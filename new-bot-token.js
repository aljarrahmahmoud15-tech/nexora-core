// Usage: npm run new-bot-token -- b1
// Prints the token ONCE. Only its hash is stored. Put it in that bot's env, never in chat.
const crypto = require('crypto');
const { pool } = require('../src/db');

(async () => {
  const id = process.argv[2];
  if (!id) throw new Error('usage: npm run new-bot-token -- <bot id, e.g. b1>');
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const r = await pool.query('update bots set token_hash=$2 where id=$1', [id, hash]);
  if (!r.rowCount) throw new Error('unknown bot id: ' + id);
  await pool.query("insert into audit_log(actor,action,target) values('owner','bot.token.issue',$1)", [id]);
  console.log('Bot', id, 'token (shown once):\n' + token);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
