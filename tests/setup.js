require('../src/config/test-environment').configureTestEnvironment();

const { prisma, cleanupTestData } = require('./helpers');

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});
