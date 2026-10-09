'use strict';

const express = require('express');
const { requestLogger } = require('./logger');
const { ValidationError, generateCode, validateUrl, validateAlias, isValidCode } = require('./links');
const { ConflictError } = require('./store/errors');

const MAX_CODE_ATTEMPTS = 5;

// Express 4 does not forward rejected promises to the error handler on its own.
const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Everything the app depends on is passed in, so tests can use an in-memory
// store, a silent logger and a shared `state` object they control.
function createApp({ store, logger, metrics, state = { shuttingDown: false }, publicBaseUrl = null }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(logger));
  app.use(metrics.middleware);
  app.use(express.json({ limit: '10kb' }));

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get(
    '/readyz',
    asyncRoute(async (req, res) => {
      if (state.shuttingDown) {
        return res.status(503).json({ status: 'shutting_down' });
      }
      try {
        await store.ping();
      } catch (err) {
        req.log.warn({ err }, 'readiness check failed: store unreachable');
        return res.status(503).json({ status: 'unavailable', store: store.kind });
      }
      return res.json({ status: 'ready', store: store.kind });
    }),
  );

  app.get(
    '/metrics',
    asyncRoute(async (req, res) => {
      res.set('Content-Type', metrics.register.contentType);
      res.send(await metrics.register.metrics());
    }),
  );

  const present = (req, link) => {
    const base = publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    return { ...link, shortUrl: new URL(link.code, base.endsWith('/') ? base : `${base}/`).toString() };
  };

  app.post(
    '/api/links',
    asyncRoute(async (req, res) => {
      const body = req.body || {};
      const url = validateUrl(body.url);

      let link;
      if (body.alias !== undefined) {
        link = await store.create({ code: validateAlias(body.alias), url });
      } else {
        for (let attempt = 1; !link; attempt += 1) {
          try {
            link = await store.create({ code: generateCode(), url });
          } catch (err) {
            if (!(err instanceof ConflictError) || attempt >= MAX_CODE_ATTEMPTS) throw err;
          }
        }
      }

      req.log.info({ code: link.code }, 'link created');
      res.status(201).location(`/api/links/${link.code}`).json(present(req, link));
    }),
  );

  app.get(
    '/api/links/:code',
    asyncRoute(async (req, res) => {
      const link = isValidCode(req.params.code) ? await store.get(req.params.code) : null;
      if (!link) return res.status(404).json({ error: 'not_found', message: 'no link with that code' });
      return res.json(present(req, link));
    }),
  );

  app.get(
    '/:code',
    asyncRoute(async (req, res) => {
      const link = isValidCode(req.params.code) ? await store.recordHit(req.params.code) : null;
      if (!link) return res.status(404).json({ error: 'not_found', message: 'no link with that code' });
      return res.redirect(302, link.url);
    }),
  );

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', message: 'route not found' });
  });

  app.use((err, req, res, _next) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    if (err instanceof ConflictError) {
      return res.status(409).json({ error: 'conflict', message: err.message });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'request body is not valid JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large', message: 'request body is too large' });
    }
    (req.log || logger).error({ err }, 'unhandled error');
    return res.status(500).json({ error: 'internal', message: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
