const U = Deno.env.get("SUPABASE_URL")!, K = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const go = (q: string) => new Response(null, { status: 302, headers: { Location: `https://quantumfinai.me/?verified=${q}` } });
Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!/^[a-f0-9]{64}$/.test(t)) return go("0");
  const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  const r = await (await fetch(`${U}/rest/v1/email_verifications?token_hash=eq.${hash}&expires_at=gte.${new Date().toISOString()}&select=id,user_id`, { headers: H })).json();
  if (!Array.isArray(r) || !r.length) return go("0");
  await fetch(`${U}/rest/v1/email_verified?on_conflict=user_id`, { method: "POST", headers: { ...H, Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ user_id: r[0].user_id }) });
  await fetch(`${U}/rest/v1/email_verifications?user_id=eq.${r[0].user_id}`, { method: "DELETE", headers: H });
  return go("1");
});
