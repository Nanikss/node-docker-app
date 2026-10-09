'use strict';

class ConflictError extends Error {
  constructor(code) {
    super(`code "${code}" is already in use`);
    this.name = 'ConflictError';
    this.code = code;
  }
}

module.exports = { ConflictError };
