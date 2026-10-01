/*
 * Markets hub, data layer. Everything here is free and needs no API key:
 *   FRED (St. Louis Fed) CSV downloads, ECB reference rates via Frankfurter, CFTC Commitments of Traders (Socrata),
 *   Coinbase and Kraken public candles, gold-api.com spot prices, the ForexFactory weekly calendar.
 * Each source is cached in SQLite and refreshed on a gentle schedule; failures keep the last good copy.
 */
import { all, db, now, one, run } from "./db";
import { E } from "./util";

db.exec(`
CREATE TABLE IF NOT EXISTS hub_series ( sid TEXT NOT NULL, d TEXT NOT NULL, v REAL NOT NULL, PRIMARY KEY (sid, d) ) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS hub_cot ( code TEXT NOT NULL, d TEXT NOT NULL, oi REAL, mm_l REAL, mm_s REAL, lev_l REAL, lev_s REAL, am_l REAL, am_s REAL, name TEXT DEFAULT '',
  PRIMARY KEY (code, d) ) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS hub_src ( src TEXT PRIMARY KEY, ok_at INTEGER, try_at INTEGER, err TEXT DEFAULT '', rows INTEGER DEFAULT 0, last TEXT DEFAULT '' );
CREATE TABLE IF NOT EXISTS hub_kv ( k TEXT PRIMARY KEY, v TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS hub_calls ( wk TEXT NOT NULL, asset TEXT NOT NULL, score REAL NOT NULL, dir INTEGER NOT NULL, conf TEXT NOT NULL, px REAL, next_px REAL, hit INTEGER, at INTEGER NOT NULL, PRIMARY KEY (wk, asset) );
`);

const UA = { "User-Agent": "GoldenStraddler-Markets/1 (+https://goldenstraddler.com/markets)" };
const URLS = {
  fred: E.HUB_FRED || "https://fred.stlouisfed.org/graph/fredgraph.csv",
  ecb: E.HUB_ECB || "https://api.frankfurter.dev/v1",
  cb: E.HUB_CB || "https://api.exchange.coinbase.com",
  kr: E.HUB_KR || "https://api.kraken.com",
  ga: E.HUB_GA || "https://api.gold-api.com",
  cftc: E.HUB_CFTC || "https://publicreporting.cftc.gov/resource",
  ff: E.HUB_FF || "https://nfs.faireconomy.media",
};
export const HISTORY_FROM = "2017-01-01";
const HOUR = 3_600_000;

// ---------------------------------------------------------------- what we collect
export const FRED_IDS = ["DTWEXBGS", "DFII10", "DGS10", "DGS2", "DFF", "T10YIE", "VIXCLS", "DCOILWTICO", "DCOILBRENTEU", "DHHNGSP", "WCESTUS1"];
export const ECB_CCY = ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "SEK"];   // SEK only for the dollar index
export const SPOT = ["XAU", "XAG", "XPT", "XPD", "HG", "BTC", "ETH"];              // gold-api.com symbols
export const COINS: Record<string, { cb: string; kr: string }> = { BTC: { cb: "BTC-USD", kr: "XBTUSD" }, ETH: { cb: "ETH-USD", kr: "ETHUSD" }, PAXG: { cb: "PAXG-USD", kr: "PAXGUSD" } };
// CFTC contract codes: disaggregated report (metals, energy) and traders in financial futures (currencies, crypto)
export const COT: Record<string, { rep: "dis" | "tff"; name: string }> = {
  "088691": { rep: "dis", name: "Gold" }, "084691": { rep: "dis", name: "Silver" }, "076651": { rep: "dis", name: "Platinum" }, "085692": { rep: "dis", name: "Copper" },
  "067651": { rep: "dis", name: "WTI crude" }, "06765T": { rep: "dis", name: "Brent crude" }, "023651": { rep: "dis", name: "Natural gas" },
  "099741": { rep: "tff", name: "Euro" }, "096742": { rep: "tff", name: "British pound" }, "097741": { rep: "tff", name: "Japanese yen" }, "092741": { rep: "tff", name: "Swiss franc" },
  "090741": { rep: "tff", name: "Canadian dollar" }, "232741": { rep: "tff", name: "Australian dollar" }, "112741": { rep: "tff", name: "New Zealand dollar" },
  "133741": { rep: "tff", name: "Bitcoin" }, "146021": { rep: "tff", name: "Ether" },
};
const DATASET = { dis: "72hh-3qpy", tff: "gpe5-46if" };

// ---------------------------------------------------------------- storage helpers
const upsert = db.query("INSERT INTO hub_series (sid, d, v) VALUES (?, ?, ?) ON CONFLICT(sid, d) DO UPDATE SET v = excluded.v");
export function putSeries(sid: string, rows: [string, number][]) {
  const tx = db.transaction((rs: [string, number][]) => { for (const [d, v] of rs) if (/^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(v)) upsert.run(sid, d, v); });
  tx(rows);
}
export const series = (sid: string, from = HISTORY_FROM) => all<{ d: string; v: number }>("SELECT d, v FROM hub_series WHERE sid = ? AND d >= ? ORDER BY d", sid, from);
export const lastOf = (sid: string) => one<{ d: string; v: number }>("SELECT d, v FROM hub_series WHERE sid = ? ORDER BY d DESC LIMIT 1", sid);
export const cotRows = (code: string) => all<any>("SELECT * FROM hub_cot WHERE code = ? ORDER BY d", code);
export const kvGet = (k: string) => one<{ v: string }>("SELECT v FROM hub_kv WHERE k = ?", k)?.v || "";
export const kvSet = (k: string, v: string) => run("INSERT INTO hub_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);

function mark(src: string, ok: boolean, rows: number, last: string, err = "") {
  run(`INSERT INTO hub_src (src, ok_at, try_at, err, rows, last) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(src) DO UPDATE SET try_at = excluded.try_at, err = excluded.err, ok_at = COALESCE(excluded.ok_at, ok_at),
    rows = CASE WHEN excluded.ok_at IS NULL THEN rows ELSE excluded.rows END, last = CASE WHEN excluded.ok_at IS NULL THEN last ELSE excluded.last END`,
    src, ok ? now() : null, now(), err.slice(0, 300), rows, last);
}
const src = (s: string) => one<{ ok_at: number | null; try_at: number | null; err: string }>("SELECT ok_at, try_at, err FROM hub_src WHERE src = ?", s);
export const sources = () => all<{ src: string; ok_at: number | null; try_at: number | null; err: string; rows: number; last: string }>("SELECT * FROM hub_src ORDER BY src");
// due when the last success is older than `every`, with a back-off after a failure
let force = false;
function due(s: string, every: number, retry = HOUR) { if (force) return true; const r = src(s); if (!r) return true; if (r.ok_at && now() - r.ok_at < every) return false; return !r.try_at || now() - r.try_at > retry; }

async function get(url: string, timeout = 20000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r;
}
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ago = (days: number) => isoDay(now() - days * 86_400_000);

// ---------------------------------------------------------------- FRED
async function fred(id: string) {
  const s = "fred:" + id;
  if (!due(s, 10 * HOUR, 2 * HOUR)) return;
  try {
    const have = lastOf(s), from = have ? isoDay(Date.parse(have.d) - 40 * 86_400_000) : HISTORY_FROM;   // re-read recent weeks: FRED revises
    const txt = await (await get(`${URLS.fred}?id=${id}&cosd=${from}`)).text();
    const rows: [string, number][] = [];
    for (const line of txt.split(/\r?\n/).slice(1)) { const [d, v] = line.split(","); if (d && v && v !== "." && v !== "") rows.push([d.trim(), Number(v)]); }
    if (!rows.length && !have) throw new Error("no rows");
    putSeries(s, rows);
    mark(s, true, rows.length, rows.length ? rows[rows.length - 1][0] + " " + rows[rows.length - 1][1] : have!.d);
  } catch (e: any) { mark(s, false, 0, "", e.message); console.error("hub fred", id, e.message); }
}

// ---------------------------------------------------------------- ECB reference rates (via Frankfurter), quoted as USD per 1 unit -> we store USD->CCY
async function ecb() {
  const s = "ecb";
  if (!due(s, 8 * HOUR, 2 * HOUR)) return;
  try {
    const have = lastOf("ecb:EUR"), from = have ? ago(30) : HISTORY_FROM;
    const j: any = await (await get(`${URLS.ecb}/${from}..?from=USD&to=${ECB_CCY.join(",")}`)).json();
    const rates = j && j.rates ? j.rates : {};
    let n = 0, last = "";
    for (const c of ECB_CCY) {
      const rows: [string, number][] = Object.entries(rates).map(([d, r]: [string, any]) => [d, Number(r?.[c])] as [string, number]).filter((x) => x[1] > 0);
      putSeries("ecb:" + c, rows); n += rows.length; if (rows.length) last = rows[rows.length - 1][0];
    }
    if (!n && !have) throw new Error("no rates");
    mark(s, true, n, last);
  } catch (e: any) { mark(s, false, 0, "", e.message); console.error("hub ecb", e.message); }
}

// ---------------------------------------------------------------- crypto and the PAXG gold proxy: daily closes from Coinbase, Kraken as a fallback
async function coin(sym: string) {
  const s = "coin:" + sym, sid = "px:" + sym;
  if (!due(s, 6 * HOUR, 2 * HOUR)) return;
  const have = lastOf(sid);
  try {
    const rows: [string, number][] = [];
    let end = Date.now(), start0 = Date.parse(have ? ago(20) : HISTORY_FROM);
    for (let page = 0; page < 12 && end > start0; page++) {                   // 300 candles per request
      const st = Math.max(start0, end - 299 * 86_400_000);
      const j: any = await (await get(`${URLS.cb}/products/${COINS[sym].cb}/candles?granularity=86400&start=${new Date(st).toISOString()}&end=${new Date(end).toISOString()}`)).json();
      if (!Array.isArray(j) || !j.length) break;
      for (const c of j) if (Array.isArray(c) && c.length >= 5) rows.push([isoDay(c[0] * 1000), Number(c[4])]);
      end = st - 86_400_000;
      await Bun.sleep(400);
    }
    if (!rows.length) throw new Error("no candles");
    rows.sort((a, b) => (a[0] < b[0] ? -1 : 1)); putSeries(sid, rows);
    mark(s, true, rows.length, rows[rows.length - 1][0] + " " + rows[rows.length - 1][1] + " (coinbase)");
  } catch (e: any) {
    try {                                                                        // Kraken keeps the last 720 days
      const j: any = await (await get(`${URLS.kr}/0/public/OHLC?pair=${COINS[sym].kr}&interval=1440`)).json();
      const key = j && j.result ? Object.keys(j.result).find((k) => k !== "last") : "";
      const list: any[] = key ? j.result[key] : [];
      const rows: [string, number][] = list.map((c) => [isoDay(Number(c[0]) * 1000), Number(c[4])] as [string, number]);
      if (!rows.length) throw new Error((j && j.error && j.error.join(", ")) || "no candles");
      putSeries(sid, rows);
      mark(s, true, rows.length, rows[rows.length - 1][0] + " " + rows[rows.length - 1][1] + " (kraken)");
    } catch (e2: any) { mark(s, false, 0, "", e.message + " / " + e2.message); console.error("hub coin", sym, e.message, e2.message); }
  }
}

// ---------------------------------------------------------------- spot prices (metals, crypto); one value per UTC day builds our own daily history
export const spot: Record<string, { price: number; at: number }> = {};
async function spots() {
  const s = "spot";
  if (!due(s, 25 * 60_000, 10 * 60_000)) return;
  let n = 0; const errs: string[] = [];
  for (const sym of SPOT) {
    try {
      const j: any = await (await get(`${URLS.ga}/price/${sym}`, 8000)).json(), px = Number(j && j.price);
      if (!(px > 0)) throw new Error("no price");
      spot[sym] = { price: px, at: Date.parse(j.updatedAt) || now() };
      putSeries("spot:" + sym, [[isoDay(now()), px]]); n++;
    } catch (e: any) { errs.push(sym + ": " + e.message); }
    await Bun.sleep(250);
  }
  mark(s, n > 0, n, Object.entries(spot).map(([k, v]) => k + " " + v.price).join(", "), errs.join("; "));
  if (errs.length) console.error("hub spot", errs.join("; "));
}

// ---------------------------------------------------------------- CFTC Commitments of Traders (weekly, Tuesday data released Friday)
const pick = (o: any, re: RegExp) => { const k = Object.keys(o).find((x) => re.test(x)); return k ? Number(o[k]) : null; };
async function cot(code: string) {
  const s = "cot:" + code, meta = COT[code];
  if (!due(s, 20 * HOUR, 3 * HOUR)) return;
  try {
    const have = one<{ d: string }>("SELECT d FROM hub_cot WHERE code = ? ORDER BY d DESC LIMIT 1", code);
    const lim = have ? 8 : 420;
    const q = `$where=cftc_contract_market_code='${code}'&$order=report_date_as_yyyy_mm_dd DESC&$limit=${lim}`;
    const j: any = await (await get(`${URLS.cftc}/${DATASET[meta.rep]}.json?${encodeURI(q)}`)).json();
    if (!Array.isArray(j)) throw new Error("unexpected reply");
    if (!j.length) throw new Error("no rows for this contract");
    const ins = db.query(`INSERT INTO hub_cot (code, d, oi, mm_l, mm_s, lev_l, lev_s, am_l, am_s, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code, d) DO UPDATE SET oi = excluded.oi, mm_l = excluded.mm_l, mm_s = excluded.mm_s, lev_l = excluded.lev_l, lev_s = excluded.lev_s, am_l = excluded.am_l, am_s = excluded.am_s, name = excluded.name`);
    let last = "";
    db.transaction(() => {
      for (const o of j) {
        const d = String(o.report_date_as_yyyy_mm_dd || "").slice(0, 10);
        if (!/^\d{4}-\d\d-\d\d$/.test(d)) continue;
        ins.run(code, d, pick(o, /^open_interest_all$/), pick(o, /^m_money_positions_long/), pick(o, /^m_money_positions_short/),
          pick(o, /^lev_money_positions_long/), pick(o, /^lev_money_positions_short/), pick(o, /^asset_mgr_positions_long/), pick(o, /^asset_mgr_positions_short/),
          String(o.market_and_exchange_names || "").slice(0, 120));
        if (d > last) last = d;
      }
    })();
    const k = Object.keys(j[0]);
    if (!have) console.log(`hub cot ${code} ${meta.name}: ${j.length} weeks, last ${last}, ${j[0].market_and_exchange_names}; fields: ${k.filter((x) => /m_money|lev_money|asset_mgr/.test(x)).slice(0, 8).join(",")}`);
    mark(s, true, j.length, last + " " + String(j[0].market_and_exchange_names || "").slice(0, 60));
  } catch (e: any) { mark(s, false, 0, "", e.message); console.error("hub cot", code, e.message); }
}

// ---------------------------------------------------------------- calendar: this week and next week, every currency, high impact only
export type Ev = { utc: number; ccy: string; title: string; fc: string; prev: string };
export function calendar(): Ev[] { try { return JSON.parse(kvGet("cal") || "[]"); } catch { return []; } }
async function cal() {
  const s = "calendar";
  if (!due(s, 4 * HOUR, HOUR)) return;
  try {
    const out = new Map<string, Ev>();
    for (const wk of ["thisweek", "nextweek"]) {
      try {
        const j: any = await (await get(`${URLS.ff}/ff_calendar_${wk}.json`, 10000)).json();
        for (const e of Array.isArray(j) ? j : []) {
          if (!e || e.impact !== "High" || typeof e.date !== "string") continue;
          const utc = Math.round(Date.parse(e.date) / 1000);
          if (!Number.isFinite(utc)) continue;
          const ev = { utc, ccy: String(e.country || "").slice(0, 3), title: String(e.title || "").slice(0, 100), fc: String(e.forecast || "").slice(0, 20), prev: String(e.previous || "").slice(0, 20) };
          out.set(ev.ccy + ev.utc + ev.title, ev);
        }
      } catch (e: any) { if (wk === "thisweek") throw e; }               // next week's file only appears late in the week
      await Bun.sleep(500);
    }
    const list = [...out.values()].sort((a, b) => a.utc - b.utc);
    // keep events we already knew about from earlier in the week
    const old = calendar().filter((e) => e.utc > now() / 1000 - 8 * 86400 && !out.has(e.ccy + e.utc + e.title));
    const merged = [...old, ...list].sort((a, b) => a.utc - b.utc);
    kvSet("cal", JSON.stringify(merged));
    mark(s, true, list.length, list.length ? new Date(list[list.length - 1].utc * 1000).toISOString().slice(0, 16) : "");
  } catch (e: any) { mark(s, false, 0, "", e.message); console.error("hub calendar", e.message); }
}

// ---------------------------------------------------------------- the schedule
let busy = false;
export async function refreshAll(onDone?: () => void, forceAll = false) {
  if (busy) return; busy = true; force = forceAll;
  try {
    await spots(); await cal(); await ecb();
    for (const id of FRED_IDS) { await fred(id); await Bun.sleep(700); }
    for (const sym of Object.keys(COINS)) { await coin(sym); await Bun.sleep(500); }
    for (const code of Object.keys(COT)) { await cot(code); await Bun.sleep(600); }
  } catch (e: any) { console.error("hub refresh", e.message); }
  finally { busy = false; force = false; }
  onDone && onDone();
}
export function startHubData(onDone: () => void) {
  if (E.HUB_OFF === "1") return;
  setTimeout(() => refreshAll(onDone), 15_000);
  setInterval(() => refreshAll(onDone), 15 * 60_000);
}
