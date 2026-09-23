const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const target = 'postgresql://test:secret@127.0.0.1:55432/ticketing_test';
const ordinary = 'postgresql://dev:private@127.0.0.1:5432/ticketing_dev';

function probe(entry, overrides = {}, files = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'ticketing-config-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(cwd, name), content);
    }
    const env = { ...process.env };
    for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'JWT_SECRET', 'PORT',
      'NODE_ENV', 'NODE_OPTIONS', 'LOG_LEVEL']) delete env[key];
    Object.assign(env, overrides);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'import-probe.cjs'), entry], {
      cwd, env, encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { ...result, observed: JSON.parse(result.stdout) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('test setup fails before helpers/Prisma imports with missing or unsafe explicit target', () => {
  for (const explicit of [undefined, 'not-a-url', ordinary,
    target.replace('127.0.0.1', 'remote.example.com')]) {
    const result = probe('tests/setup.js', {
      NODE_ENV: 'test', DATABASE_URL: ordinary, JWT_SECRET: 'test-secret',
      ...(explicit === undefined ? {} : { TEST_DATABASE_URL: explicit }),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TEST_DATABASE_URL/);
    assert.deepEqual(result.observed.imports, []);
    assert.doesNotMatch(result.stderr, /private|remote.example.com/);
  }
});

test('absent, incomplete or malformed .env.test never falls back to ordinary .env', () => {
  for (const content of [undefined, 'JWT_SECRET=test-secret',
    'TEST_DATABASE_URL=not-a-url\nJWT_SECRET=test-secret', 'TEST_DATABASE_URL']) {
    const result = probe('tests/setup.js', { NODE_ENV: 'test' }, {
      '.env': `DATABASE_URL=${ordinary}\nJWT_SECRET=development-secret`,
      ...(content === undefined ? {} : { '.env.test': content }),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TEST_DATABASE_URL/);
    assert.deepEqual(result.observed.imports, []);
  }
});

test('test setup selects explicit target before helpers construct the pool', () => {
  for (const fromFile of [false, true]) {
    const values = { TEST_DATABASE_URL: target, JWT_SECRET: 'test-secret' };
    const result = probe('tests/setup.js', {
      DATABASE_URL: ordinary, ...(fromFile ? {} : values),
    }, fromFile ? { '.env.test': Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') } : {});
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.observed.imports.includes('./helpers'));
    assert.ok(result.observed.imports.includes('pg'));
    assert.equal(result.observed.selected, true);
    assert.equal(result.observed.mode, 'test');
  }
});

test('test setup requires JWT_SECRET before importing helpers', () => {
  const result = probe('tests/setup.js', { TEST_DATABASE_URL: target });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JWT_SECRET/);
  assert.deepEqual(result.observed.imports, []);
});

test('server rejects missing or invalid configuration before importing app or database libraries', () => {
  for (const values of [{}, { DATABASE_URL: ordinary },
    { DATABASE_URL: 'invalid', JWT_SECRET: 'test-secret' },
    { DATABASE_URL: ordinary, JWT_SECRET: 'test-secret', PORT: 'invalid' }]) {
    const result = probe('src/server.js', values);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL|JWT_SECRET|PORT/);
    assert.deepEqual(result.observed.imports, []);
  }
});

test('server loads intended environment before the application import', () => {
  const result = probe('src/server.js', {}, {
    '.env': `DATABASE_URL=${target}\nJWT_SECRET=test-secret\nNODE_ENV=production`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.observed.imports.includes('./app'));
  assert.ok(result.observed.imports.includes('pg'));
  assert.equal(result.observed.mode, 'production');
});

test('direct app and Prisma imports cannot bypass their configuration guards', () => {
  for (const entry of ['src/app.js', 'src/lib/prisma.js']) {
    for (const values of [{}, { NODE_ENV: 'test', DATABASE_URL: ordinary,
      TEST_DATABASE_URL: target, JWT_SECRET: 'test-secret' }]) {
      const result = probe(entry, values);
      assert.equal(result.status, 1);
      assert.deepEqual(result.observed.imports, []);
    }
  }
});

test('Prisma CLI configuration in test mode fails closed and selects the same target', () => {
  const missing = probe('prisma.config.ts', { NODE_ENV: 'test', DATABASE_URL: ordinary });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /TEST_DATABASE_URL/);
  const valid = probe('prisma.config.ts', {
    NODE_ENV: 'test', DATABASE_URL: ordinary, TEST_DATABASE_URL: target, JWT_SECRET: 'test-secret',
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.observed.selected, true);
});
