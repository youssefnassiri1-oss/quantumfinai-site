// Sign-up only: verifies the Cloudflare Turnstile human check server-side, then creates the account.
// Sign-in does not need a human check. Direct signups on the auth API are disabled, so this is the only way in.
// Upfront blocks: VPN/proxy/datacenter connections and already-registered emails are refused with clear messages.
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
        proxy = Object.values(ex).some(f) || sp.is_vpn === true || sp.is_datacenter === true || sp.is_resproxy === true;
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  const KNOWN_POLICY_VERSIONS = ["2026-10-15", "2026-10-18"];
  if (b.consent !== true || !KNOWN_POLICY_VERSIONS.includes(String(b.policy_version || ""))) return J({ error: "Please agree to the current Terms of Service and acknowledge the Privacy Policy" }, 400);
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
      return J({ error: "Accounts cannot be created from a VPN, proxy or hosting network. Please switch it off and try again from your normal connection." }, 403);
    }
  }
  const sec = Deno.env.get("TURNSTILE_SECRET");
  if (!sec || !tk) return J({ error: "Please complete the human check first" }, 400);
  const fd = new URLSearchParams({ secret: sec, response: tk });
  if (ip) fd.set("remoteip", ip);
  const v = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd })).json().catch(() => ({}));
  if (!v.success) return J({ error: "The human check expired. Please complete it again and retry." }, 400);
  const r = await fetch(URL_ + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: pw,
      email_confirm: true,
      user_metadata: { name },
      app_metadata: { consent: { terms_accepted: true, privacy_acknowledged: true, policy_version: String(b.policy_version), accepted_at: new Date().toISOString() } }
    })
  });
  const u = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = String(u.msg || u.message || u.error_description || "");
    if (/already|registered|exists/i.test(m)) return J({ error: "An account with this email already exists. Try signing in instead." }, 409);
    if (/password/i.test(m)) return J({ error: m }, 400);
    return J({ error: "Could not create the account. Please try again." }, 400);
  }
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
