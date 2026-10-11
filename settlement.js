// All money is in fils (1 JD = 1000 fils), as whole numbers. No floats.
// Round half up with integer math only.
const pct = (amount, p) => Math.floor((amount * p + 50) / 100);

// executorFee: taken from the executor's wallet (he collected the full fare in cash).
// companyFee : the company's share of executorFee.
// ownerNet   : what the offer owner is credited. The three always sum to zero.
function settle(priceFils, { executorPct = 15, companyPct = 15 } = {}) {
  if (!Number.isSafeInteger(priceFils) || priceFils <= 0) {
    throw new RangeError('priceFils must be a positive integer');
  }
  const executorFee = pct(priceFils, executorPct);
  const companyFee = pct(executorFee, companyPct);
  const ownerNet = executorFee - companyFee;
  return { priceFils, executorFee, ownerNet, companyFee };
}

// The executor may take a job while his balance has not gone below -debtLimit.
const canAccept = (balanceFils, debtLimitFils) => balanceFils >= -debtLimitFils;

module.exports = { settle, canAccept };
