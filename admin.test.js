const test = require('node:test');
const assert = require('node:assert');
const { adminBooking } = require('../src/lib/engine');
const { makeCode, normalizeCode, hashCode } = require('../src/lib/cardcode');

const RULES = { executorPct: 15, companyPct: 15, debtLimitFils: 2000 };
function store() {
  const caps = new Map([
    [1, { id: 1, phone: '962791000001', status: 'active', balance: 0 }],
    [2, { id: 2, phone: '962791000002', status: 'active', balance: -1900 }],
    [3, { id: 3, phone: '962791000003', status: 'suspended', balance: 0 }],
  ]);
  const bookings = [];
  return {
    caps, bookings,
    async getCaptain(b, p) { const c = [...caps.values()].find((x) => x.phone === p); return c ? { ...c, balanceFils: c.balance } : null; },
    async createBooking(x) { const b = { id: bookings.length + 1, status: 'offered', ...x }; bookings.push(b); return b; },
    async addRequest() { return true; },
    async confirmBooking(x) {
      caps.get(x.executorCaptainId).balance -= x.settlement.executorFee;
      caps.get(x.ownerCaptainId).balance += x.settlement.ownerNet;
      bookings.find((b) => b.id === x.bookingId).status = 'confirmed'; return { ok: true };
    },
  };
}
const base = { botId: 'b2', ownerPhone: '0791000001', executorPhone: '0791000002', priceFils: 10000, newId: 'x' };

test('admin adds and confirms a booking from two phones and a price', async () => {
  const s = store();
  const out = await adminBooking(s, RULES, base);
  assert.strictEqual(out.status, 'confirmed');
  assert.deepStrictEqual(out.settlement, { priceFils: 10000, executorFee: 1500, ownerNet: 1275, companyFee: 225 });
  assert.strictEqual(s.caps.get(2).balance, -3400);
  assert.strictEqual(out.overLimit, true);            // admin may pass the limit, but it is reported
  assert.strictEqual(s.caps.get(1).balance, 1275);
});

test('admin can add without confirming, and bad input is refused', async () => {
  const s = store();
  assert.strictEqual((await adminBooking(s, RULES, { ...base, confirm: false })).status, 'offered');
  assert.strictEqual(s.caps.get(2).balance, -1900);
  assert.strictEqual((await adminBooking(s, RULES, { ...base, executorPhone: '0791000001' })).error, 'same_person');
  assert.strictEqual((await adminBooking(s, RULES, { ...base, executorPhone: '0790000000' })).error, 'executor_not_found');
  assert.strictEqual((await adminBooking(s, RULES, { ...base, executorPhone: '0791000003' })).error, 'executor_inactive');
  assert.strictEqual((await adminBooking(s, RULES, { ...base, priceFils: 0 })).error, 'bad_price');
});

test('card codes: format, normalization, no collisions, hash only', () => {
  const c = makeCode(5000);
  assert.match(c, /^FD-5JD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.strictEqual(normalizeCode(' fd-5jd-' + c.slice(7).toLowerCase() + ' '), normalizeCode(c));
  assert.strictEqual(hashCode(c), hashCode(c.toLowerCase()));
  assert.notStrictEqual(hashCode(c), c);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(makeCode(5000));
  assert.strictEqual(seen.size, 20000);
});
