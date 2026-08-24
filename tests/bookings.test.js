const request = require('supertest');
const app = require('../src/app');
const { prisma, createTestUser, createTestCategory, createTestEvent } = require('./helpers');

describe('bookings integration', () => {
  it('allows an attendee to create a booking', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const { token } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id, { capacity: 10 });

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ eventId: event.id, quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.data.booking).toMatchObject({
      eventId: event.id,
      quantity: 2,
      status: 'CONFIRMED',
    });
  });

  it('rejects booking creation by an organizer', async () => {
    const { user: organizer, token } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id);

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ eventId: event.id, quantity: 1 });

    expect(res.status).toBe(403);
  });

  it('returns 409 when an event is sold out', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const { user: attendee } = await createTestUser('ATTENDEE');
    const { token } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id, { capacity: 1 });

    await prisma.booking.create({
      data: {
        eventId: event.id,
        userId: attendee.id,
        quantity: 1,
        totalPrice: 100000,
        status: 'CONFIRMED',
      },
    });

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ eventId: event.id, quantity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Event is sold out');
  });

  it('allows a user to cancel their own booking', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const { token } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id);

    const bookingRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ eventId: event.id, quantity: 1 });

    const res = await request(app)
      .delete(`/api/v1/bookings/${bookingRes.body.data.booking.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('CANCELLED');
  });

  it('prevents a user from cancelling another user booking', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const { token: ownerToken } = await createTestUser('ATTENDEE');
    const { token: otherToken } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id);

    const bookingRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ eventId: event.id, quantity: 1 });

    const res = await request(app)
      .delete(`/api/v1/bookings/${bookingRes.body.data.booking.id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it('rejects cancelling a booking for a past event', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const { user: attendee, token } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id, {
      date: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
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
      .delete(`/api/v1/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${token}`);

    const persisted = await prisma.booking.findUnique({ where: { id: booking.id } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cannot cancel booking for past events');
    expect(persisted.status).toBe('CONFIRMED');
  });
});
