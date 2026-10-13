import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash, timingSafeEqual } from "node:crypto";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("CPX_POSTBACK_TOKEN") ?? "";
const SECRET = Deno.env.get("CPX_SECURE_HASH") ?? "";
const IPS = (Deno.env.get("CPX_ALLOWED_IPS") ?? "188.40.3.73,2a01:4f8:d0a:30ff::2,157.90.97.92").split(",").map((s) => s.trim().toLowerCase());
const db = createClient(URL_, SRK, { auth: { persistSession: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TXN = /^[A-Za-z0-9_.:-]{1,120}$/;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
function eq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const out = (code: number, body: string) => new Response(body, { status: code, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "GET") return out(405, "method not allowed");
  const xff = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().toLowerCase();
  const ipHash = xff ? sha("ip:" + xff).slice(0, 32) : "unknown";
  const reject = async (code: number, reason: string, txn?: string) => {
    await db.from("postback_rejects").insert({ ip_hash: ipHash, reason, txn: (txn ?? "").slice(0, 60) });
    return out(code, "rejected");
  };
  if (!TOKEN || !SECRET) return out(503, "not configured");

  // rate limit on repeated rejects from one source
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await db.from("postback_rejects").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since);
  if ((count ?? 0) >= 30) return out(429, "slow down");

  const u = new URL(req.url);
  const q = u.searchParams;
  // 1 source allowlist
  if (!IPS.includes(xff)) return await reject(403, "ip_not_allowed");
  // 2 secret in URL
  if (!eq(q.get("k") ?? "", TOKEN)) return await reject(403, "bad_token");
  const txn = q.get("trans_id") ?? "";
  if (!TXN.test(txn)) return await reject(400, "bad_txn");
  // 3 signature: md5(trans_id-secure_hash)
  if (!eq((q.get("hash") ?? "").toLowerCase(), md5(`${txn}-${SECRET}`))) return await reject(403, "bad_signature", txn);
  // 4 validate fields
  const user = q.get("user_id") ?? "";
  const status = Number(q.get("status"));
  const type = (q.get("type") ?? "complete").toLowerCase();
  const usd = Number(q.get("amount_usd") ?? "0");
  const local = Number(q.get("amount_local") ?? "0");
  if (!UUID.test(user)) return await reject(400, "bad_user", txn);
  if (![1, 2].includes(status)) return await reject(400, "bad_status", txn);
  if (!Number.isFinite(usd) || usd < 0 || usd > 1000 || !Number.isFinite(local) || local < 0) return await reject(400, "bad_amount", txn);
  if (!["complete", "bonus", "out"].includes(type)) return await reject(400, "bad_type", txn);
  if (type === "out") return out(200, "ok");

  const raw = { status, type, trans_id: txn, offer_id: q.get("offer_id"), subid_1: (q.get("sub_id") ?? "").slice(0, 60), ip_hash: ipHash };
  const { data, error } = await db.rpc("cpx_apply_postback", { p_txn: txn, p_type: type, p_status: status, p_user: user.toLowerCase(), p_usd: usd, p_local: local, p_raw: raw });
  if (error) { console.error("rpc", error.message); return out(500, "error"); }
  if (data === "unknown_user") return await reject(400, "unknown_user", txn);
  return out(200, "ok");
});
