const crypto = require('crypto');
const { handleEvent, adminBooking } = require('../lib/engine');
const { settle } = require('../lib/settlement');
const { normalizePhone } = require('../lib/phone');
const { SqlStore } = require('../lib/sqlstore');
const { loadRules } = require('../lib/rules');

// NEXORA is the authority. A bot sends what it saw; NEXORA decides and settles.
// A bot only reaches this engine after the owner switches its authority to 'nexora',
// so V26 and NEXORA never settle the same group twice.
module.exports = {
  name: 'engine',
  version: '0.1.0',
  register(r, { q, tx, audit, ownerAuth, botAuth, wrap }) {
    const store = new SqlStore(q, tx);

    r.post('/event', botAuth, wrap(async (req, res) => {
      const { rows } = await q('select authority from bots where id=$1', [req.bot.id]);
      if (!rows[0] || rows[0].authority !== 'nexora') {
        return res.status(409).json({ error: 'authority_not_nexora' });
      }
      const ev = req.body || {};
      const idOk = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
      if (ev.type === 'message' ? !idOk(ev.msgId) : ev.type === 'reaction' ? !idOk(ev.targetMsgId) : true) {
        return res.status(400).json({ error: 'bad_event' });
      }
      const out = await handleEvent(store, await loadRules(q), req.bot.id, ev);
      if (out.action === 'confirmed') {
        await audit(req.actor, 'booking.confirmed', String(out.bookingId), out.settlement);
      }
      res.json(out);
    }));

    const HTTP = { bad_price: 400, bad_phone: 400, same_person: 400, owner_not_found: 404,
      executor_not_found: 404, owner_inactive: 409, executor_inactive: 409, already_confirmed: 409 };
    const nexoraBot = async (botId) => {
      const { rows } = await q('select authority from bots where id=$1', [botId]);
      return rows[0] ? rows[0].authority === 'nexora' : null;
    };

    // Owner adds a booking by phones + price, and may confirm it immediately.
    r.post('/admin-booking', ownerAuth, wrap(async (req, res) => {
      const botId = String(req.body.botId || '');
      const ok = await nexoraBot(botId);
      if (ok === null) return res.status(404).json({ error: 'unknown_bot' });
      if (!ok) return res.status(409).json({ error: 'authority_not_nexora' });
      const out = await adminBooking(store, await loadRules(q), {
        botId, ownerPhone: req.body.ownerPhone, executorPhone: req.body.executorPhone,
        priceFils: req.body.priceFils, confirm: req.body.confirm !== false, newId: crypto.randomUUID() });
      if (out.error) return res.status(HTTP[out.error] || 400).json({ error: out.error });
      await audit('owner', out.status === 'confirmed' ? 'booking.admin_confirmed' : 'booking.admin_created',
        String(out.bookingId), { botId, priceFils: req.body.priceFils, ...(out.settlement || {}), overLimit: out.overLimit });
      res.status(201).json(out);
    }));

    // Confirm an offered booking that already has a request from this executor.
    r.post('/bookings/:id/confirm', ownerAuth, wrap(async (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      const ex = normalizePhone(req.body.executorPhone);
      if (!Number.isInteger(id) || !ex) return res.status(400).json({ error: 'bad_request' });
      const { rows } = await q(
        `select b.bot_id, b.status, b.owner_captain_id, b.price_fils, r.request_msg_id, r.executor_captain_id
         from bookings b join booking_requests r on r.booking_id=b.id
         join captains c on c.id=r.executor_captain_id where b.id=$1 and c.phone=$2`, [id, ex]);
      const x = rows[0];
      if (!x) return res.status(404).json({ error: 'no_such_request' });
      if (!(await nexoraBot(x.bot_id))) return res.status(409).json({ error: 'authority_not_nexora' });
      if (x.status !== 'offered') return res.status(409).json({ error: 'already_confirmed' });
      const s = settle(Number(x.price_fils), await loadRules(q));
      const out = await store.confirmBooking({ bookingId: id, requestMsgId: x.request_msg_id,
        executorCaptainId: Number(x.executor_captain_id), ownerCaptainId: Number(x.owner_captain_id), settlement: s });
      if (!out.ok) return res.status(409).json({ error: out.reason });
      await audit('owner', 'booking.admin_confirmed', String(id), s);
      res.json({ status: 'confirmed', settlement: s });
    }));

    r.post('/bookings/:id/void', ownerAuth, wrap(async (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
      const u = await q("update bookings set status='void' where id=$1 and status='offered' returning id", [id]);
      if (!u.rowCount) return res.status(409).json({ error: 'not_offered' });
      await audit('owner', 'booking.void', String(id));
      res.json({ ok: true });
    }));

    r.get('/bookings', ownerAuth, wrap(async (req, res) => {
      const n = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
      res.json((await q('select * from bookings order by id desc limit $1', [n])).rows);
    }));
  },
};
