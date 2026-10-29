const { z } = require('zod');

const keySchema = z.string().min(1).max(128).regex(/^[\x21-\x7E]+$/);

function idempotencyKey(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return next();
  const parsed = keySchema.safeParse(key);
  if (!parsed.success) {
    return res.status(400).json({ status: 'error', message: 'Invalid Idempotency-Key' });
  }
  req.idempotencyKey = parsed.data;
  next();
}

module.exports = idempotencyKey;
