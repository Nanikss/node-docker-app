'use strict';

const request = require('supertest');
const { buildApp } = require('./helpers');

describe('/metrics', () => {
  test('exposes default process metrics in Prometheus format', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toContain('nodejs_eventloop_lag_seconds');
  });

  test('records request duration by route template, method and status', async () => {
    const { app } = buildApp();
    await request(app).post('/api/links').send({ url: 'https://example.com', alias: 'abc' });
    await request(app).get('/abc');
    await request(app).get('/api/links/does-not-exist');

    const { text } = await request(app).get('/metrics');
    expect(text).toMatch(/http_request_duration_seconds_count\{method="POST",route="\/api\/links",status_code="201"\} 1/);
    expect(text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/:code",status_code="302"\} 1/);
    expect(text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/api\/links\/:code",status_code="404"\} 1/);
    // Raw paths must never become label values.
    expect(text).not.toContain('route="/abc"');
  });
});
