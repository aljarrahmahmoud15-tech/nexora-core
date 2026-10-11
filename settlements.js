const { settle, canAccept } = require('../lib/settlement');

const { loadRules } = require('../lib/rules');

const isFils = (n) => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000;

// SHADOW MODE: computes settlements and stores them for comparison with V26.
// It never changes a wallet or a balance.
module.exports = {
  name: 'settlements',
  version: '0.1.0',
  register(r, { q, audit, ownerAuth, botAuth, wrap }) {
    r.post('/preview', botAuth, wrap(async (req, res) => {
      if (!isFils(req.body.priceFils)) return res.status(400).json({ error: 'bad_price' });
      const rules = await loadRules(q);
      res.json(settle(req.body.priceFils, rules));
    }));

    // Step 2 of a booking: may this executor take the job?
    r.post('/can-accept', botAuth, wrap(async (req, res) => {
      if (!Number.isSafeInteger(req.body.balanceFils)) return res.status(400).json({ error: 'bad_balance' });
      const { debtLimitFils } = await loadRules(q);
      res.json({ allowed: canAccept(req.body.balanceFils, debtLimitFils), debtLimitFils });
    }));

    // Records the settlement NEXORA would make for a confirmed booking. Idempotent by bookingRef;
    // the price is frozen at first record, so a later edit cannot change it.
    r.post('/shadow', botAuth, wrap(async (req, res) => {
      const ref = String(req.body.bookingRef || '').trim();
      if (!ref || ref.length > 120) return res.status(400).json({ error: 'bad_booking_ref' });
      if (!isFils(req.body.priceFils)) return res.status(400).json({ error: 'bad_price' });
      const s = settle(req.body.priceFils, await loadRules(q));
      const ins = await q(
        `insert into settlement_shadow(bot_id, booking_ref, price_fils, executor_fee_fils, owner_net_fils, company_fee_fils)
         values($1,$2,$3,$4,$5,$6) on conflict(booking_ref) do nothing returning id`,
        [req.bot.id, ref, s.priceFils, s.executorFee, s.ownerNet, s.companyFee]);
      if (!ins.rowCount) {
        const old = await q('select price_fils from settlement_shadow where booking_ref=$1', [ref]);
        if (old.rows[0] && Number(old.rows[0].price_fils) !== s.priceFils) {
          return res.status(409).json({ error: 'ref_price_mismatch' });
        }
        return res.json({ duplicate: true, ...s });
      }
      await audit(req.actor, 'settlement.shadow', ref, { priceFils: s.priceFils });
      res.status(201).json(s);
    }));

    // Owner compares these totals with V26. Any difference is a bug to fix before NEXORA takes over.
    r.get('/shadow', ownerAuth, wrap(async (req, res) => {
      const n = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
      const rows = (await q('select * from settlement_shadow order by id desc limit $1', [n])).rows;
      const t = (await q(
        `select count(*)::int as bookings, coalesce(sum(price_fils),0)::bigint as price,
                coalesce(sum(executor_fee_fils),0)::bigint as executor_fee,
                coalesce(sum(owner_net_fils),0)::bigint as owner_net,
                coalesce(sum(company_fee_fils),0)::bigint as company_fee
         from settlement_shadow`)).rows[0];
      res.json({ totals: t, rows });
    }));
  },
};
