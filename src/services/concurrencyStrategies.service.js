const { performance } = require('node:perf_hooks');
const { Prisma } = require('@prisma/client');
const { z } = require('zod');

const itemSchema = z.object({ eventId: z.string().uuid(), quantity: z.number().int().min(1).max(10) });
const bundleSchema = z.array(itemSchema).min(1).max(50);
const transactionOptions = { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 };

async function availableTickets(tx, event) {
  const confirmed = await tx.booking.aggregate({
    where: { eventId: event.id, status: 'CONFIRMED' }, _sum: { quantity: true },
  });
  return event.capacity - (confirmed._sum.quantity ?? 0);
}

function unavailable(event) {
  if (!event) return 'NOT_FOUND';
  if (event.status !== 'PUBLISHED' || new Date(event.date) <= new Date()) return 'INVALID_EVENT';
  return null;
}

function createConfirmedBooking(tx, event, userId, quantity) {
  return tx.booking.create({
    data: { eventId: event.id, userId, quantity, totalPrice: new Prisma.Decimal(event.price).mul(quantity), status: 'CONFIRMED' },
    include: { event: { select: { id: true, title: true, date: true, venue: true, price: true } } },
  });
}

async function bookWithOptimisticLock({ prisma, eventId, userId, quantity, maxRetries = 3 }) {
  itemSchema.parse({ eventId, quantity });
  z.number().int().min(1).max(100).parse(maxRetries);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const outcome = await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id: eventId } });
      const status = unavailable(event);
      if (status) return { status };
      if (await availableTickets(tx, event) < quantity) return { status: 'INSUFFICIENT_TICKETS' };
      // Every participating inventory writer increments this version under the event lock.
      const changed = await tx.event.updateMany({
        where: { id: eventId, version: event.version }, data: { version: { increment: 1 } },
      });
      if (changed.count === 0) return { status: 'VERSION_CONFLICT' };
      return { status: 'SUCCESS', booking: await createConfirmedBooking(tx, event, userId, quantity) };
    }, transactionOptions);
    if (outcome.status !== 'VERSION_CONFLICT' || attempt === maxRetries - 1) return outcome;
  }
}

async function bookBundleInTransaction(tx, { userId, items }) {
  bundleSchema.parse(items);
  const quantities = new Map();
  for (const { eventId, quantity } of items) quantities.set(eventId, (quantities.get(eventId) ?? 0) + quantity);
  for (const quantity of quantities.values()) z.number().int().max(10).parse(quantity);
  // Let PostgreSQL use one collation and lock order for every bundle.
  const events = await tx.$queryRaw`
    SELECT * FROM "events" WHERE "id" IN (${Prisma.join([...quantities.keys()])})
    ORDER BY "id" ASC FOR UPDATE
  `;
  if (events.length !== quantities.size) return { status: 'NOT_FOUND' };
  for (const event of events) {
    const status = unavailable(event);
    if (status) return { status, failedEventId: event.id };
    if (await availableTickets(tx, event) < quantities.get(event.id)) {
      return { status: 'INSUFFICIENT_TICKETS', failedEventId: event.id };
    }
  }
  const bookings = [];
  for (const event of events) {
    await tx.event.update({ where: { id: event.id }, data: { version: { increment: 1 } } });
    bookings.push(await createConfirmedBooking(tx, event, userId, quantities.get(event.id)));
  }
  return { status: 'SUCCESS', bookings };
}

async function bookMultiEventBundleDeadlockFree({ prisma, userId, items }) {
  return prisma.$transaction((tx) => bookBundleInTransaction(tx, { userId, items }), transactionOptions);
}

async function runConcurrencyBenchmark(tasks) {
  const latencies = [];
  const started = performance.now();
  const results = await Promise.all(tasks.map(async (fn) => {
    const start = performance.now();
    try { return { ok: true, value: await fn() }; }
    catch (error) { return { ok: false, error }; }
    finally { latencies.push(performance.now() - start); }
  }));
  const totalWallMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const percentile = (p) => latencies.length ? latencies[Math.ceil(p * latencies.length) - 1] : 0;
  return {
    totalRequests: tasks.length, totalWallMs,
    throughputRps: tasks.length && totalWallMs > 0 ? tasks.length * 1000 / totalWallMs : 0,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), results,
  };
}

module.exports = { bookWithOptimisticLock, bookMultiEventBundleDeadlockFree, bookBundleInTransaction,
  runConcurrencyBenchmark, availableTickets, createConfirmedBooking, transactionOptions, bundleSchema };
