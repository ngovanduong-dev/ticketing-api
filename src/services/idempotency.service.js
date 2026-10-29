const { createHash } = require('node:crypto');

// Sort objects recursively without discarding nested keys or changing array order.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeDeterministicPayloadHash(payload) {
  return createHash('sha256').update(canonicalJson(payload ?? {}), 'utf8').digest('hex');
}

const conflict = (statusCode, error) => ({ statusCode, body: { error }, replayed: false });

// The handler must use the supplied transaction for every durable effect.
async function executeWithIdempotency({ prisma, idempotencyKey, userId, endpoint, requestBody, handler }) {
  const payloadHash = computeDeterministicPayloadHash(requestBody);
  return prisma.$transaction(async (tx) => {
    const [{ acquired }] = await tx.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0)) AS acquired
    `;
    if (!acquired) return conflict(409, 'IDEMPOTENCY_REQUEST_IN_FLIGHT');

    const existing = await tx.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
    if (existing) {
      if (existing.userId !== String(userId) || existing.endpoint !== endpoint) {
        return conflict(403, 'IDEMPOTENCY_KEY_OWNERSHIP_VIOLATION');
      }
      if (existing.payloadHash !== payloadHash) return conflict(422, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      if (existing.status === 'COMPLETED') {
        return { statusCode: existing.responseStatus, body: existing.responseBody, replayed: true };
      }
      // A deadline alone never authorizes a second execution.
      return conflict(409, 'IDEMPOTENCY_REQUEST_IN_FLIGHT');
    }

    await tx.idempotencyRecord.create({ data: {
      key: idempotencyKey, userId: String(userId), endpoint, payloadHash,
      status: 'IN_PROGRESS', lockedUntil: new Date(Date.now() + 30000),
    } });
    const result = await handler(tx);
    const body = JSON.parse(JSON.stringify(result.body));
    await tx.idempotencyRecord.update({
      where: { key: idempotencyKey },
      data: { status: 'COMPLETED', responseStatus: result.statusCode, responseBody: body },
    });
    return { statusCode: result.statusCode, body, replayed: false };
  }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 });
}

module.exports = { computeDeterministicPayloadHash, executeWithIdempotency };
