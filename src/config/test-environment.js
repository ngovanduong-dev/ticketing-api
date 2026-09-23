const { validateDatabaseUrl, validateEnvironment } = require('./environment');

function validateTestDatabaseUrl(value) {
  const url = validateDatabaseUrl(value, 'TEST_DATABASE_URL');
  if (!['127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.port || Number(url.port) < 1 || !url.username || !url.password ||
      !/^\/ticketing_test(?:_[a-z0-9_]+)?$/.test(url.pathname) ||
      value.includes('?') || value.includes('#')) {
    throw new Error(
      'TEST_DATABASE_URL must identify a disposable loopback PostgreSQL database: ' +
      'use 127.0.0.1 or [::1], an explicit port and credentials, ' +
      'a ticketing_test or ticketing_test_* database, and no query or fragment'
    );
  }
  return value;
}

function configureTestEnvironment(env = process.env) {
  const { error } = require('dotenv').config({
    path: '.env.test', processEnv: env, quiet: true,
  });
  if (error && error.code !== 'ENOENT') {
    throw new Error('Unable to read .env.test');
  }
  const databaseUrl = validateTestDatabaseUrl(env.TEST_DATABASE_URL);
  // Validate the complete configuration before changing the application's target.
  validateEnvironment({ ...env, DATABASE_URL: databaseUrl });
  env.NODE_ENV = 'test';
  env.DATABASE_URL = databaseUrl;
}

function assertTestDatabaseSelected(env = process.env) {
  if (env.NODE_ENV === 'test' &&
      env.DATABASE_URL !== validateTestDatabaseUrl(env.TEST_DATABASE_URL)) {
    throw new Error('Test database must be selected before importing application resources');
  }
}

module.exports = { validateTestDatabaseUrl, configureTestEnvironment, assertTestDatabaseSelected };
