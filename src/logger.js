'use strict';

const { randomUUID } = require('crypto');
const pino = require('pino');

function createLogger({ logLevel = 'info' } = {}) {
  return pino({
    level: logLevel,
    base: { service: 'node-docker-app' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  });
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

// Gives every request an id (reusing a sane incoming X-Request-Id, e.g. from a
// load balancer), exposes it on the response, and logs one line per request.
function requestLogger(logger) {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const start = process.hrtime.bigint();

    req.id = id;
    req.log = logger.child({ reqId: id });
    res.setHeader('X-Request-Id', id);

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : 'info';
      req.log[level](
        { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Math.round(durationMs * 10) / 10 },
        'request completed',
      );
    });
    next();
  };
}

module.exports = { createLogger, requestLogger };
