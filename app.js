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
    const close = val => { dlg.close(); resolve(val); };
    document.getElementById('modal-cancel').onclick = () => close(null);
    document.getElementById('modal-form').onsubmit = e => { e.preventDefault(); close(inp.value.trim()); };
    dlg.showModal();
  });
}

const TSW = {};
function tsRender(id) {
  if (TSW[id] !== undefined || !window.turnstile) return;
  const el = document.getElementById(id);
  if (el) TSW[id] = turnstile.render(el, { sitekey: TS_KEY, theme: 'dark' });
}
const tsToken = id => (window.turnstile && TSW[id] !== undefined) ? turnstile.getResponse(TSW[id]) : '';
const tsReset = id => { if (window.turnstile && TSW[id] !== undefined) turnstile.reset(TSW[id]); };
const tsWait = setInterval(() => { if (window.turnstile) { clearInterval(tsWait); tsRender('tsauth'); } }, 300);

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

async function tok() {
  if (!S) return null;
  if (Date.now() > S.e) {
    const [r, d] = await sb('/auth/v1/token?grant_type=refresh_token', { refresh_token: S.r });
    if (!r.ok) { signOut(); return null; }
    setSess(d);
  }
  return S.a;
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

document.querySelectorAll('#account .tabs .tab').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  document.querySelectorAll('#account .tabs .tab').forEach(x => x.classList.toggle('on', x === b));
  document.getElementById('lname').style.display = mode === 'signup' ? '' : 'none';
  document.getElementById('tsauth').style.display = mode === 'signup' ? '' : 'none';
  document.getElementById('fsubmit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  document.getElementById('ftitle').textContent = mode === 'signup' ? 'Create an account' : 'Sign in';
  authForm.pw.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  tsReset('tsauth');
}));

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!/^\S+@\S+\.\S+$/.test(authForm.email.value) || authForm.pw.value.length < 8) {
    say('Check your email and password (8 characters minimum)'); return;
  }
  if (mode === 'signup' && !authForm.name.value.trim()) { say('Name is required'); return; }
  const cap = mode === 'signup' ? tsToken('tsauth') : '';
  if (mode === 'signup' && !cap) { say('Please complete the human check first'); return; }

  try {
    if (mode === 'signup') {
      const sr = await fetch(SB_URL + '/functions/v1/signup', {
        method: 'POST',
        headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authForm.email.value, password: authForm.pw.value, name: authForm.name.value.trim(), token: cap })
      });
      const sd = await sr.json().catch(() => ({}));
      if (!sr.ok) throw { msg: sd.error || 'Could not create the account' };
      const [r2, d2] = await sb('/auth/v1/token?grant_type=password', { email: authForm.email.value, password: authForm.pw.value });
      if (!r2.ok) throw d2;
      setSess(d2); enter(); sendVerify();
    } else {
      const [r, d] = await sb('/auth/v1/token?grant_type=password', { email: authForm.email.value, password: authForm.pw.value });
      if (!r.ok) throw d;
      setSess(d); enter();
    }
  } catch (x) {
    const t = (x && (x.msg || x.message)) || '';
    say(!t ? 'Connection error' : /Invalid login/i.test(t) ? 'Wrong email or password' : t);
  } finally {
    if (mode === 'signup') tsReset('tsauth');
  }
});

const LOGOS = { bank_transfer: '🏦', digital_wallet: '👛', gift_card: '🎁', crypto: '🪙' };
const BRANDS={
binance:`<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="#F0B90B"><rect x="13.2" y="13.2" width="5.6" height="5.6"/><rect x="13.2" y="4.5" width="5.6" height="5.6"/><rect x="13.2" y="21.9" width="5.6" height="5.6"/><rect x="4.5" y="13.2" width="5.6" height="5.6"/><rect x="21.9" y="13.2" width="5.6" height="5.6"/></g></svg>`,
cwallet:`<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#00C48C"/><text x="16" y="22.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" font-weight="800" fill="#fff">C</text></svg>`,
paypal:`<svg viewBox="0 0 32 32" aria-hidden="true"><text x="4" y="24" font-family="Arial,sans-serif" font-size="19" font-weight="800" font-style="italic" fill="#003087">P</text><text x="14.5" y="24" font-family="Arial,sans-serif" font-size="19" font-weight="800" font-style="italic" fill="#009CDE">P</text></svg>`,
itunes:`<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="qfit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FA57A0"/><stop offset="1" stop-color="#FA243C"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#qfit)"/><text x="16" y="23.5" text-anchor="middle" font-size="17" fill="#fff">\u266A</text></svg>`,
googleplay:`<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="qfgp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00A0FF"/><stop offset=".5" stop-color="#00D563"/><stop offset=".75" stop-color="#FFCE00"/><stop offset="1" stop-color="#FF3A44"/></linearGradient></defs><path d="M9 5.5v21l15-10.5z" fill="url(#qfgp)"/></svg>`,
amazon:`<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#232F3E"/><text x="16" y="20" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="800" fill="#fff">a</text><path d="M8 22.5q8 4.5 16-1.5" stroke="#FF9900" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`
};
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
    <button type="button" class="mcard soon" data-toast="Not available yet - coming soon.">
      <span class="mlogo">${BRANDS[b[0]]}</span>
      <div class="mtxt"><b>${b[1]}</b><small>${b[2]}</small></div>
      <span class="tag">Coming soon</span>
    </button>`).join('');
}

let DOFF = [], DTAKEN = new Set(), DFCAT = 'All';
const CH = ['All', 'Surveys', 'Offerwalls', 'Games', 'Apps', 'Trials', 'Tasks', 'Services'];
const catIcon = c => ({ surveys: '◉', apps: '▣', games: '🎮', offerwalls: '★', services: '⚙', trials: '✦', tasks: '✓' }[(c || '').toLowerCase()] || '◇');

function paintChips(el, cur) {
  if (!el) return;
  el.innerHTML = CH.map(n => `<button type="button" class="pill${n === cur ? ' on' : ''}" data-cat="${n}">${n}</button>`).join('');
}

function drawWallPartners(nets) {
  const el = document.getElementById('wallgrid');
  if (!el) return;
  const sorted = [...(nets || [])].sort((a, b) => (a.name === 'CPX Research' ? -1 : b.name === 'CPX Research' ? 1 : 0));
  el.innerHTML = sorted.map(n => {
    const isLive = n.name === 'CPX Research' || n.status === 'partner';
    return `
      <article class="wall-card ${isLive ? 'live' : ''}">
        <div class="wall-head">
          <div class="wall-logo">${esc(n.name.slice(0, 2).toUpperCase())}</div>
          <div>
            <h3 style="margin:0;font-size:17px">${esc(n.name)}</h3>
            <span class="tag">${isLive ? '✓ Live Now' : 'Integrating Soon'}</span>
          </div>
        </div>
        <p class="note" style="margin:4px 0;flex:1">${esc(n.description || 'Complete surveys and tasks to earn points automatically.')}</p>
        ${n.name === 'CPX Research'
          ? `<button class="btn small" type="button" data-open-cpx="1">Launch Offerwall</button>`
          : `<button class="btn small ghost" type="button" disabled>Coming Soon</button>`}
      </article>`;
  }).join('');
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
    : empty(DFCAT === 'All' ? 'No direct tasks right now. Use the Offerwalls above to earn!' : 'No ' + DFCAT.toLowerCase() + ' yet.');
}

document.getElementById('dchips').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  DFCAT = b.dataset.cat;
  paintChips(document.getElementById('dchips'), DFCAT);
  drawDoff();
});


/* ---- Public offers + networks by category (guest view) ---- */
let PUB = [], FCAT = 'All';
function ncat(n) { const t = (n.network_type || '').toLowerCase(); if (t === 'survey') return 'Surveys'; if (t === 'offerwall') return 'Offerwalls'; if (/game/i.test(n.name)) return 'Games'; return 'Services'; }
function netCard(n) {
  return `<article class="card"><div class="thumb">${esc(n.name.slice(0, 2).toUpperCase())}</div><span class="tag">${esc(n.category || ncat(n))}</span> <span class="tag">${esc({ planned: 'Planned', in_contact: 'In contact', partner: 'Integrated' }[n.status] || 'Planned')}</span><h3>${esc(n.name)}</h3><p>${esc(n.description || '')}</p>${n.name === 'CPX Research' ? '<a class="btn small" href="#account">Sign in to open surveys</a> ' : ''}${n.website ? `<a class="btn small ghost" href="${esc(n.website)}" target="_blank" rel="noopener noreferrer">Visit website</a>` : ''}</article>`;
}
function pubCard(x) { return `<article class="card"><div class="thumb">${catIcon(x.category)}</div><span class="tag">${esc(x.category)}</span><h3>${esc(x.title)}</h3><p>${esc(x.description || '')}</p><div class="pts">${Number(x.points).toLocaleString()} points</div><a class="btn small" href="#account">Sign in to start</a></article>`; }
function drawPub() {
  const el = document.getElementById('offergrid'); if (!el) return;
  const l = FCAT === 'All' ? PUB : PUB.filter(o => (o.category || '').toLowerCase() === FCAT.toLowerCase());
  el.innerHTML = l.length ? l.map(x => x.isNet ? netCard(x) : pubCard(x)).join('') : empty(FCAT === 'All' ? 'Nothing here yet.' : 'No ' + FCAT.toLowerCase() + ' yet.');
}
const pubChips = document.getElementById('chips');
if (pubChips) {
  paintChips(pubChips, FCAT);
  pubChips.addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; FCAT = b.dataset.cat; paintChips(pubChips, FCAT); drawPub(); });
}
function drawPublicNets(nets) {
  const g = document.getElementById('netgrid');
  if (g) g.innerHTML = nets.map(n => netCard(Object.assign({}, n, { category: n.network_type }))).join('');
}

async function loadPublic() {
  drawBrands();
  try {
    const [m, nets, offs] = await Promise.all([
      api('withdrawal_methods?select=code,label,min_points&active=eq.true'),
      api('partners?select=id,name,website,description,network_type,status&active=eq.true&order=name'),
      api('offers?select=id,title,description,category,points&status=eq.active&order=created_at.desc')
    ]);
    window.NETS = nets || [];
    PUB = (offs || []).concat(window.NETS.map(n => Object.assign({}, n, { category: ncat(n), isNet: true })));
    drawPub(); drawPublicNets(window.NETS);
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

    document.getElementById('sbal').textContent = Number(bal).toLocaleString();
    document.getElementById('nav-bal').textContent = Number(bal).toLocaleString();
    document.getElementById('sbal-usd').textContent = `≈ $${(bal / 1000).toFixed(2)} USD`;
    document.getElementById('stotal').textContent = Number(totalEarned).toLocaleString();
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
      ? led.map(l => row(
          `<b>${l.delta > 0 ? '+' : ''}${l.delta.toLocaleString()} pts</b>`,
          esc(l.reason.replace(/_/g, ' ')),
          when(l.created_at)
        )).join('')
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
    f.style.cssText = 'width:100%;height:920px;border:0;background:#fff;display:block';
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
  if (!b) return;
  const d = b.dataset;

  if (d.openCpx) { openCpxWall(); return; }
  if (d.claim) {
    act(async () => {
      const r = await rpc('claim_offer', { p_offer: d.claim });
      if (r) {
        const h = localStorage.getItem('qf_d');
        guard({ action: 'monitor', hash: h ? await sha('qf|' + h) : '', fp: fpParts() }).catch(() => {});
      }
      return r;
    }, 'Task started!', true);
  }
  if (d.submit) {
    const n = await askNote('Proof or completion note (optional)');
    if (n !== null) act(() => rpc('submit_claim', { p_claim: d.submit, p_note: n }), 'Submitted for review');
  }
  if (d.cancel) act(() => rpc('cancel_withdrawal', { p_id: d.cancel }), 'Request cancelled');
  if (d.rc) {
    const [i, s] = d.rc.split('|');
    const n = await askNote(`Admin note for ${s}`);
    if (n !== null) act(() => rpc('admin_review_claim', { p_claim: i, p_status: s, p_note: n }), 'Claim ' + s);
  }
  if (d.rw) {
    const [i, s] = d.rw.split('|');
    const n = await askNote('Admin note (optional)');
    if (n !== null) act(() => rpc('admin_review_withdrawal', { p_id: i, p_status: s, p_note: n }), 'Updated');
  }
  if (d.rev) {
    const n = await askNote('Reason for reversal');
    if (n !== null) act(() => rpc('admin_reverse_claim', { p_claim: d.rev, p_note: n }), 'Claim reversed');
  }
  if (d.us) {
    const [i, s] = d.us.split('|');
    act(() => rpc('admin_set_user_status', { p_user: i, p_status: s, p_note: 'Set by admin' }), 'User status: ' + s);
  }
  if (d.rf) act(() => rpc('admin_resolve_flag', { p_id: d.rf }), 'Flag resolved');
  if (d.thr) {
    const v = String(parseInt(document.getElementById('thr').value, 10));
    if (!(v >= 1 && v <= 100)) { toast('Enter 1–100'); return; }
    act(() => rpc('admin_set_setting', { p_key: 'ip_score_threshold', p_value: v }), 'Threshold saved');
  }
  if (d.ns) {
    const [i, s] = d.ns.split('|');
    act(async () => { await rpc('admin_set_partner_status', { p_id: i, p_status: s }); await loadPublic(); }, 'Network updated');
  }
  if (d.os) {
    const [i, s] = d.os.split('|');
    act(() => rpc('admin_set_offer_status', { p_offer: i, p_status: s }), 'Offer updated');
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
      esc(x.partners ? x.partners.name : '') + ' | ' + esc(x.external_txn_id) + '<br><small>' + esc(x.event_type) + (x.points != null ? ' | ' + x.points + ' pts' : '') + '</small>',
      badge(x.signature_ok ? 'verified' : 'rejected'),
      when(x.created_at)
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

function fpParts() {
  let gpu = '';
  try {
    const c = document.createElement('canvas'), g = c.getContext('webgl'), e = g && g.getExtension('WEBGL_debug_renderer_info');
    gpu = e ? String(g.getParameter(e.UNMASKED_RENDERER_WEBGL)).slice(0, 80) : '';
  } catch (_) {}
  return {
    screen: screen.width + 'x' + screen.height + 'x' + (window.devicePixelRatio || 1),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    lang: navigator.language || '',
    cores: navigator.hardwareConcurrency || 0,
    mem: navigator.deviceMemory || 0,
    gpu,
    platform: (navigator.platform || '').slice(0, 40),
    touch: navigator.maxTouchPoints || 0
  };
}

async function regDevice() {
  try {
    let id = localStorage.getItem('qf_d');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('qf_d', id); }
    const h = await sha('qf|' + id);
    await rpc('register_device', { p_hash: h });
    await guard({ action: 'register', hash: h, fp: fpParts() });
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
