const enc = new TextEncoder(), dec = new TextDecoder();
async function smtp(user: string, pass: string, to: string, subject: string, text: string, html: string) {
  const c = await Deno.connectTls({ hostname: "smtp.zoho.com", port: 465 });
  let buf = "";
  const read = async (): Promise<string> => {
    for (;;) {
      const lines = buf.split("\r\n");
      if (lines.length > 1) {
        const last = lines.filter((l) => l.length >= 4);
        const done = last.find((l, i) => l[3] === " " && i === last.length - 1);
        if (done && buf.endsWith("\r\n")) { const r = buf; buf = ""; return r; }
      }
      const b = new Uint8Array(4096); const n = await c.read(b); if (n === null) throw new Error("closed");
      buf += dec.decode(b.subarray(0, n));
    }
  };
  const cmd = async (s: string, ok: string) => { await c.write(enc.encode(s + "\r\n")); const r = await read(); if (!r.startsWith(ok)) throw new Error("smtp " + r.slice(0, 3)); };
  const b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
  const b = "qf" + crypto.randomUUID().replaceAll("-", "");
  const r0 = await read(); if (!r0.startsWith("220")) throw new Error("greet");
  await cmd("EHLO quantumfinai.me", "250");
  await cmd("AUTH LOGIN", "334"); await cmd(b64(user), "334"); await cmd(b64(pass), "235");
  await cmd("MAIL FROM:<youssef@quantumfinai.me>", "250"); await cmd("RCPT TO:<" + to + ">", "250"); await cmd("DATA", "354");
  const msg = ["From: QuantumFinAI <youssef@quantumfinai.me>", "To: " + to, "Subject: " + subject, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${b}"`, "", `--${b}`, 'Content-Type: text/plain; charset=utf-8', "", text, `--${b}`, 'Content-Type: text/html; charset=utf-8', "", html, `--${b}--`].join("\r\n").replace(/\r\n\./g, "\r\n..");
  await cmd(msg + "\r\n.", "250"); try { await c.write(enc.encode("QUIT\r\n")); } catch (_e) { /* ignore */ } c.close();
}
const U = Deno.env.get("SUPABASE_URL")!, K = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "https://quantumfinai.me", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return out({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
  const ur = await fetch(`${U}/auth/v1/user`, { headers: { apikey: K, Authorization: `Bearer ${jwt}` } });
  if (!ur.ok) return out({ error: "sign in required" }, 401);
  const user = await ur.json();
  if (!user.id || !user.email) return out({ error: "sign in required" }, 401);
  const v = await (await fetch(`${U}/rest/v1/email_verified?user_id=eq.${user.id}&select=user_id`, { headers: H })).json();
  if (v.length) return out({ verified: true });
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await (await fetch(`${U}/rest/v1/email_verifications?user_id=eq.${user.id}&created_at=gte.${since}&select=id`, { headers: H })).json();
  if (recent.length >= 3) return out({ error: "Too many emails. Try again in an hour." }, 429);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = hex(raw.buffer);
  const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  const ins = await fetch(`${U}/rest/v1/email_verifications`, { method: "POST", headers: H, body: JSON.stringify({ user_id: user.id, token_hash: hash, expires_at: new Date(Date.now() + 86400_000).toISOString() }) });
  if (!ins.ok) return out({ error: "failed" }, 500);
  const link = `${U}/functions/v1/verify-email?t=${token}`;
  try {
    await smtp(Deno.env.get("ZOHO_SMTP_USER")!, Deno.env.get("ZOHO_SMTP_PASS")!, user.email, "Confirm your email for QuantumFinAI", `Confirm your email address for QuantumFinAI:\n${link}\n\nThis is optional. Your account works without it. The link expires in 24 hours. If you did not create an account, ignore this email.`, `<p>Confirm your email address for QuantumFinAI:</p><p><a href="${link}">Confirm my email</a></p><p style="color:#666">This is optional. Your account works without it. The link expires in 24 hours. If you did not create an account, ignore this email.</p>`);
  } catch (e) { console.log("smtp fail", String((e as Error).message).slice(0, 40)); return out({ error: "Could not send the email right now." }, 502); }
  return out({ sent: true });
});
