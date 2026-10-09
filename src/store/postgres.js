'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ConflictError } = require('./errors');

const SCHEMA_FILE = path.join(__dirname, '..', '..', 'db', 'schema.sql');
const UNIQUE_VIOLATION = '23505';

const toLink = (row) =>
  row && { code: row.code, url: row.url, hits: Number(row.hits), createdAt: row.created_at.toISOString() };

// `pool` is injectable so the error mapping can be unit tested without a database.
function createPostgresStore({ databaseUrl, pool } = {}) {
  const db =
    pool ||
    new Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 30000,
      query_timeout: 5000,
    });

  return {
    kind: 'postgres',
    async init() {
      // The schema is idempotent (CREATE ... IF NOT EXISTS), so applying it on boot is safe.
      await db.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));
    },
    async create({ code, url }) {
      try {
        const { rows } = await db.query(
          'INSERT INTO links (code, url) VALUES ($1, $2) RETURNING code, url, hits, created_at',
          [code, url],
        );
        return toLink(rows[0]);
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION) throw new ConflictError(code);
        throw err;
      }
    },
    async get(code) {
      const { rows } = await db.query('SELECT code, url, hits, created_at FROM links WHERE code = $1', [code]);
      return toLink(rows[0]) || null;
    },
    async recordHit(code) {
      const { rows } = await db.query(
        `UPDATE links SET hits = hits + 1, last_hit_at = now()
         WHERE code = $1 RETURNING code, url, hits, created_at`,
        [code],
      );
      return toLink(rows[0]) || null;
    },
    async ping() {
      await db.query('SELECT 1');
    },
    async close() {
      await db.end();
    },
  };
}

module.exports = { createPostgresStore };
