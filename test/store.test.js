'use strict';

const { createMemoryStore, createPostgresStore, createStore, ConflictError } = require('../src/store');

describe('stores', () => {
  test('createStore picks Postgres only when DATABASE_URL is set', async () => {
    expect(createStore({ databaseUrl: null }).kind).toBe('memory');
    const pg = createStore({ databaseUrl: 'postgres://u:p@localhost:5432/db' });
    expect(pg.kind).toBe('postgres');
    await pg.close();
  });

  test('memory store rejects duplicate codes and counts hits', async () => {
    const store = createMemoryStore();
    await store.create({ code: 'abc', url: 'https://example.com/' });
    await expect(store.create({ code: 'abc', url: 'https://x.example/' })).rejects.toBeInstanceOf(ConflictError);
    expect((await store.recordHit('abc')).hits).toBe(1);
    expect(await store.recordHit('missing')).toBeNull();
  });

  test('postgres store maps a unique violation to ConflictError', async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' })),
      end: jest.fn(),
    };
    const store = createPostgresStore({ pool });
    await expect(store.create({ code: 'abc', url: 'https://example.com/' })).rejects.toBeInstanceOf(ConflictError);
  });

  test('postgres store converts rows to links', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [{ code: 'abc', url: 'https://example.com/', hits: '3', created_at: createdAt }] }),
      end: jest.fn(),
    };
    const store = createPostgresStore({ pool });
    expect(await store.recordHit('abc')).toEqual({
      code: 'abc',
      url: 'https://example.com/',
      hits: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(pool.query.mock.calls[0][1]).toEqual(['abc']);
  });
});
