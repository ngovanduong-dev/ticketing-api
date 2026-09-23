// Child-process probe: record module boundaries and stop before a real pool exists.
const Module = require('node:module');
const path = require('node:path');
const load = Module._load;
const observed = { imports: [], selected: false };
process.on('exit', () => process.stdout.write(JSON.stringify(observed)));

Module._load = function (request, parent, isMain) {
  if (['./app', './helpers', 'pg', '@prisma/adapter-pg', '@prisma/client'].includes(request)) {
    observed.imports.push(request);
  }
  if (request === 'pg') {
    return {
      ...load.call(this, request, parent, isMain),
      Pool: class {
        constructor(options) {
          observed.selected = options.connectionString === process.env.TEST_DATABASE_URL;
          observed.mode = process.env.NODE_ENV;
          throw new Error('RESOURCE_BOUNDARY_REACHED');
        }
      },
    };
  }
  return load.call(this, request, parent, isMain);
};

try {
  const loaded = require(path.resolve(__dirname, '../..', process.argv[2]));
  if (process.argv[2] === 'prisma.config.ts') {
    observed.selected = loaded.datasource.url === process.env.TEST_DATABASE_URL;
  }
} catch (error) {
  if (error.message !== 'RESOURCE_BOUNDARY_REACHED') {
    process.stderr.write(error.message);
    process.exitCode = 1;
  }
}
