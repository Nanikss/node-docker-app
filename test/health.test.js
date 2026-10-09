'use strict';

const request = require('supertest');
const { buildApp } = require('./helpers');

describe('health endpoints', () => {
  test('/healthz reports ok', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('/readyz is 200 when the store answers', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', store: 'memory' });
  });

  test('/readyz is 503 when the store is unreachable, while /healthz stays 200', async () => {
    const { app, store } = buildApp();
    store.ping = jest.fn().mockRejectedValue(new Error('connection refused'));

    const ready = await request(app).get('/readyz');
    expect(ready.status).toBe(503);
    expect(ready.body.status).toBe('unavailable');
    expect((await request(app).get('/healthz')).status).toBe(200);
  });

  test('/readyz is 503 once shutdown has started, without touching the store', async () => {
    const { app, store, state } = buildApp();
    store.ping = jest.fn();
    state.shuttingDown = true;

    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'shutting_down' });
    expect(store.ping).not.toHaveBeenCalled();
  });

  test('unknown API routes return a JSON 404', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/nothing/here');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
