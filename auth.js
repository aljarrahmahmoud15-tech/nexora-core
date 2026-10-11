const crypto = require('crypto');
const { q } = require('./db');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const bearer = (req) => {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function ownerAuth(req, res, next) {
  const t = process.env.OWNER_TOKEN || '';
  if (t.length < 32) return res.status(500).json({ error: 'owner_token_not_configured' });
  if (!same(bearer(req), t)) return res.status(401).json({ error: 'unauthorized' });
  req.actor = 'owner';
  next();
}

const botAuth = wrap(async (req, res, next) => {
  const id = req.get('x-bot-id') || '';
  const tok = bearer(req);
  if (!id || !tok) return res.status(401).json({ error: 'unauthorized' });
  const { rows } = await q('select token_hash from bots where id=$1', [id]);
  const stored = rows[0] && rows[0].token_hash;
  const given = crypto.createHash('sha256').update(tok).digest('hex');
  if (!stored || stored.length !== given.length ||
      !crypto.timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(given, 'hex'))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.bot = { id };
  req.actor = 'bot:' + id;
  next();
});

module.exports = { ownerAuth, botAuth, wrap };
