import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash, timingSafeEqual } from "node:crypto";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = Deno.env.get("PUBSCALE_SECRET") ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TXN_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a.toLowerCase()), y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
};
const out = (code: number, body: string) =>
  new Response(body, { status: code, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "GET") return out(405, "method not allowed");
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().toLowerCase();
  const ipHash = ip ? sha256("ip:" + ip).slice(0, 32) : "unknown";
  const reject = async (code: number, reason: string, txn?: string) => {
    await db.from("postback_rejects").insert({ ip_hash: ipHash, reason: "pubscale_" + reason, txn: (txn ?? "").slice(0, 60) });
    return out(code, "rejected");
  };
  if (!SECRET) return out(503, "not configured");

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await db.from("postback_rejects").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since);
  if ((count ?? 0) >= 30) return out(429, "slow down");

  const q = new URL(req.url).searchParams;
  const userRaw = q.get("user_id") ?? "";
  const user = userRaw.toLowerCase();
  const txn = q.get("token") ?? "";
  const valueRaw = q.get("value") ?? "";
  const value = Number(valueRaw);
  const sig = q.get("signature") ?? "";
  // PubScale signature: MD5(secret + "." + user_id + "." + int(value) + "." + token)
  const expect = md5(`${SECRET}.${userRaw}.${Math.trunc(value)}.${txn}`);
  if (!sig || !safeEq(sig, expect)) return await reject(403, "bad_signature", txn);

  if (!TXN_RE.test(txn)) return await reject(400, "bad_txn", txn);
  if (!UUID_RE.test(user)) return await reject(400, "bad_user", txn);
  const pts = Math.abs(Math.trunc(value));
  if (!Number.isFinite(value) || pts <= 0 || pts > 1000000) return await reject(400, "bad_amount", txn);
  const isChargeback = (q.get("chargeback") ?? "") === "1" || value < 0;
  const usd = Math.abs(Number(q.get("payout_usd") ?? "0")) || pts / 1000;

  const raw = { token: txn, value: valueRaw, payout_usd: q.get("payout_usd"), offer_name: q.get("offer_name"), goal_name: q.get("goal_name"), country: q.get("country"), chargeback: isChargeback, ip_hash: ipHash };
  const { data, error } = await db.rpc("apply_offerwall_postback", {
    p_network: "PubScale",
    p_txn: txn,
    p_type: "conversion",
    p_status: isChargeback ? 2 : 1,
    p_user: user,
    p_usd: usd,
    p_points_override: pts,
    p_raw: raw,
  });
  if (error) { console.error("rpc error", error.message); return out(500, "error"); }
  if (data === "unknown_user") return await reject(400, "unknown_user", txn);
  return out(200, "ok");
});
