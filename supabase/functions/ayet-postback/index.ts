import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("AYET_POSTBACK_TOKEN") ?? "";
const API_KEY = Deno.env.get("AYET_API_KEY") ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TXN_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
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
    await db.from("postback_rejects").insert({ ip_hash: ipHash, reason: "ayet_" + reason, txn: (txn ?? "").slice(0, 60) });
    return out(code, "rejected");
  };
  if (!TOKEN || !API_KEY) return out(503, "not configured");

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await db.from("postback_rejects").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since);
  if ((count ?? 0) >= 30) return out(429, "slow down");

  const q = new URL(req.url).searchParams;
  // 1. secret token in the callback URL
  if (!safeEq(q.get("k") ?? "", TOKEN)) return await reject(403, "bad_token");
  // 2. HMAC-SHA256 of the alphabetically sorted query string, keyed with the publisher API key
  const sorted = new URLSearchParams([...q.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString();
  const expect = createHmac("sha256", API_KEY).update(sorted).digest("hex");
  const header = req.headers.get("x-ayetstudios-security-hash") ?? "";
  const rawTxn = q.get("transaction_id") ?? "";
  if (!header || !safeEq(header, expect)) return await reject(403, "bad_signature", rawTxn);

  const isChargeback = q.get("is_chargeback") === "1" || rawTxn.startsWith("r-");
  const txn = rawTxn.startsWith("r-") ? rawTxn.slice(2) : rawTxn;
  const user = q.get("external_identifier") ?? "";
  const usd = Math.abs(Number(q.get("payout_usd") ?? "0"));
  if (!TXN_RE.test(txn)) return await reject(400, "bad_txn", rawTxn);
  if (!UUID_RE.test(user)) return await reject(400, "bad_user", txn);
  if (!Number.isFinite(usd) || usd > 1000) return await reject(400, "bad_amount", txn);

  const raw = {
    offer_id: q.get("offer_id"),
    offer_name: (q.get("offer_name") ?? "").slice(0, 120),
    is_chargeback: isChargeback ? 1 : 0,
    transaction_id: rawTxn,
    ip_hash: ipHash,
  };
  const { data, error } = await db.rpc("apply_offerwall_postback", {
    p_network: "ayeT-Studios",
    p_txn: txn,
    p_type: isChargeback ? "reversal" : "conversion",
    p_status: isChargeback ? 2 : 1,
    p_user: user.toLowerCase(),
    p_usd: usd,
    p_points_override: null,
    p_raw: raw,
  });
  if (error) { console.error("rpc error", error.message); return out(500, "error"); }
  if (data === "unknown_user") return await reject(400, "unknown_user", txn);
  return out(200, "ok");
});
