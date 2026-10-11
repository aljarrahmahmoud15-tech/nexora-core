// Reads the three booking signals out of group text. Pure functions, no I/O.
const WORD = /(اجار[هة]|أجار[هة]|[اأ]جرة|الاجرة|الأجرة|السعر|سعر|دنانير|دينار)/;
const AFTER = /^\s*(د\.?أ|دينار|دنانير|jd|د)(?![\u0621-\u064A])/i;
const BEFORE = /(اجار[هة]|أجار[هة]|[اأ]جرة|الاجرة|السعر|سعر)\s*[:=-]?\s*$/;

function normalizeDigits(s) {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, '');
}

// Returns the price in fils, or null. Only the FIRST line counts.
function parsePrice(text) {
  if (typeof text !== 'string') return null;
  const first = normalizeDigits(text).split(/\r?\n/).find((l) => l.trim() !== '');
  if (!first) return null;
  const line = first.replace(/\d{1,2}:\d{2}/g, ' '); // times like 1:00 are not prices
  const nums = [...line.matchAll(/\d+(?:\.\d+)?/g)]
    .map((m) => ({ v: m[0], i: m.index, end: m.index + m[0].length }))
    .filter((n) => n.v.replace('.', '').length < 7); // phone numbers are not prices
  if (!nums.length) return null;
  const pick = nums.find((n) => AFTER.test(line.slice(n.end)) || BEFORE.test(line.slice(0, n.i)))
    || (WORD.test(line) ? nums[0] : null);
  if (!pick) return null;
  const fils = Math.round(Number(pick.v) * 1000);
  return fils >= 1 && fils <= 1_000_000 ? fils : null;
}

const REQUEST_WORDS = new Set(['تم', 'تم معك', 'محجوز', 'mark']);
function isRequestText(text) {
  if (typeof text !== 'string') return false;
  const t = text.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return REQUEST_WORDS.has(t);
}

function isLike(emoji) {
  const e = String(emoji || '').replace(/\uFE0F/g, '');
  return e.startsWith('👍') || e === '❤' || e === '♥';
}

module.exports = { parsePrice, isRequestText, isLike };
