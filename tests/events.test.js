const request = require('supertest');
const app = require('../src/app');
const { uniqueTestId, createTestUser, createTestCategory, createTestEvent } = require('./helpers');

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

  it('gets an event by id', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id);

    const res = await request(app).get(`/api/v1/events/${event.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.event.id).toBe(event.id);
  });
});
