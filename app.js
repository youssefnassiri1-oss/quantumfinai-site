const SB_URL = "https://rofcjlvxzctevqjzgvyt.supabase.co";
const SB_KEY = "sb_publishable_F4LnZ_xwqjOHEU_k9GdaEQ_uL2lctJq"; // Keep live publishable anon key
const TS_KEY = "0x4AAAAAAFU5qd_kL7VIoh4V";

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = s => `<span class="st st-${esc(s)}">${esc(String(s).replace(/_/g, ' '))}</span>`;
const when = t => new Date(t).toLocaleString();
const row = (a, b, c) => `<div class="lrow"><div>${a}</div><div class="lm">${b || ''}</div><div class="la">${c || ''}</div></div>`;
const empty = t => `<p class="note">${t}</p>`;

const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg) {
  if (/^✓|sent|verified/i.test(msg)) sfx('success');
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2800);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-toast]');
  if (b) toast(b.dataset.toast);
});

function askNote(title = "Add a note (optional)") {
  return new Promise(resolve => {
    const dlg = document.getElementById('note-modal');
    const inp = document.getElementById('modal-input');
    document.getElementById('modal-title').textContent = title;
    inp.value = '';
    let done = false;
    const close = val => { if (done) return; done = true; if (dlg.open) dlg.close(); resolve(val); };
    dlg.addEventListener('close', () => close(null), { once: true });
    document.getElementById('modal-cancel').onclick = () => close(null);
    document.getElementById('modal-form').onsubmit = e => { e.preventDefault(); close(inp.value.trim()); };
    dlg.showModal();
  });
}

const TSW = {};
function tsRender(id) {
  if (TSW[id] !== undefined || !window.turnstile) return;
  const el = document.getElementById(id);
  if (el) TSW[id] = turnstile.render(el, { sitekey: TS_KEY, theme: 'dark', 'expired-callback': () => say('The human check expired. Please tick it again.') });
}
const tsToken = id => (window.turnstile && TSW[id] !== undefined) ? turnstile.getResponse(TSW[id]) : '';
const tsReset = id => { if (window.turnstile && TSW[id] !== undefined) turnstile.reset(TSW[id]); };
let tsTries = 0;
const tsWait = setInterval(() => {
  if (window.turnstile) { clearInterval(tsWait); tsRender('tsauth'); }
  else if (++tsTries > 60) clearInterval(tsWait);
}, 300);

let S = JSON.parse(localStorage.getItem('qf_s') || 'null');
let ADMIN = false;

function setSess(d) {
  S = {
    a: d.access_token,
    r: d.refresh_token,
    e: Date.now() + (d.expires_in || 3600) * 1000 - 60000,
    u: (d.user && d.user.email) || (S && S.u) || ''
  };
  localStorage.setItem('qf_s', JSON.stringify(S));
}

async function sb(path, body) {
  const r = await fetch(SB_URL + path, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return [r, await r.json().catch(() => ({}))];
}

let refreshProm = null;
async function tok() {
  if (!S) return null;
  if (Date.now() <= S.e) return S.a;
  if (!refreshProm) {
    refreshProm = sb('/auth/v1/token?grant_type=refresh_token', { refresh_token: S.r })
      .then(([r, d]) => {
        refreshProm = null;
        if (!r.ok) { signOut(); return null; }
        setSess(d);
        return S.a;
      }, () => { refreshProm = null; return null; });
  }
  return refreshProm;
}

async function api(path, method = 'GET', body) {
  const k = await tok();
  const h = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (k) h.Authorization = 'Bearer ' + k;
  const r = await fetch(SB_URL + '/rest/v1/' + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d && d.message) || 'Request failed');
  return d;
}
const rpc = (n, b) => api('rpc/' + n, 'POST', b || {});

let mode = 'signup';
const authForm = document.getElementById('signup');
const formMsg = document.getElementById('formmsg');
const say = (t, ok) => { formMsg.style.color = ok ? '#86efac' : '#fca5a5'; formMsg.textContent = t; };

// Warm the sign-up function and its CORS preflight as soon as the visitor reaches the form,
// so a cold start does not hit the click itself.
let signupWarmed = false;
const warmSignup = () => {
  if (signupWarmed) return; signupWarmed = true;
  fetch(SB_URL + '/functions/v1/signup', { method: 'OPTIONS' }).catch(() => {});
};
authForm.addEventListener('focusin', warmSignup, { once: true });
document.getElementById('account').addEventListener('click', warmSignup, { once: true });

document.querySelectorAll('#account .tabs .tab').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  document.querySelectorAll('#account .tabs .tab').forEach(x => x.classList.toggle('on', x === b));
  document.getElementById('lname').style.display = mode === 'signup' ? '' : 'none';
  document.getElementById('tsauth').style.display = mode === 'signup' ? '' : 'none';
  document.getElementById('fsubmit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  document.getElementById('ftitle').textContent = mode === 'signup' ? 'Create an account' : 'Sign in';
  document.getElementById('consent-row').style.display = mode === 'signup' ? 'flex' : 'none';
  document.getElementById('legal-consent').required = mode === 'signup';
  authForm.pw.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  tsReset('tsauth');
}));

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!/^\S+@\S+\.\S+$/.test(authForm.email.value) || authForm.pw.value.length < 8) {
    say('Check your email and password (8 characters minimum)'); return;
  }
  if (mode === 'signup' && !authForm.name.value.trim()) { say('Name is required'); return; }
  if (mode === 'signup' && !document.getElementById('legal-consent').checked) { say('Please agree to the Terms of Service and acknowledge the Privacy Policy'); return; }
  const cap = mode === 'signup' ? tsToken('tsauth') : '';
  if (mode === 'signup' && !cap) { say('Please complete the human check first'); return; }

  const btn = document.getElementById('fsubmit');
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.classList.add('busy');
  btn.textContent = mode === 'signup' ? 'Creating your account…' : 'Signing you in…';
  say('One moment…', true);
  try {
    if (mode === 'signup') {
      const sr = await fetch(SB_URL + '/functions/v1/signup', {
        method: 'POST',
        headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authForm.email.value, password: authForm.pw.value, name: authForm.name.value.trim(), token: cap, consent: true, policy_version: "2026-10-15" })
      });
      const sd = await sr.json().catch(() => ({}));
      if (!sr.ok) throw { msg: sd.error || 'Could not create the account' };
      if (sd.session && sd.session.access_token) {
        setSess(sd.session);
      } else {
        const [r2, d2] = await sb('/auth/v1/token?grant_type=password', { email: authForm.email.value, password: authForm.pw.value });
        if (!r2.ok) throw d2;
        setSess(d2);
      }
      enter(); sendVerify();
    } else {
      const [r, d] = await sb('/auth/v1/token?grant_type=password', { email: authForm.email.value, password: authForm.pw.value });
      if (!r.ok) throw d;
      setSess(d); enter();
    }
  } catch (x) {
    const t = (x && (x.msg || x.message)) || '';
    say(!t ? 'Connection error' : /Invalid login/i.test(t) ? 'Wrong email or password' : t);
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.textContent = oldLabel;
    if (mode === 'signup') tsReset('tsauth');
  }
});

const LOGOS = { bank_transfer: '🏦', digital_wallet: '👛', gift_card: '🎁', crypto: '🪙' };
const BRAND_LIST = [
  ['binance', 'Binance', 'Crypto USDT'],
  ['cwallet', 'Cwallet', 'Crypto Wallet'],
  ['paypal', 'PayPal', 'Cash Transfer'],
  ['googleplay', 'Google Play', 'Gift Card'],
  ['itunes', 'Apple / iTunes', 'Gift Card'],
  ['amazon', 'Amazon', 'Gift Card']
];

function drawBrands() {
  const el = document.getElementById('wd');
  if (!el) return;
  el.innerHTML = BRAND_LIST.map(b => `
    <button type="button" class="mcard soon" data-toast="Payouts are unlocking soon.">
      <span class="mlogo">💳</span>
      <div class="mtxt"><b>${b[1]}</b><small>${b[2]}</small></div>
      <span class="tag">Soon</span>
    </button>`).join('');
}

let DOFF = [], DTAKEN = new Set(), DFCAT = 'All';
const CH = ['All', 'Surveys', 'Apps', 'Games', 'Trials', 'Tasks'];
const catIcon = c => ({ surveys: '◉', apps: '▣', games: '🎮', trials: '✦', tasks: '✓' }[(c || '').toLowerCase()] || '◇');

function paintChips(el, cur) {
  if (!el) return;
  el.innerHTML = CH.map(n => `<button type="button" class="pill${n === cur ? ' on' : ''}" data-cat="${n}">${n}</button>`).join('');
}

function drawWallPartners(nets) {
  const el = document.getElementById('wallgrid');
  if (!el) return;
  const isLiveNet = n => n.name === 'CPX Research' || n.status === 'partner';
  const byName = (a, b) => (a.name === 'CPX Research' ? -1 : b.name === 'CPX Research' ? 1 : a.name.localeCompare(b.name));
  const liveNets = (nets || []).filter(isLiveNet).sort(byName);
  const soonNets = (nets || []).filter(n => !isLiveNet(n)).sort(byName);
  const sect = t => `<h3 class="wall-sect">${t}</h3>`;
  const card = n => {
    const isLive = isLiveNet(n);
    return `
      <article class="wall-card ${isLive ? 'live' : ''}">
        <div class="wall-head">
          <div class="wall-logo">${(window.NET_LOGOS && window.NET_LOGOS[n.name]) ? `<img src="${window.NET_LOGOS[n.name]}" alt="${esc(n.name)} logo" width="40" height="40" style="width:40px;height:40px;object-fit:contain;border-radius:10px;background:#fff">` : esc(n.name.slice(0, 2).toUpperCase())}</div>
          <div>
            <h3 style="margin:0;font-size:17px">${esc(n.name)}</h3>
            <span class="tag">${isLive ? '✓ Live Now' : 'Integrating Soon'}</span>
          </div>
        </div>
        <p class="note" style="margin:4px 0;flex:1">${esc(n.description || 'Complete surveys and tasks to earn points automatically.')}</p>
        ${n.name === 'CPX Research'
          ? `<button class="btn small" type="button" data-open-cpx="1">Launch Offerwall</button>`
          : n.name === 'Wannads' && n.status === 'partner'
          ? `<button class="btn small" type="button" data-open-wannads="1">Launch Offerwall</button>`
          : n.name === 'PubScale' && n.status === 'partner'
          ? `<button class="btn small" type="button" data-open-pubscale="1">Launch Offerwall</button>`
          : n.name === 'MobiVortex' && n.status === 'partner'
          ? `<button class="btn small" type="button" data-open-mobivortex="1">Launch Offerwall</button>`
          : `<button class="btn small ghost" type="button" disabled>Coming Soon</button>`}
      </article>`;
  };
  el.innerHTML = (liveNets.length ? sect('Available now') + liveNets.map(card).join('') : '')
    + (soonNets.length ? sect('Coming soon') + soonNets.map(card).join('') : '');
}

function drawDoff() {
  const list = DFCAT === 'All' ? DOFF : DOFF.filter(o => (o.category || '').toLowerCase() === DFCAT.toLowerCase());
  document.getElementById('doffers').innerHTML = list.length
    ? list.map(o => `
      <article class="card">
        <div class="thumb">${catIcon(o.category)}</div>
        <span class="tag">${esc(o.category)}</span>
        <h3>${esc(o.title)}</h3>
        <p>${esc(o.description || '')}</p>
        <div class="pts">${o.points.toLocaleString()} pts</div>
        ${DTAKEN.has(o.id) ? '<span class="tag">In Progress</span>' : `<button class="btn small" data-claim="${o.id}">Start Task</button>`}
      </article>`).join('')
    : empty('No direct tasks in this category right now. Use the Offerwalls above to earn!');
}

document.getElementById('dchips').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  DFCAT = b.dataset.cat;
  paintChips(document.getElementById('dchips'), DFCAT);
  drawDoff();
});

async function loadPublic() {
  drawBrands();
  try {
    const [m, nets] = await Promise.all([
      api('withdrawal_methods?select=code,label,min_points&active=eq.true'),
      api('partners?select=id,name,website,description,network_type,status&active=eq.true&order=name')
    ]);
    window.NETS = nets || [];
    drawWallPartners(window.NETS);
    const wdm = document.getElementById('wdm');
    if (wdm) {
      wdm.innerHTML = m.map(x => `<option value="${esc(x.code)}">${esc(x.label)} (min ${Number(x.min_points).toLocaleString()} pts)</option>`).join('');
      document.getElementById('wdlogo').textContent = LOGOS[wdm.value] || '◇';
    }
  } catch (_) {}
}

async function loadDash() {
  try {
    const [prof, offers, claims, led, wds] = await Promise.all([
      rpc('my_profile_summary').catch(() => null),
      api('offers?select=id,title,description,category,points&status=eq.active'),
      api('offer_claims?select=*,offers(title,points)&order=created_at.desc'),
      api('points_ledger?select=*&order=created_at.desc&limit=50'),
      api('withdrawal_requests?select=*&order=created_at.desc')
    ]);

    const bal = prof ? prof.balance : await rpc('my_balance');
    const totalEarned = prof ? prof.total_earned : led.filter(x => x.delta > 0).reduce((s, x) => s + x.delta, 0);

    animateValue(document.getElementById('sbal'), Number(bal));
    animateValue(document.getElementById('nav-bal'), Number(bal));
    if (Number(bal) < 0) toast('Your balance is negative because of a reversed offer. Withdrawals stay unavailable until it is recovered.');
    document.getElementById('sbal-usd').textContent = `≈ $${(bal / 1000).toFixed(2)} USD`;
    animateValue(document.getElementById('stotal'), Number(totalEarned));
    document.getElementById('soff').textContent = claims.length;
    document.getElementById('swd').textContent = wds.filter(w => ['requested', 'under_review', 'approved'].includes(w.status)).length;

    if (prof) {
      renderProfileUI(prof);
      ADMIN = !!prof.is_admin;
    }
    document.getElementById('tabadmin').hidden = !ADMIN;

    DOFF = offers;
    DTAKEN = new Set(claims.map(c => c.offer_id));
    paintChips(document.getElementById('dchips'), DFCAT);
    drawDoff();
    drawWallPartners(window.NETS || []);

    document.getElementById('dclaims').innerHTML = claims.length
      ? claims.map(c => row(
          esc(c.offers ? c.offers.title : 'Task'),
          badge(c.status) + ' ' + esc(c.admin_note || ''),
          c.status === 'pending' ? `<button class="btn small" data-submit="${c.id}">Submit Proof</button>` : when(c.updated_at)
        )).join('')
      : empty('You have not started any direct tasks yet.');

    document.getElementById('dledger').innerHTML = led.length
      ? led.map(l => {
          const rev = l.reason === 'survey_reversal';
          const label = rev ? 'Reversal' : l.reason.replace(/_/g, ' ');
          const detail = [l.network, l.offer_name].filter(Boolean).map(esc).join(' - ');
          const t = l.started_at && Math.abs(new Date(l.created_at) - new Date(l.started_at)) > 1000
            ? `Started ${when(l.started_at)}<br>Finished ${when(l.created_at)}` : `Finished ${when(l.created_at)}`;
          return row(
            `<b${rev ? ' style="color:#fca5a5"' : ''}>${l.delta > 0 ? '+' : ''}${l.delta.toLocaleString()} pts</b>`,
            esc(label) + (detail ? '<br><small>' + detail + '</small>' : ''),
            t
          );
        }).join('')
      : empty('No point transactions recorded yet.');

    document.getElementById('dwd').innerHTML = wds.length
      ? wds.map(w => row(
          `${w.points.toLocaleString()} pts via ${esc(w.method_code.replace(/_/g, ' '))}`,
          badge(w.status) + ' ' + esc(w.admin_note || ''),
          w.status === 'requested' ? `<button class="btn small ghost" data-cancel="${w.id}">Cancel</button>` : when(w.updated_at)
        )).join('')
      : empty('No withdrawal requests yet.');

    if (ADMIN) loadAdmin();
  } catch (e) {
    toast(e.message);
  }
}

function renderProfileUI(p) {
  const name = p.name || 'Member';
  document.getElementById('pavatar').textContent = name.slice(0, 2).toUpperCase();
  document.getElementById('pname').textContent = name;
  document.getElementById('pemail').textContent = p.email;
  document.getElementById('puid').textContent = p.id;
  document.getElementById('pjoined').textContent = p.created_at ? new Date(p.created_at).toLocaleDateString() : '-';
  document.getElementById('pstatus').innerHTML = badge(p.status || 'normal');

  const vEl = document.getElementById('vmsg');
  if (p.email_verified) {
    vEl.innerHTML = `<span class="st st-verified">✓ Verified</span>`;
  } else {
    vEl.innerHTML = `<button type="button" class="btn small ghost" id="vresend">Verify Email</button>`;
    document.getElementById('vresend').onclick = async function () {
      this.disabled = true;
      const ok = await sendVerify();
      toast(ok ? 'Verification link sent to your inbox!' : 'Could not send email right now.');
    };
  }
}

document.getElementById('copy-uid').addEventListener('click', () => {
  const uid = document.getElementById('puid').textContent;
  navigator.clipboard.writeText(uid).then(() => toast('✓ Support User ID copied!'));
});

async function enter() {
  document.getElementById('guest-view').hidden = true;
  document.getElementById('guest-nav').hidden = true;
  document.getElementById('user-nav').hidden = false;
  document.getElementById('dash').hidden = false;
  scrollTo({ top: 0, behavior: 'smooth' });
  await syncPrivacyChoices();
  regDevice();
  await loadDash();
}

function signOut() {
  S = null;
  localStorage.removeItem('qf_s');
  document.getElementById('dash').hidden = true;
  document.getElementById('user-nav').hidden = true;
  document.getElementById('guest-nav').hidden = false;
  document.getElementById('guest-view').hidden = false;
  document.getElementById('wall-viewer').hidden = true;
  document.getElementById('svwrap').innerHTML = '';
  scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('signout').addEventListener('click', signOut);

document.getElementById('dtabs').addEventListener('click', e => {
  const b = e.target.closest('button.tab');
  if (!b) return;
  document.querySelectorAll('#dtabs .tab').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.dpane').forEach(p => p.hidden = p.id !== b.dataset.t);
});

async function openCpxWall() {
  if (!(await permitPartner('CPX Research'))) return;
  const viewer = document.getElementById('wall-viewer');
  const wrap = document.getElementById('svwrap');
  viewer.hidden = false;
  wrap.innerHTML = `<p class="note" style="padding:24px;text-align:center">Loading CPX Research Offerwall...</p>`;
  viewer.scrollIntoView({ behavior: 'smooth' });
  try {
    const k = await tok();
    const r = await fetch(SB_URL + '/functions/v1/cpx-wall', {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) throw new Error(d.error || 'Surveys are temporarily unavailable.');
    const f = document.createElement('iframe');
    f.src = d.url;
    f.title = 'CPX Research Offerwall';
    f.style.cssText = 'width:100%;height:calc(100dvh - 130px);min-height:560px;border:0;background:#fff;display:block';
    wrap.replaceChildren(f);
  } catch (e) {
    wrap.innerHTML = `<p class="note" style="padding:24px;color:#fca5a5">${esc(e.message)}</p>`;
  }
}

const WANNADS_KEY = '6acf5c682e699850934364';
async function openWannadsWall() {
  if (!(await permitPartner('Wannads'))) return;
  const viewer = document.getElementById('wall-viewer');
  const wrap = document.getElementById('svwrap');
  document.getElementById('wall-title').textContent = 'Wannads Offerwall';
  viewer.hidden = false;
  wrap.innerHTML = `<p class="note" style="padding:24px;text-align:center">Loading Wannads Offerwall...</p>`;
  viewer.scrollIntoView({ behavior: 'smooth' });
  try {
    const k = await tok();
    if (!k) throw new Error('Please sign in again.');
    const uid = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
    if (!/^[0-9a-f-]{36}$/i.test(uid || '')) throw new Error('Offerwall is temporarily unavailable.');
    const f = document.createElement('iframe');
    f.src = 'https://earn.wannads.com/wall?apiKey=' + WANNADS_KEY + '&userId=' + encodeURIComponent(uid);
    f.title = 'Wannads Offerwall';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    f.referrerPolicy = 'no-referrer';
    f.loading = 'lazy';
    f.style.cssText = 'width:100%;height:calc(100dvh - 130px);min-height:560px;border:0;background:#fff;display:block';
    wrap.replaceChildren(f);
  } catch (e) {
    wrap.innerHTML = `<p class="note" style="padding:24px;color:#fca5a5">${esc(e.message)}</p>`;
  }
}

const PUBSCALE_APP = '70593673';
async function openPubscaleWall() {
  if (!(await permitPartner('PubScale'))) return;
  const viewer = document.getElementById('wall-viewer');
  const wrap = document.getElementById('svwrap');
  document.getElementById('wall-title').textContent = 'PubScale Offerwall';
  viewer.hidden = false;
  wrap.innerHTML = `<p class="note" style="padding:24px;text-align:center">Loading PubScale Offerwall...</p>`;
  viewer.scrollIntoView({ behavior: 'smooth' });
  try {
    const k = await tok();
    if (!k) throw new Error('Please sign in again.');
    const uid = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
    if (!/^[0-9a-f-]{36}$/i.test(uid || '')) throw new Error('Offerwall is temporarily unavailable.');
    const f = document.createElement('iframe');
    f.src = 'https://wow.pubscale.com?app_id=' + PUBSCALE_APP + '&user_id=' + encodeURIComponent(uid);
    f.title = 'PubScale Offerwall';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    f.referrerPolicy = 'no-referrer';
    f.loading = 'lazy';
    f.style.cssText = 'width:100%;height:calc(100dvh - 130px);min-height:560px;border:0;background:#fff;display:block';
    wrap.replaceChildren(f);
  } catch (e) {
    wrap.innerHTML = `<p class="note" style="padding:24px;color:#fca5a5">${esc(e.message)}</p>`;
  }
}

const MOBIVORTEX_PLACEMENT = '6acf60a3b8a42db09a09881d';
async function openMobivortexWall() {
  if (!(await permitPartner('MobiVortex'))) return;
  const viewer = document.getElementById('wall-viewer');
  const wrap = document.getElementById('svwrap');
  document.getElementById('wall-title').textContent = 'MobiVortex Offerwall';
  viewer.hidden = false;
  wrap.innerHTML = `<p class="note" style="padding:24px;text-align:center">Loading MobiVortex Offerwall...</p>`;
  viewer.scrollIntoView({ behavior: 'smooth' });
  try {
    const k = await tok();
    if (!k) throw new Error('Please sign in again.');
    const uid = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
    if (!/^[0-9a-f-]{36}$/i.test(uid || '')) throw new Error('Offerwall is temporarily unavailable.');
    const f = document.createElement('iframe');
    f.src = 'https://vortexwall.com/ow/' + MOBIVORTEX_PLACEMENT + '/' + encodeURIComponent(uid);
    f.title = 'MobiVortex Offerwall';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    f.referrerPolicy = 'no-referrer';
    f.loading = 'lazy';
    f.style.cssText = 'width:100%;height:calc(100dvh - 130px);min-height:560px;border:0;background:#fff;display:block';
    wrap.replaceChildren(f);
  } catch (e) {
    wrap.innerHTML = `<p class="note" style="padding:24px;color:#fca5a5">${esc(e.message)}</p>`;
  }
}

document.getElementById('wall-close').addEventListener('click', () => {
  document.getElementById('wall-viewer').hidden = true;
  document.getElementById('svwrap').innerHTML = '';
});
document.getElementById('wall-refresh').addEventListener('click', () => {
  loadDash().then(() => toast('✓ Balance refreshed'));
});

async function act(fn, okMsg, needVal) {
  try {
    const r = await fn();
    if (r === 'too_fast') { toast('Submitted too quickly. Complete the task first.'); return; }
    if (needVal && !r) { toast('Action could not be completed and was logged for review.'); await loadDash(); return; }
    toast(okMsg);
    await loadDash();
  } catch (e) { toast(e.message); }
}

document.getElementById('dash').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  // Immediate feedback: disable the clicked button and mark it busy while its action runs.
  const run = (fn, okMsg, needVal) => {
    b.disabled = true;
    b.classList.add('busy');
    return act(fn, okMsg, needVal).finally(() => { b.disabled = false; b.classList.remove('busy'); });
  };

  if (d.openCpx) { document.getElementById('wall-title').textContent = 'CPX Research Surveys'; openCpxWall(); return; }
  if (d.openWannads) { openWannadsWall(); return; }
  if (d.openPubscale) { openPubscaleWall(); return; }
  if (d.openMobivortex) { openMobivortexWall(); return; }
  if (d.claim) {
    run(async () => {
      const r = await rpc('claim_offer', { p_offer: d.claim });
      if (r) {
        const h = localStorage.getItem('qf_d');
        if (!privacyGpc() && privacyChoice().fingerprinting) guard({ action: 'monitor', hash: h ? await sha('qf|' + h) : '', fp: {} }).catch(() => {});
      }
      return r;
    }, 'Task started!', true);
  }
  if (d.submit) {
    const n = await askNote('Proof or completion note (optional)');
    if (n !== null) run(() => rpc('submit_claim', { p_claim: d.submit, p_note: n }), 'Submitted for review');
  }
  if (d.cancel) run(() => rpc('cancel_withdrawal', { p_id: d.cancel }), 'Request cancelled');
  if (d.rc) {
    const [i, s] = d.rc.split('|');
    const n = await askNote(`Admin note for ${s}`);
    if (n !== null) run(() => rpc('admin_review_claim', { p_claim: i, p_status: s, p_note: n }), 'Claim ' + s);
  }
  if (d.rw) {
    const [i, s] = d.rw.split('|');
    const n = await askNote('Admin note (optional)');
    if (n !== null) run(() => rpc('admin_review_withdrawal', { p_id: i, p_status: s, p_note: n }), 'Updated');
  }
  if (d.rev) {
    const n = await askNote('Reason for reversal');
    if (n !== null) run(() => rpc('admin_reverse_claim', { p_claim: d.rev, p_note: n }), 'Claim reversed');
  }
  if (d.us) {
    const [i, s] = d.us.split('|');
    run(() => rpc('admin_set_user_status', { p_user: i, p_status: s, p_note: 'Set by admin' }), 'User status: ' + s);
  }
  if (d.rf) run(() => rpc('admin_resolve_flag', { p_id: d.rf }), 'Flag resolved');
  if (d.thr) {
    const v = String(parseInt(document.getElementById('thr').value, 10));
    if (!(v >= 1 && v <= 100)) { toast('Enter 1–100'); return; }
    run(() => rpc('admin_set_setting', { p_key: 'ip_score_threshold', p_value: v }), 'Threshold saved');
  }
  if (d.ns) {
    const [i, s] = d.ns.split('|');
    run(async () => { await rpc('admin_set_partner_status', { p_id: i, p_status: s }); await loadPublic(); }, 'Network updated');
  }
  if (d.os) {
    const [i, s] = d.os.split('|');
    run(() => rpc('admin_set_offer_status', { p_offer: i, p_status: s }), 'Offer updated');
  }
});

async function loadAdmin() {
  try {
    const [cl, wd, of, fl, ur, pb] = await Promise.all([
      api('offer_claims?select=*,offers(title)&status=in.(pending,completed,approved)&order=created_at.desc&limit=100'),
      api('withdrawal_requests?select=*&status=in.(requested,under_review,approved)&order=created_at'),
      api('offers?select=id,title,points,status,min_seconds,max_claims,partners(name)&order=created_at.desc'),
      api('fraud_flags?select=*&resolved=eq.false&order=created_at.desc&limit=100'),
      api('user_risk?select=*&status=in.(review,blocked)&order=updated_at.desc'),
      api('postback_events?select=*,partners(name)&order=created_at.desc&limit=50')
    ]);
    document.getElementById('pbn').innerHTML = (window.NETS || []).map(n => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('');
    const fc = {}; fl.forEach(x => { fc[x.user_id] = (fc[x.user_id] || 0) + 1; });

    document.getElementById('aclaims').innerHTML = cl.length ? cl.map(c => row(
      esc(c.offers.title) + '<br><small>' + esc(c.user_id.slice(0, 8)) + (fc[c.user_id] ? ' | ' + fc[c.user_id] + ' flag(s)' : '') + '</small>',
      badge(c.status) + ' ' + esc(c.proof_note || ''),
      c.status === 'approved' ? `<button class="btn small ghost" data-rev="${c.id}">Reverse</button>` :
      c.status === 'completed' ? `<button class="btn small" data-rc="${c.id}|approved">Approve</button> <button class="btn small ghost" data-rc="${c.id}|rejected">Reject</button>` :
      `<button class="btn small ghost" data-rc="${c.id}|rejected">Reject</button>`
    )).join('') : empty('Nothing to review.');

    const nxt = { requested: ['under_review', 'Start review'], under_review: ['approved', 'Approve'], approved: ['paid', 'Mark paid'] };
    document.getElementById('awd').innerHTML = wd.length ? wd.map(w => row(
      w.points + ' pts, ' + esc(w.method_code) + '<br><small>' + esc(w.destination) + '</small>',
      badge(w.status),
      `<button class="btn small" data-rw="${w.id}|${nxt[w.status][0]}">${nxt[w.status][1]}</button> <button class="btn small ghost" data-rw="${w.id}|rejected">Reject</button>`
    )).join('') : empty('No open requests.');

    document.getElementById('anets').innerHTML = (window.NETS || []).map(n => row(
      esc(n.name), badge(n.status || 'planned'),
      ['planned', 'in_contact', 'partner'].filter(s => s !== (n.status || 'planned')).map(s => `<button class="btn small ghost" data-ns="${n.id}|${s}">${s}</button>`).join(' ')
    )).join('');

    document.getElementById('aflags').innerHTML = fl.length ? fl.map(x => row(
      esc(x.kind) + ' ' + badge(x.severity) + '<br><small>' + esc(x.detail || '') + '</small>',
      when(x.created_at),
      (x.user_id ? `<button class="btn small ghost" data-us="${x.user_id}|review">Review</button> <button class="btn small ghost" data-us="${x.user_id}|blocked">Block</button> ` : '') + `<button class="btn small" data-rf="${x.id}">Resolve</button>`
    )).join('') : empty('No open flags.');

    document.getElementById('ausers').innerHTML = ur.length ? ur.map(x => row(
      'User ' + esc(x.user_id.slice(0, 8)) + '<br><small>' + esc(x.note || '') + '</small>',
      badge(x.status),
      `<button class="btn small" data-us="${x.user_id}|normal">Clear</button> ` + (x.status === 'blocked' ? '' : `<button class="btn small ghost" data-us="${x.user_id}|blocked">Block</button>`)
    )).join('') : empty('No users under review.');

    document.getElementById('apb').innerHTML = pb.length ? pb.map(x => row(
      esc(x.partners ? x.partners.name : '') + ' | ' + esc(x.external_txn_id) + '<br><small>' + esc(x.event_type) + (x.points != null ? ' | ' + x.points + ' pts' : '') + (x.offer_name ? ' | ' + esc(x.offer_name) : '') + '</small>',
      badge(x.signature_ok ? 'verified' : 'rejected'),
      (x.started_at ? 'Started ' + when(x.started_at) + '<br>' : '') + 'Finished ' + when(x.created_at)
    )).join('') : empty('No confirmations recorded.');

    document.getElementById('aoffers').innerHTML = of.map(o => row(
      esc(o.title) + '<br><small>' + esc(o.partners ? o.partners.name : '') + '</small>',
      o.points + ' pts ' + badge(o.status),
      `<button class="btn small ghost" data-os="${o.id}|${o.status === 'active' ? 'paused' : 'active'}">${o.status === 'active' ? 'Pause' : 'Activate'}</button>`
    )).join('') || empty('No offers yet.');
  } catch (e) { toast(e.message); }
}

document.getElementById('offform').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  act(async () => {
    const id = await rpc('admin_save_offer', { p_partner: f.pa.value, p_title: f.t.value, p_description: f.d.value, p_category: f.c.value, p_points: parseInt(f.p.value, 10), p_status: f.s.value });
    if (id && (f.ms.value || f.mc.value)) await rpc('admin_set_offer_limits', { p_offer: id, p_min_seconds: parseInt(f.ms.value || '0', 10), p_max_claims: parseInt(f.mc.value || '0', 10) });
    f.reset();
  }, 'Offer saved');
});

document.getElementById('pbform').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  act(async () => {
    await rpc('admin_record_postback', { p_partner: f.n.value, p_txn: f.x.value.trim(), p_type: f.t.value, p_user: null, p_claim: f.c.value.trim() || null, p_points: f.p.value ? parseInt(f.p.value, 10) : null, p_sig: f.s.checked, p_raw: '' });
    f.reset();
  }, 'Confirmation recorded');
});

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function guard(body) {
  const k = await tok();
  const r = await fetch(SB_URL + '/functions/v1/guard', {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json().catch(() => ({}));
}

function privacyChoice() {
  try { return JSON.parse(localStorage.getItem('qf_privacy') || '{}'); } catch (_) { return {}; }
}
function privacyGpc() { return navigator.globalPrivacyControl === true; }
function fpParts() { return {}; } // Detailed hardware/GPU fingerprinting removed.
async function regDevice() {
  // No persistent device identifier or fingerprint without a recorded opt-in.
  const c = privacyChoice();
  if (privacyGpc() || !c.fingerprinting) return;
  try {
    await rpc('my_privacy_choices', {p_fp:true,p_partners:c.partners||{},p_gpc:false});
    let id = localStorage.getItem('qf_d');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('qf_d',id); }
    const h=await sha('qf|'+id);
    await rpc('register_device',{p_hash:h});
    await guard({action:'register',hash:h,fp:{}});
  } catch (_) {}
}
async function sendVerify() {
  try {
    const t = await tok();
    if (!t) return false;
    const r = await fetch(SB_URL + '/functions/v1/send-verify', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
    return r.ok;
  } catch (_) { return false; }
}

(function () {
  const q = new URLSearchParams(location.search).get('verified');
  if (q === '1' || q === '0') {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => toast(q === '1' ? '✓ Your email is now verified!' : 'Verification link expired or invalid.'), 400);
  }
})();

loadPublic();
if (S) enter();


/* ---- motion polish (all respect prefers-reduced-motion) ---- */
function animateValue(el, endVal, duration = 800) {
  if (!el) return;
  const startVal = parseFloat(el.dataset.val || '0') || 0;
  if (el.id === 'sbal' && startVal > 0 && endVal > startVal) sfx('points');
  el.dataset.val = endVal;
  const fmt = v => Math.round(v).toLocaleString();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || startVal === endVal) { el.textContent = fmt(endVal); return; }
  const t0 = performance.now();
  (function tick(now) {
    const p = Math.min((now - t0) / duration, 1);
    el.textContent = fmt(startVal + (endVal - startVal) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

(function initHeroCanvas() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hero = canvas.parentElement;
  let w = 0, h = 0, parts = [], raf = 0, vis = true;
  const m = { x: -9999, y: -9999 };
  function resize() {
    const r = hero.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(45, Math.floor(w * h / 18000));
    parts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .45, vy: (Math.random() - .5) * .45, r: Math.random() * 1.8 + 1, g: Math.random() < .22 }));
  }
  function step() {
    if (!vis) return;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fillStyle = p.g ? '#f0b90b' : '#22d3ee'; ctx.fill();
      for (let j = i + 1; j < parts.length; j++) {
        const q = parts[j], d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 130) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.strokeStyle = `rgba(79,140,255,${(1 - d / 130) * .28})`; ctx.lineWidth = 1; ctx.stroke(); }
      }
      const md = Math.hypot(p.x - m.x, p.y - m.y);
      if (md < 160) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(m.x, m.y); ctx.strokeStyle = `rgba(34,211,238,${(1 - md / 160) * .5})`; ctx.stroke(); }
    }
    raf = requestAnimationFrame(step);
  }
  hero.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); m.x = e.clientX - r.left; m.y = e.clientY - r.top; }, { passive: true });
  hero.addEventListener('pointerleave', () => { m.x = m.y = -9999; });
  new IntersectionObserver(([en]) => { vis = en.isIntersecting; cancelAnimationFrame(raf); if (vis) raf = requestAnimationFrame(step); }).observe(hero);
  addEventListener('resize', resize, { passive: true });
  resize(); step();
})();

(function initSpotlight() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover)').matches) return;
  const sel = '.card, .wall-card, .mcard, .dstat';
  document.addEventListener('pointermove', e => {
    const c = e.target.closest && e.target.closest(sel);
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
})();

/* ---- soft UI sounds: off until the visitor interacts, lazy-loaded, mutable, remembered per device ---- */
let sndOn = (() => {
  const v = localStorage.getItem('qf_snd');
  return v === null ? !matchMedia('(prefers-reduced-motion: reduce)').matches : v === '1';
})();
let sndLoad = null, sndReady = false;
const sndPool = {};
function sndLoadOnce() {
  if (sndLoad) return sndLoad;
  sndLoad = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'sounds.js?v=20261014f';
    s.onload = () => { for (const k in window.QF_SOUNDS) { const a = new Audio(window.QF_SOUNDS[k]); a.preload = 'auto'; a.volume = k === 'click' ? .35 : .45; sndPool[k] = a; } sndReady = true; res(); };
    s.onerror = () => res();
    document.head.appendChild(s);
  });
  return sndLoad;
}
let userActed = false;
function sfx(name) {
  if (!sndOn || !userActed) return;
  sndLoadOnce().then(() => {
    const a = sndPool[name]; if (!a) return;
    const c = a.cloneNode(); c.volume = a.volume; c.play().catch(() => {});
  });
}
addEventListener('pointerdown', () => { userActed = true; }, { once: true, capture: true });
addEventListener('keydown', () => { userActed = true; }, { once: true, capture: true });
document.addEventListener('pointerdown', e => {
  if (e.target.closest('#snd-toggle')) return;
  if (e.target.closest('button, .btn, .tab, summary, a.btn')) sfx('click');
}, { passive: true });
(function sndToggle() {
  const b = document.createElement('button');
  b.id = 'snd-toggle'; b.type = 'button';
  const paint = () => { b.textContent = sndOn ? '🔊' : '🔇'; b.setAttribute('aria-pressed', sndOn ? 'true' : 'false'); b.setAttribute('aria-label', sndOn ? 'Mute sounds' : 'Turn sounds on'); b.title = sndOn ? 'Sounds on' : 'Sounds off'; };
  paint();
  b.addEventListener('click', () => {
    sndOn = !sndOn; localStorage.setItem('qf_snd', sndOn ? '1' : '0'); paint();
    userActed = true; if (sndOn) sfx('click');
  });
  document.body.appendChild(b);
})();

// Privacy choices are separate from acceptance of the service terms.
async function syncPrivacyChoices() {
  try {
    const remote=await rpc('my_privacy_get_choices'),local=privacyChoice();
    if(remote){
      const partners={};for(const name of Object.keys(local.partners||{}))if(remote.partners&&remote.partners[name])partners[name]=true;
      localStorage.setItem('qf_privacy',JSON.stringify({...local,partners,fingerprinting:!!local.fingerprinting&&!!remote.fingerprinting&&!privacyGpc()}));
      if(!privacyChoice().fingerprinting)localStorage.removeItem('qf_d');
    }
    if(privacyGpc())await persistPrivacy({version:'2026-10-15',fingerprinting:false,partners:{},gpc:true});
  } catch(_) { localStorage.setItem('qf_privacy',JSON.stringify({version:'2026-10-15',fingerprinting:false,partners:{}}));localStorage.removeItem('qf_d'); }
}
async function persistPrivacy(c) {
  localStorage.setItem('qf_privacy',JSON.stringify(c));
  if (!c.fingerprinting || privacyGpc()) localStorage.removeItem('qf_d');
  if (S) await rpc('my_privacy_choices',{p_fp:!!c.fingerprinting,p_partners:c.partners||{},p_gpc:privacyGpc()});
}
function privacyPanel() {
  let dlg=document.getElementById('privacy-dialog');
  if (!dlg) {
    dlg=document.createElement('dialog');dlg.id='privacy-dialog';
    dlg.innerHTML=`<form method="dialog"><h2>Privacy choices</h2><p>Essential sign-in, security and reward records are always used to run the service. Optional tracking stays off unless you choose it.</p><label><input type="checkbox" id="privacy-device"> Allow a random device identifier for duplicate-account checks. Detailed hardware/GPU fingerprinting is not collected.</label><p>Offer partners are enabled separately when you launch them. You can reject all optional processing without losing access to your account.</p><p id="privacy-gpc-note"></p><div class="privacy-actions"><button value="reject" class="btn ghost">Reject optional</button><button value="save" class="btn">Save choices</button></div></form>`;
    document.body.append(dlg);
    dlg.addEventListener('close',async()=>{
      if (!['reject','save'].includes(dlg.returnValue)) return;
      const c={version:'2026-10-15',updated_at:new Date().toISOString(),fingerprinting:dlg.returnValue==='save'&&document.getElementById('privacy-device').checked&&!privacyGpc(),partners:{}};
      document.getElementById('svwrap').replaceChildren();document.getElementById('wall-viewer').hidden=true;
      try {await persistPrivacy(c);if(c.fingerprinting)await regDevice();toast('Privacy choices saved');}catch(_){toast('Saved on this browser. Sign in again to sync account choices.');}
    });
  }
  const box=document.getElementById('privacy-device');box.checked=!!privacyChoice().fingerprinting&&!privacyGpc();box.disabled=privacyGpc();
  document.getElementById('privacy-gpc-note').textContent=privacyGpc()?'Global Privacy Control is on. Optional identifiers and partner launches are blocked.':'';
  dlg.returnValue='';dlg.showModal();
}
async function permitPartner(name) {
  // Consent is captured at sign-up (terms + privacy acknowledgement). Opening an offer is never blocked;
  // the launch is recorded best-effort so it can be withdrawn later in Privacy choices.
  try {
    const c=privacyChoice();
    if(!(c.partners&&c.partners[name])){
      persistPrivacy({...c,version:'2026-10-15',updated_at:new Date().toISOString(),partners:{...(c.partners||{}),[name]:true}}).catch(()=>{});
    }
  } catch(_) {}
  return true;
}
if(document.getElementById('privacy-choices')) document.getElementById('privacy-choices').onclick=privacyPanel;
if(document.getElementById('privacy-export')) document.getElementById('privacy-export').onclick=async()=>{try{const d=await rpc('my_privacy_export');d.privacy_choices=await rpc('my_privacy_get_choices');const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='quantumfinai-my-data.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);}catch(e){toast(e.message||'Export failed');}};
if(document.getElementById('privacy-correct')) document.getElementById('privacy-correct').onclick=async()=>{const name=await askNote('Correct your display name (1-100 characters):');if(!name)return;try{await rpc('my_privacy_correct',{p_name:name.trim()});await loadDash();toast('Name updated');}catch(e){toast(e.message||'Correction failed');}};
if(document.getElementById('privacy-delete')) document.getElementById('privacy-delete').onclick=async()=>{if((await askNote('Permanently delete your account and personal data? Download your data first. Reward accounting rows are de-linked, not removed. Pending withdrawals need support. Type DELETE to confirm:'))!=='DELETE')return;try{await rpc('my_privacy_delete',{p_confirm:'DELETE'});localStorage.removeItem('qf_d');localStorage.removeItem('qf_privacy');signOut();toast('Account deleted');}catch(e){toast(e.message||'Deletion failed. Contact support.');}};
if(privacyGpc()) { localStorage.removeItem('qf_d');persistPrivacy({version:'2026-10-15',fingerprinting:false,partners:{},gpc:true}).catch(()=>{}); }
if(!privacyChoice().version) privacyPanel();
