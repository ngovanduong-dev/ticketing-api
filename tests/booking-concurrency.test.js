const request = require('supertest');
const { Client } = require('pg');
const app = require('../src/app');
const {
  prisma,
  createTestUser,
  createTestCategory,
  createTestEvent,
} = require('./helpers');

// Separate connections hold the fixture lock and observe real application backends.
// No request is released until pg_blocking_pids proves the intended queue order.
async function withEventLock(eventId, run) {
  const options = {
    connectionString: process.env.TEST_DATABASE_URL,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    statement_timeout: 2000,
  };
  const locker = new Client(options);
  const observer = new Client(options);
  const pending = [];
  let locked = false;
  try {
    await locker.connect();
    await observer.connect();
    await locker.query('BEGIN');
    locked = true;
    await locker.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    await locker.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    const { rows: [{ pid }] } = await locker.query('SELECT pg_backend_pid() AS pid');
    const start = (req) => {
      const response = req.timeout({ deadline: 10000 }).then((res) => res);
      // Register rejection handling immediately; finally drains all requests.
      response.catch(() => {});
      pending.push(response);
      return response;
    };
    const waitForWriter = async (blockerPid) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const { rows } = await observer.query(`
          SELECT pid, query FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'active'
            AND wait_event_type = 'Lock'
            AND $1 = ANY(pg_blocking_pids(pid))
            AND query ILIKE '%events%'
        `, [blockerPid]);
        if (rows.length === 1) return rows[0];
        await new Promise((resolve) => setImmediate(resolve));
      }
      throw new Error(`No event writer blocked by backend ${blockerPid} within 2s`);
    };
    const release = async () => {
      await locker.query('COMMIT');
      locked = false;
    };
    await run({ locker, pid, start, waitForWriter, release });
  } finally {
    try {
      if (locked) await locker.query('ROLLBACK');
    } finally {
      await Promise.allSettled(pending);
      await Promise.all([locker.end(), observer.end()]);
    }
  }
}

async function expectCapacity(eventId, capacity, quantity) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  const confirmed = await prisma.booking.aggregate({
    where: { eventId, status: 'CONFIRMED' }, _sum: { quantity: true },
  });
  expect(event.capacity).toBe(capacity);
  expect(confirmed._sum.quantity ?? 0).toBe(quantity);
  expect(confirmed._sum.quantity ?? 0).toBeLessThanOrEqual(event.capacity);
}

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

describe('capacity updates racing with booking creation', () => {
  it('rejects a reduction queued behind a booking transaction', async () => {
    const { user: organizer, token: organizerToken } = await createTestUser('ORGANIZER');
    const { token: attendeeToken } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id, { capacity: 10 });

    await withEventLock(event.id, async ({ pid, start, waitForWriter, release }) => {
      const booking = start(request(app).post('/api/v1/bookings')
        .set('Authorization', `Bearer ${attendeeToken}`).send({ eventId: event.id, quantity: 5 }));
      const first = await waitForWriter(pid);
      expect(first.query).toMatch(/FOR UPDATE/i);
      const reduction = start(request(app).patch(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${organizerToken}`).send({ capacity: 2 }));
      const second = await waitForWriter(first.pid);
      expect(second.pid).not.toBe(first.pid);
      await release();

      expect((await booking).status).toBe(201);
      expect((await reduction).status).toBe(409);
      await expectCapacity(event.id, 10, 5);
    });
  });

  it('makes a booking queued behind a reduction use the reduced capacity', async () => {
    const { user: organizer, token: organizerToken } = await createTestUser('ORGANIZER');
    const { token: attendeeToken } = await createTestUser('ATTENDEE');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id, { capacity: 10 });

    await withEventLock(event.id, async ({ pid, start, waitForWriter, release }) => {
      const reduction = start(request(app).patch(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${organizerToken}`).send({ capacity: 2 }));
      const first = await waitForWriter(pid);
      const booking = start(request(app).post('/api/v1/bookings')
        .set('Authorization', `Bearer ${attendeeToken}`).send({ eventId: event.id, quantity: 5 }));
      const second = await waitForWriter(first.pid);
      expect(second.pid).not.toBe(first.pid);
      expect(second.query).toMatch(/FOR UPDATE/i);
      await release();

      expect((await reduction).status).toBe(200);
      expect((await booking).status).toBe(409);
      await expectCapacity(event.id, 2, 0);
      // An UPDATE also locks, but only FOR UPDATE protects the preceding decision.
      expect(first.query).toMatch(/FOR UPDATE/i);
    });
  });

  it.each(['owner', 'status', 'deleted'])('uses authoritative %s after waiting for the lock', async (change) => {
    const { user: organizer, token } = await createTestUser('ORGANIZER');
    const { user: otherOrganizer } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();
    const event = await createTestEvent(organizer.id, category.id);

    await withEventLock(event.id, async ({ locker, pid, start, waitForWriter, release }) => {
      const update = start(request(app).patch(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${token}`).send({ capacity: 2 }));
      await waitForWriter(pid);
      if (change === 'owner') {
        await locker.query('UPDATE events SET "organizerId" = $1 WHERE id = $2', [otherOrganizer.id, event.id]);
      } else if (change === 'status') {
        await locker.query("UPDATE events SET status = 'CANCELLED' WHERE id = $1", [event.id]);
      } else {
        await locker.query('DELETE FROM events WHERE id = $1', [event.id]);
      }
      await release();

      expect((await update).status).toBe({ owner: 403, status: 400, deleted: 404 }[change]);
      const persisted = await prisma.event.findUnique({ where: { id: event.id } });
      if (change === 'deleted') expect(persisted).toBeNull();
      else expect(persisted.capacity).toBe(10);
    });
  });
});
