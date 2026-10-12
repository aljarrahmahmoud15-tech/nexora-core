#!/usr/bin/env python3
"""NEXORA patch: bot cards editable exactly like the approved design.
Run from the repo root:  python3 apply.py
Idempotent: refuses to apply twice."""
import re, sys, pathlib

root = pathlib.Path('.')
def rd(p): return (root / p).read_text(encoding='utf-8')
def wr(p, s): (root / p).write_text(s, encoding='utf-8')
def sub1(s, old, new, label):
    if s.count(old) != 1:
        sys.exit('PATCH FAILED: expected exactly one match for ' + label + ' but found ' + str(s.count(old)))
    return s.replace(old, new)

# ---------- schema.sql ----------
s = rd('schema.sql')
if 'admin_url' in s: sys.exit('already applied')
s = s.rstrip('\n') + '''

-- Owner-editable bot profile (matches the approved design). All empty by default.
alter table bots add column if not exists admin_url text;
alter table bots add column if not exists captains_manual int;
alter table bots add column if not exists requests_manual int;
alter table bots add column if not exists wa_manual text check (wa_manual in ('ready','off'));
'''
wr('schema.sql', s)

# ---------- src/server.js (public telemetry) ----------
s = rd('src/server.js')
s = sub1(s, "b.wa_status as wa, b.last_seen,",
         "coalesce(b.wa_manual, b.wa_status) as wa, (b.wa_manual is not null) as \"waManual\", b.last_seen,", 'telemetry wa')
s = sub1(s, "(select count(*)::int from captains c where c.bot_id=b.id and c.status='active') as captains,",
         "coalesce(b.captains_manual, (select count(*)::int from captains c where c.bot_id=b.id and c.status='active')) as captains,", 'telemetry captains')
s = sub1(s, "(select count(*)::int from requests r where r.bot_id=b.id and r.status='open') as requests,",
         "coalesce(b.requests_manual, (select count(*)::int from requests r where r.bot_id=b.id and r.status='open')) as requests,", 'telemetry requests')
s = sub1(s, '(b.group_invite is not null) as "groupLinked"',
         '(b.group_invite is not null) as "groupLinked", (b.admin_url is not null) as "adminLinked"', 'telemetry linked')
wr('src/server.js', s)

# ---------- src/modules/bots.js ----------
s = rd('src/modules/bots.js')
s = sub1(s, "await q('update bots set wa_status=$2, group_id=coalesce($3,group_id), last_seen=now() where id=$1',",
         "await q('update bots set wa_status=$2, wa_manual=null, group_id=coalesce($3,group_id), last_seen=now() where id=$1',", 'heartbeat')
s = sub1(s, "'select id, name, code, authority, wa_status, group_invite, group_id, last_seen from bots order by id'",
         "'select id, name, code, authority, wa_status, wa_manual, group_invite, admin_url, captains_manual, requests_manual, group_id, last_seen from bots order by id'", 'owner list')
profile = '''
    // The owner edits a bot's card exactly like the approved design. Empty links stay empty.
    r.put('/:id/profile', ownerAuth, wrap(async (req, res) => {
      const b = req.body || {};
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!['ready', 'off'].includes(b.wa)) return res.status(400).json({ error: 'bad_wa' });
      const capRow = await q("select (value #>> '{}')::int as n from rules where key='captain_capacity'");
      const capMax = capRow.rows[0] ? capRow.rows[0].n : 250;
      const captains = Number.parseInt(b.captains, 10);
      const requests = Number.parseInt(b.requests, 10);
      if (!Number.isInteger(captains) || captains < 0 || captains > capMax) return res.status(400).json({ error: 'bad_captains' });
      if (!Number.isInteger(requests) || requests < 0) return res.status(400).json({ error: 'bad_requests' });
      const invite = String(b.invite || '').trim();
      if (invite && !invite.startsWith('https://chat.whatsapp.com/')) return res.status(400).json({ error: 'bad_invite_link' });
      const adminUrl = String(b.adminUrl || '').trim();
      if (adminUrl && !/^https:\\/\\/[^\\s]+$/.test(adminUrl)) return res.status(400).json({ error: 'bad_admin_url' });
      const u = await q(
        'update bots set name=$2, wa_manual=$3, captains_manual=$4, requests_manual=$5, group_invite=$6, admin_url=$7 where id=$1',
        [req.params.id, name, b.wa, captains, requests, invite || null, adminUrl || null]);
      if (!u.rowCount) return res.status(404).json({ error: 'unknown_bot' });
      await audit('owner', 'bot.profile.set', req.params.id, { linked: Boolean(invite), admin: Boolean(adminUrl) });
      res.json({ ok: true });
    }));
'''
marker = "    // Adding the invite link is what activates a group"
s = sub1(s, marker, profile.lstrip('\n') + '\n' + marker, 'profile route')
wr('src/modules/bots.js', s)

# ---------- public/index.html (css) ----------
s = rd('public/index.html')
css = ("label{display:grid;gap:4px;font-size:13px;color:var(--mute)}\n"
       "select{width:100%;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:15px;font:inherit}\n"
       ".two{display:grid;grid-template-columns:1fr 1fr;gap:8px}\n"
       ".ok-note{color:var(--ok);font-size:13px}\n")
s = sub1(s, "nav{position:fixed", css + "nav{position:fixed", 'css')
wr('public/index.html', s)

# ---------- public/app.js ----------
s = rd('public/app.js')
s = sub1(s, "    if (!b.last_seen ||", "    if (b.waManual) return b.wa;\n    if (!b.last_seen ||", 'waState')
a = s.index("  function saveInvite(")
b_ = s.index("  function viewLog(")
new_view = r'''  var flash = null;
  function act(label, url) {
    var a = el('a', '', url ? label : label + ' (أضف الرابط)');
    if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; } else a.setAttribute('aria-disabled', 'true');
    return a;
  }
  function field(label, input) { var l = el('label', '', label); l.appendChild(input); return l; }
  function inp(type, val, ltr) { var i = el('input'); i.type = type; i.value = val == null ? '' : val; if (ltr) i.setAttribute('dir', 'ltr'); return i; }

  function profileForm(b, o, cap) {
    var f = el('div', 'fm');
    var name = inp('text', o.name);
    var wa = el('select');
    [['ready', 'جاهزة'], ['off', 'غير مرتبطة']].forEach(function (x) {
      var op = el('option', '', x[1]); op.value = x[0]; if ((b.wa === 'ready' ? 'ready' : 'off') === x[0]) op.selected = true; wa.appendChild(op);
    });
    var cp = inp('number', b.captains); cp.min = 0; cp.max = cap;
    var rq = inp('number', b.requests); rq.min = 0;
    var gu = inp('url', o.group_invite, true); gu.placeholder = 'https://chat.whatsapp.com/…';
    var au = inp('url', o.admin_url, true); au.placeholder = 'https://…';
    f.appendChild(field('اسم البوت', name));
    f.appendChild(field('جلسة واتساب', wa));
    var two = el('div', 'two'); two.appendChild(field('كباتن القروب (حتى ' + cap + ')', cp)); two.appendChild(field('طلبات مفتوحة', rq)); f.appendChild(two);
    f.appendChild(field('رابط دعوة القروب', gu));
    f.appendChild(field('رابط لوحة الإدارة', au));
    var er = el('div', 'err'); er.setAttribute('role', 'alert'); f.appendChild(er);
    var go = el('button', 'btn pri', 'حفظ التغييرات'); go.type = 'button';
    go.addEventListener('click', function () {
      var c = parseInt(cp.value, 10), r = parseInt(rq.value, 10), g = gu.value.trim(), a = au.value.trim();
      er.textContent = '';
      if (!name.value.trim()) { er.textContent = 'اكتب اسم البوت.'; return; }
      if (isNaN(c) || c < 0 || c > cap) { er.textContent = 'عدد الكباتن يجب أن يكون بين 0 و' + cap + '.'; return; }
      if (isNaN(r) || r < 0) { er.textContent = 'عدد الطلبات يجب أن يكون 0 أو أكثر.'; return; }
      if (g && g.indexOf('https://chat.whatsapp.com/') !== 0) { er.textContent = 'رابط القروب يجب أن يبدأ بـ https://chat.whatsapp.com/'; return; }
      if (a && a.indexOf('https://') !== 0) { er.textContent = 'رابط لوحة الإدارة يجب أن يبدأ بـ https://'; return; }
      go.disabled = true; go.textContent = 'جارٍ الحفظ…';
      api('PUT', '/api/m/bots/' + encodeURIComponent(b.id) + '/profile',
        { name: name.value.trim(), wa: wa.value, captains: c, requests: r, invite: g, adminUrl: a })
        .then(function () { flash = b.id; return load(); })
        .catch(function (e) { go.disabled = false; go.textContent = 'حفظ التغييرات'; er.textContent = e.status === 401 ? 'انتهت الجلسة، ادخل من جديد.' : 'تعذّر الحفظ، حاول مرة أخرى.'; });
    });
    f.appendChild(go);
    return f;
  }

  function viewBots(v) {
    var cap = data.capacity;
    data.bots.forEach(function (b, i) {
      var st = waState(b), ok = st === 'ready', o = owner[b.id];
      var c = el('div', 'bot'); c.style.setProperty('--acc', ACC[i % 5]);
      var h = el('div', 'bh'), t = el('div'); t.appendChild(el('div', 't', b.name)); t.appendChild(el('code', '', b.code)); h.appendChild(t);
      h.appendChild(el('span', 'tag' + (ok ? ' ok' : ''), ok ? 'يعمل' : WA[st][0])); c.appendChild(h);
      c.appendChild(part('جلسة واتساب', WA[st][0], WA[st][1]));
      c.appendChild(part('قروب واتساب', b.groupLinked ? 'مرتبط' : 'بانتظار رابط الدعوة', b.groupLinked ? 'g' : 'w'));
      c.appendChild(part('لوحة الإدارة', b.adminLinked ? 'متاحة' : 'بانتظار الرابط', b.adminLinked ? 'g' : 'w'));
      c.appendChild(part('السلطة', b.authority === 'nexora' ? 'NEXORA' : 'V26', b.authority === 'nexora' ? 'g' : ''));
      var s = el('div', 'stats'); s.appendChild(stat('كباتن القروب', b.captains + ' / ' + cap)); s.appendChild(stat('طلبات مفتوحة', b.requests)); c.appendChild(s);
      var bar = el('div', 'bar'), fi = el('i'); fi.style.width = Math.min(100, Math.round(b.captains / cap * 100)) + '%'; fi.style.background = ACC[i % 5]; bar.appendChild(fi); c.appendChild(bar);
      if (token && o) {
        var ac = el('div', 'acts'); ac.appendChild(act('فتح لوحة البوت', o.admin_url)); ac.appendChild(act('فتح القروب', o.group_invite)); c.appendChild(ac);
        c.appendChild(profileForm(b, o, cap));
        if (flash === b.id) c.appendChild(el('div', 'ok-note', 'تم حفظ التغييرات.'));
        var tk = el('button', 'btn', 'إصدار رمز التوثيق للبوت'); tk.type = 'button'; tk.style.marginTop = '10px';
        var tout = el('div');
        tk.addEventListener('click', function () {
          if (!window.confirm('سيُبطل هذا الرمز الرمز السابق لهذا البوت. متابعة؟')) return;
          api('POST', '/api/m/bots/' + encodeURIComponent(b.id) + '/token').then(function (r) {
            tout.textContent = '';
            tout.appendChild(el('div', 'err', 'انسخ الرمز الآن وضعه في إعدادات هذا البوت فقط. لا يظهر مرة ثانية.'));
            tout.appendChild(el('code', 'tk', r.token));
          }).catch(function () { tout.textContent = 'تعذّر إصدار الرمز.'; });
        });
        c.appendChild(tk); c.appendChild(tout);
      }
      v.appendChild(c);
    });
    if (!token) v.appendChild(el('div', 'note', 'الروابط وتعديل بيانات البوتات يظهران بعد دخول المالك.'));
  }

'''
s = s[:a] + new_view + s[b_:]
# do not wipe a form while the owner is typing
s = sub1(s, "setInterval(function () { if (!document.hidden) load(); }, EVERY);",
         "setInterval(function () {\n    var ae = document.activeElement;\n    if (document.hidden || (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.closest && ae.closest('#view'))) return;\n    load();\n  }, EVERY);", 'interval')
wr('public/app.js', s)
print('patch applied')
