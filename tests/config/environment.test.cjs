const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment } = require('../../src/config/environment');
const { validateTestDatabaseUrl } = require('../../src/config/test-environment');

const target = 'postgresql://test:secret@127.0.0.1:55432/ticketing_test';

test('accepts explicit disposable IPv4 and IPv6 targets', () => {
  for (const value of [target, target.replace('127.0.0.1', '[::1]'),
    target.replace('ticketing_test', 'ticketing_test_ci_123')]) {
    assert.equal(validateTestDatabaseUrl(value), value);
  }
});

test('rejects missing, malformed, remote, ambiguous and overridden test targets', () => {
  const invalid = [undefined, '', ' ', 'not-a-url',
    target.replace('postgresql:', 'https:'),
    target.replace('127.0.0.1', 'db.example.com'),
    target.replace('127.0.0.1', 'localhost'),
    target.replace('127.0.0.1', '0.0.0.0'),
    target.replace(':55432', ''), target.replace(':55432', ':0'),
    target.replace('test:secret@', ''), target.replace(':secret', ''),
    target.replace(':secret', ':%XX'),
    target.replace('ticketing_test', 'ticketing_dev'),
    target.replace('ticketing_test', 'postgres'),
    target.replace('ticketing_test', 'ticketing_test/other'),
    target.replace('ticketing_test', 'ticketing%5ftest'),
    `${target}?host=remote.example.com`, `${target}?schema=public`,
    `${target}?`, `${target}#ignored`, `${target} `, `${target}\n`];
  for (const value of invalid) {
    assert.throws(() => validateTestDatabaseUrl(value), (error) => {
      assert.match(error.message, /TEST_DATABASE_URL/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});

test('validates required runtime configuration without disclosing values', () => {
  const valid = { DATABASE_URL: target, JWT_SECRET: 'runtime-secret' };
  assert.deepEqual(validateEnvironment(valid), { port: 3000 });
  assert.deepEqual(validateEnvironment({ ...valid, PORT: '4567' }), { port: 4567 });
  for (const [key, value] of [['DATABASE_URL', undefined], ['DATABASE_URL', ' '],
    ['DATABASE_URL', 'postgresql://secret@'], ['JWT_SECRET', undefined],
    ['JWT_SECRET', ' '], ['PORT', 'abc'], ['PORT', '0'], ['PORT', '65536']]) {
    assert.throws(() => validateEnvironment({ ...valid, [key]: value }), (error) => {
      assert.ok(error.message.includes(key));
      assert.doesNotMatch(error.message, /runtime-secret|secret@/);
      return true;
    });
  }
});
