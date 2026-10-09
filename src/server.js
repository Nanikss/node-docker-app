'use strict';

const http = require('http');
const { loadConfig, ConfigError } = require('./config');
const { createLogger } = require('./logger');
const { createMetrics } = require('./metrics');
const { createStore } = require('./store');
const { createApp } = require('./app');
const { createShutdown } = require('./shutdown');

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(err.message);
    process.exit(1);
  }

  const logger = createLogger(config);
  const store = createStore(config);
  await store.init();

  const state = { shuttingDown: false };
  const app = createApp({ store, logger, metrics: createMetrics(), state, publicBaseUrl: config.publicBaseUrl });
  const server = http.createServer(app);

  const shutdown = createShutdown({
    server,
    store,
    state,
    logger,
    timeoutMs: config.shutdownTimeoutMs,
    exit: (code) => process.exit(code),
  });
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  server.listen(config.port, () => {
    logger.info({ port: config.port, store: store.kind }, 'server listening');
  });
}

main().catch((err) => {
  console.error('fatal: failed to start', err);
  process.exit(1);
});
