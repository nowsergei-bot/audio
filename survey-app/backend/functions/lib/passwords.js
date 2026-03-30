const crypto = require('crypto');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const s = String(stored || '');
  const parts = s.split('$');
  if (parts.length !== 3) return false;
  const [alg, saltHex, keyHex] = parts;
  if (alg !== 'scrypt') return false;
  const salt = Buffer.from(saltHex, 'hex');
  const key = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(String(password), salt, key.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return crypto.timingSafeEqual(key, derived);
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { hashPassword, verifyPassword, newSessionToken, tokenHash };

