import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = Deno.env.get("CPX_SECURE_HASH") ?? "";
const APP_ID = "37194";
const CORS = {
  "access-control-allow-origin": "https://quantumfinai.me",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "origin",
};
const json = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SECRET) return json(503, { error: "Surveys are not available yet" });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error } = await db.auth.getUser(jwt);
  if (error || !u?.user) return json(401, { error: "Please sign in first" });
  const uid = u.user.id;

  const { data: st } = await db.rpc("user_status", { p_user: uid });
  if (st && st !== "normal") return json(403, { error: "Your account is under review. Surveys are paused until it is cleared." });

  const { data: mins } = await db.from("settings").select("value").eq("key", "human_check_minutes").maybeSingle();
  const win = Number(mins?.value ?? 30) || 30;
  const { data: hc } = await db.from("human_checks").select("verified_at").eq("user_id", uid).maybeSingle();
  if (!hc || Date.now() - new Date(hc.verified_at).getTime() > win * 60000) return json(403, { error: "Please complete the human check first" });

  const hash = createHash("md5").update(`${uid}-${SECRET}`).digest("hex");
  const url = `https://offers.cpx-research.com/index.php?app_id=${APP_ID}&ext_user_id=${uid}&secure_hash=${hash}`;
  return json(200, { url });
});
