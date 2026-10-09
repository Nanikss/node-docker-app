'use strict';

const { randomBytes } = require('crypto');

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const RESERVED = new Set(['api', 'healthz', 'readyz', 'metrics']);
const MAX_URL_LENGTH = 2048;

class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function generateCode(length = CODE_LENGTH) {
  const bytes = randomBytes(length);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

function validateUrl(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ValidationError('invalid_url', 'url is required');
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new ValidationError('invalid_url', 'url is not a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('invalid_url', 'url must use http or https');
  }
  const normalized = parsed.toString();
  if (normalized.length > MAX_URL_LENGTH) {
    throw new ValidationError('invalid_url', `url must be at most ${MAX_URL_LENGTH} characters`);
  }
  return normalized;
}

function isValidCode(code) {
  return typeof code === 'string' && CODE_PATTERN.test(code) && !RESERVED.has(code.toLowerCase());
}

function validateAlias(alias) {
  if (!isValidCode(alias)) {
    throw new ValidationError(
      'invalid_alias',
      'alias must be 3-32 characters of letters, digits, "-" or "_" and not a reserved word',
    );
  }
  return alias;
}

module.exports = { ValidationError, generateCode, validateUrl, validateAlias, isValidCode };
