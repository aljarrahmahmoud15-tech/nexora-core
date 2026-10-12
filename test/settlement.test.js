const test = require('node:test');
const assert = require('node:assert');
const { settle, canAccept } = require('../src/lib/settlement');

test('10 JD booking: 1.500 / 1.275 / 0.225', () => {
  assert.deepStrictEqual(settle(10000), {
    priceFils: 10000, executorFee: 1500, ownerNet: 1275, companyFee: 225,
  });
});

test('rounding case 1.350 JD keeps the sum balanced', () => {
  const s = settle(1350);
  assert.strictEqual(s.executorFee, 203);
  assert.strictEqual(s.ownerNet + s.companyFee, s.executorFee);
});

test('never loses or creates a fil, for every price up to 50 JD', () => {
  for (let p = 1; p <= 50000; p++) {
    const s = settle(p);
    assert.strictEqual(s.ownerNet + s.companyFee, s.executorFee, 'price ' + p);
    assert.ok(s.ownerNet >= 0 && s.companyFee >= 0, 'price ' + p);
  }
});

test('rejects bad prices', () => {
  for (const bad of [0, -5, 1.5, NaN, '10']) assert.throws(() => settle(bad));
});

test('debt limit of 2 JD', () => {
  assert.strictEqual(canAccept(0, 2000), true);
  assert.strictEqual(canAccept(-2000, 2000), true);
  assert.strictEqual(canAccept(-2001, 2000), false);
});
