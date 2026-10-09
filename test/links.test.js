'use strict';

const request = require('supertest');
const { buildApp } = require('./helpers');
const { ConflictError } = require('../src/store/errors');

describe('POST /api/links', () => {
  test('creates a link with a generated code', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/links').send({ url: 'https://example.com/docs?page=1' });

    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(res.body.url).toBe('https://example.com/docs?page=1');
    expect(res.body.hits).toBe(0);
    expect(res.body.shortUrl).toMatch(new RegExp(`/${res.body.code}$`));
    expect(res.headers.location).toBe(`/api/links/${res.body.code}`);
  });

  test.each([
    ['missing url', {}],
    ['non-string url', { url: 42 }],
    ['relative url', { url: '/just/a/path' }],
    ['unsupported scheme', { url: 'javascript:alert(1)' }],
    ['ftp scheme', { url: 'ftp://example.com/file' }],
    ['too long', { url: `https://example.com/${'a'.repeat(2100)}` }],
  ])('rejects %s with 400', async (_name, body) => {
    const { app } = buildApp();
    const res = await request(app).post('/api/links').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_url');
  });

  test('accepts a custom alias and returns 409 when it is taken', async () => {
    const { app } = buildApp();
    const first = await request(app).post('/api/links').send({ url: 'https://example.com', alias: 'my-link' });
    expect(first.status).toBe(201);
    expect(first.body.code).toBe('my-link');

    const second = await request(app).post('/api/links').send({ url: 'https://other.example', alias: 'my-link' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('conflict');
  });

  test.each(['ab', 'has space', 'metrics', 'API', 'x'.repeat(33)])('rejects alias "%s"', async (alias) => {
    const { app } = buildApp();
    const res = await request(app).post('/api/links').send({ url: 'https://example.com', alias });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_alias');
  });

  test('returns 400 for malformed JSON', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/links').set('Content-Type', 'application/json').send('{"url":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  test('retries when a generated code collides', async () => {
    const { app, store } = buildApp();
    const create = store.create;
    let calls = 0;
    store.create = async (link) => {
      calls += 1;
      if (calls === 1) throw new ConflictError(link.code);
      return create(link);
    };
    const res = await request(app).post('/api/links').send({ url: 'https://example.com' });
    expect(res.status).toBe(201);
    expect(calls).toBe(2);
  });
});

describe('redirect and stats', () => {
  test('GET /:code redirects with 302 and counts hits', async () => {
    const { app } = buildApp();
    await request(app).post('/api/links').send({ url: 'https://example.com/target', alias: 'docs' });

    const first = await request(app).get('/docs');
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('https://example.com/target');
    await request(app).get('/docs');

    const stats = await request(app).get('/api/links/docs');
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ code: 'docs', url: 'https://example.com/target', hits: 2 });
    expect(typeof stats.body.createdAt).toBe('string');
  });

  test('unknown codes return 404 for both redirect and stats', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/nope123')).status).toBe(404);
    expect((await request(app).get('/api/links/nope123')).status).toBe(404);
    expect((await request(app).get('/favicon.ico')).status).toBe(404);
  });

  test('uses PUBLIC_BASE_URL for shortUrl when configured', async () => {
    const { app } = buildApp({ publicBaseUrl: 'https://sho.rt' });
    const res = await request(app).post('/api/links').send({ url: 'https://example.com', alias: 'abc' });
    expect(res.body.shortUrl).toBe('https://sho.rt/abc');
  });
});

describe('request id', () => {
  test('echoes a valid X-Request-Id and generates one otherwise', async () => {
    const { app } = buildApp();
    const echoed = await request(app).get('/healthz').set('X-Request-Id', 'abc-123');
    expect(echoed.headers['x-request-id']).toBe('abc-123');

    const generated = await request(app).get('/healthz').set('X-Request-Id', 'bad id\twith junk');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
