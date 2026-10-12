const test = require('node:test');
const assert = require('node:assert');
const { handleEvent } = require('../src/lib/engine');
const { parsePrice, isRequestText, isLike } = require('../src/lib/parse');
const { normalizePhone } = require('../src/lib/phone');

const RULES = { executorPct: 15, companyPct: 15, debtLimitFils: 2000 };

// In-memory store with the same semantics as SqlStore.
function memStore(captains) {
  const caps = new Map(captains.map((c) => [c.id, { ...c }]));
  const bookings = []; const requests = []; const ledger = []; let company = 0;
  const byPhone = (p) => [...caps.values()].find((c) => c.phone === p) || null;
  return {
    caps, bookings, ledger, get company() { return company; },
    async getCaptain(bot, phone) { const c = byPhone(phone); return c ? { ...c, balanceFils: c.balance } : null; },
    async findBookingByOffer(bot, id) { return bookings.find((b) => b.offerMsgId === id) || null; },
    async createBooking(x) {
      let b = bookings.find((q) => q.offerMsgId === x.offerMsgId);
      if (!b) { b = { id: bookings.length + 1, status: 'offered', ...x }; bookings.push(b); }
      return b;
    },
    async addRequest(x) {
      if (requests.find((r) => r.requestMsgId === x.requestMsgId)) return false;
      requests.push(x); return true;
    },
    async findRequest(bot, id) {
      const r = requests.find((q) => q.requestMsgId === id); if (!r) return null;
      const b = bookings.find((q) => q.id === r.bookingId);
      return { bookingId: b.id, executorCaptainId: r.executorCaptainId, ownerCaptainId: b.ownerCaptainId,
        priceFils: b.priceFils, bookingStatus: b.status };
    },
    async confirmBooking(x) {
      const b = bookings.find((q) => q.id === x.bookingId);
      if (b.status !== 'offered') return { ok: false, reason: 'already_confirmed' };
      const s = x.settlement;
      caps.get(x.executorCaptainId).balance -= s.executorFee;
      caps.get(x.ownerCaptainId).balance += s.ownerNet;
      company += s.companyFee; b.status = 'confirmed'; ledger.push(s);
      return { ok: true };
    },
  };
}
const people = () => memStore([
  { id: 1, phone: '962791000001', status: 'active', balance: 0 },   // owner
  { id: 2, phone: '962791000002', status: 'active', balance: 0 },   // executor
  { id: 3, phone: '962791000003', status: 'active', balance: 0 },   // another executor
]);
const msg = (id, sender, text, quoted) => ({ type: 'message', msgId: id, senderId: sender, text, quotedMsgId: quoted });
const like = (target, sender, emoji = '👍') => ({ type: 'reaction', targetMsgId: target, senderId: sender, emoji });

test('three steps in order settle once: 10 JD', async () => {
  const s = people();
  assert.strictEqual((await handleEvent(s, RULES, 'b2', msg('O1', '962791000001', 'عمان - اربد 10 د'))).action, 'offer_recorded');
  assert.strictEqual((await handleEvent(s, RULES, 'b2', msg('R1', '962791000002', 'تم', 'O1'))).action, 'request_recorded');
  const out = await handleEvent(s, RULES, 'b2', like('R1', '962791000001'));
  assert.strictEqual(out.action, 'confirmed');
  assert.strictEqual(s.caps.get(2).balance, -1500);
  assert.strictEqual(s.caps.get(1).balance, 1275);
  assert.strictEqual(s.company, 225);
});

test('a second like does not settle twice', async () => {
  const s = people();
  await handleEvent(s, RULES, 'b2', msg('O1', '962791000001', 'السعر 4'));
  await handleEvent(s, RULES, 'b2', msg('R1', '962791000002', 'محجوز', 'O1'));
  await handleEvent(s, RULES, 'b2', like('R1', '962791000001'));
  const again = await handleEvent(s, RULES, 'b2', like('R1', '962791000001', '❤️'));
  assert.strictEqual(again.action, 'ignored');
  assert.strictEqual(s.caps.get(2).balance, -600);
});

test('like before any request, or by someone else, is ignored', async () => {
  const s = people();
  await handleEvent(s, RULES, 'b2', msg('O1', '962791000001', 'اجرة 5 دينار'));
  assert.strictEqual((await handleEvent(s, RULES, 'b2', like('O1', '962791000001'))).reason, 'not_a_request');
  await handleEvent(s, RULES, 'b2', msg('R1', '962791000002', 'تم', 'O1'));
  assert.strictEqual((await handleEvent(s, RULES, 'b2', like('R1', '962791000003'))).reason, 'reactor_not_offer_owner');
  assert.strictEqual(s.caps.get(2).balance, 0);
});

test('owner cannot book his own offer', async () => {
  const s = people();
  await handleEvent(s, RULES, 'b2', msg('O1', '962791000001', 'السعر 5'));
  assert.strictEqual((await handleEvent(s, RULES, 'b2', msg('R1', '962791000001', 'تم', 'O1'))).reason, 'same_person');
});

test('two requests: the like picks the executor', async () => {
  const s = people();
  await handleEvent(s, RULES, 'b2', msg('O1', '962791000001', 'السعر 10'));
  await handleEvent(s, RULES, 'b2', msg('R1', '962791000002', 'تم', 'O1'));
  await handleEvent(s, RULES, 'b2', msg('R2', '962791000003', 'تم معك', 'O1'));
  await handleEvent(s, RULES, 'b2', like('R2', '962791000001'));
  assert.strictEqual(s.caps.get(3).balance, -1500);
  assert.strictEqual(s.caps.get(2).balance, 0);
});

test('debt limit of 2 JD blocks the request', async () => {
  const s = people(); s.caps.get(2).balance = -2001;
  await handleEvent(s, RULES, 'b2', msg('O1', '962791000001', 'السعر 5'));
  const out = await handleEvent(s, RULES, 'b2', msg('R1', '962791000002', 'تم', 'O1'));
  assert.strictEqual(out.action, 'rejected');
});

test('unregistered executor and out-of-order replies are ignored', async () => {
  const s = people();
  assert.strictEqual((await handleEvent(s, RULES, 'b2', msg('R0', '962791000002', 'تم', 'NOPE'))).reason, 'not_an_offer');
  await handleEvent(s, RULES, 'b2', msg('O1', '962791000001', 'السعر 5'));
  assert.strictEqual((await handleEvent(s, RULES, 'b2', msg('R1', '962799999999', 'تم', 'O1'))).reason, 'executor_not_registered');
});

test('price parsing', () => {
  assert.strictEqual(parsePrice('اجرة 2.5 دينار'), 2500);
  assert.strictEqual(parsePrice('عمان اربد ٣د'), 3000);
  assert.strictEqual(parsePrice('السعر: 10\nمن الساعة 1:00'), 10000);
  assert.strictEqual(parsePrice('بعد 10 دقائق'), null);
  assert.strictEqual(parsePrice('رقمي 0791234567'), null);
  assert.strictEqual(parsePrice('السعر 0791234567'), null);
  assert.strictEqual(parsePrice('مرحبا\nالسعر 5'), null);   // the price must be in the FIRST line
  assert.strictEqual(parsePrice('الساعة 1:00 السعر 4'), 4000);
});

test('request words and reactions', () => {
  for (const t of ['تم', 'تم معك', 'محجوز', 'Mark', ' تم! ', 'تم 👍']) assert.ok(isRequestText(t), t);
  for (const t of ['تمام', 'لا', 'ok']) assert.ok(!isRequestText(t), t);
  assert.ok(isLike('👍') && isLike('❤️') && isLike('👍🏽') && !isLike('😂') && !isLike(''));
});

test('phone normalization', () => {
  assert.strictEqual(normalizePhone('0791234567'), '962791234567');
  assert.strictEqual(normalizePhone('+962 79 123 4567'), '962791234567');
  assert.strictEqual(normalizePhone('00962791234567'), '962791234567');
});
