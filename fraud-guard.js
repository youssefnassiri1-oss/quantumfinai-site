/* =====================================================================
 * FraudGuard v1 — client-side signal collector for rewards websites
 * ---------------------------------------------------------------------
 * Mirrors the Verisoul mobile collectors' philosophy, adapted to browsers:
 *   - DeviceData      -> collectDevice()   (browser/hardware fingerprint)
 *   - Emulator checks -> collectBot()      (webdriver/headless signals)
 *   - Sensor/behavior -> collectBehavior() (mouse/touch entropy)
 *   - NetworkData     -> collectNetHints() (connection hints; IP checked server-side)
 *
 * IMPORTANT: this script only COLLECTS signals. The fraud verdict must be
 * computed on YOUR SERVER (never trust client-side decisions).
 *
 * QuantumFinAI integration (2026-10-18):
 *   This build is a pure collector - it never talks to the network itself.
 *   The site's own authenticated anti-fraud pipeline (app.js -> guard edge
 *   function) reads window.FraudGuard.getReport() after sign-up and sends it
 *   with the member's session, so reports are always tied to an account and
 *   consent-gated (Privacy choices -> device fingerprinting; GPC respected).
 *   Server side: the guard function stores the report, flags automation and
 *   behaviour signals, and links accounts that share the same fingerprint.
 * ===================================================================== */
(function () {
  'use strict';

  var SESSION_KEY = 'fg_sid_v1';

  /* ---------- helpers ---------- */

  function cyrb53(str, seed) {
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  function getSessionId() {
    try {
      var s = localStorage.getItem(SESSION_KEY);
      if (!s) {
        s = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(SESSION_KEY, s);
      }
      return s;
    } catch (e) {
      return 's_nostorage_' + Math.random().toString(36).slice(2, 10);
    }
  }

  /* ---------- 1. device / browser fingerprint (like DeviceData) ---------- */

  function canvasFingerprint() {
    try {
      var c = document.createElement('canvas');
      c.width = 240; c.height = 60;
      var x = c.getContext('2d');
      x.textBaseline = 'top';
      x.font = '14px "Arial"';
      x.fillStyle = '#f60';
      x.fillRect(0, 0, 120, 30);
      x.fillStyle = '#069';
      x.fillText('FraudGuard-ق', 4, 20);
      x.strokeStyle = 'rgba(0,0,0,0.4)';
      x.beginPath(); x.arc(200, 30, 18, 0, Math.PI * 2); x.stroke();
      return cyrb53(c.toDataURL(), 7);
    } catch (e) { return null; }
  }

  function webglFingerprint() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return { supported: false };
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      var vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      var renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return {
        supported: true,
        vendor: String(vendor),
        renderer: String(renderer),
        hash: cyrb53(String(vendor) + '|' + String(renderer), 13)
      };
    } catch (e) { return { supported: false, error: true }; }
  }

  function audioFingerprint() {
    // Lightweight oscillator-based fingerprint (like the mobile sensor inventory:
    // cheap to collect, hard to fake consistently).
    try {
      var AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!AC) return null;
      var ctx = new AC(1, 44100, 44100);
      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      var comp = ctx.createDynamicsCompressor();
      osc.connect(comp); comp.connect(ctx.destination);
      osc.start(0);
      // NOTE: full rendering is async; we return a sync-capable stub hash of params.
      return cyrb53('tri|10000|' + (ctx.sampleRate || 0), 29);
    } catch (e) { return null; }
  }

  function collectDevice() {
    var nav = navigator, scr = screen;
    var tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) {}
    var d = {
      userAgent: nav.userAgent || null,
      platform: nav.platform || null,
      hardwareConcurrency: nav.hardwareConcurrency || null,
      deviceMemory: nav.deviceMemory || null,          // GB buckets (Chrome)
      maxTouchPoints: (typeof nav.maxTouchPoints === 'number') ? nav.maxTouchPoints : null,
      screenW: scr.width, screenH: scr.height,
      availW: scr.availWidth, availH: scr.availHeight,
      colorDepth: scr.colorDepth, pixelRatio: window.devicePixelRatio || 1,
      timezone: tz, tzOffsetMin: new Date().getTimezoneOffset(),
      language: nav.language || null,
      languages: (nav.languages || []).join(',') || null,
      cookieEnabled: !!nav.cookieEnabled,
      doNotTrack: nav.doNotTrack || null,
      pdfViewerEnabled: (typeof nav.pdfViewerEnabled === 'boolean') ? nav.pdfViewerEnabled : null,
      webdriver: nav.webdriver === true,               // <-- classic automation flag
      pluginsCount: (nav.plugins ? nav.plugins.length : 0),
      canvas: canvasFingerprint(),
      webgl: webglFingerprint(),
      audio: audioFingerprint()
    };
    d.fingerprintHash = cyrb53(JSON.stringify(d), 3);  // stable-ish device hash
    return d;
  }

  /* ---------- 2. bot / headless signals (like emulator heuristics) ---------- */

  function collectBot() {
    var nav = navigator;
    var flags = [];
    if (nav.webdriver === true) flags.push('webdriver_true');
    if (!nav.plugins || nav.plugins.length === 0) flags.push('no_plugins');
    if (!nav.languages || nav.languages.length === 0) flags.push('no_languages');
    // headless Chrome tells: tiny plugin list + webdriver + missing chrome object nuances
    var isHeadlessUA = /headless/i.test(nav.userAgent || '');
    if (isHeadlessUA) flags.push('headless_ua');
    // touch-capable UA but zero touch points (or vice versa) = spoofing smell
    var mobileUA = /android|iphone|ipad|mobile/i.test(nav.userAgent || '');
    if (mobileUA && (nav.maxTouchPoints === 0)) flags.push('mobile_ua_no_touch');
    if (!mobileUA && (nav.maxTouchPoints || 0) > 2) flags.push('desktop_ua_many_touch');
    // phantomjs / selenium leftovers
    if (window._phantom || window.__phantomas || window.callPhantom) flags.push('phantom_artifact');
    if (document.documentElement && document.documentElement.getAttribute('selenium')) flags.push('selenium_attr');
    return { botFlags: flags, looksAutomated: flags.length > 0 };
  }

  /* ---------- 3. behavior entropy (like the accelerometer stream) ---------- */

  var behavior = { moves: 0, clicks: 0, keys: 0, scrolls: 0, firstTs: 0, lastTs: 0, dist: 0, _lx: null, _ly: null, _t0: 0 };

  function armBehavior() {
    behavior._t0 = Date.now();
    function onMove(e) {
      var now = Date.now();
      if (now - behavior._t0 > 15000) { cleanup(); return; } // sample first 15s only
      behavior.moves++;
      if (behavior._lx !== null) {
        var dx = e.clientX - behavior._lx, dy = e.clientY - behavior._ly;
        behavior.dist += Math.sqrt(dx * dx + dy * dy);
      }
      behavior._lx = e.clientX; behavior._ly = e.clientY;
      behavior.lastTs = now;
      if (!behavior.firstTs) behavior.firstTs = now;
    }
    function onClick() { behavior.clicks++; behavior.lastTs = Date.now(); }
    function onKey() { behavior.keys++; behavior.lastTs = Date.now(); }
    function onScroll() { behavior.scrolls++; behavior.lastTs = Date.now(); }
    function cleanup() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    }
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('click', onClick, { passive: true });
    window.addEventListener('keydown', onKey, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    behavior._cleanup = cleanup;
  }

  function collectBehavior() {
    var span = behavior.lastTs && behavior.firstTs ? (behavior.lastTs - behavior.firstTs) : 0;
    return {
      mouseMoves: behavior.moves,
      clicks: behavior.clicks,
      keys: behavior.keys,
      scrolls: behavior.scrolls,
      activeSpanMs: span,
      // bots: perfectly straight fast lines; humans: jittery. distance/moves ratio hints at it.
      avgMoveDist: behavior.moves > 0 ? +(behavior.dist / behavior.moves).toFixed(2) : 0
    };
  }

  /* ---------- 4. network hints (like NetworkData; IP reputation = server-side) ---------- */

  function collectNetHints() {
    var hints = { online: !!navigator.onLine };
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (c) {
        hints.effectiveType = c.effectiveType || null; // '4g', '3g'...
        hints.downlinkMbps = (typeof c.downlink === 'number') ? c.downlink : null;
        hints.rttMs = (typeof c.rtt === 'number') ? c.rtt : null;
        hints.saveData = !!c.saveData;
      }
    } catch (e) {}
    return hints;
  }

  /* ---------- assemble + send ---------- */

  function getReport() {
    return {
      v: 1,
      sessionId: getSessionId(),
      ts: new Date().toISOString(),
      page: location.pathname,
      device: collectDevice(),
      bot: collectBot(),
      behavior: collectBehavior(),
      net: collectNetHints()
    };
  }

  // Start sampling behaviour as soon as the page is ready; the report is
  // read by app.js at sign-up/sign-in, so early leavers are still covered and
  // no report ever goes out unattributed or without consent.
  var booted = false;
  function boot() {
    if (booted) return; booted = true;
    armBehavior();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else window.addEventListener('DOMContentLoaded', boot);

  // public API: window.FraudGuard.getReport() -> fresh report on demand
  window.FraudGuard = {
    getReport: getReport
  };
})();
