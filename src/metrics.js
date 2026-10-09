'use strict';

const client = require('prom-client');

// Each app instance gets its own registry so tests don't share state.
function createMetrics() {
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  // Label by the matched route template ("/api/links/:code"), never the raw
  // path, so label cardinality stays bounded no matter what clients request.
  function middleware(req, res, next) {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      end({ method: req.method, route, status_code: String(res.statusCode) });
    });
    next();
  }

  return { register, httpDuration, middleware };
}

module.exports = { createMetrics };
