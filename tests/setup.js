require('dotenv').config({ path: '.env.test' });

const { prisma, cleanupTestData } = require('./helpers');

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});
