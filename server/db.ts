// SQLite storage (bun:sqlite) on the Railway volume.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DIR = (Bun.env.DATA_DIR || Bun.env.RAILWAY_VOLUME_MOUNT_PATH || "./data").trim();
mkdirSync(DIR, { recursive: true });
export const DB_PATH = join(DIR, "goldenstraddler.db");
export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT DEFAULT '', created_at INTEGER NOT NULL,
  stripe_customer TEXT DEFAULT '', notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS licences (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES customers(id),
  plan TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER, source TEXT NOT NULL,
  account TEXT DEFAULT '', account_server TEXT DEFAULT '', account_name TEXT DEFAULT '', account_demo INTEGER DEFAULT 0,
  bound_at INTEGER, last_move_at INTEGER, last_seen INTEGER, ea_build TEXT DEFAULT '',
  stripe_sub TEXT DEFAULT '', refundable_until INTEGER, note TEXT DEFAULT '', reminded_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS licences_customer ON licences(customer_id);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), email TEXT NOT NULL, plan TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'new', licence_id TEXT, method TEXT NOT NULL, status TEXT NOT NULL,
  list_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'eur', code TEXT DEFAULT '',
  provider_ref TEXT DEFAULT '', payment_ref TEXT DEFAULT '', consent_at INTEGER, ip TEXT DEFAULT '', country TEXT DEFAULT '',
  created_at INTEGER NOT NULL, paid_at INTEGER, refunded_at INTEGER, note TEXT DEFAULT '', claim_hash TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_provider ON orders(provider_ref);
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY, kind TEXT NOT NULL, value INTEGER NOT NULL, plans TEXT NOT NULL DEFAULT 'lifetime,monthly',
  monthly_duration TEXT NOT NULL DEFAULT 'once', max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1, note TEXT DEFAULT '', stripe_coupon TEXT DEFAULT '', created_by TEXT DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, totp_secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, last_step INTEGER NOT NULL DEFAULT 0, last_login INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS feeds (
  licence_id TEXT PRIMARY KEY, status TEXT, status_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
  symbol TEXT DEFAULT '', magic TEXT DEFAULT '', currency TEXT DEFAULT 'USD'
);
CREATE TABLE IF NOT EXISTS trades (
  licence_id TEXT NOT NULL, id TEXT NOT NULL, side TEXT NOT NULL, open_time TEXT, close_time TEXT,
  volume REAL, open_price REAL, close_price REAL, points REAL, gross REAL, commission REAL, swap REAL, fee REAL, net REAL,
  PRIMARY KEY (licence_id, id)
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT DEFAULT '', detail TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, name TEXT DEFAULT '', email TEXT NOT NULL, topic TEXT DEFAULT '',
  message TEXT NOT NULL, customer_id TEXT DEFAULT '', handled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events ( id TEXT PRIMARY KEY, at INTEGER NOT NULL );
`);

export const now = () => Date.now();
export const one = <T = any>(sql: string, ...p: any[]) => db.query(sql).get(...p) as T | null;
export const all = <T = any>(sql: string, ...p: any[]) => db.query(sql).all(...p) as T[];
export const run = (sql: string, ...p: any[]) => db.query(sql).run(...p);

// idempotency for payment webhooks
export function seenEvent(id: string) {
  if (one("SELECT id FROM events WHERE id = ?", id)) return true;
  run("INSERT INTO events (id, at) VALUES (?, ?)", id, now());
  return false;
}

export function audit(actor: string, action: string, target = "", detail = "") {
  run("INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)", now(), actor, action, target, detail.slice(0, 2000));
}

// consistent online backup (VACUUM INTO) used by the admin export
export function backupTo(path: string) { db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`); }
