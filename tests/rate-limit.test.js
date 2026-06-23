const express = require('express');
const request = require('supertest');
const { createRateLimiter } = require('../src/middlewares/rateLimit.middleware');

describe('rate limiting middleware', () => {
  it('returns 429 with a consistent JSON response after the request limit is exceeded', async () => {
    const app = express();

    app.use(
      createRateLimiter({
        windowMs: 60 * 1000,
        max: 2,
        message: 'Too many test requests.',
        skipInTest: false,
      })
    );
    app.get('/limited', (req, res) => {
      res.json({ status: 'success' });
    });

    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(200);

    const limited = await request(app).get('/limited');

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      status: 'error',
      message: 'Too many test requests.',
    });
  });
});
