(function () {
  'use strict';
  var token = null, idle = null, tab = 'book';
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function jd(f) { return (Number(f) / 1000).toFixed(3); }
  function when(x) { return x ? new Date(x).toLocaleString('ar') : '—'; }

  var ERR = {
    unauthorized: 'الرمز غير صحيح.', authority_not_nexora: 'هذا البوت ما زال تحت سلطة V26. غيّر سلطته إلى NEXORA أولاً.',
    owner_not_found: 'رقم المنزل غير مسجّل كابتناً في هذا البوت.', executor_not_found: 'رقم المنفذ غير مسجّل كابتناً في هذا البوت.',
    owner_inactive: 'المنزل موقوف.', executor_inactive: 'المنفذ موقوف.', same_person: 'المنزل والمنفذ نفس الرقم.',
    bad_price: 'السعر غير صالح.', bad_phone: 'رقم هاتف غير صالح.', already_confirmed: 'الحجز مثبّت أو مغلق سابقاً.',
    no_such_request: 'لا يوجد طلب من هذا المنفذ على الحجز.', not_offered: 'لا يمكن إلغاء حجز غير معروض.',
    value_must_be_whole_dinars_up_to_500: 'القيمة بالدنانير الصحيحة وحتى 500.', count_1_to_100: 'العدد من 1 إلى 100.',
    not_active: 'البطاقة غير فعّالة.', not_found: 'غير موجود.'
  };
  var msg = function (e) { return ERR[e.message] || ('تعذّر التنفيذ (' + e.message + ')'); };

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (!r.ok) { var e = new Error((d && d.error) || ('http_' + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
  }
  function bump() { clearTimeout(idle); idle = setTimeout(logout, 15 * 60 * 1000); }
  function logout() { token = null; $('#tok').value = ''; $('#login').hidden = false; $('#nav').hidden = true; $('#out').hidden = true; $('#view').textContent = ''; }
  document.addEventListener('click', function () { if (token) bump(); });

  function field(label, input) { var l = el('label', '', label); l.appendChild(input); return l; }
  function inp(type, ph, ltr) { var i = el('input'); i.type = type; if (ph) i.placeholder = ph; if (ltr) i.setAttribute('dir', 'ltr'); return i; }
  function card(parent) { var c = el('div', 'card'); parent.appendChild(c); return c; }
  function sleep(v) { v.textContent = ''; }

  // ---------- new booking ----------
  function viewBook(v) {
    var c = card(v); c.appendChild(el('div', 'sub', 'جارٍ التحميل…'));
    Promise.all([api('GET', '/api/m/bots'), api('GET', '/api/owner/rules')]).then(function (rs) {
      var bots = rs[0], rules = {}; rs[1].forEach(function (x) { rules[x.key] = x.value; });
      var ep = Number(rules.commission_executor_pct || 15), cp = Number(rules.commission_company_pct || 15);
      c.textContent = '';
      var bot = el('select');
      bots.forEach(function (b) { var o = el('option', '', b.name + (b.authority === 'nexora' ? ' · NEXORA' : ' · V26 (غير متاح)')); o.value = b.id; if (b.authority !== 'nexora') o.disabled = true; bot.appendChild(o); });
      var first = bots.find(function (b) { return b.authority === 'nexora'; }); if (first) bot.value = first.id;
      var own = inp('tel', '07xxxxxxxx', true), exe = inp('tel', '07xxxxxxxx', true), price = inp('number', '10.000', true);
      price.step = '0.001'; price.min = '0.001'; price.inputMode = 'decimal';
      var conf = el('input'); conf.type = 'checkbox'; conf.checked = true; conf.style.width = 'auto';
      var cl = el('label'); cl.style.display = 'flex'; cl.style.gap = '8px'; cl.style.alignItems = 'center'; cl.appendChild(conf); cl.appendChild(document.createTextNode('تثبيت الحجز مباشرة وتنفيذ التسوية'));
      var prev = el('div', 'prev'), err = el('div', 'err'); err.setAttribute('role', 'alert');
      var ok = el('div'); var go = el('button', 'btn', 'إضافة الحجز'); go.type = 'button';
      c.appendChild(field('البوت', bot)); c.appendChild(field('رقم المنزل (صاحب العرض)', own)); c.appendChild(field('رقم المنفذ', exe)); c.appendChild(field('السعر بالدينار', price));
      c.appendChild(prev); c.appendChild(cl); c.appendChild(err); c.appendChild(go); c.appendChild(ok);
      if (!first) err.textContent = 'لا يوجد بوت تحت سلطة NEXORA بعد. فعّل واحداً من إعدادات السلطة.';
      function pct(a, p) { return Math.floor((a * p + 50) / 100); }
      function fils() { var f = Math.round(parseFloat(price.value) * 1000); return isFinite(f) && f > 0 ? f : null; }
      function draw() {
        prev.textContent = ''; var f = fils(); if (!f) return;
        var x = pct(f, ep), co = pct(x, cp), o = x - co;
        [['يُخصم من المنفذ', '−' + jd(x)], ['يُضاف للمنزل', '+' + jd(o)], ['للشركة', '+' + jd(co)]].forEach(function (p) { var d = el('div'); d.appendChild(document.createTextNode(p[0] + ' ')); d.appendChild(el('b', 'ltr', p[1])); prev.appendChild(d); });
      }
      price.addEventListener('input', draw);
      go.addEventListener('click', function () {
        err.textContent = ''; ok.textContent = ''; var f = fils();
        if (!bot.value || !own.value.trim() || !exe.value.trim() || !f) { err.textContent = 'أكمل البوت والرقمين والسعر.'; return; }
        if (!window.confirm('إضافة حجز ' + jd(f) + ' د.أ\nالمنزل: ' + own.value + '\nالمنفذ: ' + exe.value + (conf.checked ? '\nسيُثبَّت وتُنفَّذ التسوية الآن.' : '\nسيُحفظ دون تثبيت.'))) return;
        go.disabled = true;
        api('POST', '/api/m/engine/admin-booking', { botId: bot.value, ownerPhone: own.value, executorPhone: exe.value, priceFils: f, confirm: conf.checked })
          .then(function (r) {
            var b = el('div', 'okmsg');
            b.appendChild(el('div', 'g', r.status === 'confirmed' ? 'تم تثبيت الحجز #' + r.bookingId : 'تم حفظ الحجز #' + r.bookingId + ' دون تثبيت'));
            if (r.settlement) {
              b.appendChild(el('div', '', 'رصيد المنفذ بعد التسوية: ' + jd(r.executorBalanceAfter)));
              b.appendChild(el('div', '', 'رصيد المنزل بعد التسوية: ' + jd(r.ownerBalanceAfter)));
              if (r.overLimit) b.appendChild(el('div', 'w', 'تنبيه: رصيد المنفذ تجاوز حد المديونية.'));
            }
            ok.appendChild(b); own.value = ''; exe.value = ''; price.value = ''; prev.textContent = '';
          }).catch(function (e) { err.textContent = msg(e); }).then(function () { go.disabled = false; });
      });
    }).catch(function (e) { c.textContent = msg(e); });
  }

  // ---------- bookings ----------
  function viewBookings(v) {
    var c = card(v); c.appendChild(el('div', 'sub', 'جارٍ التحميل…'));
    api('GET', '/api/m/engine/bookings?limit=50').then(function (rows) {
      c.textContent = ''; if (!rows.length) { c.appendChild(el('div', 'sub', 'لا توجد حجوزات بعد.')); return; }
      rows.forEach(function (b) {
        var r = el('div', 'row'), l = el('div');
        l.appendChild(el('div', 't', '#' + b.id + ' · ' + jd(b.price_fils) + ' د.أ · ' + b.bot_id));
        l.appendChild(el('div', 'm', (String(b.offer_msg_id).indexOf('admin:') === 0 ? 'من الإدارة' : 'من القروب') + ' · ' + when(b.created_at)));
        r.appendChild(l);
        var s = el('div'); var st = el('span', b.status === 'confirmed' ? 'g' : b.status === 'void' ? 'r' : 'w', b.status === 'confirmed' ? 'مثبّت' : b.status === 'void' ? 'ملغى' : 'معروض'); s.appendChild(st);
        if (b.status === 'offered') {
          var cb = el('button', 'btn sm', 'تأكيد'); cb.type = 'button'; cb.style.marginInlineStart = '8px';
          cb.addEventListener('click', function () {
            var p = window.prompt('رقم المنفذ الذي ردّ على هذا الحجز:'); if (!p) return;
            api('POST', '/api/m/engine/bookings/' + b.id + '/confirm', { executorPhone: p }).then(function () { show(); }).catch(function (e) { window.alert(msg(e)); });
          });
          var vb = el('button', 'btn alt sm', 'إلغاء'); vb.type = 'button'; vb.style.marginInlineStart = '6px';
          vb.addEventListener('click', function () {
            if (!window.confirm('إلغاء الحجز #' + b.id + '؟')) return;
            api('POST', '/api/m/engine/bookings/' + b.id + '/void').then(function () { show(); }).catch(function (e) { window.alert(msg(e)); });
          });
          s.appendChild(cb); s.appendChild(vb);
        }
        r.appendChild(s); c.appendChild(r);
      });
    }).catch(function (e) { c.textContent = msg(e); });
  }

  // ---------- wallets ----------
  function viewWallets(v) {
    var neg = false, box = el('div'), formHost = el('div');
    var t = el('button', 'btn alt sm', 'عرض المدينين فقط'); t.type = 'button';
    v.appendChild(t); v.appendChild(formHost); v.appendChild(box);
    t.addEventListener('click', function () { neg = !neg; t.textContent = neg ? 'عرض الكل' : 'عرض المدينين فقط'; load(); });
    function adjust(cap) {
      sleep(formHost); var c = card(formHost);
      c.appendChild(el('div', 't', 'تسوية رصيد ' + cap.phone));
      var amt = inp('number', 'مثال: 5 للإضافة أو -2 للخصم', true); amt.step = '0.001';
      var note = inp('text', 'السبب (مثلاً: سداد مديونية)'); var err = el('div', 'err');
      var go = el('button', 'btn', 'تنفيذ'); go.type = 'button';
      c.appendChild(field('المبلغ بالدينار', amt)); c.appendChild(field('السبب', note)); c.appendChild(err); c.appendChild(go);
      go.addEventListener('click', function () {
        var f = Math.round(parseFloat(amt.value) * 1000); if (!isFinite(f) || f === 0) { err.textContent = 'أدخل مبلغاً صالحاً.'; return; }
        if (!window.confirm('تسوية ' + jd(f) + ' د.أ على ' + cap.phone + '؟')) return;
        api('POST', '/api/m/wallets/adjust', { captainId: Number(cap.id), amountFils: f, note: note.value }).then(function () { sleep(formHost); load(); }).catch(function (e) { err.textContent = msg(e); });
      });
    }
    function load() {
      sleep(box); var c = card(box); c.appendChild(el('div', 'sub', 'جارٍ التحميل…'));
      api('GET', '/api/m/wallets' + (neg ? '?negative=1' : '')).then(function (rows) {
        c.textContent = ''; if (!rows.length) { c.appendChild(el('div', 'sub', 'لا توجد أرصدة.')); return; }
        rows.forEach(function (w) {
          var r = el('div', 'row'), l = el('div'); l.appendChild(el('code', '', w.phone)); l.appendChild(el('div', 'm', w.bot_id + (w.status === 'suspended' ? ' · موقوف' : '')));
          r.appendChild(l);
          var s = el('div'); var b = Number(w.balance_fils); s.appendChild(el('span', 'ltr ' + (b < 0 ? 'r' : 'g'), jd(b)));
          var ab = el('button', 'btn alt sm', 'تسوية'); ab.type = 'button'; ab.style.marginInlineStart = '8px'; ab.addEventListener('click', function () { adjust(w); });
          s.appendChild(ab); r.appendChild(s); c.appendChild(r);
        });
      }).catch(function (e) { c.textContent = msg(e); });
    }
    load();
  }

  // ---------- cards ----------
  function viewCards(v) {
    var c = card(v), res = el('div'), list = el('div');
    var val = el('select'); [1, 2, 5, 10, 20, 50].forEach(function (n) { var o = el('option', '', n + ' د.أ'); o.value = n * 1000; val.appendChild(o); }); val.value = 5000;
    var cnt = inp('number', '', true); cnt.value = 1; cnt.min = 1; cnt.max = 100;
    var note = inp('text', 'ملاحظة (اختياري)'); var err = el('div', 'err'); var go = el('button', 'btn', 'إصدار البطاقات'); go.type = 'button';
    c.appendChild(field('القيمة', val)); c.appendChild(field('العدد', cnt)); c.appendChild(field('ملاحظة', note)); c.appendChild(err); c.appendChild(go); c.appendChild(res);
    v.appendChild(list);
    go.addEventListener('click', function () {
      err.textContent = ''; sleep(res); go.disabled = true;
      api('POST', '/api/m/cards/issue', { valueFils: Number(val.value), count: Number(cnt.value), note: note.value }).then(function (r) {
        var b = el('div', 'okmsg'); b.appendChild(el('div', 'w', 'انسخ الأكواد الآن. لا تظهر مرة ثانية، ولا تُحفظ إلا مشفّرة.'));
        var txt = r.codes.join('\n'); b.appendChild(el('div', 'pre', txt));
        var cp = el('button', 'btn alt sm', 'نسخ الكل'); cp.type = 'button'; cp.style.marginTop = '8px';
        cp.addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { cp.textContent = 'تم النسخ'; }); });
        b.appendChild(cp); res.appendChild(b); loadList();
      }).catch(function (e) { err.textContent = msg(e); }).then(function () { go.disabled = false; });
    });
    function loadList() {
      sleep(list); var l = card(list);
      api('GET', '/api/m/cards').then(function (rows) {
        if (!rows.length) { l.appendChild(el('div', 'sub', 'لا توجد بطاقات.')); return; }
        rows.forEach(function (k) {
          var r = el('div', 'row'), d = el('div'); d.appendChild(el('div', 't', '#' + k.id + ' · ' + jd(k.value_fils) + ' د.أ' + (k.note ? ' · ' + k.note : '')));
          d.appendChild(el('div', 'm', when(k.created_at) + (k.used_at ? ' · استُبدلت ' + when(k.used_at) : ''))); r.appendChild(d);
          var s = el('div'); s.appendChild(el('span', k.status === 'active' ? 'g' : k.status === 'used' ? 'm' : 'r', k.status === 'active' ? 'فعّالة' : k.status === 'used' ? 'مستخدمة' : 'ملغاة'));
          if (k.status === 'active') { var vb = el('button', 'btn alt sm', 'إلغاء'); vb.type = 'button'; vb.style.marginInlineStart = '8px'; vb.addEventListener('click', function () { if (window.confirm('إلغاء البطاقة #' + k.id + '؟')) api('POST', '/api/m/cards/' + k.id + '/void').then(loadList).catch(function (e) { window.alert(msg(e)); }); }); s.appendChild(vb); }
          r.appendChild(s); l.appendChild(r);
        });
      }).catch(function (e) { l.textContent = msg(e); });
    }
    loadList();
  }

  // ---------- audit ----------
  function viewAudit(v) {
    var c = card(v); c.appendChild(el('div', 'sub', 'جارٍ التحميل…'));
    api('GET', '/api/owner/audit?limit=100').then(function (rows) {
      c.textContent = ''; rows.forEach(function (a) {
        var r = el('div', 'row'), l = el('div'); l.appendChild(el('div', 't', a.action + (a.target ? ' · ' + a.target : ''))); l.appendChild(el('div', 'm', a.actor + ' · ' + when(a.at))); r.appendChild(l); c.appendChild(r);
      });
    }).catch(function (e) { c.textContent = msg(e); });
  }

  var VIEWS = { book: viewBook, bookings: viewBookings, wallets: viewWallets, cards: viewCards, audit: viewAudit };
  function show() { var v = $('#view'); sleep(v); VIEWS[tab](v); }
  document.querySelectorAll('#nav button').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.dataset.t; document.querySelectorAll('#nav button').forEach(function (x) { x.setAttribute('aria-selected', x === b); }); show();
    });
  });

  function login() {
    var t = $('#tok').value.trim(); $('#lerr').textContent = ''; if (!t) return;
    token = t;
    api('GET', '/api/owner/modules').then(function () {
      $('#login').hidden = true; $('#nav').hidden = false; $('#out').hidden = false; $('#tok').value = ''; bump(); show();
    }).catch(function (e) { token = null; $('#lerr').textContent = msg(e); });
  }
  $('#go').addEventListener('click', login);
  $('#tok').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  $('#out').addEventListener('click', logout);
})();
