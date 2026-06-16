const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const prisma = require('../src/lib/prisma');

const TEST_PREFIX = `vitest-${Date.now()}`;

const uniqueTestId = (label) => `${TEST_PREFIX}-${label}-${Date.now()}-${randomUUID()}`;

const uniqueTestEmail = (label) => `${uniqueTestId(label)}@example.com`;

const signToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

const createTestUser = async (role = 'ATTENDEE', overrides = {}) => {
  const unique = uniqueTestId(role.toLowerCase());

  const user = await prisma.user.create({
    data: {
      email: `${unique}@example.com`,
      password: 'not-used',
      name: `Test ${role}`,
      role,
      ...overrides,
    },
  });

  return { user, token: signToken(user.id) };
};

const createTestCategory = async (overrides = {}) => {
  const unique = uniqueTestId('category');

  return prisma.category.create({
    data: {
      name: unique,
      slug: unique,
      ...overrides,
    },
  });
};

const createTestEvent = async (organizerId, categoryId, overrides = {}) => {
  const unique = uniqueTestId('event');

  return prisma.event.create({
    data: {
      title: unique,
      description: 'Test event description',
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      venue: 'Test venue',
      capacity: 10,
      price: 100000,
      status: 'PUBLISHED',
      organizerId,
      categoryId,
      ...overrides,
    },
  });
};

const cleanupTestData = async () => {
  await prisma.booking.deleteMany({
    where: {
      OR: [
        { user: { is: { email: { startsWith: TEST_PREFIX } } } },
        { event: { is: { title: { startsWith: TEST_PREFIX } } } },
        { event: { is: { category: { is: { slug: { startsWith: TEST_PREFIX } } } } } },
        { event: { is: { organizer: { is: { email: { startsWith: TEST_PREFIX } } } } } },
      ],
    },
  });

  await prisma.event.deleteMany({
    where: {
      OR: [
        { title: { startsWith: TEST_PREFIX } },
        { category: { is: { slug: { startsWith: TEST_PREFIX } } } },
        { organizer: { is: { email: { startsWith: TEST_PREFIX } } } },
      ],
    },
  });

  await prisma.category.deleteMany({
    where: { slug: { startsWith: TEST_PREFIX } },
  });

  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
};

module.exports = {
  prisma,
  uniqueTestId,
  uniqueTestEmail,
  createTestUser,
  createTestCategory,
  createTestEvent,
  cleanupTestData,
};
