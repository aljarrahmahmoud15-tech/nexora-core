const { normalizePhone } = require('../lib/phone');

module.exports = {
  name: 'captains',
  version: '0.1.0',
  register(r, { q, tx, audit, ownerAuth, botAuth, wrap }) {
    // Capacity is enforced here, by NEXORA, not by the bot.
    r.post('/join', botAuth, wrap(async (req, res) => {
      const phone = normalizePhone(req.body.phone);
      if (phone.length < 8 || phone.length > 15) return res.status(400).json({ error: 'bad_phone' });
      const name = typeof req.body.name === 'string' ? req.body.name.slice(0, 80) : null;

      const out = await tx(async (c) => {
        await c.query('select id from bots where id=$1 for update', [req.bot.id]);
        const cap = await c.query("select (value #>> '{}')::int as n from rules where key='captain_capacity'");
        const limit = cap.rows[0] ? cap.rows[0].n : 250;
        const cnt = await c.query(
          "select count(*)::int as n from captains where bot_id=$1 and status='active'", [req.bot.id]);
        if (cnt.rows[0].n >= limit) return { full: true };
        const ins = await c.query(
          'insert into captains(bot_id, phone, name) values($1,$2,$3) on conflict(phone) do nothing returning id',
          [req.bot.id, phone, name]);
        return ins.rowCount ? { id: ins.rows[0].id } : { duplicate: true };
      });

      if (out.full) return res.status(409).json({ error: 'group_full' });
      if (out.duplicate) return res.status(409).json({ error: 'already_registered' });
      await audit(req.actor, 'captain.join', String(out.id), { bot: req.bot.id });
      res.status(201).json({ id: out.id });
    }));

    r.get('/', ownerAuth, wrap(async (req, res) => {
      const n = Math.min(Number.parseInt(req.query.limit, 10) || 100, 500);
      const bot = req.query.bot ? String(req.query.bot) : null;
      res.json((await q(
        `select id, bot_id, phone, name, status, joined_at from captains
         where ($1::text is null or bot_id=$1) order by id desc limit $2`, [bot, n])).rows);
    }));

    r.put('/:id/status', ownerAuth, wrap(async (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || !['active', 'suspended'].includes(req.body.status)) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const r1 = await q('update captains set status=$2 where id=$1', [id, req.body.status]);
      if (!r1.rowCount) return res.status(404).json({ error: 'not_found' });
      await audit('owner', 'captain.status', String(id), { status: req.body.status });
      res.json({ ok: true });
    }));
  },
};
