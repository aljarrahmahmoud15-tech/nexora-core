const { normalizePhone } = require('../lib/phone');

module.exports = {
  name: 'wallets',
  version: '0.1.0',
  register(r, { q, tx, audit, ownerAuth, botAuth, wrap }) {
    // A bot may read the balance of one captain in its own group.
    r.get('/balance', botAuth, wrap(async (req, res) => {
      const phone = normalizePhone(req.query.phone);
      const { rows } = await q('select balance_fils from captains where bot_id=$1 and phone=$2', [req.bot.id, phone]);
      if (!rows[0]) return res.status(404).json({ error: 'not_found' });
      res.json({ balanceFils: Number(rows[0].balance_fils) });
    }));

    r.get('/', ownerAuth, wrap(async (req, res) => {
      const neg = req.query.negative === '1';
      res.json((await q(
        `select id, bot_id, phone, name, status, balance_fils from captains
         where ($1::boolean is false or balance_fils < 0) order by balance_fils asc limit 500`, [neg])).rows);
    }));

    r.get('/ledger', ownerAuth, wrap(async (req, res) => {
      const id = Number.parseInt(req.query.captainId, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'captainId_required' });
      res.json((await q('select * from ledger where captain_id=$1 order by id desc limit 200', [id])).rows);
    }));

    // Top-ups and corrections. The owner records them; each one is a ledger row, never an overwrite.
    r.post('/adjust', ownerAuth, wrap(async (req, res) => {
      const id = Number.parseInt(req.body.captainId, 10);
      const amt = req.body.amountFils;
      const note = String(req.body.note || '').slice(0, 200);
      if (!Number.isInteger(id) || !Number.isSafeInteger(amt) || amt === 0 || Math.abs(amt) > 10_000_000) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const out = await tx(async (c) => {
        const u = await c.query(
          'update captains set balance_fils = balance_fils + $2 where id=$1 returning balance_fils', [id, amt]);
        if (!u.rows[0]) return null;
        await c.query(
          `insert into ledger(account, captain_id, kind, amount_fils, balance_after_fils, note)
           values($1,$2,'adjustment',$3,$4,$5)`, ['captain:' + id, id, amt, u.rows[0].balance_fils, note]);
        return Number(u.rows[0].balance_fils);
      });
      if (out === null) return res.status(404).json({ error: 'not_found' });
      await audit('owner', 'wallet.adjust', String(id), { amountFils: amt, note });
      res.json({ balanceFils: out });
    }));
  },
};
