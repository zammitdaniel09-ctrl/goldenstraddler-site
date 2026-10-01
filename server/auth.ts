import { createHmac, randomBytes } from "node:crypto";
import { all, audit, now, one, run } from "./db";
import { DAY, E, code32, cookie, newId, safeEq, sha256, token } from "./util";

// ---------------------------------------------------------------- TOTP (RFC 6238, SHA1, 6 digits, 30 s)
const A32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function b32decode(s: string) {
  const out: number[] = []; let bits = 0, v = 0;
  for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { v = ((v << 5) | A32.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { bits -= 8; out.push((v >> bits) & 255); } }
  return Buffer.from(out);
}
export function b32encode(buf: Buffer) {
  let bits = 0, v = 0, out = "";
  for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += A32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += A32[(v << (5 - bits)) & 31];
  return out;
}
export const newTotpSecret = () => b32encode(randomBytes(20));
function hotp(key: Buffer, c: number) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(c));
  const h = createHmac("sha1", key).update(b).digest(), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
// returns the matched time step (for replay protection) or 0
export function totpStep(secret: string, code: string, lastStep: number) {
  if (!/^\d{6}$/.test(code)) return 0;
  const key = b32decode(secret), s = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) if (s + d > lastStep && safeEq(hotp(key, s + d), code)) return s + d;
  return 0;
}
export const otpauthUri = (secret: string, label: string) =>
  `otpauth://totp/${encodeURIComponent("GoldenStraddler Admin:" + label)}?secret=${secret}&issuer=${encodeURIComponent("GoldenStraddler Admin")}&digits=6&period=30`;

// ---------------------------------------------------------------- sessions
export type Kind = "admin" | "customer";
const COOKIE: Record<Kind, string> = { admin: "gs_a", customer: "gs_c" };
const LIFE: Record<Kind, number> = { admin: 12 * 3_600_000, customer: 30 * DAY };
export function startSession(kind: Kind, subject: string) {
  const t = token(32);
  run("INSERT INTO sessions (hash, kind, subject, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", sha256(t), kind, subject, now() + LIFE[kind], now());
  return `${COOKIE[kind]}=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(LIFE[kind] / 1000)}`;
}
export function sessionOf(req: Request, kind: Kind): string | null {
  const t = cookie(req, COOKIE[kind]);
  if (!t) return null;
  const r = one<{ subject: string; expires_at: number }>("SELECT subject, expires_at FROM sessions WHERE hash = ? AND kind = ?", sha256(t), kind);
  return r && r.expires_at > now() ? r.subject : null;
}
export function endSession(req: Request, kind: Kind) {
  const t = cookie(req, COOKIE[kind]);
  if (t) run("DELETE FROM sessions WHERE hash = ?", sha256(t));
  return `${COOKIE[kind]}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export const endAllSessions = (kind: Kind, subject: string) => run("DELETE FROM sessions WHERE kind = ? AND subject = ?", kind, subject);
setInterval(() => run("DELETE FROM sessions WHERE expires_at < ?", now()), 3_600_000);

// ---------------------------------------------------------------- admins
export type Admin = { id: string; email: string; name: string; role: string; totp_secret: string; active: number; last_step: number; last_login: number | null; created_at: number };
export function bootstrapOwner() {
  if (one("SELECT id FROM admins LIMIT 1")) return;
  const email = (E.OWNER_EMAIL || "").trim().toLowerCase(), secret = (E.OWNER_TOTP_SECRET || "").trim();
  if (!email || secret.replace(/[^A-Z2-7]/gi, "").length < 16) { console.log("admin: set OWNER_EMAIL and OWNER_TOTP_SECRET to create the owner account"); return; }
  run("INSERT INTO admins (id, email, name, role, totp_secret, created_at) VALUES (?, ?, ?, 'owner', ?, ?)", newId("adm"), email, E.OWNER_NAME || "Owner", secret, now());
  audit("system", "owner created", email);
  console.log("admin: owner account created for " + email);
}
export function adminLogin(email: string, code: string): Admin | null {
  const a = one<Admin>("SELECT * FROM admins WHERE email = ? AND active = 1", email.toLowerCase());
  if (!a) { totpStep(newTotpSecret(), code, 0); return null; } // same work either way
  const step = totpStep(a.totp_secret, code, a.last_step);
  if (!step) return null;
  run("UPDATE admins SET last_step = ?, last_login = ? WHERE id = ?", step, now(), a.id);
  return a;
}
export function adminOf(req: Request): Admin | null {
  const id = sessionOf(req, "admin");
  return id ? one<Admin>("SELECT * FROM admins WHERE id = ? AND active = 1", id) : null;
}

// ---------------------------------------------------------------- customer email codes
export function newLoginCode(email: string) {
  const c = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  run("INSERT INTO login_codes (email, code_hash, expires_at, tries) VALUES (?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0",
    email, sha256(email + ":" + c), now() + 10 * 60_000);
  return c;
}
export function checkLoginCode(email: string, code: string) {
  const r = one<{ code_hash: string; expires_at: number; tries: number }>("SELECT * FROM login_codes WHERE email = ?", email);
  if (!r || r.expires_at < now() || r.tries >= 5) return false;
  if (!safeEq(r.code_hash, sha256(email + ":" + code))) { run("UPDATE login_codes SET tries = tries + 1 WHERE email = ?", email); return false; }
  run("DELETE FROM login_codes WHERE email = ?", email);
  return true;
}
export { code32, all };
