'use strict';

const { createMemoryStore } = require('./memory');
const { createPostgresStore } = require('./postgres');
const { ConflictError } = require('./errors');

function createStore({ databaseUrl }) {
  return databaseUrl ? createPostgresStore({ databaseUrl }) : createMemoryStore();
}

module.exports = { createStore, createMemoryStore, createPostgresStore, ConflictError };
