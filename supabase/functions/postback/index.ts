import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GLOBAL_TOKEN = Deno.env.get("POSTBACK_TOKEN") ?? Deno.env.get("CPX_POSTBACK_TOKEN") ?? "";

const db = createClient(URL_, SRK, { auth: { persistSession: false } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TXN_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const hmacSha1 = (key: string, s: string) => createHmac("sha1", key).update(s).digest("hex");

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase()), y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}


function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function exactEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
// TheoremReach: HMAC-SHA1 over the full callback URL without the trailing hash parameter, base64url, no padding.
function trSigOk(reqUrl: string, hash: string): boolean {
  const secret = Deno.env.get("THEOREMREACH_SECRET") ?? "";
  if (!secret || !hash) return false;
  const base = reqUrl.replace(/[?&]hash=[^&]*$/, "");
  const bases = new Set<string>([base, base.replace(/^http:/, "https:")]);
  for (const b of [...bases]) {
    const p = new URL(b);
    if (!p.pathname.startsWith("/functions/v1/")) { p.pathname = "/functions/v1" + p.pathname; bases.add(p.toString()); }
  }
  for (const b of bases) {
    if (exactEq(hash, b64url(createHmac("sha1", secret).update(b).digest()))) return true;
  }
  return false;
}

const out = (code: number, body: string) =>
  new Response(body, { status: code, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

interface NormalizedPostback {
  partnerName: string;
  txn: string;
  user: string;
  status: 1 | 2; // 1 = credit, 2 = reversal/chargeback
  usd: number;
  points: number | null;
  sigOk: boolean;
}

function parseNetwork(net: string, u: URL): NormalizedPostback | null {
  const q = u.searchParams;

  if (net === "cpx") {
    const secret = Deno.env.get("CPX_SECURE_HASH") ?? "";
    const txn = q.get("trans_id") ?? "";
    const hash = q.get("hash") ?? "";
    const sigOk = !!secret && safeEq(hash, md5(`${txn}-${secret}`));
    return {
      partnerName: "CPX Research",
      txn,
      user: q.get("user_id") ?? "",
      status: Number(q.get("status")) === 2 ? 2 : 1,
      usd: Number(q.get("amount_usd") ?? "0"),
      points: Number(q.get("amount_local") ?? "0") || null,
      sigOk,
    };
  }

  if (net === "timewall") {
    const secret = Deno.env.get("TIMEWALL_SECRET") ?? "";
    const user = q.get("userID") ?? "";
    const revenue = q.get("revenue") ?? "0";
    const type = (q.get("type") ?? "credit").toLowerCase();
    const hash = q.get("hash") ?? "";
    // TimeWall signature: SHA256(userID + revenue + secret)
    const sigOk = !!secret && safeEq(hash, sha256(`${user}${revenue}${secret}`));
    return {
      partnerName: "TimeWall",
      txn: q.get("transactionID") ?? "",
      user,
      status: type === "chargeback" ? 2 : 1,
      usd: Math.abs(Number(revenue)),
      points: Math.abs(Number(q.get("currencyAmount") ?? "0")) || null,
      sigOk,
    };
  }

  if (net === "torox") {
    const secret = Deno.env.get("TOROX_SECRET") ?? "";
    const oid = q.get("oid") ?? "";
    const uid = q.get("uid") ?? "";
    const sig = q.get("sig") ?? "";
    // Torox signature: MD5(oid + "-" + uid + "-" + secret)
    const sigOk = !!secret && safeEq(sig, md5(`${oid}-${uid}-${secret}`));
    const amt = Number(q.get("amount") ?? "0");
    return {
      partnerName: "Torox",
      txn: q.get("id") ?? "",
      user: uid,
      status: amt < 0 ? 2 : 1,
      usd: Math.abs(Number(q.get("payout") ?? "0")),
      points: Math.abs(amt) || null,
      sigOk,
    };
  }

  if (net === "wannads") {
    const secret = Deno.env.get("WANNADS_SECRET") ?? "";
    const user = q.get("user_id") ?? "";
    const txn = q.get("transaction_id") ?? "";
    const reward = q.get("reward") ?? "";
    const sig = q.get("signature") ?? "";
    // Wannads signature: MD5(user_id + transaction_id + reward + SECRET)
    const sigOk = !!secret && safeEq(sig, md5(`${user}${txn}${reward}${secret}`));
    const st = (q.get("status") ?? "credited").toLowerCase();
    const rw = Number(reward);
    return {
      partnerName: "Wannads",
      txn,
      user,
      status: st === "rejected" || rw < 0 ? 2 : 1,
      usd: Math.abs(Number(q.get("payout") ?? "0")),
      points: Math.abs(rw) || null,
      sigOk,
    };
  }

  if (net === "pubscale") {
    const secret = Deno.env.get("PUBSCALE_SECRET") ?? "";
    const user = q.get("user_id") ?? "";
    const txn = q.get("token") ?? "";
    const value = Number(q.get("value") ?? "0");
    const sig = q.get("signature") ?? "";
    // PubScale signature: MD5(secret.user_id.int(value).token)
    const sigOk = !!secret && !!sig && safeEq(sig, md5(`${secret}.${user}.${Math.trunc(value)}.${txn}`));
    return {
      partnerName: "PubScale",
      txn,
      user,
      status: 1,
      usd: Math.abs(Number(q.get("payout_usd") ?? "0")),
      points: Math.abs(Math.trunc(value)) || null,
      sigOk,
    };
  }

  if (net === "mobivortex") {
    const secret = Deno.env.get("MOBIVORTEX_SECRET") ?? "";
    const user = q.get("identity_id") ?? "";
    const txn = q.get("txid") ?? "";
    const camp = q.get("campaign_id") ?? "";
    const hash = q.get("hash") ?? "";
    // VortexWall hash: SHA256(identity_id + campaign_id + txid + SECRET)
    const sigOk = !!secret && !!hash && safeEq(hash, sha256(`${user}${camp}${txn}${secret}`));
    const pts = Number(q.get("points") ?? "0");
    const rejected = (q.get("result") ?? "completed").toLowerCase() === "rejected" || pts < 0;
    return {
      partnerName: "MobiVortex",
      txn,
      user,
      status: rejected ? 2 : 1,
      usd: Math.abs(Number(q.get("payout") ?? "0")),
      points: Math.abs(Math.trunc(pts)) || null,
      sigOk,
    };
  }

  if (net === "bitlabs") {
    const secret = Deno.env.get("BITLABS_SECRET") ?? "";
    const hash = q.get("hash") ?? "";
    // Verify URL without &hash=... using HMAC-SHA1
    const rawUrl = u.href.replace(/([?&])hash=[^&]+/, "");
    const sigOk = !!secret && safeEq(hash, hmacSha1(secret, rawUrl));
    const type = (q.get("type") ?? "COMPLETE").toUpperCase();
    return {
      partnerName: "BitLabs",
      txn: q.get("tx") ?? "",
      user: q.get("uid") ?? "",
      status: type === "RECONCILIATION" ? 2 : 1,
      usd: Math.abs(Number(q.get("raw") ?? "0")),
      points: Math.abs(Number(q.get("val") ?? "0")) || null,
      sigOk,
    };
  }

  if (net === "theoremreach") {
    const reward = Math.abs(Math.trunc(Number(q.get("reward") ?? "0")));
    return {
      partnerName: "TheoremReach",
      txn: q.get("tx_id") ?? "",
      user: q.get("user_id") ?? "",
      status: (q.get("reversal") ?? "").toLowerCase() === "true" ? 2 : 1,
      usd: Math.abs(Number(q.get("currency") ?? "0")),
      points: reward || null,
      sigOk: trSigOk(u.toString().replace(/^http:/, "https:"), q.get("hash") ?? ""),
    };
  }

  return null;
}

async function trEventWebhook(req: Request): Promise<Response> {
  const u = new URL(req.url);
  if ((u.searchParams.get("net") ?? "").toLowerCase() !== "theoremreach_event") return out(405, "method not allowed");
  const xff = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().toLowerCase();
  const ipHash = xff ? sha256("ip:" + xff).slice(0, 32) : "unknown";
  const rej = async (code: number, reason: string) => {
    await db.from("postback_rejects").insert({ ip_hash: ipHash, reason, txn: "" });
    return out(code, "rejected");
  };
  if (!trSigOk(u.toString().replace(/^http:/, "https:"), u.searchParams.get("hash") ?? "")) return await rej(403, "bad_signature");
  const body = await req.json().catch(() => null) as any;
  const d = body?.data ?? body;
  if (!d || typeof d !== "object") return await rej(400, "bad_body");
  if (d.event_type !== "reversal") return out(200, "ok"); // bans are not credited or reversed here
  const user = String(d.user_id ?? "").toLowerCase();
  if (!UUID_RE.test(user)) return await rej(400, "bad_user");
  const list = Array.isArray(d.reversed_transactions) ? d.reversed_transactions.slice(0, 50) : [];
  for (const t of list) {
    const txn = String(t?.transaction_id ?? "");
    if (!TXN_RE.test(txn)) continue;
    const usd = Math.abs(Number(t?.amount_in_dollars ?? "0"));
    const pts = Math.abs(Math.trunc(Number(t?.amount_in_currency ?? "0")));
    if (!Number.isFinite(usd) || usd > 1000) continue;
    const { error } = await db.rpc("apply_offerwall_postback", {
      p_network: "TheoremReach", p_txn: txn, p_type: "reversal", p_status: 2, p_user: user,
      p_usd: usd, p_points_override: pts || null, p_raw: { event: "reversal", ip_hash: ipHash }, p_offer_name: null, p_started_at: null,
    });
    if (error) { console.error("rpc error", error.message); return out(500, "error"); }
  }
  return out(200, "ok");
}

Deno.serve(async (req) => {
  if (req.method === "POST") return await trEventWebhook(req);
  if (req.method !== "GET") return out(405, "method not allowed");
  const xff = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().toLowerCase();
  const ipHash = xff ? sha256("ip:" + xff).slice(0, 32) : "unknown";

  const reject = async (code: number, reason: string, txn?: string) => {
    await db.from("postback_rejects").insert({ ip_hash: ipHash, reason, txn: (txn ?? "").slice(0, 60) });
    return out(code, "rejected");
  };

  if (!GLOBAL_TOKEN) return out(503, "not configured");

  // Rate limit repeated rejects from same IP
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await db.from("postback_rejects").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since);
  if ((count ?? 0) >= 30) return out(429, "slow down");

  const u = new URL(req.url);
  const q = u.searchParams;

  // 1. Check secret URL token
  // PubScale and MobiVortex cannot carry the custom token; they are authenticated by their mandatory signature only.
  if ((q.get("net") ?? "").toLowerCase() !== "pubscale" && (q.get("net") ?? "").toLowerCase() !== "mobivortex" && (q.get("net") ?? "").toLowerCase() !== "theoremreach" && !safeEq(q.get("k") ?? "", GLOBAL_TOKEN)) return await reject(403, "bad_token");

  // 2. Parse network adapter
  const net = (q.get("net") ?? "cpx").toLowerCase();
  const parsed = parseNetwork(net, u);
  if (!parsed) return await reject(400, "unknown_network");

  // TheoremReach debug/test callbacks must never credit anyone.
  if (net === "theoremreach" && (q.get("debug") ?? "").toLowerCase() === "true") return out(200, "ok");

  // Optional IP allowlist for CPX
  if (net === "cpx") {
    const cpxIps = (Deno.env.get("CPX_ALLOWED_IPS") ?? "188.40.3.73,2a01:4f8:d0a:30ff::2,157.90.97.92")
      .split(",").map(s => s.trim().toLowerCase());
    if (!cpxIps.includes(xff)) return await reject(403, "ip_not_allowed", parsed.txn);
  }

  if (!TXN_RE.test(parsed.txn)) return await reject(400, "bad_txn");
  if (!parsed.sigOk) return await reject(403, "bad_signature", parsed.txn);
  if (!UUID_RE.test(parsed.user)) return await reject(400, "bad_user", parsed.txn);
  if (!Number.isFinite(parsed.usd) || parsed.usd < 0 || parsed.usd > 1000) return await reject(400, "bad_amount", parsed.txn);

  const raw = Object.fromEntries(q.entries());
  delete raw.k;
  delete raw.hash;
  delete raw.sig;
  delete raw.signature;

  const { data, error } = await db.rpc("apply_offerwall_postback", {
    p_network: parsed.partnerName,
    p_txn: parsed.txn,
    p_type: parsed.status === 2 ? "reversal" : "conversion",
    p_status: parsed.status,
    p_user: parsed.user.toLowerCase(),
    p_usd: parsed.usd,
    p_points_override: parsed.points,
    p_raw: { ...raw, ip_hash: ipHash },
    p_offer_name: (q.get("offer_name") || q.get("campaign_name") || q.get("offer") || "").slice(0, 120) || null,
    p_started_at: null,
  });

  if (error) {
    console.error("rpc error", error.message);
    return out(500, "error");
  }
  if (data === "unknown_user") return await reject(400, "unknown_user", parsed.txn);
  return out(200, "ok");
});

