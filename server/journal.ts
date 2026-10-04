/*
 * GoldenStraddler Journal: storage, access, imports, the MT5 connector and the journal API.
 * Every query is scoped to the signed-in customer. Statistics live in web/js/jstats.js, shared with the browser.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, audit, db, DB_PATH, now, one, run } from "./db";
import { DAY, bad, getN, getS, json, limited, newId, sha256, str, token } from "./util";
import { effective, type Customer, type Licence } from "./licence";

db.exec(`
CREATE TABLE IF NOT EXISTS j_accounts (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, broker TEXT DEFAULT '', platform TEXT DEFAULT 'mt5', currency TEXT DEFAULT 'USD',
  login TEXT DEFAULT '', server TEXT DEFAULT '', demo INTEGER DEFAULT 0, source TEXT DEFAULT 'import', time_mode TEXT DEFAULT 'mt4ny',
  balance_start REAL DEFAULT 0, token_hash TEXT DEFAULT '', token_hint TEXT DEFAULT '', last_sync INTEGER, balance REAL, equity REAL,
  archived INTEGER DEFAULT 0, ref TEXT DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS j_accounts_c ON j_accounts(customer_id);
CREATE INDEX IF NOT EXISTS j_accounts_t ON j_accounts(token_hash);
CREATE TABLE IF NOT EXISTS j_trades (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, account_id TEXT NOT NULL, ext_id TEXT NOT NULL, symbol TEXT NOT NULL, side INTEGER NOT NULL,
  volume REAL, open_time INTEGER NOT NULL, close_time INTEGER NOT NULL, open_price REAL, close_price REAL, sl REAL, tp REAL,
  commission REAL DEFAULT 0, swap REAL DEFAULT 0, fee REAL DEFAULT 0, gross REAL DEFAULT 0, net REAL DEFAULT 0, mae REAL, mfe REAL,
  magic TEXT DEFAULT '', comment TEXT DEFAULT '', note TEXT DEFAULT '', rating INTEGER, playbook_id TEXT, checks TEXT DEFAULT '[]',
  risk REAL, tags TEXT DEFAULT '[]', media TEXT DEFAULT '[]', reviewed INTEGER DEFAULT 0, source TEXT DEFAULT 'import',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (account_id, ext_id)
);
CREATE INDEX IF NOT EXISTS j_trades_c ON j_trades(customer_id, close_time);
CREATE TABLE IF NOT EXISTS j_tags ( id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom', color TEXT DEFAULT '', created_at INTEGER NOT NULL );
CREATE INDEX IF NOT EXISTS j_tags_c ON j_tags(customer_id);
CREATE TABLE IF NOT EXISTS j_playbooks (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', rules TEXT DEFAULT '[]', color TEXT DEFAULT '',
  archived INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS j_days (
  customer_id TEXT NOT NULL, day TEXT NOT NULL, plan TEXT DEFAULT '', review TEXT DEFAULT '', lessons TEXT DEFAULT '', mood INTEGER, focus INTEGER, grade INTEGER,
  media TEXT DEFAULT '[]', updated_at INTEGER NOT NULL, PRIMARY KEY (customer_id, day)
);
CREATE TABLE IF NOT EXISTS j_media ( id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, name TEXT DEFAULT '', created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS j_prefs ( customer_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS j_ai (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, kind TEXT NOT NULL, thread TEXT DEFAULT '', role TEXT DEFAULT '', title TEXT DEFAULT '', content TEXT NOT NULL,
  scope TEXT DEFAULT '{}', credits INTEGER DEFAULT 0, cost_micro INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS j_ai_c ON j_ai(customer_id, created_at);
`);
// releases: the public calendar (cid '') for everyone, and each customer's own from their MT5 connector (seen only by them)
if (all<any>("PRAGMA table_info(j_events)").some((c) => c.name === "t") && !all<any>("PRAGMA table_info(j_events)").some((c) => c.name === "cid")) db.exec("DROP TABLE j_events");
db.exec("CREATE TABLE IF NOT EXISTS j_events ( t INTEGER NOT NULL, c TEXT NOT NULL, n TEXT NOT NULL, cid TEXT NOT NULL DEFAULT '', PRIMARY KEY (t, c, n, cid) )");
// price bars around each trade, sent by the MT5 connector: the per-trade chart and replay
db.exec(`CREATE TABLE IF NOT EXISTS j_bars ( trade_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, tf INTEGER NOT NULL, t0 INTEGER NOT NULL, base REAL NOT NULL, pt REAL NOT NULL,
  data TEXT NOT NULL, ct INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL ); CREATE INDEX IF NOT EXISTS j_bars_c ON j_bars(customer_id, ct);`);
// accounts gained prop-firm style limits after the first release of this table
if (!all<any>("PRAGMA table_info(j_accounts)").some((c) => c.name === "limits")) db.exec("ALTER TABLE j_accounts ADD COLUMN limits TEXT DEFAULT '{}'");
// an account can be shared as a public results page at /j/<share>
if (!all<any>("PRAGMA table_info(j_accounts)").some((c) => c.name === "share")) { db.exec("ALTER TABLE j_accounts ADD COLUMN share TEXT DEFAULT ''"); db.exec("ALTER TABLE j_accounts ADD COLUMN share_opts TEXT DEFAULT '{}'"); }
db.exec("CREATE INDEX IF NOT EXISTS j_accounts_s ON j_accounts(share)");

const MEDIA_DIR = join(DB_PATH, "..", "journal-media");
mkdirSync(MEDIA_DIR, { recursive: true });
const J = (x: any) => { try { return JSON.parse(x); } catch { return null; } };
const num = (v: any) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/\s+/g, "").replace(/,(?=\d{3}(\D|$))/g, "")); return Number.isFinite(n) ? n : null; };

// ---------------------------------------------------------------- who can use it
// Anyone with an active GoldenStraddler licence gets the journal included; the journal plan sells it on its own.
export function journalAccess(c: Customer | null) {
  if (!c) return { ok: false, why: "signin" as const };
  const ls = all<Licence>("SELECT * FROM licences WHERE customer_id = ?", c.id);
  const live = ls.filter((l) => effective(l) === "active");
  if (!live.length) return { ok: false, why: ls.length ? ("expired" as const) : ("none" as const) };
  const viaJournal = live.every((l) => (l.plan as string) === "journal");
  const exp = live.some((l) => !l.expires_at) ? null : Math.max(...live.map((l) => l.expires_at || 0));
  return { ok: true, why: "ok" as const, plan: viaJournal ? "journal" : "included", expires: exp };
}
export const journalOpen = () => getS("journal_public") === "1";

// ---------------------------------------------------------------- AI credits, counted per calendar month
export function aiUsage(cid: string) {
  const d = new Date(), from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const used = one<{ n: number }>("SELECT COALESCE(SUM(credits), 0) n FROM j_ai WHERE customer_id = ? AND created_at >= ?", cid, from)!.n;
  const cap = Math.max(0, getN("journal_ai_credits") || 100);
  return { used, cap, left: Math.max(0, cap - used), resets: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

// ---------------------------------------------------------------- preferences
const PREF_DEFAULTS = { tz: "UTC", dayStart: 0, currency: "USD", be: 0, rules: { maxDailyLoss: null, maxTrades: null, maxRisk: null, requireStop: false, stopAfterLosses: null, hours: "", revengeMin: 15 }, goals: { monthly: null, weekly: null }, onboarded: false };
export function prefsOf(cid: string) {
  const r = one<{ data: string }>("SELECT data FROM j_prefs WHERE customer_id = ?", cid);
  const p = { ...PREF_DEFAULTS, ...(r ? J(r.data) || {} : {}) };
  p.rules = { ...PREF_DEFAULTS.rules, ...(p.rules || {}) }; p.goals = { ...PREF_DEFAULTS.goals, ...(p.goals || {}) };
  return p;
}
function setPrefs(cid: string, b: any) {
  const p = prefsOf(cid), n = (v: any, lo: number, hi: number) => { const x = num(v); return x === null ? null : Math.max(lo, Math.min(hi, x)); };
  if (b.tz !== undefined) { try { new Intl.DateTimeFormat("en", { timeZone: str(b.tz, 64) }); p.tz = str(b.tz, 64); } catch {} }
  if (b.dayStart !== undefined) p.dayStart = n(b.dayStart, 0, 23) ?? 0;
  if (b.currency !== undefined && /^[A-Z]{3}$/.test(str(b.currency, 3))) p.currency = str(b.currency, 3);
  if (b.be !== undefined) p.be = n(b.be, 0, 1e6) ?? 0;
  if (b.rules && typeof b.rules === "object") {
    const r = b.rules;
    p.rules = { maxDailyLoss: n(r.maxDailyLoss, 0, 1e9), maxTrades: n(r.maxTrades, 0, 1000), maxRisk: n(r.maxRisk, 0, 1e9), requireStop: !!r.requireStop,
      stopAfterLosses: n(r.stopAfterLosses, 0, 50), hours: /^\d\d:\d\d-\d\d:\d\d$/.test(str(r.hours, 11)) ? str(r.hours, 11) : "", revengeMin: n(r.revengeMin, 0, 1440) };
  }
  if (b.goals && typeof b.goals === "object") p.goals = { monthly: n(b.goals.monthly, -1e9, 1e9), weekly: n(b.goals.weekly, -1e9, 1e9) };
  if (b.onboarded !== undefined) p.onboarded = !!b.onboarded;
  run("INSERT INTO j_prefs (customer_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(customer_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", cid, JSON.stringify(p), now());
  return p;
}

// ---------------------------------------------------------------- broker time to UTC
// Most MT4/MT5 brokers run their server clock at GMT+2, or GMT+3 while US daylight saving is on (so the day ends at 17:00 New York).
function usDst(ms: number) {
  const d = new Date(ms), y = d.getUTCFullYear();
  const nth = (m: number, n: number) => { const f = new Date(Date.UTC(y, m, 1)); const off = (7 - f.getUTCDay()) % 7; return Date.UTC(y, m, 1 + off + (n - 1) * 7); };
  const start = nth(2, 2) + 7 * 3600000, end = nth(10, 1) + 6 * 3600000;   // 2am local, second Sunday of March to first Sunday of November
  return ms >= start && ms < end;
}
export function toUtc(localMs: number, mode: string) {
  if (!Number.isFinite(localMs)) return NaN;
  if (mode === "utc") return localMs;
  const m = /^fixed:([+-]?\d{1,4})$/.exec(mode || "");
  if (m) return localMs - Number(m[1]) * 60000;
  const guess = localMs - 3 * 3600000;                                       // "mt4ny": GMT+3 in US summer, GMT+2 otherwise
  return localMs - (usDst(guess) ? 3 : 2) * 3600000;
}
// "2026.10.01 01:45:01", "2026-10-01T01:45", "01/10/2026 01:45", unix seconds or ms; read as wall-clock time
export function parseTime(v: any, dayFirst = true): number {
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  if (/^\d{9,10}(\.\d+)?$/.test(s)) return Number(s) * 1000;
  if (/^\d{12,13}$/.test(s)) return Number(s);
  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (m[7]) { if (m[7] === "Z") return t; const z = m[7].replace(":", ""); return t - (Number(z.slice(0, 3)) * 60 + Math.sign(Number(z.slice(0, 3)) || 1) * Number(z.slice(3))) * 60000; }
    return t;
  }
  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(s);
  if (m) {
    let [a, b] = [+m[1], +m[2]]; if (!dayFirst || b > 12) [a, b] = [b, a];
    let y = +m[3]; if (y < 100) y += 2000;
    let h = +(m[4] || 0); if (m[7]) { const pm = m[7].toUpperCase() === "PM"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return Date.UTC(y, b - 1, a, h, +(m[5] || 0), +(m[6] || 0));
  }
  const t = Date.parse(s); return Number.isFinite(t) ? t : NaN;
}

// ---------------------------------------------------------------- high-impact releases, kept so trades can be matched to the news around them
const MAJORS = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"]);
const putEvent = db.query("INSERT OR IGNORE INTO j_events (t, c, n, cid) VALUES (?, ?, ?, ?)");
// ForexFactory's weekly list, as fetched for the EA: keep the high-impact ones
export function archiveEvents(list: any[]) {
  let n = 0;
  db.transaction(() => {
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || e.impact !== "High" || !MAJORS.has(e.country) || typeof e.date !== "string" || /T00:00:00/.test(e.date)) continue;
      const t = Date.parse(e.date); if (!Number.isFinite(t)) continue;
      putEvent.run(t, e.country, str(e.title, 80), ""); n++;
    }
  })();
  return n;
}
export const eventsBetween = (cid: string, from: number, to: number) => all<{ t: number; c: string; n: string }>(
  "SELECT DISTINCT t, c, n FROM j_events WHERE t >= ? AND t <= ? AND (cid = '' OR cid = ?) ORDER BY t LIMIT 30000", from, to, cid);
function eventsFor(cid: string, trades: any[]) {
  if (!trades.length) return [];
  let lo = Infinity, hi = -Infinity; for (const t of trades) { if (t.ot < lo) lo = t.ot; if (t.ot > hi) hi = t.ot; }
  return eventsBetween(cid, lo - DAY, hi + DAY);
}

// ---------------------------------------------------------------- imports: MT5 and MT4 reports (HTML) and any CSV
type Row = { ext: string; symbol: string; side: number; volume: number | null; ot: number; ct: number; op: number | null; cp: number | null; sl: number | null; tp: number | null;
  commission: number; swap: number; fee: number; gross: number; net: number; magic?: string; comment?: string; mae?: number | null; mfe?: number | null };
const ALIASES: Record<string, string[]> = {
  ext: ["position", "position id", "position_id", "ticket", "order", "id", "trade id", "trade #", "deal", "#"],
  symbol: ["symbol", "item", "instrument", "market", "pair", "ticker", "asset", "contract"],
  side: ["type", "side", "direction", "action", "buy/sell", "b/s", "long/short"],
  volume: ["volume", "size", "lots", "lot", "quantity", "qty", "amount", "units"],
  ot: ["open time", "opened", "entry time", "time open", "open date", "date opened", "entry date", "open_time", "opening time", "time"],
  ct: ["close time", "closed", "exit time", "time close", "close date", "date closed", "exit date", "close_time", "closing time"],
  op: ["open price", "entry price", "price open", "entry", "open_price", "opening price", "avg entry", "price"],
  cp: ["close price", "exit price", "price close", "exit", "close_price", "closing price", "avg exit"],
  sl: ["s / l", "s/l", "sl", "stop loss", "stop", "stoploss", "initial stop"],
  tp: ["t / p", "t/p", "tp", "take profit", "target", "takeprofit"],
  commission: ["commission", "commissions", "comm", "fees", "fee commission"],
  swap: ["swap", "swaps", "rollover", "financing", "overnight"],
  fee: ["fee", "taxes", "tax", "other fees"],
  gross: ["profit", "gross", "gross p&l", "gross pnl", "p/l", "pl", "pnl", "p&l", "realized", "realized p&l", "result"],
  net: ["net", "net profit", "net p&l", "net pnl", "net_profit", "total"],
  magic: ["magic", "magic number", "expert"],
  comment: ["comment", "comments", "note"],
};
const norm = (h: string) => h.toLowerCase().replace(/\u00a0/g, " ").replace(/\s+/g, " ").replace(/[()]/g, "").trim();
function mapHeader(hdr: string[]) {
  const idx: Record<string, number> = {}, seen: Record<string, number> = {};
  const H = hdr.map(norm);
  // a repeated "time" or "price" column means open then close (MT4/MT5 layout)
  H.forEach((h, i) => {
    const c = (seen[h] = (seen[h] || 0) + 1);
    if ((h === "time" || h === "price") && c === 2) { idx[h === "time" ? "ct" : "cp"] ??= i; return; }
    for (const [k, al] of Object.entries(ALIASES)) if (idx[k] === undefined && al.includes(h)) { idx[k] = i; break; }
  });
  // "time" alone is the open time only when there's no other open-time column
  return idx;
}
function sideOf(v: any): number | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^(buy|long|b|0|bought|buy limit|buy stop)$/.test(s) || s.startsWith("buy")) return 1;
  if (/^(sell|short|s|1|sold|sell limit|sell stop)$/.test(s) || s.startsWith("sell")) return -1;
  return null;
}
function rowsFromGrid(grid: string[][], mode: string, dayFirst: boolean) {
  const out: Row[] = [], errors: string[] = [];
  // find the header: the first row that names a symbol, a side and either profit or a price
  let h = -1, idx: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 400); i++) {
    const m = mapHeader(grid[i]);
    if (m.symbol !== undefined && m.side !== undefined && (m.gross !== undefined || m.net !== undefined) && (m.ot !== undefined || m.ct !== undefined)) { h = i; idx = m; break; }
  }
  if (h < 0) return { rows: out, errors: ["Couldn't find the header row. The file needs columns for symbol, type (buy or sell), time and profit."], header: [] as string[] };
  const g = (r: string[], k: string) => (idx[k] === undefined ? "" : r[idx[k]] ?? "");
  let n = 0;
  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i]; if (!r || r.length < 4) { if (out.length) break; else continue; }
    const first = norm(r[0] || "");
    if (["orders", "deals", "working orders", "open positions", "open trades:", "summary", "results"].includes(first) && out.length) break;
    const side = sideOf(g(r, "side")), sym = str(g(r, "symbol"), 24).toUpperCase();
    if (side === null || !sym) continue;                                        // balance, credit and deposit rows
    n++;
    const ot = parseTime(g(r, "ot"), dayFirst), ct = parseTime(g(r, "ct"), dayFirst);
    const otU = toUtc(Number.isFinite(ot) ? ot : ct, mode), ctU = toUtc(Number.isFinite(ct) ? ct : ot, mode);
    if (!Number.isFinite(otU) || !Number.isFinite(ctU)) { if (errors.length < 8) errors.push(`Row ${i + 1}: couldn't read the time.`); continue; }
    const vol = num(String(g(r, "volume")).split("/")[0]);
    const comm = num(g(r, "commission")) || 0, swap = num(g(r, "swap")) || 0, fee = num(g(r, "fee")) || 0;
    let gross = num(g(r, "gross")), net = num(g(r, "net"));
    if (gross === null && net === null) { if (errors.length < 8) errors.push(`Row ${i + 1}: no profit.`); continue; }
    if (net === null) net = (gross || 0) + comm + swap + fee;
    if (gross === null) gross = net - comm - swap - fee;
    const op = num(g(r, "op")), cp = num(g(r, "cp"));
    const ext = str(g(r, "ext"), 40) || `${sym}-${side}-${otU}-${ctU}-${vol}-${op}`;
    out.push({ ext, symbol: sym, side, volume: vol, ot: Math.min(otU, ctU), ct: Math.max(otU, ctU), op, cp, sl: num(g(r, "sl")) || null, tp: num(g(r, "tp")) || null,
      commission: comm, swap, fee, gross, net, magic: str(g(r, "magic"), 24), comment: str(g(r, "comment"), 120) });
  }
  if (!out.length && !errors.length) errors.push(n ? "No closed trades could be read." : "No trades found under the header row.");
  return { rows: out, errors, header: grid[h] };
}
// tables in an HTML report, with colspan expanded so columns line up
function htmlGrid(html: string) {
  const grid: string[][] = [];
  const clean = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row: string[] = [];
    for (const td of tr[1].matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      const span = Math.min(20, Number((/colspan\s*=\s*"?(\d+)/i.exec(td[2]) || [])[1] || 1));
      const hidden = /class\s*=\s*"?[^">]*hidden/i.test(td[2]);
      const v = clean(td[3]);
      row.push(hidden ? "" : v); for (let k = 1; k < span; k++) row.push("");
    }
    if (row.length) grid.push(row);
  }
  return grid;
}
function csvGrid(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const sample = lines.slice(0, 5).join("\n"), delim = [",", ";", "\t", "|"].map((d) => [d, sample.split(d).length] as [string, number]).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  for (const line of lines) {
    const cells: string[] = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === delim) { cells.push(cur.trim()); cur = ""; } else cur += ch;
    }
    cells.push(cur.trim()); out.push(cells);
  }
  // European files write decimals with commas when the delimiter is a semicolon
  if (delim === ";") for (const r of out) for (let i = 0; i < r.length; i++) if (/^-?\d+,\d+$/.test(r[i])) r[i] = r[i].replace(",", ".");
  return out;
}
export function parseImport(text: string, name: string, mode: string, dayFirst = true) {
  const isHtml = /<table[\s>]/i.test(text.slice(0, 200000)) || /\.html?$/i.test(name);
  const grid = isHtml ? htmlGrid(text) : csvGrid(text);
  const fmt = isHtml ? (/Trade History Report|Positions/i.test(text) ? "MetaTrader 5 report" : /Closed Transactions|Statement/i.test(text) ? "MetaTrader 4 statement" : "HTML table") : "CSV";
  const r = rowsFromGrid(grid, mode, dayFirst);
  return { format: fmt, ...r };
}

// ---------------------------------------------------------------- trades in and out
const upsert = db.query(`INSERT INTO j_trades (id, customer_id, account_id, ext_id, symbol, side, volume, open_time, close_time, open_price, close_price, sl, tp,
  commission, swap, fee, gross, net, mae, mfe, magic, comment, source, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id, ext_id) DO UPDATE SET symbol = excluded.symbol, side = excluded.side, volume = excluded.volume, open_time = excluded.open_time, close_time = excluded.close_time,
  open_price = excluded.open_price, close_price = excluded.close_price, sl = COALESCE(excluded.sl, j_trades.sl), tp = COALESCE(excluded.tp, j_trades.tp),
  commission = excluded.commission, swap = excluded.swap, fee = excluded.fee, gross = excluded.gross, net = excluded.net,
  mae = COALESCE(excluded.mae, j_trades.mae), mfe = COALESCE(excluded.mfe, j_trades.mfe), magic = excluded.magic, comment = excluded.comment, updated_at = excluded.updated_at`);
export function storeRows(cid: string, accountId: string, rows: Row[], source: string) {
  let added = 0, updated = 0;
  db.transaction(() => {
    for (const r of rows.slice(0, 50000)) {
      const had = one("SELECT id FROM j_trades WHERE account_id = ? AND ext_id = ?", accountId, r.ext);
      upsert.run(newId("jt"), cid, accountId, r.ext, r.symbol, r.side, r.volume, r.ot, r.ct, r.op, r.cp, r.sl, r.tp, r.commission, r.swap, r.fee, r.gross, r.net,
        r.mae ?? null, r.mfe ?? null, r.magic || "", r.comment || "", source, now(), now());
      if (had) updated++; else added++;
    }
  })();
  return { added, updated };
}
// the shape the statistics engine and the screen use
const OUT = `SELECT id, account_id a, symbol s, side d, volume v, open_time ot, close_time ct, open_price op, close_price cp, sl, tp, net, gross, commission comm, swap, fee, mae, mfe,
  tags, playbook_id pb, rating rt, risk, note, media, checks, reviewed, magic, comment FROM j_trades`;
const shape = (t: any) => ({ ...t, tags: J(t.tags) || [], media: J(t.media) || [], checks: J(t.checks) || [], reviewed: !!t.reviewed });
export const tradesOf = (cid: string) => all(OUT + " WHERE customer_id = ? ORDER BY close_time", cid).map(shape);
const tradeOf = (cid: string, id: string) => { const t = one(OUT + " WHERE customer_id = ? AND id = ?", cid, id); return t ? shape(t) : null; };

// GoldenStraddler customers: their EA's own trades appear as an account without any setup
function syncEaTrades(cid: string) {
  const ls = all<Licence>("SELECT * FROM licences WHERE customer_id = ? AND account != ''", cid);
  for (const l of ls) {
    const n = one<{ n: number; last: string }>("SELECT COUNT(*) n, MAX(close_time) last FROM trades WHERE licence_id = ?", l.id)!;
    if (!n.n) continue;
    let acc = one<any>("SELECT * FROM j_accounts WHERE customer_id = ? AND ref = ?", cid, "lic:" + l.id);
    if (!acc) {
      const id = newId("ja");
      run(`INSERT INTO j_accounts (id, customer_id, name, broker, platform, currency, login, server, demo, source, time_mode, ref, created_at) VALUES (?, ?, ?, ?, 'mt5', ?, ?, ?, ?, 'ea', 'mt4ny', ?, ?)`,
        id, cid, "GoldenStraddler EA", "", (one<any>("SELECT currency FROM feeds WHERE licence_id = ?", l.id)?.currency) || "USD", l.account, l.account_server, l.account_demo, "lic:" + l.id, now());
      acc = one<any>("SELECT * FROM j_accounts WHERE id = ?", id);
    }
    if (acc.archived) continue;
    const have = one<{ n: number }>("SELECT COUNT(*) n FROM j_trades WHERE account_id = ?", acc.id)!.n;
    if (have >= n.n && acc.last_sync && acc.last_sync > Date.now() - 60_000) continue;
    const rows: Row[] = all<any>("SELECT * FROM trades WHERE licence_id = ?", l.id).map((t) => {
      const ot = toUtc(parseTime(t.open_time), "mt4ny"), ct = toUtc(parseTime(t.close_time), "mt4ny");
      return { ext: String(t.id), symbol: String(acc.symbol || "XAUUSD"), side: t.side === "BUY" ? 1 : -1, volume: t.volume, ot, ct, op: t.open_price, cp: t.close_price, sl: null, tp: null,
        commission: t.commission || 0, swap: t.swap || 0, fee: t.fee || 0, gross: t.gross || 0, net: t.net || 0, magic: "", comment: "GoldenStraddler" };
    }).filter((r) => Number.isFinite(r.ot) && Number.isFinite(r.ct));
    const sym = one<any>("SELECT symbol FROM feeds WHERE licence_id = ?", l.id)?.symbol;
    if (sym) for (const r of rows) r.symbol = String(sym).toUpperCase();
    storeRows(cid, acc.id, rows, "ea");
    run("UPDATE j_accounts SET last_sync = ? WHERE id = ?", now(), acc.id);
  }
}

// ---------------------------------------------------------------- candles around a trade
// sent as { tf: seconds per bar, t: first bar (server time, s), base, pt, b: [[bars from t, open, high, low, close] in points from base] }
const TFS = new Set([60, 300, 900, 1800, 3600, 14400, 86400]);
const putBars = db.query(`INSERT INTO j_bars (trade_id, customer_id, tf, t0, base, pt, data, ct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(trade_id) DO UPDATE SET tf = excluded.tf, t0 = excluded.t0, base = excluded.base, pt = excluded.pt, data = excluded.data, ct = excluded.ct, created_at = excluded.created_at`);
export function barsOf(x: any, utc: (sec: any) => number) {
  const tf = Number(x?.tf), pt = Number(x?.pt), base = Number(x?.base), t0 = utc(x?.t);
  if (!TFS.has(tf) || !(pt > 0 && pt < 1000) || !(base > 0 && Number.isFinite(base)) || !Number.isFinite(t0) || t0 <= 0 || !Array.isArray(x.b)) return null;
  const out: number[][] = []; let last = -1;
  for (const r of x.b.slice(0, 800)) {
    if (!Array.isArray(r) || r.length < 5) return null;
    const [d, o, h, l, c] = r.slice(0, 5).map((v: any) => Math.round(Number(v)));
    if (![d, o, h, l, c].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e8) || d <= last || d > 1e6) return null;
    out.push([d, o, Math.max(h, o, c, l), Math.min(l, o, c, h), c]); last = d;
  }
  return out.length >= 2 ? { tf, t0, base, pt, b: out } : null;
}
// keep the newest 3,000 charts per customer
function trimBars(cid: string) {
  const n = one<{ n: number }>("SELECT COUNT(*) n FROM j_bars WHERE customer_id = ?", cid)!.n;
  if (n > 3000) run("DELETE FROM j_bars WHERE trade_id IN (SELECT trade_id FROM j_bars WHERE customer_id = ? ORDER BY ct ASC LIMIT ?)", cid, n - 3000);
}
const dropBars = (where: string, ...args: any[]) => run(`DELETE FROM j_bars WHERE trade_id IN (SELECT id FROM j_trades WHERE ${where})`, ...args);

// ---------------------------------------------------------------- the MT5 connector: an EA that sends the account's closed positions
export function connectorSync(b: any) {
  const tok = str(b.token, 80);
  if (!tok) return { code: 401, body: { ok: false, error: "Paste your connector token into the connector's inputs." } };
  const acc = one<any>("SELECT * FROM j_accounts WHERE token_hash = ?", sha256(tok));
  if (!acc) return { code: 401, body: { ok: false, error: "This connector token isn't valid. Make a new one in your journal under Accounts." } };
  const c = one<Customer>("SELECT * FROM customers WHERE id = ?", acc.customer_id);
  if (!journalAccess(c).ok) return { code: 403, body: { ok: false, error: "Your journal access has ended. Renew from goldenstraddler.com/account." } };
  const login = str(b.login, 20);
  if (acc.login && login && acc.login !== login) return { code: 409, body: { ok: false, error: `This token belongs to account ${acc.login}. Make a separate token for each account.` } };
  const offMin = Math.max(-14 * 60, Math.min(14 * 60, Number(b.offset_min) || 0));
  // the EA knows today's server offset; most MT5 brokers move between GMT+2 and GMT+3 with US daylight saving, so older trades follow that rule
  const mode = offMin === 120 || offMin === 180 ? "mt4ny" : "fixed:" + offMin, utc = (sec: any) => toUtc(Number(sec) * 1000, mode);
  const rows: Row[] = [];
  for (const p of (Array.isArray(b.positions) ? b.positions : []).slice(0, 5000)) {
    const side = sideOf(p.side), sym = str(p.symbol, 24).toUpperCase(), ext = str(p.id, 40);
    if (side === null || !sym || !ext) continue;
    // times arrive as server time; the EA tells us its offset from UTC
    const ot = utc(p.open_time), ct = utc(p.close_time);
    if (!Number.isFinite(ot) || !Number.isFinite(ct) || ct <= 0) continue;
    const n = (k: string) => num(p[k]);
    const comm = n("commission") || 0, swap = n("swap") || 0, fee = n("fee") || 0, profit = n("profit") || 0;
    rows.push({ ext, symbol: sym, side, volume: n("volume"), ot, ct, op: n("open_price"), cp: n("close_price"), sl: n("sl") || null, tp: n("tp") || null,
      commission: comm, swap, fee, gross: profit, net: profit + comm + swap + fee, magic: str(p.magic, 24), comment: str(p.comment, 120), mae: n("mae") || null, mfe: n("mfe") || null });
  }
  // the connector also sends MT5's own high-impact calendar for the same period, so older trades can be matched to the news too
  if (Array.isArray(b.events)) db.transaction(() => {
    for (const e of b.events.slice(0, 20000)) {
      const c = str(e.currency, 3).toUpperCase(), t = utc(e.time);
      if (!MAJORS.has(c) || !Number.isFinite(t) || t <= 0) continue;
      putEvent.run(t, c, str(e.name, 80), acc.customer_id);
    }
  })();
  const r = storeRows(acc.customer_id, acc.id, rows, "connector");
  // candles around each trade (sent once the window after the close has passed)
  let charts = 0;
  db.transaction(() => {
    for (const p of (Array.isArray(b.positions) ? b.positions : []).slice(0, 5000)) {
      if (!p || !p.bars) continue;
      const bars = barsOf(p.bars, utc); if (!bars) continue;
      const t = one<{ id: string; close_time: number }>("SELECT id, close_time FROM j_trades WHERE account_id = ? AND ext_id = ?", acc.id, str(p.id, 40)); if (!t) continue;
      putBars.run(t.id, acc.customer_id, bars.tf, bars.t0, bars.base, bars.pt, JSON.stringify(bars.b), t.close_time, now()); charts++;
    }
  })();
  if (charts) trimBars(acc.customer_id);
  run(`UPDATE j_accounts SET last_sync = ?, login = CASE WHEN login = '' THEN ? ELSE login END, server = CASE WHEN ? != '' THEN ? ELSE server END,
       broker = CASE WHEN broker = '' THEN ? ELSE broker END, currency = CASE WHEN ? != '' THEN ? ELSE currency END, demo = ?, balance = ?, equity = ?, source = 'connector' WHERE id = ?`,
    now(), login, str(b.server, 96), str(b.server, 96), str(b.company, 96), str(b.currency, 8), str(b.currency, 8), b.demo ? 1 : 0, num(b.balance), num(b.equity), acc.id);
  const c2 = one<{ n: number; last: number }>("SELECT COUNT(*) n, MAX(close_time) last FROM j_trades WHERE account_id = ?", acc.id)!;
  return { code: 200, body: { ok: true, ...r, charts, have: c2.n, last_close: c2.last ? Math.floor((c2.last + offMin * 60000) / 1000) : 0 } };
}

// ---------------------------------------------------------------- media (screenshots)
const MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
function saveMedia(cid: string, b: any) {
  const mime = str(b.mime, 30), data = String(b.data || "");
  if (!MIME[mime]) throw Object.assign(new Error("Use a PNG, JPG, WebP or GIF image."), { code: 400 });
  const buf = Buffer.from(data.replace(/^data:[^,]+,/, ""), "base64");
  if (buf.length < 50 || buf.length > 6 << 20) throw Object.assign(new Error("Images can be up to 6 MB."), { code: 400 });
  const total = one<{ s: number }>("SELECT COALESCE(SUM(size), 0) s FROM j_media WHERE customer_id = ?", cid)!.s;
  if (total + buf.length > 2 * 1024 ** 3) throw Object.assign(new Error("You've reached the 2 GB screenshot limit. Delete some first."), { code: 400 });
  const id = newId("jm");
  mkdirSync(join(MEDIA_DIR, cid), { recursive: true });
  writeFileSync(join(MEDIA_DIR, cid, id + "." + MIME[mime]), buf);
  run("INSERT INTO j_media (id, customer_id, mime, size, name, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, cid, mime, buf.length, str(b.name, 120), now());
  return { id, mime, size: buf.length };
}
function mediaFile(cid: string, id: string) {
  const m = one<any>("SELECT * FROM j_media WHERE id = ? AND customer_id = ?", id, cid);
  if (!m || !/^jm_[a-z0-9]+$/.test(id)) return null;
  const f = join(MEDIA_DIR, cid, id + "." + MIME[m.mime]);
  return existsSync(f) ? { f, mime: m.mime } : null;
}
function dropMedia(cid: string, ids: string[]) {
  for (const id of ids) { const m = mediaFile(cid, id); if (m) try { unlinkSync(m.f); } catch {} run("DELETE FROM j_media WHERE id = ? AND customer_id = ?", id, cid); }
}

// ---------------------------------------------------------------- a shared results page: one account, read-only, for anyone with the link
export function sharedAccount(tok: string) {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(tok)) return null;
  const a = one<any>("SELECT * FROM j_accounts WHERE share = ?", tok);
  if (!a || a.archived) return null;
  const c = one<Customer>("SELECT * FROM customers WHERE id = ?", a.customer_id);
  if (!c || !journalAccess(c).ok) return null;
  const trades = all(OUT + " WHERE account_id = ? ORDER BY close_time", a.id).map(shape);
  const typed = one<{ n: number }>("SELECT COUNT(*) n FROM j_trades WHERE account_id = ? AND source NOT IN ('connector', 'ea')", a.id)!.n;
  return { account: a, trades, prefs: prefsOf(c.id), opts: J(a.share_opts) || {}, synced: trades.length > 0 && typed === 0 };
}

// ---------------------------------------------------------------- the whole journal in one payload
const pubAcc = (a: any) => ({ id: a.id, name: a.name, broker: a.broker, platform: a.platform, currency: a.currency, login: a.login ? "••••" + String(a.login).slice(-4) : "", server: a.server,
  demo: !!a.demo, source: a.source, time_mode: a.time_mode, balance_start: a.balance_start, token_hint: a.token_hint, last_sync: a.last_sync, balance: a.balance, equity: a.equity, archived: !!a.archived, ea: String(a.ref || "").startsWith("lic:"), limits: J(a.limits) || {}, share: a.share ? "/j/" + a.share : "", share_opts: J(a.share_opts) || {} });
export function journalState(c: Customer) {
  syncEaTrades(c.id);
  const trades = tradesOf(c.id);
  const days = all<any>("SELECT day, plan != '' p, review != '' r, lessons != '' l, mood, grade, media FROM j_days WHERE customer_id = ?", c.id)
    .map((d) => ({ day: d.day, notes: !!(d.p || d.r || d.l), mood: d.mood, grade: d.grade, shots: (J(d.media) || []).length }));
  return {
    ok: true, access: journalAccess(c), prefs: prefsOf(c.id), ai: aiUsage(c.id), email: c.email,
    accounts: all<any>("SELECT * FROM j_accounts WHERE customer_id = ? ORDER BY created_at", c.id).map(pubAcc),
    tags: all("SELECT id, name, kind, color FROM j_tags WHERE customer_id = ? ORDER BY kind, name", c.id),
    playbooks: all<any>("SELECT id, name, description, rules, color, archived FROM j_playbooks WHERE customer_id = ? ORDER BY name", c.id).map((p) => ({ ...p, rules: J(p.rules) || [], archived: !!p.archived })),
    trades, days, events: eventsFor(c.id, trades),
    charts: all<{ trade_id: string }>("SELECT trade_id FROM j_bars WHERE customer_id = ?", c.id).map((r) => r.trade_id),
  };
}

// starter tags so the first review has something to click
function seedTags(cid: string) {
  if (one("SELECT id FROM j_tags WHERE customer_id = ? LIMIT 1", cid)) return;
  const T: [string, string][] = [["FOMO entry", "mistake"], ["Moved my stop", "mistake"], ["Chased price", "mistake"], ["Oversized", "mistake"], ["Exited too early", "mistake"], ["Revenge trade", "mistake"],
    ["Calm", "emotion"], ["Confident", "emotion"], ["Anxious", "emotion"], ["Frustrated", "emotion"], ["Bored", "emotion"], ["News", "custom"], ["A+ setup", "custom"]];
  for (const [n, k] of T) run("INSERT INTO j_tags (id, customer_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)", newId("jg"), cid, n, k, now());
}

const ACC_FIELDS = (b: any) => ({ name: str(b.name, 60) || "My account", broker: str(b.broker, 60), platform: ["mt5", "mt4", "ctrader", "other"].includes(b.platform) ? b.platform : "mt5",
  currency: /^[A-Z]{3}$/.test(str(b.currency, 3)) ? str(b.currency, 3) : "USD", time_mode: /^(utc|mt4ny|fixed:[+-]?\d{1,4})$/.test(str(b.time_mode, 16)) ? str(b.time_mode, 16) : "mt4ny",
  balance_start: num(b.balance_start) || 0, demo: b.demo ? 1 : 0, limits: JSON.stringify(limitsOf(b.limits)) });
// prop-firm style limits: amounts in the account currency, or percentages of the starting balance
function limitsOf(l: any) {
  if (!l || typeof l !== "object") return {};
  const n = (v: any, hi: number) => { const x = num(v); return x === null || x <= 0 ? null : Math.min(hi, x); };
  const o: any = { dailyLoss: n(l.dailyLoss, 1e9), dailyLossPct: !!l.dailyLossPct, maxDD: n(l.maxDD, 1e9), maxDDPct: !!l.maxDDPct, trailing: !!l.trailing, target: n(l.target, 1e9), targetPct: !!l.targetPct,
    minDays: n(l.minDays, 365), consistency: n(l.consistency, 100), firm: str(l.firm, 40) };
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === "" || o[k] === false) delete o[k];
  return o;
}
const csvCell = (v: any) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : s; };

// ---------------------------------------------------------------- the API
export async function journalApi(req: Request, p: string, c: Customer | null, b: () => Promise<any>): Promise<Response> {
  const post = req.method === "POST", del = req.method === "DELETE";
  if (!c) return bad("Sign in to use your journal.", 401);
  const acc = journalAccess(c);
  if (!acc.ok) return json(403, { ok: false, error: acc.why === "expired" ? "Your plan has ended. Renew it from your account to open your journal again." : "The journal comes with GoldenStraddler or the Journal plan.", why: acc.why });
  if (limited("j:" + c.id, 600, 60_000)) return bad("Slow down a little.", 429);
  const cid = c.id;

  if (p === "/api/journal/state") { seedTags(cid); return json(200, journalState(c)); }
  if (p === "/api/journal/prefs" && post) return json(200, { ok: true, prefs: setPrefs(cid, await b()) });

  // accounts
  if (p === "/api/journal/accounts" && post) {
    if ((one<{ n: number }>("SELECT COUNT(*) n FROM j_accounts WHERE customer_id = ?", cid)!.n) >= 30) return bad("You can have up to 30 accounts.");
    const f = ACC_FIELDS(await b()), id = newId("ja");
    run(`INSERT INTO j_accounts (id, customer_id, name, broker, platform, currency, time_mode, balance_start, demo, limits, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?)`,
      id, cid, f.name, f.broker, f.platform, f.currency, f.time_mode, f.balance_start, f.demo, f.limits, now());
    return json(200, { ok: true, account: pubAcc(one("SELECT * FROM j_accounts WHERE id = ?", id)) });
  }
  let m = /^\/api\/journal\/accounts\/(ja_[a-z0-9]+)(\/token|\/share)?$/.exec(p);
  if (m) {
    const a = one<any>("SELECT * FROM j_accounts WHERE id = ? AND customer_id = ?", m[1], cid);
    if (!a) return bad("Account not found.", 404);
    if (m[2] === "/share" && post) {
      const x = await b();
      if (!x.on) { run("UPDATE j_accounts SET share = '', share_opts = '{}' WHERE id = ?", a.id); audit("customer:" + c.email, "stopped sharing a journal account", a.id); }
      else {
        const opts = { money: !!x.money, trades: !!x.trades };
        run("UPDATE j_accounts SET share = ?, share_opts = ? WHERE id = ?", a.share || token(12), JSON.stringify(opts), a.id);
        audit("customer:" + c.email, "shared a journal account", a.id, JSON.stringify(opts));
      }
      return json(200, { ok: true, account: pubAcc(one("SELECT * FROM j_accounts WHERE id = ?", a.id)) });
    }
    if (m[2] === "/token" && post) {
      const t = "gsj_" + token(24);
      run("UPDATE j_accounts SET token_hash = ?, token_hint = ? WHERE id = ?", sha256(t), t.slice(-4), a.id);
      audit("customer:" + c.email, "made a journal connector token", a.id);
      return json(200, { ok: true, token: t });
    }
    if (del) {
      const media = all<any>("SELECT media FROM j_trades WHERE account_id = ?", a.id).flatMap((t) => J(t.media) || []);
      dropMedia(cid, media);
      dropBars("account_id = ? AND customer_id = ?", a.id, cid);
      run("DELETE FROM j_trades WHERE account_id = ? AND customer_id = ?", a.id, cid);
      if (String(a.ref).startsWith("lic:")) run("UPDATE j_accounts SET archived = 1 WHERE id = ?", a.id); else run("DELETE FROM j_accounts WHERE id = ?", a.id);
      return json(200, { ok: true });
    }
    if (post) {
      const x = await b(), f = ACC_FIELDS({ ...a, limits: J(a.limits) || {}, ...x });
      run("UPDATE j_accounts SET name = ?, broker = ?, platform = ?, currency = ?, time_mode = ?, balance_start = ?, demo = ?, limits = ?, archived = ? WHERE id = ?",
        f.name, f.broker, f.platform, f.currency, f.time_mode, f.balance_start, f.demo, f.limits, x.archived ? 1 : 0, a.id);
      return json(200, { ok: true, account: pubAcc(one("SELECT * FROM j_accounts WHERE id = ?", a.id)) });
    }
  }

  // imports: preview first, then commit
  if (p === "/api/journal/import" && post) {
    if (limited("ji:" + cid, 40, 3_600_000)) return bad("Too many imports in an hour. Try again later.", 429);
    const x = await b(), a = one<any>("SELECT * FROM j_accounts WHERE id = ? AND customer_id = ?", str(x.account, 40), cid);
    if (!a) return bad("Pick the account these trades belong to.");
    const text = String(x.text || "");
    if (!text.trim()) return bad("That file is empty.");
    if (text.length > 24 << 20) return bad("Files can be up to 24 MB.", 413);
    const mode = /^(utc|mt4ny|fixed:[+-]?\d{1,4})$/.test(str(x.time_mode, 16)) ? str(x.time_mode, 16) : a.time_mode;
    const r = parseImport(text, str(x.name, 200), mode, x.dayFirst !== false);
    if (!x.commit) return json(200, { ok: true, format: r.format, count: r.rows.length, errors: r.errors, header: r.header, sample: r.rows.slice(0, 8),
      range: r.rows.length ? [Math.min(...r.rows.map((t) => t.ot)), Math.max(...r.rows.map((t) => t.ct))] : null, net: r.rows.reduce((s, t) => s + t.net, 0) });
    if (!r.rows.length) return bad(r.errors[0] || "No trades to import.");
    if (mode !== a.time_mode) run("UPDATE j_accounts SET time_mode = ? WHERE id = ?", mode, a.id);
    const s = storeRows(cid, a.id, r.rows, "import");
    run("UPDATE j_accounts SET last_sync = ? WHERE id = ?", now(), a.id);
    audit("customer:" + c.email, "imported journal trades", a.id, `${s.added} new, ${s.updated} updated, ${r.format}`);
    return json(200, { ok: true, ...s, format: r.format });
  }

  // trades
  if (p === "/api/journal/trades" && post) {
    const x = await b(), a = one<any>("SELECT * FROM j_accounts WHERE id = ? AND customer_id = ?", str(x.account, 40), cid);
    if (!a) return bad("Pick an account.");
    const side = sideOf(x.side), sym = str(x.symbol, 24).toUpperCase(), ot = Number(x.ot), ct = Number(x.ct), net = num(x.net);
    if (side === null || !sym || !Number.isFinite(ot) || !Number.isFinite(ct) || net === null) return bad("Fill in the symbol, direction, times and result.");
    const comm = num(x.commission) || 0, swap = num(x.swap) || 0;
    const r = storeRows(cid, a.id, [{ ext: "manual-" + token(6), symbol: sym, side, volume: num(x.volume), ot: Math.min(ot, ct), ct: Math.max(ot, ct), op: num(x.op), cp: num(x.cp), sl: num(x.sl), tp: num(x.tp),
      commission: comm, swap, fee: 0, gross: net - comm - swap, net }], "manual");
    return json(200, { ok: true, ...r, trades: tradesOf(cid) });
  }
  if (p === "/api/journal/trades/bulk" && post) {
    const x = await b(), ids: string[] = (Array.isArray(x.ids) ? x.ids : []).slice(0, 5000).map((v: any) => str(v, 40));
    const tagIds = new Set(all<any>("SELECT id FROM j_tags WHERE customer_id = ?", cid).map((t) => t.id));
    const add = (Array.isArray(x.addTags) ? x.addTags : []).filter((t: string) => tagIds.has(t)), rem = new Set((Array.isArray(x.removeTags) ? x.removeTags : []).map(String));
    const pb = x.playbook === undefined ? undefined : x.playbook ? (one("SELECT id FROM j_playbooks WHERE id = ? AND customer_id = ?", str(x.playbook, 40), cid) ? str(x.playbook, 40) : undefined) : null;
    db.transaction(() => {
      for (const id of ids) {
        const t = one<any>("SELECT tags FROM j_trades WHERE id = ? AND customer_id = ?", id, cid); if (!t) continue;
        const tags = [...new Set([...(J(t.tags) || []), ...add])].filter((g) => !rem.has(g));
        run("UPDATE j_trades SET tags = ?, playbook_id = CASE WHEN ? = 1 THEN ? ELSE playbook_id END, reviewed = CASE WHEN ? = 1 THEN 1 ELSE reviewed END, updated_at = ? WHERE id = ? AND customer_id = ?",
          JSON.stringify(tags), pb === undefined ? 0 : 1, pb ?? null, x.reviewed ? 1 : 0, now(), id, cid);
      }
      if (x.delete === true) for (const id of ids) { const t = one<any>("SELECT media FROM j_trades WHERE id = ? AND customer_id = ?", id, cid); if (t) { dropMedia(cid, J(t.media) || []); run("DELETE FROM j_bars WHERE trade_id = ?", id); run("DELETE FROM j_trades WHERE id = ? AND customer_id = ?", id, cid); } }
    })();
    return json(200, { ok: true, trades: tradesOf(cid) });
  }
  m = /^\/api\/journal\/trades\/(jt_[a-z0-9]+)\/bars$/.exec(p);
  if (m) {
    const r = one<any>("SELECT tf, t0, base, pt, data FROM j_bars WHERE trade_id = ? AND customer_id = ?", m[1], cid);
    return json(200, { ok: true, bars: r ? { tf: r.tf, t0: r.t0, base: r.base, pt: r.pt, b: J(r.data) || [] } : null });
  }
  m = /^\/api\/journal\/trades\/(jt_[a-z0-9]+)$/.exec(p);
  if (m) {
    const t = one<any>("SELECT * FROM j_trades WHERE id = ? AND customer_id = ?", m[1], cid);
    if (!t) return bad("Trade not found.", 404);
    if (del) { dropMedia(cid, J(t.media) || []); run("DELETE FROM j_bars WHERE trade_id = ?", t.id); run("DELETE FROM j_trades WHERE id = ?", t.id); return json(200, { ok: true }); }
    if (post) {
      const x = await b(), set: string[] = [], val: any[] = [];
      const put = (col: string, v: any) => { set.push(col + " = ?"); val.push(v); };
      if (x.note !== undefined) put("note", str(x.note, 20000));
      if (x.rating !== undefined) put("rating", x.rating ? Math.max(1, Math.min(5, Math.round(Number(x.rating)) || 1)) : null);
      if (x.playbook !== undefined) put("playbook_id", x.playbook && one("SELECT id FROM j_playbooks WHERE id = ? AND customer_id = ?", str(x.playbook, 40), cid) ? str(x.playbook, 40) : null);
      if (x.checks !== undefined) put("checks", JSON.stringify((Array.isArray(x.checks) ? x.checks : []).slice(0, 50).map((n: any) => Math.round(Number(n))).filter(Number.isFinite)));
      if (x.risk !== undefined) put("risk", num(x.risk) && num(x.risk)! > 0 ? num(x.risk) : null);
      if (x.sl !== undefined) put("sl", num(x.sl) && num(x.sl)! > 0 ? num(x.sl) : null);
      if (x.tp !== undefined) put("tp", num(x.tp) && num(x.tp)! > 0 ? num(x.tp) : null);
      if (x.reviewed !== undefined) put("reviewed", x.reviewed ? 1 : 0);
      if (x.tags !== undefined) { const ok = new Set(all<any>("SELECT id FROM j_tags WHERE customer_id = ?", cid).map((g) => g.id)); put("tags", JSON.stringify([...new Set((Array.isArray(x.tags) ? x.tags : []).map(String).filter((g: string) => ok.has(g)))])); }
      if (x.media !== undefined) {
        const keep = (Array.isArray(x.media) ? x.media : []).map(String).filter((id: string) => one("SELECT id FROM j_media WHERE id = ? AND customer_id = ?", id, cid)).slice(0, 12);
        dropMedia(cid, (J(t.media) || []).filter((id: string) => !keep.includes(id)));
        put("media", JSON.stringify(keep));
      }
      if (!set.length) return bad("Nothing to change.");
      put("updated_at", now());
      run(`UPDATE j_trades SET ${set.join(", ")} WHERE id = ? AND customer_id = ?`, ...val, t.id, cid);
      return json(200, { ok: true, trade: tradeOf(cid, t.id) });
    }
  }

  // days
  m = /^\/api\/journal\/days\/(\d{4}-\d\d-\d\d)$/.exec(p);
  if (m) {
    const day = m[1];
    if (post) {
      const x = await b(), old = one<any>("SELECT * FROM j_days WHERE customer_id = ? AND day = ?", cid, day);
      const sc = (v: any) => (v === null || v === undefined || v === "" ? null : Math.max(1, Math.min(5, Math.round(Number(v)) || 1)));
      const media = x.media !== undefined ? (Array.isArray(x.media) ? x.media : []).map(String).filter((id: string) => one("SELECT id FROM j_media WHERE id = ? AND customer_id = ?", id, cid)).slice(0, 12) : J(old?.media) || [];
      if (old && x.media !== undefined) dropMedia(cid, (J(old.media) || []).filter((id: string) => !media.includes(id)));
      run(`INSERT INTO j_days (customer_id, day, plan, review, lessons, mood, focus, grade, media, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(customer_id, day) DO UPDATE SET plan = excluded.plan, review = excluded.review, lessons = excluded.lessons, mood = excluded.mood, focus = excluded.focus, grade = excluded.grade, media = excluded.media, updated_at = excluded.updated_at`,
        cid, day, x.plan !== undefined ? str(x.plan, 20000) : old?.plan || "", x.review !== undefined ? str(x.review, 20000) : old?.review || "", x.lessons !== undefined ? str(x.lessons, 20000) : old?.lessons || "",
        x.mood !== undefined ? sc(x.mood) : old?.mood ?? null, x.focus !== undefined ? sc(x.focus) : old?.focus ?? null, x.grade !== undefined ? sc(x.grade) : old?.grade ?? null, JSON.stringify(media), now());
    }
    const d = one<any>("SELECT * FROM j_days WHERE customer_id = ? AND day = ?", cid, day);
    return json(200, { ok: true, day: d ? { ...d, media: J(d.media) || [] } : { day, plan: "", review: "", lessons: "", mood: null, focus: null, grade: null, media: [] } });
  }

  // tags and playbooks
  if (p === "/api/journal/tags" && post) {
    const x = await b(), name = str(x.name, 40), kind = ["mistake", "emotion", "custom"].includes(x.kind) ? x.kind : "custom";
    if (!name) return bad("Name the tag.");
    if (one("SELECT id FROM j_tags WHERE customer_id = ? AND lower(name) = lower(?)", cid, name)) return bad("You already have that tag.");
    if (one<{ n: number }>("SELECT COUNT(*) n FROM j_tags WHERE customer_id = ?", cid)!.n >= 300) return bad("You can have up to 300 tags.");
    const id = newId("jg"); run("INSERT INTO j_tags (id, customer_id, name, kind, color, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, cid, name, kind, str(x.color, 9), now());
    return json(200, { ok: true, tag: one("SELECT id, name, kind, color FROM j_tags WHERE id = ?", id) });
  }
  m = /^\/api\/journal\/tags\/(jg_[a-z0-9]+)$/.exec(p);
  if (m) {
    const g = one<any>("SELECT * FROM j_tags WHERE id = ? AND customer_id = ?", m[1], cid); if (!g) return bad("Tag not found.", 404);
    if (del) {
      db.transaction(() => { for (const t of all<any>("SELECT id, tags FROM j_trades WHERE customer_id = ? AND tags LIKE ?", cid, `%${g.id}%`)) run("UPDATE j_trades SET tags = ? WHERE id = ?", JSON.stringify((J(t.tags) || []).filter((x: string) => x !== g.id)), t.id); run("DELETE FROM j_tags WHERE id = ?", g.id); })();
      return json(200, { ok: true });
    }
    if (post) { const x = await b(); run("UPDATE j_tags SET name = ?, kind = ?, color = ? WHERE id = ?", str(x.name, 40) || g.name, ["mistake", "emotion", "custom"].includes(x.kind) ? x.kind : g.kind, str(x.color, 9), g.id); return json(200, { ok: true }); }
  }
  if (p === "/api/journal/playbooks" && post) {
    const x = await b(), name = str(x.name, 60); if (!name) return bad("Name the setup.");
    const id = newId("jp"); run("INSERT INTO j_playbooks (id, customer_id, name, description, rules, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, cid, name, str(x.description, 4000),
      JSON.stringify((Array.isArray(x.rules) ? x.rules : []).map((r: any) => str(r, 200)).filter(Boolean).slice(0, 20)), str(x.color, 9), now(), now());
    return json(200, { ok: true, id });
  }
  m = /^\/api\/journal\/playbooks\/(jp_[a-z0-9]+)$/.exec(p);
  if (m) {
    const pb = one<any>("SELECT * FROM j_playbooks WHERE id = ? AND customer_id = ?", m[1], cid); if (!pb) return bad("Setup not found.", 404);
    if (del) { run("UPDATE j_trades SET playbook_id = NULL WHERE playbook_id = ? AND customer_id = ?", pb.id, cid); run("DELETE FROM j_playbooks WHERE id = ?", pb.id); return json(200, { ok: true }); }
    if (post) {
      const x = await b();
      run("UPDATE j_playbooks SET name = ?, description = ?, rules = ?, color = ?, archived = ?, updated_at = ? WHERE id = ?", str(x.name, 60) || pb.name, str(x.description, 4000),
        JSON.stringify((Array.isArray(x.rules) ? x.rules : []).map((r: any) => str(r, 200)).filter(Boolean).slice(0, 20)), str(x.color, 9), x.archived ? 1 : 0, now(), pb.id);
      return json(200, { ok: true });
    }
  }

  // screenshots
  if (p === "/api/journal/media" && post) {
    if (limited("jm:" + cid, 120, 3_600_000)) return bad("Too many uploads in an hour.", 429);
    try { return json(200, { ok: true, ...saveMedia(cid, await b()) }); } catch (e: any) { return bad(e.message, e.code || 400); }
  }
  m = /^\/api\/journal\/media\/(jm_[a-z0-9]+)$/.exec(p);
  if (m) {
    const f = mediaFile(cid, m[1]); if (!f) return bad("Not found", 404);
    return new Response(Bun.file(f.f), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  }

  // export
  if (p === "/api/journal/export.csv") {
    const accs = new Map(all<any>("SELECT id, name FROM j_accounts WHERE customer_id = ?", cid).map((a) => [a.id, a.name]));
    const tags = new Map(all<any>("SELECT id, name FROM j_tags WHERE customer_id = ?", cid).map((t) => [t.id, t.name]));
    const pbs = new Map(all<any>("SELECT id, name FROM j_playbooks WHERE customer_id = ?", cid).map((t) => [t.id, t.name]));
    const H = ["account", "ticket", "symbol", "side", "volume", "open_time_utc", "close_time_utc", "open_price", "close_price", "stop_loss", "take_profit", "commission", "swap", "fee", "gross", "net", "mae_price", "mfe_price", "setup", "tags", "rating", "note"];
    const lines = [H.join(",")];
    for (const t of all<any>("SELECT * FROM j_trades WHERE customer_id = ? ORDER BY close_time", cid))
      lines.push([accs.get(t.account_id), t.ext_id, t.symbol, t.side > 0 ? "buy" : "sell", t.volume, new Date(t.open_time).toISOString(), new Date(t.close_time).toISOString(), t.open_price, t.close_price, t.sl, t.tp,
        t.commission, t.swap, t.fee, t.gross, t.net, t.mae, t.mfe, pbs.get(t.playbook_id) || "", (J(t.tags) || []).map((g: string) => tags.get(g)).filter(Boolean).join("|"), t.rating, t.note].map(csvCell).join(","));
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journal-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  }
  return bad("Unknown journal route.", 404);
}

// admin overview
export function journalAdmin() {
  return {
    users: one<{ n: number }>("SELECT COUNT(DISTINCT customer_id) n FROM j_trades")!.n, accounts: one<{ n: number }>("SELECT COUNT(*) n FROM j_accounts WHERE archived = 0")!.n,
    trades: one<{ n: number }>("SELECT COUNT(*) n FROM j_trades")!.n, connectors: one<{ n: number }>("SELECT COUNT(*) n FROM j_accounts WHERE source = 'connector' AND last_sync > ?", now() - 7 * DAY)!.n,
    aiMonth: one<any>("SELECT COALESCE(SUM(credits), 0) credits, COALESCE(SUM(cost_micro), 0) cost FROM j_ai WHERE created_at > ?", now() - 30 * DAY),
  };
}
