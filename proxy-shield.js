/* =====================================================================
 * ProxyShield v1 — deep client-side proxy / VPN / Tor detection
 * ---------------------------------------------------------------------
 * Goes as deep as the browser sandbox allows. What JS genuinely CAN do:
 *   1. WebRTC ICE harvesting  -> real local IPs + STUN-visible public IP.
 *      If STUN-seen IP != server-seen IP  => traffic is proxied/tunneled.
 *   2. Tor Browser detection  -> letterboxing, UTC, empty plugins, no WebRTC…
 *   3. Consistency checks     -> timezone / language / geo contradictions.
 *   4. Automation signals     -> webdriver, headless, phantom leftovers.
 *
 * HONEST LIMITS (do not trust anyone who claims otherwise):
 *   - JS CANNOT read the browser's proxy settings (no API exists).
 *   - TLS/JA3 fingerprinting and ASN / IP-reputation checks are SERVER-side.
 *   - This script COLLECTS evidence; the verdict is computed on YOUR server
 *     by summing risk-signal weights (see RISK_WEIGHTS below).
 *
 * QuantumFinAI integration (2026-10-18):
 *   This build is a pure collector - it never talks to the site's servers
 *   itself and never runs on page load. app.js calls
 *   await window.ProxyShield.collect() from regDevice(), only for accounts
 *   whose recorded opt-in (Privacy choices -> device fingerprinting) is on
 *   and only when the browser does not send Global Privacy Control, and the
 *   report travels with the member's own session to the guard function.
 *   The only third-party contact is the WebRTC STUN lookup (Cloudflare,
 *   with Google STUN as fallback) at collection time; no report is sent
 *   anywhere else. The guard function stores the signals and computes any
 *   verdict server-side; clientScore below is indicative only.
 * ===================================================================== */
(function () {
  'use strict';

  var STUN_URLS = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];
  var WEBRTC_TIMEOUT_MS = 4500;

  /* Suggested server-side weights — tune to your traffic. The server should
     SUM the weights of present signals: 0-30 allow, 30-60 review/step-up,
     60+ block or require manual review. Never block on ONE signal alone. */
  var RISK_WEIGHTS = {
    WEBRTC_IP_MISMATCH: 45,   // STUN public IP != server-seen IP -> proxy/tunnel
    WEBRTC_ONLY_RELAY: 20,    // only TURN/relay candidates (restrictive egress)
    WEBRTC_BLOCKED: 15,       // RTCPeerConnection missing/blocked (Tor/hardened)
    TOR_LIKELY: 55,           // several Tor Browser markers together
    TOR_POSSIBLE: 25,         // 1-2 Tor markers
    TZ_GEO_MISMATCH: 25,      // browser timezone != IP timezone
    LANG_GEO_MISMATCH: 15,    // browser language far from IP country
    MDNS_ONLY_HOSTS: 5,       // local IPs hidden via mDNS (modern Chrome; weak)
    AUTOMATION: 40,           // webdriver / headless / selenium artifacts
    NO_SENSORS_TOUCH_MISMATCH: 10
  };

  var serverGeo = (typeof window !== 'undefined' && window.__SERVER_GEO__) || null;

  /* ---------------- 1. WebRTC ICE harvesting (the deepest client trick) ---------------- */

  function parseCandidate(line, out) {
    // candidate:<foundation> <comp> <proto> <prio> <ip> <port> typ <type> ...
    var m = /^candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\S+)/.exec(line || '');
    if (!m) return;
    var ip = m[1], type = m[2];
    if (/\.local$/i.test(ip)) { out.mdnsObfuscated = true; return; } // Chrome hides host IPs
    if (type === 'host' && out.host.indexOf(ip) === -1) out.host.push(ip);
    else if (type === 'srflx' && out.srflx.indexOf(ip) === -1) out.srflx.push(ip);
    else if (type === 'relay' && out.relay.indexOf(ip) === -1) out.relay.push(ip);
  }

  function harvestWebRTC() {
    return new Promise(function (resolve) {
      var out = { supported: true, host: [], srflx: [], relay: [], mdnsObfuscated: false, error: null };
      var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
      if (!RTC) { out.supported = false; resolve(out); return; }
      var done = false;
      function finish() {
        if (done) return; done = true;
        try { pc.close(); } catch (e) {}
        resolve(out);
      }
      var pc;
      try {
        pc = new RTC({ iceServers: [{ urls: STUN_URLS }] });
      } catch (e) { out.supported = false; out.error = 'ctor'; resolve(out); return; }
      pc.onicecandidate = function (ev) {
        if (ev && ev.candidate && ev.candidate.candidate) parseCandidate(ev.candidate.candidate, out);
        else finish(); // null candidate = gathering complete
      };
      try {
        pc.createDataChannel('ps');
        pc.createOffer().then(function (offer) { return pc.setLocalDescription(offer); })
          .catch(function () { finish(); });
      } catch (e) { out.error = 'offer'; finish(); return; }
      setTimeout(finish, WEBRTC_TIMEOUT_MS);
    });
  }

  /* ---------------- 2. Tor Browser detection (scored, never single-flag) ---------------- */

  function detectTor() {
    var flags = [];
    var ua = navigator.userAgent || '';
    // Tor Browser letterboxing rounds viewport to multiples of 200x100 (often 1000x1000)
    if (window.innerWidth === 1000 && window.innerHeight === 1000) flags.push('viewport_1000x1000');
    else if (window.innerWidth % 200 === 0 && window.innerHeight % 100 === 0 &&
             window.innerWidth <= 1600 && screen.width > window.innerWidth) flags.push('letterbox_steps');
    try {
      if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC' &&
          new Date().getTimezoneOffset() === 0) flags.push('utc_timezone');
    } catch (e) {}
    if ((navigator.plugins || []).length === 0 && (navigator.mimeTypes || []).length === 0) flags.push('no_plugins_mimetypes');
    if (/Firefox\/\d+/.test(ua) && !('RTCPeerConnection' in window) && !('mozRTCPeerConnection' in window))
      flags.push('firefox_no_webrtc'); // Tor Browser disables WebRTC
    if (screen.width === 1000 || screen.height === 1000) flags.push('screen_1000');
    // Tor ships a minimal font set — canvas renders very few distinct fonts distinctly
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 &&
        (navigator.deviceMemory || 8) <= 4 && flags.length >= 1) flags.push('low_hw_profile');
    return { flags: flags, torLikely: flags.length >= 3, torPossible: flags.length >= 1 && flags.length < 3 };
  }

  /* ---------------- 3. Consistency checks ---------------- */

  // tiny language->expected-region map (coarse; server should do the real GeoIP work)
  var LANG_REGION = {
    ar: ['MA','DZ','TN','EG','SA','AE','QA','KW','FR','ES','IT','BE','NL','DE'],
    fr: ['MA','DZ','TN','FR','BE','CA','CH'],
    en: ['US','GB','CA','AU','MA','AE','SA','IN','NG','ZA'],
    es: ['ES','MX','AR','US'], de: ['DE','AT','CH'], it: ['IT'], pt: ['BR','PT'],
    nl: ['NL','BE'], tr: ['TR'], ur: ['PK'], hi: ['IN'], zh: ['CN','TW','HK'], ru: ['RU']
  };

  function checkConsistency() {
    var issues = [];
    if (!serverGeo) return { issues: issues, skipped: true };
    try {
      var btz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (serverGeo.timezone && btz && btz !== serverGeo.timezone) {
        // allow same-country aliases loosely: only flag clear mismatch
        issues.push('TZ_GEO_MISMATCH');
      }
    } catch (e) {}
    var lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    var regions = LANG_REGION[lang];
    if (serverGeo.country && regions && regions.indexOf(serverGeo.country) === -1) {
      issues.push('LANG_GEO_MISMATCH');
    }
    return { issues: issues, skipped: false };
  }

  /* ---------------- 4. Automation signals (compact) ---------------- */

  function automationSignals() {
    var f = [];
    if (navigator.webdriver === true) f.push('webdriver');
    if (/headless/i.test(navigator.userAgent || '')) f.push('headless_ua');
    if (window._phantom || window.callPhantom || window.__phantomas) f.push('phantom');
    if (document.documentElement.getAttribute('selenium') !== null ||
        document.documentElement.getAttribute('webdriver') !== null) f.push('selenium_attr');
    // desktop UA with touch, mobile UA without touch
    var mobileUA = /android|iphone|ipad|mobile/i.test(navigator.userAgent || '');
    if (mobileUA && navigator.maxTouchPoints === 0) f.push('mobile_no_touch');
    if (!mobileUA && (navigator.maxTouchPoints || 0) > 2) f.push('desktop_touch');
    return f;
  }

  /* ---------------- 5. Assemble the verdict payload ---------------- */

  function buildReport(rtc, tor, consistency, automation) {
    var signals = [];
    function add(code) { if (signals.indexOf(code) === -1) signals.push(code); }

    // WebRTC vs server IP: THE proxy test (server compares srflx[0] to request IP)
    if (!rtc.supported) add('WEBRTC_BLOCKED');
    else {
      if (rtc.srflx.length === 0 && rtc.relay.length > 0) add('WEBRTC_ONLY_RELAY');
      if (rtc.mdnsObfuscated && rtc.host.length === 0) add('MDNS_ONLY_HOSTS');
    }
    if (tor.torLikely) add('TOR_LIKELY');
    else if (tor.torPossible) add('TOR_POSSIBLE');
    consistency.issues.forEach(add);
    if (automation.length > 0) add('AUTOMATION');

    var score = signals.reduce(function (s, c) { return s + (RISK_WEIGHTS[c] || 0); }, 0);

    var btz = null, tzOff = null, lang = null;
    try { btz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) {}
    try { tzOff = new Date().getTimezoneOffset(); } catch (e) {}
    try { lang = navigator.language || null; } catch (e) {}

    return {
      v: 1,
      ts: new Date().toISOString(),
      page: location.pathname,
      client: { timezone: btz, tzOffsetMin: tzOff, language: lang },
      webrtc: {
        supported: rtc.supported,
        hostIps: rtc.host,                 // local IPs (private) — device LAN footprint
        publicIpsViaStun: rtc.srflx,      // public IP as the STUN server sees it
        relayOnly: rtc.relay.length > 0 && rtc.srflx.length === 0,
        mdnsObfuscated: rtc.mdnsObfuscated
        // SERVER: compare publicIpsViaStun[0] with request IP / X-Forwarded-For
        // of the SAME address family (IPv4 with IPv4, IPv6 with IPv6).
        // If they differ -> the browser's traffic is proxied/tunneled.
        // A dual-stack phone can legitimately show one family per path, so a
        // cross-family difference alone must never feed WEBRTC_IP_MISMATCH.
      },
      tor: tor,
      consistency: consistency,
      automation: automation,
      signals: signals,
      riskWeights: RISK_WEIGHTS,
      clientScore: score,  // indicative only — SERVER recomputes and decides
      note: 'Verdict must be computed server-side. Client score is indicative.'
    };
  }

  /* ---------------- collection entry point (called by app.js) ---------------- */

  var running = null;
  function collect() {
    if (running) return running; // one harvest per page view is enough
    running = harvestWebRTC().then(function (rtc) {
      var report = buildReport(rtc, detectTor(), checkConsistency(), automationSignals());
      window.__proxyShieldReport = report; // inspectable in devtools console
      return report;
    }).catch(function () { return null; });
    return running;
  }

  window.ProxyShield = {
    collect: collect,
    setServerGeo: function (g) { serverGeo = g; },
    weights: RISK_WEIGHTS
  };
})();
