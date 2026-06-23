const rateLimit = require('express-rate-limit');

const jsonRateLimitHandler = (req, res, next, options) => {
  res.status(options.statusCode).json(options.message);
};

const createRateLimiter = ({ windowMs, max, message, skipInTest = true }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => skipInTest && process.env.NODE_ENV === 'test',
    message: { status: 'error', message },
    handler: jsonRateLimitHandler,
  });

const globalLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many auth attempts, please try again later.',
});

const bookingLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many booking requests, please wait a minute.',
});

module.exports = {
  createRateLimiter,
  globalLimiter,
  authLimiter,
  bookingLimiter,
};
