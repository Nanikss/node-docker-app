'use strict';

const { ConflictError } = require('./errors');

// Store interface (implemented by memory and postgres):
//   init()              prepare storage
//   create({code, url}) -> link, throws ConflictError if the code exists
//   get(code)           -> link | null
//   recordHit(code)     -> link | null, increments the hit counter
//   ping()              resolves if the backing store is reachable
//   close()             release connections
// A link is { code, url, hits, createdAt }.
function createMemoryStore() {
  const links = new Map();
  const copy = (link) => (link ? { ...link } : null);

  return {
    kind: 'memory',
    async init() {},
    async create({ code, url }) {
      if (links.has(code)) throw new ConflictError(code);
      const link = { code, url, hits: 0, createdAt: new Date().toISOString() };
      links.set(code, link);
      return copy(link);
    },
    async get(code) {
      return copy(links.get(code));
    },
    async recordHit(code) {
      const link = links.get(code);
      if (!link) return null;
      link.hits += 1;
      return copy(link);
    },
    async ping() {},
    async close() {},
  };
}

module.exports = { createMemoryStore };
