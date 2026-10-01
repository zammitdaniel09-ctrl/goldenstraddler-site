import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { one, run, DB_PATH } from "./db";

export const E = Bun.env;
export const DAY = 86_400_000;

// ---------------------------------------------------------------- ids and keys
const B32 = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no I, L, O, U, 0, 1
export function token(n = 32) { return randomBytes(n).toString("base64url"); }
export function code32(len: number) {
  const b = randomBytes(len); let s = "";
  for (let i = 0; i < len; i++) s += B32[b[i] % B32.length];
  return s;
}
export const newId = (p: string) => p + "_" + code32(12).toLowerCase();
export const newOrderId = () => "GS-" + code32(6);
export const newLicenceKey = () => ["GS", code32(4), code32(4), code32(4), code32(4)].join("-");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmacHex = (alg: string, key: string | Buffer, msg: string) => createHmac(alg, key).update(msg).digest("hex");
export function safeEq(a: string, b: string) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}

// ---------------------------------------------------------------- app secret (encrypts stored API keys)
function appKey(): Buffer {
  let s = (E.APP_SECRET || "").trim();
  if (!s) {
    const f = join(DB_PATH, "..", "app_secret.txt");
    if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString("hex"), { mode: 0o600 });
    s = readFileSync(f, "utf8").trim();
  }
  return createHash("sha256").update(s).digest();
}
const AK = appKey();
export function seal(plain: string) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", AK, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function unseal(box: string) {
  if (!box.startsWith("v1:")) return box;
  const b = Buffer.from(box.slice(3), "base64"), d = createDecipheriv("aes-256-gcm", AK, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------- settings
export const SECRET_KEYS = new Set(["stripe_secret", "stripe_webhook_secret", "np_api_key", "np_ipn_secret", "resend_key"]);
export const DEFAULTS: Record<string, string> = {
  price_lifetime: "149900", price_monthly: "27900", currency: "eur",
  site_url: E.SITE_URL || "https://goldenstraddler.com",
  mail_from: "GoldenStraddler <support@goldenstraddler.com>", support_email: "support@goldenstraddler.com",
  notify_emails: "",
  bank_name: "", bank_holder: "", bank_iban: "", bank_bic: "",
  seller_name: "", seller_address: "", seller_vat: "", seller_reg: "",
  record_url: E.RECORD_URL || "https://goldenstraddler.up.railway.app/api/public",
  record_public: "0", record_min_trades: "20",
  stripe_tax: "0", methods_card: "1", methods_crypto: "1", methods_bank: "1",
  refund_days: "7", move_days: "30", ea_version: "3.00", announcement: "",
  promo_code: "GOLD999",
};
const cache = new Map<string, string>();
export function getS(k: string): string {
  if (cache.has(k)) return cache.get(k)!;
  const r = one<{ value: string }>("SELECT value FROM settings WHERE key = ?", k);
  let v = r ? r.value : (DEFAULTS[k] ?? "");
  if (r && SECRET_KEYS.has(k)) { try { v = unseal(v); } catch { v = ""; } }
  // environment variables win for secrets so they can be set on Railway as well
  const env = (E[k.toUpperCase()] || "").trim();
  if (SECRET_KEYS.has(k) && env) v = env;
  cache.set(k, v);
  return v;
}
export function setS(k: string, v: string) {
  const stored = SECRET_KEYS.has(k) && v ? seal(v) : v;
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, stored);
  cache.delete(k);
}
export const getN = (k: string) => Number(getS(k)) || 0;
export const siteUrl = () => getS("site_url").replace(/\/+$/, "");

// ---------------------------------------------------------------- http helpers
export const SEC_H = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY" };
export const json = (code: number, obj: any, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC_H, ...extra } });
export const bad = (msg: string, code = 400) => json(code, { ok: false, error: msg });
export async function body(req: Request, max = 1 << 20): Promise<any> {
  const raw = (await req.text()).replace(/\u0000+$/, "");
  if (raw.length > max) throw Object.assign(new Error("Request too large"), { code: 413 });
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Invalid JSON"), { code: 400 }); }
}
export function cookie(req: Request, name: string) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([A-Za-z0-9_-]{16,})"));
  return m ? m[1] : "";
}
export const setCookie = (name: string, val: string, maxAgeSec: number, path = "/") =>
  `${name}=${val}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
export const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
export const str = (v: any, n = 200) => (v === undefined || v === null ? "" : String(v)).slice(0, n).trim();
export const emailOk = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(e);
export const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const euros = (cents: number) => "€" + (cents / 100).toLocaleString("en-IE", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- rate limits (in memory)
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, ms: number, add = true) {
  const t = Date.now(), a = (hits.get(key) || []).filter((x) => x > t - ms);
  if (add) a.push(t);
  hits.set(key, a);
  return a.length > max;
}
setInterval(() => { const t = Date.now(); for (const [k, a] of hits) if (!a.length || a[a.length - 1] < t - DAY) hits.delete(k); }, 3_600_000);
