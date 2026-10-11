(function () {
  'use strict';
  var ACC = ['#22c3a6', '#8b7cf6', '#f2a93b', '#ec6b8f', '#4aa3f5'];
  var STALE = 3 * 60 * 1000, EVERY = 15000;
  var data = null, failed = false, token = null, owner = {}, tab = 'center', idle = null, last = null;
  var $ = function (s) { return document.querySelector(s); };
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; }
  function jd(f) { return (Number(f) / 1000).toFixed(3); }
  function part(l, v, c) { var p = el('div', 'part'); p.appendChild(el('span', '', l)); p.appendChild(el('span', c || '', v)); return p; }
  function stat(l, v) { var d = el('div', '', l); d.appendChild(el('b', '', String(v))); return d; }

  function waState(b) {
    if (!b.last_seen || Date.now() - new Date(b.last_seen).getTime() > STALE) return 'stale';
    return b.wa;
  }
  var WA = { ready: ['جاهزة', 'g'], qr: ['بانتظار مسح الرمز', 'w'], off: ['غير مرتبطة', 'w'], stale: ['لا يوجد نبض', 'r'] };

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (!r.ok) { var e = new Error((d && d.error) || ('http_' + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  // ---------- data ----------
  function load() {
    return fetch('/api/telemetry', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.json(); })
      .then(function (d) { data = d; failed = false; last = new Date(); })
      .catch(function () { failed = true; })
      .then(function () {
        if (!token) return;
        return api('GET', '/api/m/bots').then(function (rows) {
          owner = {}; rows.forEach(function (b) { owner[b.id] = b; });
        }).catch(function (e) { if (e.status === 401) logout(); });
      })
      .then(render);
  }

  // ---------- views ----------
  function viewCenter(v) {
    var bots = data.bots, cap = data.capacity, total = cap * bots.length;
    var sum = bots.reduce(function (a, b) { return a + b.captains; }, 0);
    var ready = bots.filter(function (b) { return waState(b) === 'ready'; }).length;
    var req = bots.reduce(function (a, b) { return a + b.requests; }, 0);
    var pc = total ? Math.round(sum / total * 100) : 0;
    var c = el('div', 'card'), big = el('div', 'big');
    big.appendChild(el('strong', '', String(sum))); big.appendChild(el('span', '', 'من ' + total + ' كابتن')); big.appendChild(el('em', '', pc + '%'));
    c.appendChild(big);
    var seg = el('div', 'seg');
    bots.forEach(function (b, i) {
      var w = el('div', 'sg'), col = el('div', 'col'), fi = el('i');
      fi.style.height = Math.min(100, Math.round(b.captains / cap * 100)) + '%'; fi.style.background = ACC[i % 5];
      if (waState(b) !== 'ready') fi.style.opacity = '.35';
      col.appendChild(fi); w.appendChild(col); w.appendChild(el('small', '', 'L' + (i + 1))); w.appendChild(el('b', '', String(b.captains))); seg.appendChild(w);
    });
    c.appendChild(seg); v.appendChild(c);
    var s = el('div', 'sum');
    var a1 = el('div'); a1.appendChild(el('strong', '', ready + '/' + bots.length)); a1.appendChild(el('span', '', 'بوتات جاهزة'));
    var a2 = el('div'); a2.appendChild(el('strong', '', String(req))); a2.appendChild(el('span', '', 'طلبات مفتوحة'));
    s.appendChild(a1); s.appendChild(a2); v.appendChild(s);

    v.appendChild(el('h2', '', 'تحتاج إجراءً'));
    var list = el('div', 'list'), n = 0;
    function item(t, m, bad) { var i = el('div', 'item'); i.appendChild(el('i', 'dot' + (bad ? ' bad' : ''))); var d = el('div'); d.appendChild(el('div', 't', t)); if (m) d.appendChild(el('div', 'm', m)); i.appendChild(d); list.appendChild(i); n++; }
    bots.forEach(function (b) {
      var st = waState(b);
      if (st === 'stale') item('لا نبض من ' + b.name, 'تأكد أن البوت يعمل ويرسل حالته', true);
      else if (st !== 'ready') item('ربط واتساب: ' + b.name, WA[st][0]);
      if (!b.groupLinked) item('إضافة رابط دعوة قروب ' + b.name, 'يُفعّل القروب بمجرد حفظ الرابط');
      if (b.captains >= cap) item(b.name + ' وصل السعة الكاملة', 'القروب ممتلئ (' + cap + ' كابتن)', true);
    });
    if (!n) item('لا شيء يحتاج إجراءً', 'كل البوتات تعمل وقروباتها مرتبطة');
    v.appendChild(list);
  }

  function saveInvite(b, input, err, btn) {
    var g = input.value.trim(); err.textContent = '';
    if (g && g.indexOf('https://chat.whatsapp.com/') !== 0) { err.textContent = 'الرابط يجب أن يبدأ بـ https://chat.whatsapp.com/'; return; }
    btn.disabled = true;
    api('PUT', '/api/m/bots/' + encodeURIComponent(b.id) + '/group', { invite: g })
      .then(function () { return load(); })
      .catch(function (e) { err.textContent = e.status === 401 ? 'انتهت الجلسة، ادخل من جديد.' : 'تعذّر الحفظ.'; })
      .then(function () { btn.disabled = false; });
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
      c.appendChild(part('السلطة', b.authority === 'nexora' ? 'NEXORA' : 'V26', b.authority === 'nexora' ? 'g' : ''));
      var s = el('div', 'stats'); s.appendChild(stat('كباتن القروب', b.captains + ' من ' + cap)); s.appendChild(stat('طلبات مفتوحة', b.requests)); c.appendChild(s);
      var bar = el('div', 'bar'), fi = el('i'); fi.style.width = Math.min(100, Math.round(b.captains / cap * 100)) + '%'; fi.style.background = ACC[i % 5]; bar.appendChild(fi); c.appendChild(bar);
      if (token && o) {
        var fm = el('div', 'fm'), inp = el('input'); inp.type = 'url'; inp.setAttribute('dir', 'ltr'); inp.placeholder = 'https://chat.whatsapp.com/…'; inp.value = o.group_invite || '';
        var er = el('div', 'err'); er.setAttribute('role', 'alert');
        var sv = el('button', 'btn pri', o.group_invite ? 'تحديث رابط القروب' : 'حفظ رابط القروب'); sv.type = 'button';
        sv.addEventListener('click', function () { saveInvite(b, inp, er, sv); });
        fm.appendChild(inp); fm.appendChild(er); fm.appendChild(sv); c.appendChild(fm);
        var ac = el('div', 'acts'), g = el('a', '', 'فتح القروب');
        if (o.group_invite) { g.href = o.group_invite; g.target = '_blank'; g.rel = 'noopener noreferrer'; } else g.setAttribute('aria-disabled', 'true');
        var p = el('a', '', 'لوحة الإدارة'); p.href = '/admin/';
        ac.appendChild(p); ac.appendChild(g); c.appendChild(ac);
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
    if (!token) v.appendChild(el('div', 'note', 'روابط القروبات وتعديلها يظهران بعد دخول المالك.'));
  }

  function viewLog(v) {
    var c = el('div', 'card'); v.appendChild(c);
    if (!token) { c.appendChild(el('div', 'sub', 'سجل التدقيق يظهر بعد دخول المالك.')); return; }
    c.appendChild(el('div', 'sub', 'جارٍ التحميل…'));
    api('GET', '/api/owner/audit?limit=50').then(function (rows) {
      c.textContent = '';
      if (!rows.length) { c.appendChild(el('div', 'sub', 'لا توجد أحداث بعد.')); return; }
      rows.forEach(function (a) {
        var i = el('div', 'item'), d = el('div'); d.appendChild(el('div', 't', a.action + (a.target ? ' · ' + a.target : '')));
        d.appendChild(el('div', 'm', a.actor + ' · ' + new Date(a.at).toLocaleString('ar'))); i.appendChild(d); c.appendChild(i);
      });
    }).catch(function () { c.textContent = 'تعذّر تحميل السجل.'; });
  }

  function render() {
    $('#fail').hidden = !failed;
    var v = $('#view'); v.textContent = '';
    if (!data) { v.appendChild(el('div', 'card', failed ? 'لا توجد بيانات بعد.' : 'جارٍ التحميل…')); return; }
    $('#sub').textContent = 'مركز إدارة تشغيلي · ' + (data.capacity * data.bots.length) + ' كابتن';
    $('#stamp').textContent = last ? 'آخر تحديث ' + last.toLocaleTimeString('ar') + ' · يُحدَّث كل 15 ثانية' : '';
    ({ center: viewCenter, bots: viewBots, log: viewLog })[tab](v);
  }

  // ---------- owner mode ----------
  function bump() { clearTimeout(idle); idle = setTimeout(logout, 15 * 60 * 1000); }
  function logout() { token = null; owner = {}; $('#own-btn').textContent = 'دخول المالك'; render(); }
  document.addEventListener('click', function () { if (token) bump(); });
  $('#own-btn').addEventListener('click', function () {
    if (token) { logout(); return; }
    $('#own').hidden = !$('#own').hidden;
    if (!$('#own').hidden) $('#tok').focus();
  });
  function login() {
    var t = $('#tok').value.trim(); $('#oerr').textContent = ''; if (!t) return;
    token = t;
    api('GET', '/api/m/bots').then(function (rows) {
      owner = {}; rows.forEach(function (b) { owner[b.id] = b; });
      $('#own').hidden = true; $('#tok').value = ''; $('#own-btn').textContent = 'خروج المالك'; bump(); render();
    }).catch(function (e) { token = null; $('#oerr').textContent = e.status === 401 ? 'الرمز غير صحيح.' : 'تعذّر الاتصال.'; });
  }
  $('#ologin').addEventListener('click', login);
  $('#tok').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });

  // ---------- wiring ----------
  document.querySelectorAll('nav button').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.dataset.t;
      document.querySelectorAll('nav button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      render(); window.scrollTo(0, 0);
    });
  });
  $('#refresh').addEventListener('click', load);
  setInterval(function () { if (!document.hidden) load(); }, EVERY);
  load();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
