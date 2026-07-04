const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { catchAsync } = require('../middlewares/error.middleware');

const measureLatencyMs = (startedAt) => {
  const elapsedNs = process.hrtime.bigint() - startedAt;
  return Number(elapsedNs / 1000000n);
};

const checkDatabase = async () => {
  const startedAt = process.hrtime.bigint();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return {
      status: 'ok',
      latencyMs: measureLatencyMs(startedAt),
    };
  } catch (err) {
    logger.error({ err }, 'Health check database probe failed');

    return {
      status: 'error',
      latencyMs: measureLatencyMs(startedAt),
    };
  }
};

const getHealth = catchAsync(async (req, res) => {
  const database = await checkDatabase();
  const healthy = database.status === 'ok';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    services: {
      database,
    },
  });
});

module.exports = { getHealth, checkDatabase };
