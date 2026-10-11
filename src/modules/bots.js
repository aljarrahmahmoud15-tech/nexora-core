const crypto = require('crypto');

module.exports = {
  name: 'bots',
  version: '0.1.0',
  register(r, { q, audit, ownerAuth, botAuth, wrap }) {
    // A bot reports its state. NEXORA keeps the truth.
    r.post('/heartbeat', botAuth, wrap(async (req, res) => {
      const wa = ['ready', 'off', 'qr'].includes(req.body.wa) ? req.body.wa : 'off';
      const groupId = typeof req.body.groupId === 'string' ? req.body.groupId.slice(0, 120) : null;
      await q('update bots set wa_status=$2, group_id=coalesce($3,group_id), last_seen=now() where id=$1',
        [req.bot.id, wa, groupId]);
      res.json({ ok: true });
    }));

    // The bot asks which group invite it must join. The owner decides it, not the bot.
    r.get('/me', botAuth, wrap(async (req, res) => {
      const { rows } = await q('select id, name, group_invite from bots where id=$1', [req.bot.id]);
      res.json(rows[0]);
    }));

    r.get('/', ownerAuth, wrap(async (req, res) => {
      res.json((await q(
        'select id, name, code, authority, wa_status, group_invite, group_id, last_seen from bots order by id')).rows);
    }));

    // Issues a new token for a bot. Shown ONCE; only its hash is stored. Replaces the previous token.
    r.post('/:id/token', ownerAuth, wrap(async (req, res) => {
      const token = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const u = await q('update bots set token_hash=$2 where id=$1', [req.params.id, hash]);
      if (!u.rowCount) return res.status(404).json({ error: 'unknown_bot' });
      await audit('owner', 'bot.token.issue', req.params.id);
      res.json({ token });
    }));

    // The owner decides who settles this bot's group. Switch to 'nexora' only after V26 stops settling it.
    r.put('/:id/authority', ownerAuth, wrap(async (req, res) => {
      if (!['v26', 'nexora'].includes(req.body.authority)) return res.status(400).json({ error: 'bad_authority' });
      const r1 = await q('update bots set authority=$2 where id=$1', [req.params.id, req.body.authority]);
      if (!r1.rowCount) return res.status(404).json({ error: 'unknown_bot' });
      await audit('owner', 'bot.authority.set', req.params.id, { authority: req.body.authority });
      res.json({ ok: true });
    }));

    // Adding the invite link is what activates a group: the bot picks it up from /me.
    r.put('/:id/group', ownerAuth, wrap(async (req, res) => {
      const invite = String(req.body.invite || '').trim();
      if (invite && !invite.startsWith('https://chat.whatsapp.com/')) {
        return res.status(400).json({ error: 'bad_invite_link' });
      }
      const r1 = await q('update bots set group_invite=$2 where id=$1', [req.params.id, invite || null]);
      if (!r1.rowCount) return res.status(404).json({ error: 'unknown_bot' });
      await audit('owner', 'bot.group_invite.set', req.params.id, { linked: Boolean(invite) });
      res.json({ ok: true });
    }));
  },
};
