// Sign-up only: verifies the Cloudflare Turnstile human check server-side, then creates the account.
// Sign-in does not need a human check. Direct signups on the auth API are disabled, so this is the only way in.
// Upfront blocks: VPN/proxy/datacenter connections, same-device duplicate accounts and already-registered emails
// are refused with their own clear messages.
const URL_ = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "https://quantumfinai.me",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const H = { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" };
const rest = async (p: string, m = "GET", b?: unknown, extra: Record<string, string> = {}) => {
  const r = await fetch(URL_ + "/rest/v1/" + p, { method: m, headers: { ...H, ...extra }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
// Same IP reputation source as the guard function: Scamalytics first, proxycheck.io fallback,
// cached for 7 days in ip_checks so repeat visitors do not burn API quota.
async function ipReputation(ip: string) {
  const ih = await sha(ip + "qf-salt");
  const c = await rest(`ip_checks?select=*&ip_hash=eq.${ih}&checked_at=gte.${new Date(Date.now() - 7 * 864e5).toISOString()}`);
  if (c && c.length) return { ...c[0], ih };
  let proxy = false, kind: string | null = null, score: number | null = null, source = "none";
  const su = Deno.env.get("SCAMALYTICS_USER"), sk = Deno.env.get("SCAMALYTICS_KEY");
  try {
    if (su && sk) {
      const r = await fetch(`https://api11.scamalytics.com/v3/${encodeURIComponent(su)}?key=${encodeURIComponent(sk)}&ip=${encodeURIComponent(ip)}`);
      const j = await r.json();
      const s = j?.scamalytics;
      if (s && s.status === "ok") {
        score = Number(s.scamalytics_score);
        source = "scamalytics";
        const ex = j.external_datasources || {};
        const f = (o: any) => o && (o.ip_is_proxy === true || o.proxy === true || o.is_proxy === true || o.vpn === true || o.tor === true);
        const sp = s.scamalytics_proxy || {};
        const fl = [...Object.entries(ex).filter(([, o]) => f(o)).map(([k]) => "ext:" + k), ...["is_vpn", "is_datacenter", "is_resproxy"].filter((k) => sp[k] === true).map((k) => k.slice(3))];
        proxy = fl.length > 0;
        kind = fl.join(",").slice(0, 80) || null;
      }
    }
  } catch (_) {}
  if (source === "none" || score === null) {
    try {
      const pk = Deno.env.get("PROXYCHECK_KEY");
      const r = await fetch(`https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&risk=1&asn=1${pk ? `&key=${pk}` : ""}`);
      const j = await r.json();
      const d = j && j[ip];
      if (d) {
        proxy = d.proxy === "yes";
        kind = d.type || null;
        score = typeof d.risk === "number" ? d.risk : Number(d.risk ?? 0);
        source = "proxycheck";
      }
    } catch (_) {}
  }
  if (source !== "none") await rest("ip_checks", "POST", { ip_hash: ih, proxy, kind, score, source, checked_at: new Date().toISOString() }, { Prefer: "resolution=merge-duplicates" });
  return { ih, proxy, kind, score, source };
}

// ---- Refusal log: reason code, time, hashed IP, hashed device ID, a salted hash of the attempted email, and
// a short detail (provider, score, flags, browser timezone). No raw IP, email, name or password.
// Deleted after 90 days by the daily privacy cleanup. A logging error never changes the response.
// Email hash = sha256(secret salt + lowercase trimmed email), same formula as the SQL function refusals_for_email().
let SALT: string | null = null;
async function emailHash(em: string) {
  if (!em) return null;
  if (!SALT) { const r = await rest("refusal_salt?select=salt&id=eq.1"); SALT = (r && r[0] && r[0].salt) || null; }
  return SALT ? await sha(SALT + em) : null;
}
async function refuseBase(req: Request, em: string, reason: string, status: number, body: unknown, detail = "", dh = "") {
  try {
    const ipRaw = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    await rest("signup_refusals", "POST", { reason, http_status: status, detail: detail.slice(0, 200) || null, ip_hash: ipRaw ? await sha(ipRaw + "qf-salt") : null, device_hash: /^[0-9a-f]{8,128}$/.test(dh) ? dh : null, email_hash: await emailHash(em) });
  } catch (_) {}
  return J(body, status);
}

// ---- Same-device duplicate check (explicit one-time opt-in box on the sign-up form) ----
const DUP_MSG = "This device has already been used to create an account on QuantumFinAI. Each person can have one account. If you share this device or network with family, email youssef@quantumfinai.me and we will review it.";
const HEX = /^[0-9a-f]{8,128}$/;
async function hwHash(fp: any) {
  if (!fp || !fp.gpu || fp.cores === undefined || fp.cores === null) return null;
  return await sha(JSON.stringify([fp.screen ?? "", fp.tz ?? "", fp.cores ?? null, fp.mem ?? null, fp.gpu ?? "", fp.platform ?? ""]));
}
// Strong match: the same browser storage ID. Medium match: same network AND same browser/hardware signature.
// Any lookup error fails open (the request is allowed) so a database hiccup never blocks real members.
async function deviceDuplicate(dh: string, fh: string | null, hw: string | null, iph: string | null) {
  try {
    const arr = (x: unknown) => (Array.isArray(x) ? x : []);
    if (arr(await rest(`signup_devices?select=user_id&device_hash=eq.${dh}&limit=1`)).length) return true;
    if (arr(await rest(`devices?select=user_id&device_hash=eq.${dh}&limit=1`)).length) return true;
    if (!iph) return false;
    const conds = [fh ? `fp_hash.eq.${fh}` : "", hw ? `hw_hash.eq.${hw}` : ""].filter(Boolean);
    if (conds.length && arr(await rest(`signup_devices?select=user_id&ip_hash=eq.${iph}&or=(${conds.join(",")})&limit=1`)).length) return true;
    if (fh && arr(await rest(`fraud_reports?select=user_id&ip_hash=eq.${iph}&fingerprint_hash=eq.${fh}&limit=1`)).length) return true;
    if (hw) {
      for (const d of arr(await rest(`devices?select=fp&ip_hash=eq.${iph}&limit=50`))) {
        if (await hwHash(d.fp) === hw) return true;
      }
    }
  } catch (_) {}
  return false;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  const em0 = String(b.email || "").trim().toLowerCase().slice(0, 200);
  const refuse = (r: Request, reason: string, status: number, body: unknown, detail = "", dh = "") =>
    refuseBase(r, em0, reason, status, body, [detail, `tz=${String(b?.fp?.tz || "?").slice(0, 40)}`].filter(Boolean).join(" "), dh);
  const KNOWN_POLICY_VERSIONS = ["2026-10-15", "2026-10-18"];
  if (b.consent !== true || !KNOWN_POLICY_VERSIONS.includes(String(b.policy_version || ""))) return await refuse(req, "terms_not_accepted", 400, { error: "Please agree to the current Terms of Service and acknowledge the Privacy Policy" }, b.consent === true ? "policy_version" : "no_consent");
  const email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || ""), name = String(b.name || "").trim().slice(0, 100), tk = String(b.token || "");
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) return J({ error: "Check your email address" }, 400);
  if (pw.length < 8 || pw.length > 200) return J({ error: "Password must be at least 8 characters" }, 400);
  if (!name) return J({ error: "Name is required" }, 400);
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  // Upfront network block, before the human check is consumed: VPN, proxy, Tor and hosting/datacenter IPs.
  // If every reputation provider is unreachable the request is allowed through (fail-open); the
  // authenticated guard function still scores the IP after sign-up in that case.
  if (ip) {
    const rep = await ipReputation(ip);
    if (rep.proxy === true) {
      return await refuse(req, "vpn_proxy", 403, { error: "Accounts cannot be created from a VPN, proxy or hosting network. Please switch it off and try again from your normal connection." }, `${rep.source || ""} score ${rep.score ?? "?"} flags ${rep.kind || "none"}`);
    }
  }
  // One-time device check: required, opt-in box ticked on the form. Nothing is stored for refused attempts.
  const dh = String(b.device_hash || "").toLowerCase(), fhRaw = String(b.fingerprint_hash || "").toLowerCase();
  if (b.device_check !== true) return await refuse(req, "device_check_not_ticked", 400, { error: "Please allow the one-time device check. It is required to create an account (one account per person)." });
  if (!HEX.test(dh)) return await refuse(req, "device_check_failed", 400, { error: "The device check did not run. Please reload the page and try again." });
  const fh = HEX.test(fhRaw) ? fhRaw : null;
  const fpIn = b.fp && typeof b.fp === "object" ? b.fp : {};
  const fp = { screen: String(fpIn.screen ?? "").slice(0, 20), tz: String(fpIn.tz ?? "").slice(0, 60), cores: Number.isFinite(fpIn.cores) ? Number(fpIn.cores) : null, mem: Number.isFinite(fpIn.mem) ? Number(fpIn.mem) : null, gpu: String(fpIn.gpu ?? "").slice(0, 120), platform: String(fpIn.platform ?? "").slice(0, 40) };
  const hw = await hwHash(fp);
  const iph = ip ? await sha(ip + "qf-salt") : null;
  if (await deviceDuplicate(dh, fh, hw, iph)) return await refuse(req, "device_duplicate", 403, { error: DUP_MSG, code: "device_duplicate" }, "", dh);
  const sec = Deno.env.get("TURNSTILE_SECRET");
  if (!sec || !tk) return J({ error: "Please complete the human check first" }, 400);
  const fd = new URLSearchParams({ secret: sec, response: tk });
  if (ip) fd.set("remoteip", ip);
  const v = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd })).json().catch(() => ({}));
  if (!v.success) return await refuse(req, "human_check_failed", 400, { error: "The human check expired. Please complete it again and retry." }, "", dh);
  const r = await fetch(URL_ + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: pw,
      email_confirm: true,
      user_metadata: { name },
      app_metadata: { consent: { terms_accepted: true, privacy_acknowledged: true, policy_version: String(b.policy_version), device_check: true, accepted_at: new Date().toISOString() } }
    })
  });
  const u = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = String(u.msg || u.message || u.error_description || "");
    if (/already|registered|exists/i.test(m)) return await refuse(req, "email_already_registered", 409, { error: "An account with this email already exists. Try signing in instead." }, "", dh);
    if (/password/i.test(m)) return J({ error: m }, 400);
    return J({ error: "Could not create the account. Please try again." }, 400);
  }
  // Record the sign-up device check. The unique index on device_hash also settles two simultaneous sign-ups
  // from one browser: the loser's fresh account is removed and refused.
  const dr = await fetch(URL_ + "/rest/v1/signup_devices", { method: "POST", headers: H, body: JSON.stringify({ user_id: u.id, device_hash: dh, fp_hash: fh, hw_hash: hw, ip_hash: iph }) }).catch(() => null);
  if (dr && dr.status === 409) {
    await fetch(URL_ + "/auth/v1/admin/users/" + u.id, { method: "DELETE", headers: H }).catch(() => null);
    return await refuse(req, "device_duplicate", 403, { error: DUP_MSG, code: "device_duplicate" }, "simultaneous", dh);
  }
  // Mirror the opt-in in the member's privacy choices so the existing guard checks apply to the account.
  await fetch(URL_ + "/rest/v1/privacy_choices?on_conflict=user_id", { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: u.id, fingerprinting: true, partners: {}, gpc: false, version: "2026-10-18" }) }).catch(() => null);
  // Record the passed human check and sign the user in server-side, in parallel,
  // so the browser skips a second cross-region round trip right after sign-up.
  const [tr] = await Promise.all([
    fetch(URL_ + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: SRK, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pw })
    }),
    fetch(URL_ + "/rest/v1/human_checks", {
      method: "POST",
      headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id: u.id, verified_at: new Date().toISOString() })
    }).catch(() => null)
  ]);
  const td = await tr.json().catch(() => ({}));
  if (tr.ok && td.access_token) return J({ ok: true, session: td });
  return J({ ok: true });
});
