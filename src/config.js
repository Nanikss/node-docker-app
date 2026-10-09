'use strict';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function parseInteger(env, name, fallback, { min, max }, problems) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
    return fallback;
  }
  return value;
}

function parseUrl(env, name, protocols, problems) {
  const raw = env[name];
  if (raw === undefined || raw === '') return null;
  try {
    const url = new URL(raw);
    if (!protocols.includes(url.protocol)) throw new Error('bad protocol');
    return raw;
  } catch {
    // Never echo DATABASE_URL back: it usually contains a password.
    problems.push(`${name} must be a ${protocols.map((p) => p.replace(':', '://')).join(' or ')} URL`);
    return null;
  }
}

// Reads and validates everything the service needs from the environment.
// Throws a ConfigError listing every problem, so a bad deploy fails at startup
// with one clear message instead of at the first request.
function loadConfig(env = process.env) {
  const problems = [];

  const logLevel = env.LOG_LEVEL || 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${logLevel}")`);
  }

  const config = {
    port: parseInteger(env, 'PORT', 3000, { min: 1, max: 65535 }, problems),
    logLevel,
    databaseUrl: parseUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:'], problems),
    publicBaseUrl: parseUrl(env, 'PUBLIC_BASE_URL', ['http:', 'https:'], problems),
    // Docker sends SIGKILL 10s after SIGTERM by default, so drain within 8s.
    shutdownTimeoutMs: parseInteger(env, 'SHUTDOWN_TIMEOUT_MS', 8000, { min: 100, max: 120000 }, problems),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return Object.freeze(config);
}

module.exports = { loadConfig, ConfigError };
