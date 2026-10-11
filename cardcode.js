const crypto = require('crypto');

// 32 symbols without 0/O/1/I. 256 % 32 == 0, so the random pick is unbiased.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const part = (n) => {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[b[i] % 32];
  return s;
};

// FD-5JD-K7M2-9QXP : 8 random symbols (~1.1e12 combinations), so a code cannot be guessed.
const makeCode = (valueFils) => `FD-${valueFils / 1000}JD-${part(4)}-${part(4)}`;
const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (c) => crypto.createHash('sha256').update(normalizeCode(c)).digest('hex');

module.exports = { makeCode, normalizeCode, hashCode };
