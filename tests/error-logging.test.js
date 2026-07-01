const express = require('express');
const request = require('supertest');
const logger = require('../src/lib/logger');
const { errorHandler } = require('../src/middlewares/error.middleware');

describe('error logging middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs unexpected errors with structured request metadata', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const app = express();

    app.get('/boom', (req, res, next) => {
      next(new Error('database exploded'));
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      status: 'error',
      message: 'Internal server error',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        method: 'GET',
        path: '/boom',
      }),
      'Unexpected error'
    );
  });
});
