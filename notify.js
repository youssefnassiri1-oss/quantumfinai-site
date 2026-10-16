/* QuantumFinAI credit notifications: in-site card + optional browser push */
(function () {
  'use strict';
  var SB_URL = 'https://rofcjlvxzctevqjzgvyt.supabase.co';
  var SB_KEY = 'sb_publishable_F4LnZ_xwqjOHEU_k9GdaEQ_uL2lctJq';
  var VAPID = 'BGUdX_Jqixrlpr-9m6yscg1LtsYtx71ehi1kbqS1mR_O-grlO_RSocRmTVPxVSrO0u4Jwn9MSv_mkbl75IHfiuc';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css = '' +
  '#qf-notes{position:fixed;top:74px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:12px;width:min(360px,calc(100vw - 24px));pointer-events:none}' +
  '.qfn{pointer-events:auto;position:relative;overflow:hidden;border-radius:18px;padding:16px 18px 18px;color:#fff;font-family:inherit;' +
  'background:linear-gradient(135deg,rgba(24,22,56,.96),rgba(10,16,34,.96));border:1px solid rgba(124,108,255,.45);' +
  'box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 0 1px rgba(34,211,238,.12),0 0 40px rgba(91,77,255,.28);backdrop-filter:blur(14px);' +
  'transform:translateX(120%);opacity:0;transition:transform .55s cubic-bezier(.2,.9,.25,1.1),opacity .4s}' +
  '.qfn.on{transform:none;opacity:1}.qfn.off{transform:translateX(120%);opacity:0}' +
  '.qfn:before{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.14) 50%,transparent 70%);transform:translateX(-120%);animation:qfsheen 1.4s .35s ease-out 1 forwards}' +
  '@keyframes qfsheen{to{transform:translateX(120%)}}' +
  '.qfn-row{display:flex;gap:14px;align-items:center;position:relative}' +
  '.qfn-coin{flex:none;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;font-size:22px;font-weight:800;color:#1b1400;' +
  'background:radial-gradient(circle at 30% 25%,#fff3b0,#fbbf24 55%,#b45309);box-shadow:0 0 22px rgba(251,191,36,.55)}' +
  '.qfn.on .qfn-coin{animation:qfpop .7s .15s cubic-bezier(.2,1.4,.3,1) both}' +
  '@keyframes qfpop{0%{transform:scale(.3) rotate(-30deg)}100%{transform:none}}' +
  '.qfn-k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#67e8f9;font-weight:700}' +
  '.qfn-pts{font-size:26px;font-weight:800;line-height:1.15;background:linear-gradient(90deg,#c4b5fd,#67e8f9);-webkit-background-clip:text;background-clip:text;color:transparent}' +
  '.qfn-pts small{font-size:13px;font-weight:600;color:#cbd5e1;-webkit-text-fill-color:#cbd5e1;margin-left:6px}' +
  '.qfn-d{font-size:13px;color:#cbd5e1;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.qfn-x{position:absolute;top:4px;right:6px;z-index:2;background:none;border:0;color:#94a3b8;font-size:18px;cursor:pointer;padding:4px 8px;line-height:1}' +
  '.qfn-x:hover{color:#fff}' +
  '.qfn-push{display:inline-block;margin-top:10px;font-size:12px;color:#67e8f9;background:none;border:1px solid rgba(103,232,249,.4);border-radius:999px;padding:5px 12px;cursor:pointer;position:relative}' +
  '.qfn-bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:linear-gradient(90deg,#5b4dff,#22d3ee);transform-origin:left;animation:qfbar linear forwards}' +
  '@keyframes qfbar{to{transform:scaleX(0)}}' +
  '.qfn-spark{position:absolute;width:5px;height:5px;border-radius:50%;background:#fde68a;left:38px;top:34px;opacity:0;animation:qfspark 1s ease-out forwards}' +
  '@keyframes qfspark{0%{opacity:1;transform:translate(0,0)}100%{opacity:0;transform:translate(var(--dx),var(--dy))}}' +
  '@media (prefers-reduced-motion:reduce){.qfn,.qfn:before,.qfn.on .qfn-coin,.qfn-spark{animation:none!important;transition:opacity .2s!important;transform:none}.qfn:not(.on){opacity:0}}' +
  '@media (max-width:520px){#qf-notes{top:70px;right:12px;left:12px;width:auto}}' +
  '.qf-pn{margin-bottom:20px}.qf-pn .qf-row{display:flex!important;justify-content:flex-start!important;gap:10px;flex-wrap:wrap;margin-top:12px}.qf-pn .st-msg{margin-top:10px;font-size:13px;color:#94a3b8;min-height:18px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var box = document.createElement('div'); box.id = 'qf-notes'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box);

  function sess() { try { return JSON.parse(localStorage.getItem('qf_s') || 'null'); } catch (_) { return null; } }
  function uid(s) { try { return JSON.parse(atob(s.a.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch (_) { return null; } }
  function hdr(s) { return { apikey: SB_KEY, Authorization: 'Bearer ' + (s ? s.a : SB_KEY), 'Content-Type': 'application/json' }; }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var pushOK = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);

  function show(o) {
    var el = document.createElement('div'); el.className = 'qfn'; el.setAttribute('role', 'status');
    var detail = [o.network, o.offer].filter(Boolean).map(esc).join(' - ') || 'Offer completed';
    var usd = (o.delta / 1000).toFixed(2);
    var ask = pushOK && Notification.permission === 'default' && !localStorage.getItem('qf_push_asked');
    el.innerHTML = '<button class="qfn-x" aria-label="Dismiss">&times;</button><div class="qfn-row"><div class="qfn-coin">$</div><div style="min-width:0"><div class="qfn-k">Offer credited</div><div class="qfn-pts"><span class="qfn-n">+0</span><small>pts &middot; \u2248 $' + usd + '</small></div><div class="qfn-d">' + detail + '</div></div></div>' +
      (ask ? '<button class="qfn-push" type="button">Get alerts when you are away</button>' : '') + '<div class="qfn-bar" style="animation-duration:' + (ask ? 11 : 7) + 's"></div>';
    if (!reduce) for (var i = 0; i < 8; i++) { var sp = document.createElement('i'); sp.className = 'qfn-spark'; var a = i / 8 * 6.283; sp.style.setProperty('--dx', Math.round(Math.cos(a) * 46) + 'px'); sp.style.setProperty('--dy', Math.round(Math.sin(a) * 46) + 'px'); sp.style.animationDelay = (0.3 + i * 0.02) + 's'; el.appendChild(sp); }
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('on'); }); });
    try { if (typeof sfx === 'function') sfx('points'); } catch (_) {}
    var n = el.querySelector('.qfn-n'), t0 = performance.now(), dur = reduce ? 1 : 900;
    (function tick(t) { var p = Math.min(1, (t - t0) / dur); n.textContent = '+' + Math.round(o.delta * (1 - Math.pow(1 - p, 3))).toLocaleString(); if (p < 1) requestAnimationFrame(tick); })(t0);
    function close() { el.classList.add('off'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 600); }
    el.querySelector('.qfn-x').onclick = close;
    var pb = el.querySelector('.qfn-push');
    if (pb) { localStorage.setItem('qf_push_asked', '1'); pb.onclick = function () { enable().then(function (m) { pb.textContent = m; }); }; }
    setTimeout(close, (ask ? 11 : 7) * 1000);
  }
  window.qfShowCredit = show;

  /* ---- credit watcher (reads the member's own ledger rows) ---- */
  var busy = false;
  function key(s) { return 'qf_seen_' + uid(s); }
  async function poll() {
    var s = sess(); if (!s || !s.a || busy || document.hidden) return; busy = true;
    try {
      var r = await fetch(SB_URL + '/rest/v1/points_ledger?select=*&order=created_at.desc&limit=5', { headers: hdr(s) });
      if (!r.ok) return; var rows = await r.json(); if (!rows.length) { if (!localStorage.getItem(key(s))) localStorage.setItem(key(s), '1970-01-01T00:00:00Z'); return; }
      var seen = localStorage.getItem(key(s));
      if (!seen) { localStorage.setItem(key(s), rows[0].created_at); return; }
      var fresh = rows.filter(function (x) { return x.created_at > seen && x.delta > 0; }).reverse();
      localStorage.setItem(key(s), rows[0].created_at);
      if (fresh.length) {
        var b = document.getElementById('wall-refresh'); if (b && !document.getElementById('dash').hidden) { try { b.click(); } catch (_) {} }
        fresh.forEach(function (x, i) { setTimeout(function () { show({ delta: x.delta, network: x.network, offer: x.offer_name }); }, i * 900); });
      }
    } catch (_) {} finally { busy = false; }
  }
  setInterval(poll, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  setTimeout(poll, 2500);

  /* ---- web push ---- */
  function b64(u) { var p = '='.repeat((4 - u.length % 4) % 4), s = (u + p).replace(/-/g, '+').replace(/_/g, '/'), r = atob(s), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  async function reg() { return navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function () { return navigator.serviceWorker.ready; }); }
  async function enable() {
    var s = sess(); if (!s) return 'Sign in first.';
    if (!pushOK) return /iPhone|iPad/.test(navigator.userAgent) ? 'On iPhone: use Share > Add to Home Screen, then open the site from the icon.' : 'This browser does not support notifications.';
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'Notifications are blocked. You can allow them in your browser settings.';
    try {
      var rg = await reg(), sub = await rg.pushManager.getSubscription() || await rg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID) });
      var j = sub.toJSON();
      var r = await fetch(SB_URL + '/rest/v1/rpc/save_push_subscription', { method: 'POST', headers: hdr(s), body: JSON.stringify({ p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }) });
      if (!r.ok) throw new Error('save');
      localStorage.setItem('qf_push_on', '1'); paint();
      return 'Browser alerts are on.';
    } catch (e) { return 'Could not turn on alerts. Please try again.'; }
  }
  async function disable() {
    var s = sess();
    try {
      var rg = await navigator.serviceWorker.getRegistration('/'), sub = rg && await rg.pushManager.getSubscription();
      if (sub) { if (s) await fetch(SB_URL + '/rest/v1/rpc/delete_push_subscription', { method: 'POST', headers: hdr(s), body: JSON.stringify({ p_endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
    } catch (_) {}
    localStorage.removeItem('qf_push_on'); paint(); return 'Browser alerts are off.';
  }
  async function test() {
    var s = sess(); if (!s) return 'Sign in first.';
    try {
      var rg = await navigator.serviceWorker.getRegistration('/'), sub = rg && await rg.pushManager.getSubscription();
      if (!sub) return 'Turn on browser alerts first.';
      var r = await fetch(SB_URL + '/functions/v1/send-push', { method: 'POST', headers: hdr(s), body: JSON.stringify({ test: true, sub: sub.toJSON() }) });
      return r.ok ? 'Test sent. It should appear in a moment.' : 'The test could not be sent.';
    } catch (_) { return 'The test could not be sent.'; }
  }
  async function isOn() { try { if (!pushOK || Notification.permission !== 'granted') return false; var rg = await navigator.serviceWorker.getRegistration('/'); return !!(rg && await rg.pushManager.getSubscription()); } catch (_) { return false; } }

  function card() {
    var host = document.getElementById('d-profile'); if (!host || document.getElementById('qf-pn')) return;
    var c = document.createElement('section'); c.id = 'qf-pn'; c.className = 'prof-card qf-pn';
    c.innerHTML = '<h3>Credit notifications</h3><p class="note">When an offer is credited you see a pop-up here. You can also get a browser notification when the tab is closed. We store your browser\u2019s push address with your account only for this, and you can turn it off at any time.</p><div class="qf-row"><button type="button" class="btn small" id="qf-pn-t"></button><button type="button" class="btn small ghost" id="qf-pn-prev">Preview pop-up</button><button type="button" class="btn small ghost" id="qf-pn-test" hidden>Send test alert</button></div><div class="st-msg" id="qf-pn-m"></div>';
    host.insertBefore(c, host.firstChild); paint();
    var m = c.querySelector('#qf-pn-m');
    c.querySelector('#qf-pn-prev').onclick = function () { show({ delta: 1250, network: 'Preview', offer: 'Sample offer (no points added)' }); };
    c.querySelector('#qf-pn-test').onclick = async function () { m.textContent = await test(); };
    c.querySelector('#qf-pn-t').onclick = async function () { m.textContent = (await isOn()) ? await disable() : await enable(); paint(); };
  }
  async function paint() {
    var t = document.getElementById('qf-pn-t'); if (!t) return; var on = await isOn();
    t.textContent = on ? 'Turn off browser alerts' : 'Turn on browser alerts'; document.getElementById('qf-pn-test').hidden = !on;
  }
  setInterval(card, 1500);
})();
