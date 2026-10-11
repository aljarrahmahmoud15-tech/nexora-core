const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool, q, tx } = require('./db');
const { audit } = require('./audit');
const { ownerAuth, botAuth, wrap } = require('./auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
app.use(rateLimit({ windowMs: 60_000, limit: 300 }));

app.get('/health', (req, res) => res.json({ ok: true }));

// Public, read-only, sanitized: numbers and states only. No tokens, sessions or phones.
app.get('/api/telemetry', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const cap = await q("select (value #>> '{}')::int as n from rules where key='captain_capacity'");
  const { rows } = await q(`
    select b.id, b.name, b.code, b.authority, b.wa_status as wa, b.last_seen,
      (select count(*)::int from captains c where c.bot_id=b.id and c.status='active') as captains,
      (select count(*)::int from requests r where r.bot_id=b.id and r.status='open') as requests,
      (b.group_invite is not null) as "groupLinked"
    from bots b order by b.id`);
  res.json({ updatedAt: new Date().toISOString(), capacity: cap.rows[0] ? cap.rows[0].n : 250, bots: rows });
}));

// Rules: the owner sets them, every module obeys them.
app.get('/api/owner/rules', ownerAuth, wrap(async (req, res) => {
  res.json((await q('select key, value, updated_at from rules order by key')).rows);
}));

app.put('/api/owner/rules/:key', ownerAuth, wrap(async (req, res) => {
  if (!/^[a-z0-9_]{2,60}$/.test(req.params.key)) return res.status(400).json({ error: 'bad_key' });
  if (req.body.value === undefined) return res.status(400).json({ error: 'value_required' });
  await q(`insert into rules(key,value) values($1,$2)
           on conflict(key) do update set value=excluded.value, updated_at=now()`,
    [req.params.key, JSON.stringify(req.body.value)]);
  await audit('owner', 'rule.set', req.params.key, { value: req.body.value });
  res.json({ ok: true });
}));

app.get('/api/owner/audit', ownerAuth, wrap(async (req, res) => {
  const n = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
  res.json((await q('select * from audit_log order by id desc limit $1', [n])).rows);
}));

// Modules: each path is a separate unit that can be added or switched off.
const enabled = new Map();

async function loadModules() {
  const dir = path.join(__dirname, 'modules');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const m = require(path.join(dir, f));
    await q(`insert into modules(name,version) values($1,$2)
             on conflict(name) do update set version=excluded.version`, [m.name, m.version]);
    const { rows } = await q('select enabled from modules where name=$1', [m.name]);
    enabled.set(m.name, rows[0].enabled);
    const router = express.Router();
    m.register(router, { q, tx, audit, ownerAuth, botAuth, wrap });
    app.use('/api/m/' + m.name,
      (req, res, next) => (enabled.get(m.name) ? next() : res.status(503).json({ error: 'module_disabled' })),
      router);
    console.log('module loaded:', m.name, m.version, enabled.get(m.name) ? '(on)' : '(off)');
  }
}

app.get('/api/owner/modules', ownerAuth, wrap(async (req, res) => {
  res.json((await q('select * from modules order by name')).rows);
}));

app.put('/api/owner/modules/:name', ownerAuth, wrap(async (req, res) => {
  if (!enabled.has(req.params.name)) return res.status(404).json({ error: 'unknown_module' });
  if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled_must_be_boolean' });
  await q('update modules set enabled=$2 where name=$1', [req.params.name, req.body.enabled]);
  enabled.set(req.params.name, req.body.enabled);
  await audit('owner', req.body.enabled ? 'module.enable' : 'module.disable', req.params.name);
  res.json({ ok: true });
}));

// Website. The public page shows numbers only; the admin page is inert without the owner token.
const PUB = path.join(__dirname, '..', 'public');
const pageHeaders = (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; manifest-src 'self'; img-src 'self' data:; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  next();
};
app.use('/admin', pageHeaders, express.static(path.join(PUB, 'admin'), { index: 'admin.html' }));
app.use('/', (req, res, next) => (req.path.startsWith('/api') ? next() : pageHeaders(req, res, next)),
  express.static(PUB, { index: 'index.html' }));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

// The schema is idempotent, so it is applied on every boot: no shell is needed on the host.
async function migrate() {
  if (process.env.AUTO_MIGRATE === 'false') return;
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  console.log('schema ok');
}

migrate()
  .then(loadModules)
  .then(() => app.listen(process.env.PORT || 8788, () => console.log('NEXORA core up')))
  .catch((e) => { console.error(e); process.exit(1); });
