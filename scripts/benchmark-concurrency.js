process.env.NODE_ENV = 'test';
require('../src/config/test-environment').configureTestEnvironment();
const { prisma, createTestUser, createTestCategory, createTestEvent, cleanupTestData } = require('../tests/helpers');
const { bookInTransaction } = require('../src/services/booking.service');
const { bookWithOptimisticLock, bookMultiEventBundleDeadlockFree, runConcurrencyBenchmark,
  transactionOptions } = require('../src/services/concurrencyStrategies.service');

async function main() {
  const [{ version }] = await prisma.$queryRaw`SELECT version()`;
  console.log(JSON.stringify({ node: process.version, platform: process.platform, database: version,
    poolMax: 10, scope: 'service calls; includes connection-pool queueing; no HTTP' }));
  const { user: organizer } = await createTestUser('ORGANIZER');
  const { user: attendee } = await createTestUser();
  const category = await createTestCategory();
  for (const strategy of ['pessimistic', 'optimistic-1', 'optimistic-5', 'ordered-bundle']) {
    const capacity = strategy === 'ordered-bundle' ? 10 : 5;
    const count = strategy === 'ordered-bundle' ? 20 : 25;
    const event = await createTestEvent(organizer.id, category.id, { capacity });
    const second = strategy === 'ordered-bundle'
      ? await createTestEvent(organizer.id, category.id, { capacity }) : null;
    const args = { prisma, eventId: event.id, userId: attendee.id, quantity: 1 };
    const tasks = Array.from({ length: count }, (_, index) => async () => {
      if (strategy === 'pessimistic') {
        try {
          await prisma.$transaction((tx) => bookInTransaction(tx, args), transactionOptions);
          return { status: 'SUCCESS' };
        } catch (error) {
          if (error.isOperational && error.statusCode === 409) return { status: 'INSUFFICIENT_TICKETS' };
          throw error;
        }
      }
      if (second) {
        const items = [{ eventId: event.id, quantity: 1 }, { eventId: second.id, quantity: 1 }];
        return bookMultiEventBundleDeadlockFree({ ...args, items: index % 2 ? items.reverse() : items });
      }
      return bookWithOptimisticLock({ ...args, maxRetries: strategy === 'optimistic-1' ? 1 : 5 });
    });
    const { results, ...metrics } = await runConcurrencyBenchmark(tasks);
    const outcomes = {};
    for (const result of results) {
      const status = result.ok ? result.value.status : 'UNEXPECTED_ERROR';
      outcomes[status] = (outcomes[status] ?? 0) + 1;
      if (!result.ok) process.exitCode = 1;
    }
    console.log(JSON.stringify({ strategy, capacityPerEvent: capacity, ...metrics, outcomes }));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { await cleanupTestData(); }
  finally { await prisma.$disconnect(); }
});
