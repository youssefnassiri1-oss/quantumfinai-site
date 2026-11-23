/* ==========================================================================
   QuantumFinAI Enhancements Engine (enhancements.js)
   Extends existing app.js without removing or overriding existing features.
   ========================================================================== */
(function () {
  'use strict';

  const Q = () => window.QF || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------------
     1. Dual Currency Display Engine (Underlying store = integer points)
     ------------------------------------------------------------------------ */
  const Currency = {
    mode: localStorage.getItem('qf_currency') === 'usd' ? 'usd' : 'points',
    rate: 1000, // Configurable via platform_settings.points_per_dollar

    format(points, opts = {}) {
      const n = Number(points || 0);
      const sign = opts.signed && n > 0 ? '+' : n < 0 ? '-' : '';
      const abs = Math.abs(n);
      if (this.mode === 'usd') {
        const usd = (abs / this.rate).toFixed(2);
        return `${sign}$${usd}`;
      }
      return `${sign}${Math.round(abs).toLocaleString()} pts`;
    },

    secondary(points) {
      const n = Number(points || 0);
      if (this.mode === 'usd') return `${Math.round(n).toLocaleString()} pts`;
      return `≈ $${(n / this.rate).toFixed(2)} USD`;
    },

    async setMode(nextMode, syncServer = true) {
      if (!['usd', 'points'].includes(nextMode)) return;
      this.mode = nextMode;
      try { localStorage.setItem('qf_currency', nextMode); } catch (_) {}
      document.querySelectorAll('.cur-switch button').forEach(b => {
        b.classList.toggle('on', b.dataset.cur === nextMode);
        b.setAttribute('aria-pressed', b.dataset.cur === nextMode ? 'true' : 'false');
      });
      this.refreshAllDisplays();
      if (syncServer && Q().isSignedIn && Q().isSignedIn()) {
        try { await Q().rpc('set_currency_preference', { p_mode: nextMode }); } catch (_) {}
      }
    },

    refreshAllDisplays() {
      // Update navbar balance pill
      const balVal = Number(document.getElementById('sbal')?.dataset.val ?? 0);
      const navPill = document.querySelector('#user-nav .bal-pill');
      if (navPill) {
        const b = document.getElementById('nav-bal');
        const sm = navPill.querySelector('small');
        if (b && sm) {
          if (this.mode === 'usd') {
            b.textContent = `$${(balVal / this.rate).toFixed(2)}`;
            sm.textContent = 'USD';
          } else {
            b.textContent = Math.round(balVal).toLocaleString();
            sm.textContent = 'pts';
          }
        }
      }

      // Update Dashboard primary stats without altering underlying balance
      const sbalEl = document.getElementById('sbal');
      const sbalUsd = document.getElementById('sbal-usd');
      if (sbalEl && sbalEl.parentElement) {
        sbalEl.textContent = this.mode === 'usd'
          ? `$${(balVal / this.rate).toFixed(2)}`
          : Math.round(balVal).toLocaleString();
        const unitNode = sbalEl.nextSibling;
        if (unitNode && unitNode.nodeType === 3) unitNode.textContent = this.mode === 'usd' ? '' : ' pts';
        if (sbalUsd) sbalUsd.textContent = this.secondary(balVal);
      }

      const stotalEl = document.getElementById('stotal');
      if (stotalEl) {
        const tot = Number(stotalEl.dataset.val ?? 0);
        stotalEl.textContent = this.mode === 'usd'
          ? `$${(tot / this.rate).toFixed(2)}`
          : Math.round(tot).toLocaleString();
        const unitNode = stotalEl.nextSibling;
        if (unitNode && unitNode.nodeType === 3) unitNode.textContent = this.mode === 'usd' ? '' : ' pts';
      }

      // Update all data-pts elements across tickers, cards, gamification, referrals
      document.querySelectorAll('[data-pts]').forEach(el => {
        const pts = Number(el.dataset.pts || 0);
        el.textContent = this.format(pts, { signed: el.dataset.signed === '1' });
      });

      // Re-render live feeds & extended dashboard formatting
      if (lastExtData) renderExtendedDashboard(lastExtData);
      if (lastLiveActivity) renderActivityTicker(lastLiveActivity);
      if (lastLiveOffers) renderOffersTicker(lastLiveOffers);
      if (lastOfferStats) renderOfferStats(lastOfferStats);
    }
  };

  function makeCurrencySwitcher() {
    const wrap = document.createElement('div');
    wrap.className = 'cur-switch';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Currency display mode');
    wrap.innerHTML = `
      <button type="button" data-cur="usd" class="${Currency.mode === 'usd' ? 'on' : ''}">USD ($)</button>
      <button type="button" data-cur="points" class="${Currency.mode === 'points' ? 'on' : ''}">Points</button>
    `;
    wrap.addEventListener('click', e => {
      const btn = e.target.closest('button[data-cur]');
      if (!btn) return;
      Currency.setMode(btn.dataset.cur, true);
      if (Q().toast) Q().toast(`Display mode set to ${btn.dataset.cur === 'usd' ? 'USD ($)' : 'Points'}`);
    });
    return wrap;
  }
  /* ------------------------------------------------------------------------
     2. Time Formatting Helper
     ------------------------------------------------------------------------ */
  function timeAgo(iso) {
    const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  /* ------------------------------------------------------------------------
     3. Referral Code Capture (?ref=CODE)
     ------------------------------------------------------------------------ */
  (function captureReferral() {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[A-Za-z0-9_-]{4,24}$/.test(ref.trim())) {
      try { localStorage.setItem('qf_ref_code', ref.trim().toUpperCase()); } catch (_) {}
    }
  })();

  /* ------------------------------------------------------------------------
     4. Live Activity Feed & Live Offers (Real DB Data Only)
     ------------------------------------------------------------------------ */
  let lastLiveActivity = null;
  let lastLiveOffers = null;
  let lastOfferStats = null;

  async function fetchPublicLiveFeeds() {
    const q = Q();
    if (!q.rpc) return;
    try {
      const [activity, offers, stats] = await Promise.all([
        q.rpc('get_live_activity_feed', { p_limit: 24, p_offset: 0 }).catch(() => []),
        q.rpc('get_live_offers_feed', { p_limit: 24 }).catch(() => []),
        q.rpc('get_offer_statistics').catch(() => null)
      ]);
      lastLiveActivity = Array.isArray(activity) ? activity : [];
      lastLiveOffers = Array.isArray(offers) ? offers : [];
      lastOfferStats = stats;

      renderActivityTicker(lastLiveActivity);
      renderOffersTicker(lastLiveOffers);
      if (stats) renderOfferStats(stats);
      renderActivityHistoryList(lastLiveActivity);
    } catch (_) {}
  }

  function renderActivityTicker(items) {
    const targets = document.querySelectorAll('[data-live-activity-track]');
    targets.forEach(track => {
      if (!items || !items.length) {
        track.parentElement.innerHTML = `<p class="ticker-empty">Verified member earnings appear here in real time as tasks are completed.</p>`;
        return;
      }
      const makeCard = it => {
        const who = it.country ? `A user from ${esc(it.country)}` : `User ${esc(it.alias)}`;
        const verb = it.activity_type === 'survey' ? 'completed a survey'
          : it.activity_type === 'welcome_bonus' ? 'claimed a welcome reward'
          : it.activity_type === 'daily_checkin' ? 'checked in daily'
          : it.activity_type === 'achievement' ? 'unlocked an achievement'
          : 'completed an offer';
        return `
          <div class="ticker-item">
            <span><b>${who}</b> ${verb}</span>
            <span class="ticker-amt" data-pts="${it.points}">${Currency.format(it.points)}</span>
            <span class="ticker-time">${timeAgo(it.created_at)}</span>
          </div>`;
      };
      const html = items.map(makeCard).join('');
      // Duplicate once for seamless infinite right-to-left loop
      track.innerHTML = html + html;
      track.style.setProperty('--ticker-dur', Math.max(24, items.length * 3.2) + 's');
    });
  }

  function renderOffersTicker(items) {
    const track = document.getElementById('live-offers-track');
    if (!track) return;
    if (!items || !items.length) {
      track.parentElement.innerHTML = `<p class="ticker-empty">Completed platform offers will stream here automatically once verified.</p>`;
      return;
    }
    const makeCard = it => {
      const origin = it.country ? ` from ${esc(it.country)}` : '';
      return `
        <div class="ticker-item">
          <span><b>User ${esc(it.alias)}</b>${origin} · ${esc(it.offer_name)}</span>
          <span class="ticker-amt" data-pts="${it.points}">${Currency.format(it.points)}</span>
          <span class="st st-${esc(it.status)}">${esc(it.status.replace(/_/g, ' '))}</span>
          <span class="ticker-time">${timeAgo(it.completed_at)}</span>
        </div>`;
    };
    const html = items.map(makeCard).join('');
    track.innerHTML = html + html;
    track.style.setProperty('--ticker-dur', Math.max(26, items.length * 3.5) + 's');
  }

  function renderOfferStats(stats) {
    const el = document.getElementById('live-offer-stats');
    if (!el || !stats) return;
    el.innerHTML = `
      <div class="dstat">
        <span>Total Completed Offers</span>
        <b>${Number(stats.total_completed_offers || 0).toLocaleString()}</b>
        <small>Verified platform completions</small>
      </div>
      <div class="dstat">
        <span>Total Rewards Distributed</span>
        <b data-pts="${stats.total_rewards_points || 0}">${Currency.format(stats.total_rewards_points || 0)}</b>
        <small>Credited to member ledgers</small>
      </div>
      <div class="dstat">
        <span>Conversion Standard</span>
        <b>${Currency.rate.toLocaleString()} pts</b>
        <small>= $1.00 USD (exact ledger)</small>
      </div>
    `;

    const pop = document.getElementById('popular-offers-list');
    if (pop) {
      const list = stats.popular_offers || [];
      pop.innerHTML = list.length
        ? list.map(o => `
            <article class="card">
              <span class="tag">${esc(o.network)}</span>
              <h3>${esc(o.name)}</h3>
              <p>${Number(o.completions).toLocaleString()} verified completions</p>
              <div class="pts" data-pts="${o.avg_points}">Avg ${Currency.format(o.avg_points)}</div>
            </article>`).join('')
        : `<p class="note">Popular offers will rank automatically from verified completion data.</p>`;
    }
  }

  function renderActivityHistoryList(items) {
    const el = document.getElementById('community-history-list');
    if (!el) return;
    el.innerHTML = items && items.length
      ? items.map(it => {
          const who = it.country ? `Member from ${esc(it.country)} (${esc(it.alias)})` : `User ${esc(it.alias)}`;
          return `<div class="lrow">
            <div><b>${who}</b><br><small>${esc(it.label)}</small></div>
            <div class="lm"><span class="ticker-amt" data-pts="${it.points}">${Currency.format(it.points)}</span></div>
            <div class="la"><small>${new Date(it.created_at).toLocaleString()}</small></div>
          </div>`;
        }).join('')
      : `<p class="note">No verified community activity recorded yet.</p>`;
  }

  /* ------------------------------------------------------------------------
     5. Interactive Welcome Reward Machine (Server-Side CSPRNG Reveal)
     ------------------------------------------------------------------------ */
  let welcomeRolling = false;

  function ensureWelcomeModal() {
    let dlg = document.getElementById('welcome-reward-modal');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'welcome-reward-modal';
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="reg-bonus-pill">🎁 Welcome Registration Bonus</span>
        <button type="button" class="btn small ghost" id="wr-close" aria-label="Close">✕</button>
      </div>
      <h2 id="wr-heading" style="margin:6px 0 4px;font-size:26px">Unlock Your Welcome Reward</h2>
      <p class="note" id="wr-sub" style="margin:0 0 10px">Spin the verified reward reel to reveal your one-time registration bonus.</p>

      <div class="reel-stage" aria-live="polite">
        <div class="reel-pointer" aria-hidden="true"></div>
        <div class="reel-track" id="wr-track"></div>
      </div>

      <div id="wr-result" class="reel-result" hidden>
        <h3 id="wr-win-title">Congratulations!</h3>
        <p id="wr-win-msg" style="margin:0 0 14px;color:var(--tx)"></p>
        <button type="button" class="btn big" id="wr-claim-btn">Claim My Reward</button>
      </div>

      <div id="wr-actions" style="margin-top:12px">
        <button type="button" class="btn big" id="wr-spin-btn">Open Welcome Box</button>
      </div>

      <details class="odds-box">
        <summary>Reward Odds & Transparency</summary>
        <p class="note" style="margin:8px 0 6px">Rewards are selected using cryptographically secure server-side randomness before the animation starts. Each eligible account may claim once.</p>
        <table class="odds-table">
          <thead><tr><th>Reward</th><th>Points</th><th>Probability</th></tr></thead>
          <tbody id="wr-odds-body"></tbody>
        </table>
      </details>
    `;
    document.body.appendChild(dlg);
    dlg.querySelector('#wr-close').addEventListener('click', () => {
      if (!welcomeRolling) dlg.close();
    });
    return dlg;
  }

  function tierClass(points) {
    if (points >= 5000) return 'tier-rare';
    if (points >= 1000) return 'tier-high';
    if (points >= 500) return 'tier-mid';
    return 'tier-low';
  }

  function renderOddsTable(tiers) {
    const body = document.getElementById('wr-odds-body');
    if (!body) return;
    body.innerHTML = (tiers || []).map(t => `
      <tr>
        <td><b>${esc(t.label)}</b></td>
        <td>${Number(t.points).toLocaleString()} pts</td>
        <td>${(Number(t.probability_bps) / 100).toFixed(1)}%</td>
      </tr>`).join('');
  }

  function buildReelTiles(tiers, winnerPoints) {
    const track = document.getElementById('wr-track');
    const winIdx = 38;
    const total = 48;
    const pool = (tiers && tiers.length) ? tiers : [
      { label: '$0.00', points: 0 }, { label: '$0.10', points: 100 },
      { label: '$0.50', points: 500 }, { label: '$0.55', points: 550 },
      { label: '$1.00', points: 1000 }, { label: '$3.00', points: 3000 },
      { label: '$5.00', points: 5000 }
    ];
    const winnerTier = pool.find(t => Number(t.points) === Number(winnerPoints)) || {
      label: `$${(winnerPoints / Currency.rate).toFixed(2)}`,
      points: winnerPoints
    };

    const items = [];
    for (let i = 0; i < total; i++) {
      const t = i === winIdx ? winnerTier : pool[Math.floor(Math.random() * pool.length)];
      items.push(`
        <div class="reel-tile ${tierClass(t.points)}" data-idx="${i}">
          <b>${Currency.format(t.points)}</b>
          <small>${t.points >= 5000 ? '★ Rare Jackpot' : Currency.secondary(t.points)}</small>
        </div>`);
    }
    track.style.transition = 'none';
    track.style.transform = 'translateX(0px)';
    track.innerHTML = items.join('');
    return { track, winIdx, winnerTier };
  }

  async function openWelcomeRewardModal(preloadedState) {
    const q = Q();
    const dlg = ensureWelcomeModal();
    const state = preloadedState || await q.rpc('get_welcome_reward_state').catch(() => null);
    if (!state) return;

    renderOddsTable(state.tiers || []);
    const spinBtn = dlg.querySelector('#wr-spin-btn');
    const claimBtn = dlg.querySelector('#wr-claim-btn');
    const resBox = dlg.querySelector('#wr-result');
    const actionsBox = dlg.querySelector('#wr-actions');

    // Reset modal UI
    resBox.hidden = true;
    actionsBox.hidden = false;

    // Preview idle reel
    buildReelTiles(state.tiers || [], 0);

    // If user already rolled earlier (e.g. refreshed mid-spin), show locked outcome directly
    if (state.reward && state.reward.status === 'rolled') {
      showWelcomeOutcome(state.reward.points, true);
    } else if (state.reward && state.reward.status === 'claimed') {
      actionsBox.hidden = true;
      resBox.hidden = false;
      dlg.querySelector('#wr-win-title').textContent = 'Welcome Reward Claimed';
      dlg.querySelector('#wr-win-msg').textContent = `You received ${Currency.format(state.reward.points)} (${Currency.secondary(state.reward.points)}).`;
      claimBtn.hidden = true;
    } else if (state.requires_verification) {
      spinBtn.disabled = true;
      spinBtn.textContent = 'Verify Your Email to Unlock';
    } else {
      spinBtn.disabled = false;
      spinBtn.textContent = 'Open Welcome Box';
    }

    spinBtn.onclick = async () => {
      if (welcomeRolling) return;
      welcomeRolling = true;
      spinBtn.disabled = true;
      spinBtn.classList.add('busy');
      spinBtn.textContent = 'Determining Verified Reward...';
      try {
        // 1. Server determines outcome cryptographically BEFORE animation
        const outcome = await q.rpc('roll_welcome_reward');
        renderOddsTable(outcome.tiers || state.tiers);

        // 2. Build reel with locked server result at winIdx
        const { track, winIdx } = buildReelTiles(outcome.tiers || state.tiers, outcome.points);
        actionsBox.hidden = true;

        // Measure exact tile stride
        const firstTile = track.children[0];
        const stride = (firstTile ? firstTile.getBoundingClientRect().width : 116) + 10;
        const jitter = (Math.random() - 0.5) * (stride * 0.36);
        const targetX = -(winIdx * stride + (stride - 10) / 2 + jitter);

        if (reducedMotion() || outcome.already_rolled) {
          track.style.transform = `translateX(${targetX}px)`;
          track.children[winIdx]?.classList.add('winner');
          welcomeRolling = false;
          showWelcomeOutcome(outcome.points, outcome.status === 'claimed');
          return;
        }

        // Force layout reflow then animate smooth right-to-left deceleration
        void track.offsetWidth;
        const duration = 5200;
        track.style.transition = `transform ${duration}ms cubic-bezier(0.11, 0.85, 0.16, 1)`;
        track.style.transform = `translateX(${targetX}px)`;

        // Subtle rhythmic click ticks during slowdown
        let ticks = 0;
        const tickTimer = setInterval(() => {
          ticks++;
          if (q.sfx && ticks < 20) q.sfx('click');
          if (ticks >= 20) clearInterval(tickTimer);
        }, 210);

        setTimeout(() => {
          clearInterval(tickTimer);
          track.children[winIdx]?.classList.add('winner');
          if (q.sfx) q.sfx(outcome.points > 0 ? 'points' : 'success');
          welcomeRolling = false;
          showWelcomeOutcome(outcome.points, false);
        }, duration + 120);
      } catch (err) {
        welcomeRolling = false;
        spinBtn.disabled = false;
        spinBtn.classList.remove('busy');
        spinBtn.textContent = 'Open Welcome Box';
        if (q.toast) q.toast(err.message || 'Could not open welcome box.');
      }
    };

    function showWelcomeOutcome(points, alreadyClaimed) {
      resBox.hidden = false;
      actionsBox.hidden = true;
      claimBtn.hidden = !!alreadyClaimed;
      claimBtn.disabled = false;
      claimBtn.textContent = 'Claim My Reward';

      if (points > 0) {
        dlg.querySelector('#wr-win-title').textContent = `Congratulations! You Won ${Currency.format(points)}!`;
        dlg.querySelector('#wr-win-msg').textContent = `You've received your welcome reward (${Currency.secondary(points)}). Click below to credit it to your balance.`;
      } else {
        dlg.querySelector('#wr-win-title').textContent = 'Welcome to QuantumFinAI!';
        dlg.querySelector('#wr-win-msg').textContent = `Your bonus box landed on ${Currency.format(0)} this time — complete your Daily Check-in and Offerwalls to start earning right away!`;
      }

      claimBtn.onclick = async () => {
        claimBtn.disabled = true;
        claimBtn.classList.add('busy');
        claimBtn.textContent = 'Crediting...';
        try {
          const res = await q.rpc('claim_welcome_reward');
          if (q.sfx) q.sfx('success');
          if (q.toast) q.toast(res.points > 0 ? `✓ ${Currency.format(res.points)} credited to your balance!` : '✓ Welcome step completed!');
          dlg.close();
          if (q.loadDash) await q.loadDash();
        } catch (err) {
          claimBtn.disabled = false;
          claimBtn.classList.remove('busy');
          claimBtn.textContent = 'Claim My Reward';
          if (q.toast) q.toast(err.message || 'Could not claim reward.');
        }
      };
    }

    if (!dlg.open) dlg.showModal();
  }

  /* ------------------------------------------------------------------------
     7. Extended Dashboard: Gamification, Referrals, Verification Banner, Cashout
     ------------------------------------------------------------------------ */
  let lastExtData = null;
  let welcomePromptedThisSession = false;

  function ensureDashboardExtensions() {
    const dash = document.getElementById('dash');
    const dtabs = document.getElementById('dtabs');
    if (!dash || !dtabs || document.getElementById('dash-welcome-strip')) return;

    // 1. Add Currency Toggle to Navbar
    const userNav = document.getElementById('user-nav');
    if (userNav && !userNav.querySelector('.cur-switch')) {
      userNav.insertBefore(makeCurrencySwitcher(), userNav.firstChild);
    }

    // 2. Personalized Welcome & Level Strip + Quick Actions
    const strip = document.createElement('div');
    strip.id = 'dash-welcome-strip';
    strip.className = 'dash-welcome-strip';
    strip.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <b id="dw-greeting" style="font-size:19px">Welcome back</b>
          <span class="level-pill" id="dw-level">Beginner</span>
          <span class="level-pill" id="dw-streak">🔥 0-day streak</span>
        </div>
        <p class="note" id="dw-next-step" style="margin:6px 0 0">Complete daily check-ins, offers, and surveys to level up.</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap" id="dw-right">
        <button type="button" class="btn small" id="dw-welcome-btn" hidden>🎁 Open Welcome Reward</button>
      </div>
    `;
    const dstats = dash.querySelector('.dstats');
    dash.insertBefore(strip, dstats);

    // Append Pending Balance & Total Withdrawn cards into existing .dstats
    if (dstats && !document.getElementById('spend-bal')) {
      dstats.insertAdjacentHTML('beforeend', `
        <div class="dstat"><span>Pending Balance</span><b id="spend-bal" data-pts="0">0 pts</b><small>Held in queue</small></div>
        <div class="dstat"><span>Total Withdrawn</span><b id="swithdrawn" data-pts="0">0 pts</b><small>Completed payouts</small></div>
      `);
    }

    // Quick Actions Bar
    const qa = document.createElement('div');
    qa.className = 'quick-actions';
    qa.innerHTML = `
      <button type="button" class="qa-btn primary" data-jump="d-earn">⚡ Earn Now</button>
      <button type="button" class="qa-btn" data-jump="d-gami">🏆 Rewards & Check-in</button>
      <button type="button" class="qa-btn" data-jump="d-wd">💳 Withdraw</button>
      <button type="button" class="qa-btn" data-jump="d-ref">🤝 Invite Friends</button>
      <button type="button" class="qa-btn" data-jump="d-rewards">📜 Transactions</button>
    `;
    qa.addEventListener('click', e => {
      const b = e.target.closest('[data-jump]');
      if (!b) return;
      document.querySelector(`#dtabs .tab[data-t="${b.dataset.jump}"]`)?.click();
    });
    dash.insertBefore(qa, dtabs);

    // 3. Add New Dashboard Tabs (Rewards/Gamification, Referrals, Community Feed) before Profile/Admin
    const profileTab = dtabs.querySelector('[data-t="d-profile"]');
    const addTab = (id, label) => {
      const b = document.createElement('button');
      b.className = 'tab';
      b.dataset.t = id;
      b.textContent = label;
      dtabs.insertBefore(b, profileTab);
    };
    addTab('d-gami', 'Daily & Levels');
    addTab('d-ref', 'Referrals');
    addTab('d-community', 'Live Activity');

    // 4. Create Tab Panes
    const dProfile = document.getElementById('d-profile');

    // Gamification Pane
    const gamiPane = document.createElement('div');
    gamiPane.className = 'dpane';
    gamiPane.id = 'd-gami';
    gamiPane.hidden = true;
    gamiPane.innerHTML = `
      <div class="gami-grid">
        <div class="prof-card">
          <div>
            <h3 style="margin:0 0 4px">Daily Check-in</h3>
            <p class="note" style="margin:0">Check in daily to grow your streak and unlock the Day-7 weekly milestone bonus.</p>
            <div class="checkin-days" id="checkin-calendar"></div>
          </div>
          <button type="button" class="btn" id="btn-daily-checkin">Claim Daily Check-in</button>
        </div>

        <div class="prof-card">
          <div>
            <h3 style="margin:0 0 4px">Membership Level & Progress</h3>
            <p class="note" id="lvl-perks" style="margin:0 0 12px"></p>
            <div class="prog-label"><span>Next Level</span><b id="lvl-prog-txt">-</b></div>
            <div class="bar"><i id="lvl-prog-bar" style="width:0%"></i></div>

            <div class="prog-label"><span>Minimum Withdrawal Threshold</span><b id="wd-prog-txt">-</b></div>
            <div class="bar"><i id="wd-prog-bar" style="width:0%"></i></div>

            <div class="prog-label"><span>Achievements Progress</span><b id="ach-prog-txt">0 / 0</b></div>
            <div class="bar"><i id="ach-prog-bar" style="width:0%"></i></div>
          </div>
        </div>
      </div>
      <h3 class="sh">Achievements</h3>
      <div class="ach-grid" id="achievements-grid"></div>
    `;
    dash.insertBefore(gamiPane, dProfile);

    // Referrals Pane
    const refPane = document.createElement('div');
    refPane.className = 'dpane';
    refPane.id = 'd-ref';
    refPane.hidden = true;
    refPane.innerHTML = `
      <div class="prof-card" style="margin-bottom:20px">
        <h3 style="margin:0 0 6px">Invite Friends & Earn Commission</h3>
        <p class="note" id="ref-rule-note" style="margin:0">Share your unique link below. Verified referrals earn you lifetime commission on qualifying offers.</p>
        <div class="ref-box">
          <input id="ref-link-input" readonly value="Loading...">
          <button type="button" class="btn small" id="ref-copy-btn">Copy Link</button>
        </div>
        <div class="dstats" style="margin:8px 0 0">
          <div class="dstat"><span>Total Referrals</span><b id="ref-total">0</b></div>
          <div class="dstat"><span>Pending</span><b id="ref-pending">0</b></div>
          <div class="dstat"><span>Verified</span><b id="ref-verified">0</b></div>
          <div class="dstat"><span>Conversion</span><b id="ref-conv">0%</b></div>
          <div class="dstat"><span>Referral Earnings</span><b id="ref-earn" data-pts="0">0 pts</b></div>
        </div>
      </div>
      <h3 class="sh">Recent Referrals</h3>
      <div class="list" id="ref-recent-list"></div>
    `;
    dash.insertBefore(refPane, dProfile);

    // Community Activity History Pane
    const commPane = document.createElement('div');
    commPane.className = 'dpane';
    commPane.id = 'd-community';
    commPane.hidden = true;
    commPane.innerHTML = `
      <h3 class="sh">Recent Community Activity</h3>
      <p class="note">Anonymous activity from verified accounts. Only the first letter of a name is shown.</p>
      <div class="list" id="community-history-list"></div>
    `;
    dash.insertBefore(commPane, dProfile);

    document.getElementById('dw-welcome-btn').addEventListener('click', () => openWelcomeRewardModal());
    document.getElementById('btn-daily-checkin').addEventListener('click', async () => {
      const q = Q(); const btn = document.getElementById('btn-daily-checkin');
      btn.disabled = true;
      try {
        const res = await q.rpc('claim_daily_checkin');
        if (res.already_claimed) { if (q.toast) q.toast('You already checked in today. Come back tomorrow.'); }
        else {
          if (q.sfx) q.sfx('points');
          if (q.toast) q.toast(`✓ Day ${res.streak_day} check-in: ${Currency.format(res.points)} credited`);
        }
        if (q.loadDash) await q.loadDash();
      } catch (err) {
        if (q.toast) q.toast(err.message || 'Check-in failed.');
        btn.disabled = false;
      }
    });
    document.getElementById('ref-copy-btn').addEventListener('click', async () => {
      const inp = document.getElementById('ref-link-input');
      try { await navigator.clipboard.writeText(inp.value); if (Q().toast) Q().toast('Referral link copied'); }
      catch (_) { inp.select(); document.execCommand && document.execCommand('copy'); if (Q().toast) Q().toast('Referral link copied'); }
    });
  }

  function renderExtendedDashboard(d) {
    if (!d) return;
    lastExtData = d;
    Currency.rate = Number(d.points_per_dollar) || 1000;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setPts = (id, v) => { const el = document.getElementById(id); if (el) { el.dataset.pts = v; el.textContent = Currency.format(v); } };

    const free = d.enabled !== false;
    document.querySelectorAll('#dtabs .tab[data-t="d-gami"], #dtabs .tab[data-t="d-ref"]').forEach(t => { t.hidden = !free; });

    const lvl = d.current_level || { name: 'Beginner', color: '#93a89a', perks: '' };
    const lp = document.getElementById('dw-level');
    if (lp) { lp.textContent = `${lvl.name} level`; lp.style.borderColor = lvl.color; lp.style.color = lvl.color; }
    set('dw-streak', `🔥 ${d.current_streak || 0}-day streak`);
    set('lvl-perks', lvl.perks || '');
    const next = d.next_level;
    const life = Number(d.lifetime_points || 0);
    if (next) {
      const span = Math.max(1, next.min_points - (lvl.min_points || 0));
      const pct = Math.min(100, Math.max(0, ((life - (lvl.min_points || 0)) / span) * 100));
      set('lvl-prog-txt', `${Currency.format(life)} / ${Currency.format(next.min_points)} (${next.name})`);
      const b = document.getElementById('lvl-prog-bar'); if (b) b.style.width = pct + '%';
    } else {
      set('lvl-prog-txt', 'Top level reached');
      const b = document.getElementById('lvl-prog-bar'); if (b) b.style.width = '100%';
    }

    const bal = Number(document.getElementById('sbal')?.dataset.val ?? 0);
    const minWd = Number(d.min_withdrawal_points || 0);
    set('wd-prog-txt', `${Currency.format(Math.max(0, bal))} / ${Currency.format(minWd)}`);
    const wb = document.getElementById('wd-prog-bar');
    if (wb) wb.style.width = Math.min(100, minWd ? (Math.max(0, bal) / minWd) * 100 : 0) + '%';

    const achs = d.achievements || [];
    const done = achs.filter(a => a.unlocked).length;
    set('ach-prog-txt', `${done} / ${achs.length}`);
    const ab = document.getElementById('ach-prog-bar'); if (ab) ab.style.width = (achs.length ? done / achs.length * 100 : 0) + '%';
    const grid = document.getElementById('achievements-grid');
    if (grid) {
      grid.innerHTML = achs.map(a => `
        <div class="ach${a.unlocked ? ' on' : ''}">
          <i>${esc(a.icon)}</i><b>${esc(a.title)}</b>
          <small>${esc(a.description)}</small>
          <span>${a.reward_points > 0 ? 'Reward: ' + Currency.format(a.reward_points) : ''}${a.unlocked ? ' · Unlocked' : ''}</span>
        </div>`).join('');
    }

    // Check-in calendar: 7-day cycle
    const cal = document.getElementById('checkin-calendar');
    if (cal) {
      const streak = Number(d.current_streak || 0);
      const doneInCycle = streak === 0 ? 0 : ((streak - 1) % 7) + 1;
      const todayDone = !!d.checkin_today;
      let html = '';
      for (let i = 1; i <= 7; i++) {
        const isDone = todayDone ? i <= doneInCycle : i <= (streak % 7 === 0 ? 0 : doneInCycle);
        html += `<div class="cday${isDone ? ' done' : ''}${i === 7 ? ' big' : ''}"><small>Day ${i}</small><b>${i === 7 ? '★' : '+'}</b></div>`;
      }
      cal.innerHTML = html;
    }
    const cb = document.getElementById('btn-daily-checkin');
    if (cb) { cb.disabled = !!d.checkin_today; cb.textContent = d.checkin_today ? 'Checked in today ✓' : 'Claim Daily Check-in'; }

    // Pending / withdrawn
    setPts('spend-bal', d.pending_withdrawal_points || 0);
    setPts('swithdrawn', d.total_withdrawn_points || 0);

    // Welcome button
    const wr = d.welcome_reward || {};
    const wbtn = document.getElementById('dw-welcome-btn');
    if (wbtn) wbtn.hidden = !(free && wr.eligible || (wr.reward && wr.reward.status === 'rolled'));
    const greeting = document.getElementById('dw-greeting');
    if (greeting && !greeting.dataset.set) { greeting.textContent = 'Welcome back'; greeting.dataset.set = '1'; }

    let hint = 'Complete offers and surveys to level up.';
    if (Number(d.bonus_locked_points) > 0) {
      hint = `Bonus points (${Currency.format(d.bonus_locked_points)}) can be withdrawn after you earn ${Currency.format(d.bonus_unlock_real_pts)} from partner offers or surveys.`;
    } else if (free && !d.checkin_today) hint = 'Your daily check-in is ready.';
    set('dw-next-step', hint);
    const note = document.getElementById('ref-rule-note');
    if (note) note.textContent = 'Share your link. Once a friend earns from partner offers, you receive a commission on their partner earnings. Bonus points are not counted.';

    // Auto-offer welcome box once per session
    if (free && wr.eligible && !welcomePromptedThisSession && !(wr.reward && wr.reward.status === 'claimed')) {
      welcomePromptedThisSession = true;
      setTimeout(() => openWelcomeRewardModal(wr), 900);
    }
    if (Array.isArray(d.newly_unlocked) && d.newly_unlocked.length && Q().toast) {
      d.newly_unlocked.forEach(a => Q().toast(`🏆 Achievement unlocked: ${a.title}`));
    }
  }

  async function renderReferralPanel() {
    const q = Q();
    try {
      const s = await q.rpc('get_my_referral_summary');
      const link = `${location.origin}/?ref=${encodeURIComponent(s.code)}`;
      const inp = document.getElementById('ref-link-input'); if (inp) inp.value = link;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('ref-total', s.total); set('ref-pending', s.pending); set('ref-verified', s.verified); set('ref-conv', s.conversion_rate + '%');
      const e = document.getElementById('ref-earn'); if (e) { e.dataset.pts = s.earnings_points; e.textContent = Currency.format(s.earnings_points); }
      const list = document.getElementById('ref-recent-list');
      if (list) list.innerHTML = (s.recent || []).length
        ? s.recent.map(r => `<div class="lrow"><div><b>${esc(r.alias)}</b><br><small>${esc(r.status)}</small></div><div class="lm"><span data-pts="${r.earned_points}">${Currency.format(r.earned_points)}</span></div><div class="la"><small>${new Date(r.created_at).toLocaleDateString()}</small></div></div>`).join('')
        : '<p class="note">No referrals yet.</p>';
    } catch (_) {}
  }

  async function applyStoredReferral() {
    let code = null;
    try { code = localStorage.getItem('qf_ref_code'); } catch (_) {}
    if (!code) return;
    try {
      await Q().rpc('apply_referral_code', { p_code: code });
    } catch (_) {}
    try { localStorage.removeItem('qf_ref_code'); } catch (_) {}
  }

  let dashBusy = false;
  async function onDashboardLoaded() {
    const q = Q();
    if (dashBusy || !q.rpc || !(q.isSignedIn && q.isSignedIn())) return;
    dashBusy = true;
    try {
      ensureDashboardExtensions();
      await applyStoredReferral();
      const d = await q.rpc('get_user_dashboard_extended');
      if (d && d.currency_mode && !localStorage.getItem('qf_currency')) { await Currency.setMode(d.currency_mode, false); }
      renderExtendedDashboard(d);
      setTimeout(() => Currency.refreshAllDisplays(), 950);
      fetchPublicLiveFeeds();
      if (d && d.enabled !== false) renderReferralPanel();
    } catch (_) {
    } finally { dashBusy = false; }
  }

  window.QFEnhancements = { Currency, onDashboardLoaded };
  document.addEventListener('DOMContentLoaded', () => { Currency.rate = 1000; });
})();
