const { q } = require('./db');

// Every decision and every sensitive action leaves a trace here.
async function audit(actor, action, target, detail) {
  await q('insert into audit_log(actor,action,target,detail) values($1,$2,$3,$4)', [
    actor, action, target || null, JSON.stringify(detail || {}),
  ]);
}

module.exports = { audit };
