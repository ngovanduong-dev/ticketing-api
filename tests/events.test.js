const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  uniqueTestId,
  createTestUser,
  createTestCategory,
  createTestEvent,
} = require('./helpers');

describe('events integration', () => {
  it('allows an organizer to create an event', async () => {
    const { token } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: uniqueTestId('created-event'),
        description: 'Created through integration test',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        venue: 'Integration venue',
        capacity: 50,
        price: 100000,
        categoryId: category.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.event.categoryId).toBe(category.id);
    expect(res.body.data.event.organizer).toBeDefined();
  });

  it('rejects event creation by an attendee', async () => {
    const { token } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: uniqueTestId('attendee-event'),
        description: 'Attendee should not create this',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        venue: 'Integration venue',
        capacity: 50,
        price: 100000,
        categoryId: category.id,
      });

    expect(res.status).toBe(403);
  });

  it('rejects events with a past date', async () => {
    const { token } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: uniqueTestId('past-event'),
        description: 'Past event should be rejected',
        date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        venue: 'Integration venue',
        capacity: 50,
        price: 100000,
        categoryId: category.id,
      });

    expect(res.status).toBe(400);
  });

  it('lists published events with pagination metadata', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id);

    const res = await request(app).get('/api/v1/events').query({ page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.events.some((item) => item.id === event.id)).toBe(true);
    expect(res.body.data.pagination).toMatchObject({
      page: 1,
      limit: 10,
    });
  });

  it('searches published events by title case-insensitively', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const keyword = uniqueTestId('unique-search-keyword');
    const event = await createTestEvent(organizer.id, category.id, {
      title: `Backend ${keyword} Conference`,
    });

    await createTestEvent(organizer.id, category.id, {
      title: uniqueTestId('unrelated-event'),
    });

    const res = await request(app)
      .get('/api/v1/events')
      .query({ q: keyword.toUpperCase(), page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.events.map((item) => item.id)).toContain(event.id);
    expect(res.body.data.events.every((item) => item.title.toLowerCase().includes(keyword.toLowerCase()))).toBe(true);
  });

  it('returns an empty list when keyword search has no matches', async () => {
    const res = await request(app)
      .get('/api/v1/events')
      .query({ q: uniqueTestId('no-search-match'), page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(0);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('rejects an overly long search query', async () => {
    const res = await request(app)
      .get('/api/v1/events')
      .query({ q: 'a'.repeat(101) });

    expect(res.status).toBe(400);
  });

  it('gets an event by id', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id);

    const res = await request(app).get(`/api/v1/events/${event.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.event.id).toBe(event.id);
  });

  it('prevents another organizer from updating an event', async () => {
    const { user: owner } = await createTestUser('ORGANIZER');
    const { token: otherOrganizerToken } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const event = await createTestEvent(owner.id, category.id);

    const res = await request(app)
      .patch(`/api/v1/events/${event.id}`)
      .set('Authorization', `Bearer ${otherOrganizerToken}`)
      .send({ venue: 'Unauthorized venue change' });

    const persisted = await prisma.event.findUnique({ where: { id: event.id } });

    expect(res.status).toBe(403);
    expect(persisted.venue).toBe(event.venue);
  });

  it('prevents another organizer from cancelling an event', async () => {
    const { user: owner } = await createTestUser('ORGANIZER');
    const { token: otherOrganizerToken } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const event = await createTestEvent(owner.id, category.id);

    const res = await request(app)
      .delete(`/api/v1/events/${event.id}`)
      .set('Authorization', `Bearer ${otherOrganizerToken}`);

    const persisted = await prisma.event.findUnique({ where: { id: event.id } });

    expect(res.status).toBe(403);
    expect(persisted.status).toBe('PUBLISHED');
  });

  it('soft-cancels an event without cancelling confirmed bookings (characterization)', async () => {
    const { user: organizer, token } = await createTestUser('ORGANIZER');
    const { user: attendee } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id);
    const booking = await prisma.booking.create({
      data: {
        eventId: event.id,
        userId: attendee.id,
        quantity: 1,
        totalPrice: 100000,
        status: 'CONFIRMED',
      },
    });

    const res = await request(app)
      .delete(`/api/v1/events/${event.id}`)
      .set('Authorization', `Bearer ${token}`);

    const [persistedEvent, persistedBooking] = await Promise.all([
      prisma.event.findUnique({ where: { id: event.id } }),
      prisma.booking.findUnique({ where: { id: booking.id } }),
    ]);

    expect(res.status).toBe(204);
    expect(persistedEvent.status).toBe('CANCELLED');
    expect(persistedBooking.status).toBe('CONFIRMED');
  });

  it('allows updating a non-date field on an already-past event (characterization)', async () => {
    const { user: organizer, token } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id, {
      date: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const updatedVenue = 'Updated past-event venue';

    const res = await request(app)
      .patch(`/api/v1/events/${event.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ venue: updatedVenue });

    const persisted = await prisma.event.findUnique({ where: { id: event.id } });

    expect(res.status).toBe(200);
    expect(res.body.data.event.venue).toBe(updatedVenue);
    expect(persisted.venue).toBe(updatedVenue);
  });

  it('allows reducing capacity below confirmed quantity (characterization)', async () => {
    const { user: organizer, token } = await createTestUser('ORGANIZER');
    const { user: attendee } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id, { capacity: 10 });
    await prisma.booking.create({
      data: {
        eventId: event.id,
        userId: attendee.id,
        quantity: 5,
        totalPrice: 500000,
        status: 'CONFIRMED',
      },
    });

    const res = await request(app)
      .patch(`/api/v1/events/${event.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ capacity: 2 });

    const [persistedEvent, confirmed] = await Promise.all([
      prisma.event.findUnique({ where: { id: event.id } }),
      prisma.booking.aggregate({
        where: { eventId: event.id, status: 'CONFIRMED' },
        _sum: { quantity: true },
      }),
    ]);

    expect(res.status).toBe(200);
    expect(persistedEvent.capacity).toBe(2);
    expect(confirmed._sum.quantity).toBe(5);
  });
});
