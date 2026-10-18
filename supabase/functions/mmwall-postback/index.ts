import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ALLOWED_IPS = (Deno.env.get("MMWALL_ALLOWED_IPS") ?? "63.32.127.99").split(",").map((s) => s.trim());
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TXN_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const out = (code: number, body: string) =>
  new Response(body, { status: code, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "GET") return out(405, "method not allowed");
  // MM Wall sends no signature: only its fixed server IP is accepted. cf-connecting-ip is set by the edge and cannot be spoofed.
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim();
  const ipHash = ip ? sha256("ip:" + ip.toLowerCase()).slice(0, 32) : "unknown";
  const q = new URL(req.url).searchParams;
  const txn = q.get("transaction_id") ?? "";
  const reject = async (code: number, reason: string) => {
    await db.from("postback_rejects").insert({ ip_hash: ipHash, reason: "mmwall_" + reason, txn: txn.slice(0, 60) });
    return out(code, "rejected");
  };
  if (!ip || !ALLOWED_IPS.includes(ip)) return await reject(403, "ip_not_allowed");

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await db.from("postback_rejects").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since);
  if ((count ?? 0) >= 30) return out(429, "slow down");

  const user = (q.get("user_id") ?? "").toLowerCase();
  const amount = Number(q.get("amount") ?? "0");
  const payout = Number(q.get("payout") ?? "0");
  if (!TXN_RE.test(txn)) return await reject(400, "bad_txn");
  if (!UUID_RE.test(user)) return await reject(400, "bad_user");
  if (!Number.isFinite(amount) || !Number.isFinite(payout) || Math.abs(payout) > 1000 || Math.abs(amount) > 1000000) return await reject(400, "bad_amount");

  const reversal = amount < 0 || payout < 0;
  const pts = Math.abs(Math.trunc(amount));
  const raw = { amount: q.get("amount"), payout: q.get("payout"), subid: q.get("subid"), offerid: q.get("offerid"), ip_hash: ipHash };
  const { data, error } = await db.rpc("apply_offerwall_postback", {
    p_network: "MM Wall",
    p_txn: txn,
    p_type: reversal ? "reversal" : "conversion",
    p_status: reversal ? 2 : 1,
    p_user: user,
    p_usd: Math.abs(payout),
    p_points_override: pts || null,
    p_raw: raw,
  });
  if (error) { console.error("rpc error", error.message); return out(500, "error"); }
  if (data === "unknown_user") return await reject(400, "unknown_user");
  return out(200, "ok");
});
