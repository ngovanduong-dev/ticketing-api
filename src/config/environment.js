function validateDatabaseUrl(value, name = 'DATABASE_URL') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  let url;
  try {
    url = new URL(value);
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    decodeURIComponent(url.pathname);
  } catch {
    throw new Error(`${name} must be a PostgreSQL connection URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      url.pathname.length <= 1 || value !== value.trim() || /[\s\\]/.test(value)) {
    throw new Error(`${name} must be a PostgreSQL connection URL`);
  }
  return url;
}

function validateEnvironment(env = process.env) {
  validateDatabaseUrl(env.DATABASE_URL);
  if (typeof env.JWT_SECRET !== 'string' || !env.JWT_SECRET.trim()) {
    throw new Error('Missing required environment variable: JWT_SECRET');
  }

  const port = env.PORT || '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return { port: Number(port) };
}

module.exports = { validateDatabaseUrl, validateEnvironment };
