if (process.env.NODE_ENV === 'test') {
  require('./src/config/test-environment').configureTestEnvironment();
} else {
  require('dotenv').config({ quiet: true });
}
const { defineConfig } = require("prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
