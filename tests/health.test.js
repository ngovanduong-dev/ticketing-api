const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');
const logger = require('../src/lib/logger');

describe('health check', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 when the database probe succeeds', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      services: {
        database: {
          status: 'ok',
        },
      },
    });
    expect(res.body.timestamp).toEqual(expect.any(String));
    expect(res.body.uptimeSeconds).toEqual(expect.any(Number));
    expect(res.body.services.database.latencyMs).toEqual(expect.any(Number));
  });

  it('returns 503 when the database probe fails', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('database unavailable'));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'degraded',
      services: {
        database: {
          status: 'error',
        },
      },
    });
    expect(res.body.services.database.latencyMs).toEqual(expect.any(Number));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Health check database probe failed'
    );
  });
});
