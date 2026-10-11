const KINDS = ['settlement', 'refund', 'deduction', 'new_module', 'other'];

// NEXORA never moves money. It records the request, waits for the owner's explicit
// decision, and the bot only acts on an approved one.
module.exports = {
  name: 'approvals',
  version: '0.1.0',
  register(r, { q, audit, ownerAuth, botAuth, wrap }) {
    r.post('/', botAuth, wrap(async (req, res) => {
      if (!KINDS.includes(req.body.kind)) return res.status(400).json({ error: 'bad_kind' });
      const payload = req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
      const { rows } = await q(
        'insert into approvals(bot_id, kind, payload) values($1,$2,$3) returning id',
        [req.bot.id, req.body.kind, JSON.stringify(payload)]);
      await audit(req.actor, 'approval.request', String(rows[0].id), { kind: req.body.kind });
      res.status(201).json({ id: rows[0].id, status: 'pending' });
    }));

    r.get('/pending', ownerAuth, wrap(async (req, res) => {
      res.json((await q(
        "select id, bot_id, kind, payload, created_at from approvals where status='pending' order by id")).rows);
    }));

    // A bot may read only the status of its own requests.
    r.get('/:id', botAuth, wrap(async (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
      const { rows } = await q(
        'select id, kind, status, decided_at from approvals where id=$1 and bot_id=$2', [id, req.bot.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not_found' });
      res.json(rows[0]);
    }));

    r.post('/:id/decide', ownerAuth, wrap(async (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      const d = req.body.decision;
      if (!Number.isInteger(id) || !['approve', 'reject'].includes(d)) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const note = typeof req.body.note === 'string' ? req.body.note.slice(0, 300) : null;
      const { rows } = await q(
        `update approvals set status=$2, decided_at=now(), note=$3
         where id=$1 and status='pending' returning id`,
        [id, d === 'approve' ? 'approved' : 'rejected', note]);
      if (!rows[0]) return res.status(409).json({ error: 'not_pending' });
      await audit('owner', 'approval.' + d, String(id), { note });
      res.json({ ok: true });
    }));
  },
};
