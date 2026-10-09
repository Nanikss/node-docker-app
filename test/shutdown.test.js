'use strict';

const http = require('http');
const request = require('supertest');
const { createShutdown } = require('../src/shutdown');
const { buildApp, silentLogger } = require('./helpers');

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function get(port, options = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: '/', ...options }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      })
      .on('error', reject);
  });
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// The handler is injected, so the test decides exactly when the in-flight
// request finishes: no sleeps, no timing guesses.
function setup(handler, { timeoutMs = 5000 } = {}) {
  const server = http.createServer(handler);
  const state = { shuttingDown: false };
  const store = { close: jest.fn().mockResolvedValue() };
  const exit = jest.fn();
  const shutdown = createShutdown({ server, store, state, logger: silentLogger(), timeoutMs, exit });
  return { server, state, store, exit, shutdown };
}

describe('graceful shutdown', () => {
  test('waits for an in-flight request before closing the store and exiting', async () => {
    const started = deferred();
    const release = deferred();
    const { server, state, store, exit, shutdown } = setup((req, res) => {
      started.resolve();
      release.promise.then(() => res.end('done'));
    });
    const port = await listen(server);

    const response = get(port);
    await started.promise;

    let settled = false;
    const result = shutdown('SIGTERM').then((code) => {
      settled = true;
      return code;
    });
    await tick();

    expect(state.shuttingDown).toBe(true);
    expect(server.listening).toBe(false); // no new connections
    expect(settled).toBe(false); // still draining
    expect(store.close).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    release.resolve();
    expect(await response).toMatchObject({ status: 200, body: 'done' });
    expect(await result).toBe(0);
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('closes idle keep-alive connections instead of waiting for them to time out', async () => {
    const { server, exit, shutdown } = setup((req, res) => res.end('ok'), { timeoutMs: 3000 });
    const port = await listen(server);
    const agent = new http.Agent({ keepAlive: true });

    expect((await get(port, { agent })).status).toBe(200); // socket now idle in the agent's pool
    expect(await shutdown('SIGTERM')).toBe(0);
    expect(exit).toHaveBeenCalledWith(0);
    agent.destroy();
  });

  test('forces connections closed and exits 1 when draining exceeds the timeout', async () => {
    const started = deferred();
    const { server, store, exit, shutdown } = setup(() => started.resolve(), { timeoutMs: 50 });
    const port = await listen(server);

    const response = get(port).catch((err) => err);
    await started.promise; // handler never responds

    expect(await shutdown('SIGTERM')).toBe(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(store.close).toHaveBeenCalledTimes(1);
    expect((await response).code).toBe('ECONNRESET');
  });

  test('is idempotent when SIGTERM and SIGINT both arrive', async () => {
    const { server, exit, shutdown } = setup((req, res) => res.end('ok'));
    await listen(server);
    const first = shutdown('SIGTERM');
    expect(shutdown('SIGINT')).toBe(first);
    await first;
    expect(exit).toHaveBeenCalledTimes(1);
  });

  test('the real app reports not-ready as soon as shutdown begins', async () => {
    const { app, state, store } = buildApp();
    const server = http.createServer(app);
    const shutdown = createShutdown({ server, store, state, logger: silentLogger(), timeoutMs: 1000, exit: jest.fn() });

    expect((await request(server).get('/readyz')).status).toBe(200);
    shutdown('SIGTERM');
    expect(state.shuttingDown).toBe(true);
    expect((await request(app).get('/readyz')).status).toBe(503);
  });
});
