const { ZodError } = require('zod');
const logger = require('../lib/logger');

const errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: err.flatten().fieldErrors,
    });
  }

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
  }

  if (err.code === 'P2002') {
    return res.status(409).json({
      status: 'error',
      message: `${err.meta?.target?.join(', ')} already exists`,
    });
  }

  logger.error(
    {
      err,
      requestId: req.id,
      method: req.method,
      path: req.originalUrl || req.path,
    },
    'Unexpected error'
  );

  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
};

const catchAsync = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { errorHandler, catchAsync };
