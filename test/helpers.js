'use strict';

const pino = require('pino');
const { createApp } = require('../src/app');
const { createMetrics } = require('../src/metrics');
const { createMemoryStore } = require('../src/store/memory');

const silentLogger = () => pino({ level: 'silent' });

function buildApp(overrides = {}) {
  const deps = {
    store: createMemoryStore(),
    logger: silentLogger(),
    metrics: createMetrics(),
    state: { shuttingDown: false },
    ...overrides,
  };
  return { app: createApp(deps), ...deps };
}

module.exports = { buildApp, silentLogger };
