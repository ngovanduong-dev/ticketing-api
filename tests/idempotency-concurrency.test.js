const request = require('supertest');
const { randomUUID } = require('node:crypto');
const app = require('../src/app');
const { prisma, createTestUser, createTestCategory, createTestEvent } = require('./helpers');
const { executeWithIdempotency, computeDeterministicPayloadHash: hash } = require('../src/services/idempotency.service');
const { bookInTransaction } = require('../src/services/booking.service');
const { bookWithOptimisticLock: optimistic, bookMultiEventBundleDeadlockFree: bundle,
  runConcurrencyBenchmark: benchmark } = require('../src/services/concurrencyStrategies.service');

async function fixture(capacity = 5) {
  const { user: organizer, token: organizerToken } = await createTestUser('ORGANIZER');
  const { user: attendee, token } = await createTestUser();
  const category = await createTestCategory();
  const event = await createTestEvent(organizer.id, category.id, { capacity });
  return { organizer, organizerToken, attendee, token, category, event };
}

async function inventory(eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  const result = await prisma.booking.aggregate({ where: { eventId, status: 'CONFIRMED' }, _sum: { quantity: true } });
  return { available: event.capacity - (result._sum.quantity ?? 0), version: event.version };
}

function post(token, body, key, path = '/api/v1/bookings') {
  const req = request(app).post(path).set('Authorization', `Bearer ${token}`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send(body);
}

describe('transactional idempotency', () => {
  it('canonicalizes nested objects, preserves array order and hashes every nested value', () => {
    expect(hash({ b: [{ y: 2, x: 1 }], a: null })).toBe(hash({ a: null, b: [{ x: 1, y: 2 }] }));
    expect(hash({ items: [{ eventId: 'a', quantity: 1 }] })).not.toBe(hash({ items: [{ eventId: 'a', quantity: 2 }] }));
    expect(hash({ items: [1, 2] })).not.toBe(hash({ items: [2, 1] }));
    expect(hash({ a: null })).not.toBe(hash({}));
  });

  it('replays the exact HTTP response, rejects changed payloads and isolates accounts and endpoints', async () => {
    const f = await fixture();
    const key = randomUUID();
    const body = { eventId: f.event.id, quantity: 1 };
    const first = await post(f.token, body, key);
    const second = await post(f.token, { quantity: 1, eventId: f.event.id }, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(await inventory(f.event.id)).toEqual({ available: 4, version: 2 });
    const mismatch = await post(f.token, { ...body, quantity: 2 }, key);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
    const other = await createTestUser();
    expect((await post(other.token, body, key)).status).toBe(403);
    expect((await post(f.token, { items: [body] }, key, '/api/v1/bookings/batch')).status).toBe(403);
    expect(await prisma.booking.count({ where: { eventId: f.event.id } })).toBe(1);
  });

  it('allows only one effect across simultaneous first requests for a new key', async () => {
    const f = await fixture(10);
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 20 }, () =>
      post(f.token, { eventId: f.event.id, quantity: 1 }, key)));
    expect(responses.every((res) => [201, 409].includes(res.status))).toBe(true);
    const successes = responses.filter((res) => res.status === 201);
    expect(successes.length).toBeGreaterThan(0);
    expect(new Set(successes.map((res) => res.body.data.booking.id)).size).toBe(1);
    expect(await inventory(f.event.id)).toEqual({ available: 9, version: 2 });
  });

  it('returns in-flight conflict while a handler owns the key and then replays', async () => {
    const f = await fixture();
    const key = randomUUID();
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const ready = new Promise((resolve) => { entered = resolve; });
    const body = { eventId: f.event.id, quantity: 1 };
    const first = executeWithIdempotency({ prisma, idempotencyKey: key, userId: f.attendee.id,
      endpoint: 'POST /api/v1/bookings', requestBody: body, handler: async (tx) => {
        const booking = await bookInTransaction(tx, { ...body, userId: f.attendee.id });
        entered();
        await gate;
        return { statusCode: 201, body: { status: 'success', data: { booking } } };
      } });
    // Propagate startup failures instead of leaving the synchronization gate pending.
    try {
      await Promise.race([ready, first]);
      const conflict = await post(f.token, body, key);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe('IDEMPOTENCY_REQUEST_IN_FLIGHT');
    } finally { release(); await first; }
    const replay = await post(f.token, body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await inventory(f.event.id)).toEqual({ available: 4, version: 2 });
  });

  it('rolls back booking and key when response persistence fails, then permits retry', async () => {
    const f = await fixture();
    const key = randomUUID();
    const body = { eventId: f.event.id, quantity: 1 };
    await expect(executeWithIdempotency({ prisma, idempotencyKey: key, userId: f.attendee.id,
      endpoint: 'POST /api/v1/bookings', requestBody: body, handler: async (tx) => {
        await bookInTransaction(tx, { ...body, userId: f.attendee.id });
        // PostgreSQL rejects this JSON string after the booking INSERT.
        return { statusCode: 201, body: { invalid: '\u0000' } };
      } })).rejects.toThrow();
    expect(await inventory(f.event.id)).toEqual({ available: 5, version: 1 });
    expect(await prisma.idempotencyRecord.findUnique({ where: { key } })).toBeNull();
    expect((await post(f.token, body, key)).status).toBe(201);
    expect(await inventory(f.event.id)).toEqual({ available: 4, version: 2 });
  });

  it('validates headers and booking payloads before reserving keys', async () => {
    const f = await fixture();
    const body = { eventId: f.event.id, quantity: 1 };
    expect((await post(f.token, body, 'x'.repeat(129))).status).toBe(400);
    expect((await post(f.token, body, 'invalid key')).status).toBe(400);
    const key = randomUUID();
    expect((await post(f.token, { ...body, quantity: 0 }, key)).status).toBe(400);
    expect(await prisma.idempotencyRecord.findUnique({ where: { key } })).toBeNull();
    expect((await post(f.organizerToken, body, key)).status).toBe(403);
    expect((await post(f.token, body, key)).status).toBe(201);
  });

  it('replays persisted responses through an independent database client', async () => {
    const { PrismaClient } = require('@prisma/client');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const f = await fixture();
    const key = randomUUID();
    const body = { eventId: f.event.id, quantity: 1 };
    const first = await post(f.token, body, key);
    const independent = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) });
    try {
      const replay = await executeWithIdempotency({ prisma: independent, idempotencyKey: key,
        userId: f.attendee.id, endpoint: 'POST /api/v1/bookings', requestBody: body,
        handler: () => { throw new Error('Replay executed the handler'); } });
      expect(replay).toEqual({ statusCode: 201, body: first.body, replayed: true });
    } finally { await independent.$disconnect(); }
  });

  it('never reclaims an expired persisted in-progress record automatically', async () => {
    const f = await fixture();
    const key = randomUUID();
    const body = { eventId: f.event.id, quantity: 1 };
    await prisma.idempotencyRecord.create({ data: { key, userId: f.attendee.id,
      endpoint: 'POST /api/v1/bookings', payloadHash: hash(body), status: 'IN_PROGRESS', lockedUntil: new Date(0) } });
    expect((await post(f.token, body, key)).status).toBe(409);
    expect(await inventory(f.event.id)).toEqual({ available: 5, version: 1 });
  });
});

describe('booking strategies and latency measurements', () => {
  it.each([1, 5])('preserves inventory under 25 CAS requests with %i attempts', async (maxRetries) => {
    const f = await fixture();
    const args = { prisma, eventId: f.event.id, userId: f.attendee.id, quantity: 1, maxRetries };
    const metrics = await benchmark(Array.from({ length: 25 }, () => () => optimistic(args)));
    expect(metrics.results.every((result) => result.ok)).toBe(true);
    const outcomes = metrics.results.map((result) => result.value.status);
    expect(outcomes.every((status) => ['SUCCESS', 'VERSION_CONFLICT', 'INSUFFICIENT_TICKETS'].includes(status))).toBe(true);
    const successes = outcomes.filter((status) => status === 'SUCCESS').length;
    expect(successes).toBeGreaterThan(0);
    expect(successes).toBeLessThanOrEqual(5);
    if (maxRetries === 5) expect(successes).toBe(5);
    expect(await inventory(f.event.id)).toEqual({ available: 5 - successes, version: 1 + successes });
    // One attempt can leave inventory unsold; subsequent requests demonstrate progress.
    for (let remaining = 5 - successes; remaining > 0; remaining--) {
      expect((await optimistic(args)).status).toBe('SUCCESS');
    }
    expect(await inventory(f.event.id)).toEqual({ available: 0, version: 6 });
    expect(await prisma.booking.count({ where: { eventId: f.event.id } })).toBe(5);
    for (const metric of ['p50Ms', 'p95Ms', 'p99Ms', 'throughputRps']) {
      expect(Number.isFinite(metrics[metric])).toBe(true);
      expect(metrics[metric]).toBeGreaterThan(0);
    }
    expect(metrics.p50Ms).toBeLessThanOrEqual(metrics.p95Ms);
    expect(metrics.p95Ms).toBeLessThanOrEqual(metrics.p99Ms);
    const { results, ...telemetry } = metrics;
    console.log(JSON.stringify({ workload: '25 CAS requests / 5 tickets', maxRetries, successes, ...telemetry }));
  });

  it.each(['booking', 'capacity', 'date', 'event cancellation', 'booking cancellation'])(
    'rejects a stale CAS snapshot after %s commits', async (change) => {
      const f = await fixture(2);
      let bookingId;
      if (change === 'booking cancellation') {
        const response = await post(f.token, { eventId: f.event.id, quantity: 1 });
        bookingId = response.body.data.booking.id;
      }
      let snapshotReady;
      let release;
      const ready = new Promise((resolve) => { snapshotReady = resolve; });
      const gate = new Promise((resolve) => { release = resolve; });
      // Pause after both reads, immediately before the real PostgreSQL CAS.
      const scheduled = { $transaction: (fn, options) => prisma.$transaction((tx) => fn({
        booking: tx.booking,
        event: { findUnique: tx.event.findUnique, updateMany: async (query) => {
          snapshotReady();
          await gate;
          return tx.event.updateMany(query);
        } },
      }), options) };
      const pending = optimistic({ prisma: scheduled, eventId: f.event.id, userId: f.attendee.id, quantity: 1, maxRetries: 1 });
      try {
        await Promise.race([ready, pending]);
        if (change === 'booking') {
          expect((await post(f.token, { eventId: f.event.id, quantity: 1 })).status).toBe(201);
        } else if (change === 'booking cancellation') {
          expect((await request(app).delete(`/api/v1/bookings/${bookingId}`)
            .set('Authorization', `Bearer ${f.token}`)).status).toBe(200);
        } else if (change === 'event cancellation') {
          expect((await request(app).delete(`/api/v1/events/${f.event.id}`)
            .set('Authorization', `Bearer ${f.organizerToken}`)).status).toBe(204);
        } else {
          const data = change === 'capacity' ? { capacity: 1 } : { date: new Date(Date.now() + 86400000).toISOString() };
          expect((await request(app).patch(`/api/v1/events/${f.event.id}`)
            .set('Authorization', `Bearer ${f.organizerToken}`).send(data)).status).toBe(200);
        }
      } finally { release(); await pending; }
      expect((await pending).status).toBe('VERSION_CONFLICT');
      const state = await inventory(f.event.id);
      expect(state.available).toBeGreaterThanOrEqual(0);
      expect(state.version).toBe(change === 'booking cancellation' ? 3 : 2);
    });

  it('serializes reversed bundles without deadlocks and rejects sold-out bundles atomically', async () => {
    const f = await fixture(10);
    const beta = await createTestEvent(f.organizer.id, f.category.id, { capacity: 10 });
    const items = [{ eventId: f.event.id, quantity: 1 }, { eventId: beta.id, quantity: 1 }];
    const metrics = await benchmark(Array.from({ length: 20 }, (_, i) => () =>
      bundle({ prisma, userId: f.attendee.id, items: i % 2 ? [...items].reverse() : items })));
    expect(metrics.results.filter((result) => !result.ok)).toEqual([]);
    expect(metrics.results.filter((result) => result.value.status === 'SUCCESS')).toHaveLength(10);
    expect(metrics.results.filter((result) => result.value.status === 'INSUFFICIENT_TICKETS')).toHaveLength(10);
    expect(await inventory(f.event.id)).toEqual({ available: 0, version: 11 });
    expect(await inventory(beta.id)).toEqual({ available: 0, version: 11 });
    expect(await prisma.booking.count({ where: { eventId: { in: [f.event.id, beta.id] } } })).toBe(20);
    const { results, ...telemetry } = metrics;
    console.log(JSON.stringify({ workload: '20 reversed bundles / 10 tickets per event', ...telemetry }));
  });

  it('aggregates duplicate bundle items, replays nested bodies and rolls back partial availability', async () => {
    const f = await fixture(3);
    const beta = await createTestEvent(f.organizer.id, f.category.id, { capacity: 1 });
    const items = [{ eventId: f.event.id, quantity: 1 }, { eventId: f.event.id, quantity: 1 }];
    const key = randomUUID();
    const first = await post(f.token, { items }, key, '/api/v1/bookings/batch');
    expect(first.status).toBe(201);
    expect(first.body.data.bookings).toHaveLength(1);
    expect(first.body.data.bookings[0].quantity).toBe(2);
    expect((await post(f.token, { items }, key, '/api/v1/bookings/batch')).body).toEqual(first.body);
    expect((await post(f.token, { items: [{ ...items[0], quantity: 3 }] }, key, '/api/v1/bookings/batch')).status).toBe(422);
    expect((await bundle({ prisma, userId: f.attendee.id, items: [
      { eventId: beta.id, quantity: 1 }, { eventId: f.event.id, quantity: 2 },
    ] })).status).toBe('INSUFFICIENT_TICKETS');
    expect(await inventory(beta.id)).toEqual({ available: 1, version: 1 });
    expect(await inventory(f.event.id)).toEqual({ available: 1, version: 2 });
  });

  it('validates strategies and preserves event eligibility', async () => {
    const f = await fixture();
    const args = { prisma, userId: f.attendee.id, eventId: f.event.id, quantity: 1 };
    await expect(optimistic({ ...args, maxRetries: 0 })).rejects.toThrow();
    await expect(optimistic({ ...args, quantity: -1 })).rejects.toThrow();
    await expect(bundle({ ...args, items: [] })).rejects.toThrow();
    expect((await optimistic({ ...args, eventId: randomUUID() })).status).toBe('NOT_FOUND');
    expect((await bundle({ ...args, items: [{ eventId: randomUUID(), quantity: 1 }] })).status).toBe('NOT_FOUND');
    for (const data of [{ status: 'DRAFT' }, { status: 'PUBLISHED', date: new Date(0) }]) {
      await prisma.event.update({ where: { id: f.event.id }, data });
      expect((await optimistic(args)).status).toBe('INVALID_EVENT');
      expect((await bundle({ ...args, items: [{ eventId: f.event.id, quantity: 1 }] })).status).toBe('INVALID_EVENT');
    }
    expect(await inventory(f.event.id)).toEqual({ available: 5, version: 1 });
  });

  it('increments versions for cancellation and event updates', async () => {
    const f = await fixture(1);
    const booked = await post(f.token, { eventId: f.event.id, quantity: 1 });
    expect((await request(app).delete(`/api/v1/bookings/${booked.body.data.booking.id}`)
      .set('Authorization', `Bearer ${f.token}`)).status).toBe(200);
    expect(await inventory(f.event.id)).toEqual({ available: 1, version: 3 });
    expect((await request(app).patch(`/api/v1/events/${f.event.id}`)
      .set('Authorization', `Bearer ${f.organizerToken}`).send({ capacity: 2 })).status).toBe(200);
    expect(await inventory(f.event.id)).toEqual({ available: 2, version: 4 });
    expect((await request(app).delete(`/api/v1/events/${f.event.id}`)
      .set('Authorization', `Bearer ${f.organizerToken}`)).status).toBe(204);
    expect((await inventory(f.event.id)).version).toBe(5);
  });

  it('reports empty workloads and includes rejected task latencies', async () => {
    expect(await benchmark([])).toMatchObject({ totalRequests: 0, throughputRps: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, results: [] });
    const result = await benchmark([() => { throw new Error('failure'); }, async () => 42]);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[1]).toEqual({ ok: true, value: 42 });
    expect(result.p99Ms).toBeGreaterThan(0);
  });
});
