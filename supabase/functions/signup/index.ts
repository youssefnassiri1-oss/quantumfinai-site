// Sign-up only: verifies the Cloudflare Turnstile human check server-side, then creates the account.
// Sign-in does not need a human check. Direct signups on the auth API are disabled, so this is the only way in.
const URL_ = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "https://quantumfinai.me",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || ""), name = String(b.name || "").trim().slice(0, 100), tk = String(b.token || "");
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) return J({ error: "Check your email address" }, 400);
  if (pw.length < 8 || pw.length > 200) return J({ error: "Password must be at least 8 characters" }, 400);
  if (!name) return J({ error: "Name is required" }, 400);
  const sec = Deno.env.get("TURNSTILE_SECRET");
  if (!sec || !tk) return J({ error: "Please complete the human check first" }, 400);
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const fd = new URLSearchParams({ secret: sec, response: tk });
  if (ip) fd.set("remoteip", ip);
  const v = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd })).json().catch(() => ({}));
  if (!v.success) return J({ error: "The human check expired. Please complete it again and retry." }, 400);
  const r = await fetch(URL_ + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { name } })
  });
  const u = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = String(u.msg || u.message || u.error_description || "");
    if (/already|registered|exists/i.test(m)) return J({ error: "An account with this email already exists. Try signing in." }, 409);
    if (/password/i.test(m)) return J({ error: m }, 400);
    return J({ error: "Could not create the account. Please try again." }, 400);
  }
  // the human check was passed at sign-up
  await fetch(URL_ + "/rest/v1/human_checks", {
    method: "POST",
    headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: u.id, verified_at: new Date().toISOString() })
  }).catch(() => {});
  return J({ ok: true });
});
