const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createTestUser,
  createTestCategory,
  createTestEvent,
} = require('./helpers');

describe('booking race condition protection', () => {
  it('does not oversell when multiple attendees book the last ticket concurrently', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const attendees = await Promise.all(
      Array.from({ length: 10 }, () => createTestUser('ATTENDEE'))
    );

    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id, { capacity: 1 });

    const responses = await Promise.all(
      attendees.map(({ token }) =>
        request(app)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${token}`)
          .send({ eventId: event.id, quantity: 1 })
      )
    );

    const statusCounts = responses.reduce((acc, res) => {
      acc[res.status] = (acc[res.status] || 0) + 1;
      return acc;
    }, {});

    const confirmed = await prisma.booking.aggregate({
      where: { eventId: event.id, status: 'CONFIRMED' },
      _sum: { quantity: true },
      _count: true,
    });

    expect(statusCounts[201]).toBe(1);
    expect(statusCounts[409]).toBe(9);
    expect(confirmed._count).toBe(1);
    expect(confirmed._sum.quantity).toBe(1);
  });
});
