'use strict';

const { loadConfig, ConfigError } = require('../src/config');

describe('loadConfig', () => {
  test('applies defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      logLevel: 'info',
      databaseUrl: null,
      publicBaseUrl: null,
      shutdownTimeoutMs: 8000,
    });
  });

  test('reads valid values', () => {
    const config = loadConfig({
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATABASE_URL: 'postgres://app:secret@db:5432/app',
      PUBLIC_BASE_URL: 'https://sho.rt',
      SHUTDOWN_TIMEOUT_MS: '5000',
    });
    expect(config).toMatchObject({ port: 8080, logLevel: 'debug', shutdownTimeoutMs: 5000 });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test.each([
    [{ PORT: 'abc' }, /PORT must be an integer between 1 and 65535/],
    [{ PORT: '70000' }, /PORT must be an integer/],
    [{ LOG_LEVEL: 'loud' }, /LOG_LEVEL must be one of/],
    [{ DATABASE_URL: 'mysql://db/app' }, /DATABASE_URL must be a postgres:\/\/ or postgresql:\/\/ URL/],
    [{ SHUTDOWN_TIMEOUT_MS: '0' }, /SHUTDOWN_TIMEOUT_MS must be an integer/],
  ])('rejects %o', (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });

  test('reports every problem at once and never echoes the database URL', () => {
    let error;
    try {
      loadConfig({ PORT: '-1', LOG_LEVEL: 'nope', DATABASE_URL: 'mysql://user:hunter2@db/app' });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.problems).toHaveLength(3);
    expect(error.message).not.toContain('hunter2');
  });
});
