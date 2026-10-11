const { makeCode, hashCode } = require('../lib/cardcode');
const { normalizePhone } = require('../lib/phone');

// Wrong-code attempts per captain: 5 failures lock redemption for 15 minutes.
const fails = new Map();
const lockedUntil = (k) => (fails.get(k) || { until: 0 }).until;
function recordFail(k) {
  const f = fails.get(k) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60_000; }
  fails.set(k, f);
}

module.exports = {
  name: 'cards',
  version: '0.1.0',
  register(r, { q, tx, audit, ownerAuth, botAuth, wrap }) {
    // Owner issues cards. The codes are returned ONCE; only their hash is stored.
    r.post('/issue', ownerAuth, wrap(async (req, res) => {
      const value = req.body.valueFils;
      const count = Number.parseInt(req.body.count, 10) || 1;
      const note = String(req.body.note || '').slice(0, 120);
      if (!Number.isSafeInteger(value) || value < 1000 || value > 500_000 || value % 1000 !== 0) {
        return res.status(400).json({ error: 'value_must_be_whole_dinars_up_to_500' });
      }
      if (count < 1 || count > 100) return res.status(400).json({ error: 'count_1_to_100' });
      const codes = [];
      for (let i = 0; i < count; i++) {
        const code = makeCode(value);
        await q('insert into cards(code_hash, value_fils, note) values($1,$2,$3)', [hashCode(code), value, note]);
        codes.push(code);
      }
      await audit('owner', 'card.issue', null, { valueFils: value, count, note });
      res.status(201).json({ valueFils: value, codes });
    }));

    // A captain redeems through the bot. Atomic: a card works once, the ledger records it.
    r.post('/redeem', botAuth, wrap(async (req, res) => {
      const phone = normalizePhone(req.body.phone);
      const key = req.bot.id + ':' + phone;
      if (lockedUntil(key) > Date.now()) return res.status(429).json({ error: 'too_many_attempts' });
      const out = await tx(async (c) => {
        const cap = await c.query(
          'select id, status from captains where bot_id=$1 and phone=$2 for update', [req.bot.id, phone]);
        if (!cap.rows[0] || cap.rows[0].status !== 'active') return { err: 'captain_not_found' };
        const card = await c.query('select id, value_fils, status from cards where code_hash=$1 for update',
          [hashCode(req.body.code)]);
        if (!card.rows[0] || card.rows[0].status === 'void') return { err: 'invalid_code' };
        if (card.rows[0].status !== 'active') return { err: 'already_used' };
        const cid = Number(cap.rows[0].id);
        await c.query("update cards set status='used', used_at=now(), used_by_captain_id=$2 where id=$1",
          [card.rows[0].id, cid]);
        const u = await c.query(
          'update captains set balance_fils = balance_fils + $2 where id=$1 returning balance_fils',
          [cid, card.rows[0].value_fils]);
        await c.query(
          `insert into ledger(account, captain_id, kind, amount_fils, balance_after_fils, note)
           values($1,$2,'card_redeem',$3,$4,$5)`,
          ['captain:' + cid, cid, card.rows[0].value_fils, u.rows[0].balance_fils, 'card:' + card.rows[0].id]);
        return { cardId: Number(card.rows[0].id), valueFils: Number(card.rows[0].value_fils),
          balanceFils: Number(u.rows[0].balance_fils), captainId: cid };
      });
      if (out.err === 'invalid_code' || out.err === 'already_used') {
        recordFail(key);
        return res.status(out.err === 'already_used' ? 409 : 404).json({ error: out.err });
      }
      if (out.err) return res.status(404).json({ error: out.err });
      fails.delete(key);
      await audit(req.actor, 'card.redeem', String(out.cardId), { captainId: out.captainId, valueFils: out.valueFils });
      res.json({ valueFils: out.valueFils, balanceFils: out.balanceFils });
    }));

    r.get('/', ownerAuth, wrap(async (req, res) => {
      res.json((await q(
        `select id, value_fils, status, note, created_at, used_at, used_by_captain_id
         from cards order by id desc limit 200`)).rows);
    }));

    r.post('/:id/void', ownerAuth, wrap(async (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
      const u = await q("update cards set status='void' where id=$1 and status='active' returning id", [id]);
      if (!u.rowCount) return res.status(409).json({ error: 'not_active' });
      await audit('owner', 'card.void', String(id));
      res.json({ ok: true });
    }));
  },
};
