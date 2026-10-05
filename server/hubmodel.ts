/*
 * Markets hub, the model. A weekly call per market from a transparent factor score:
 * every factor is a measured fact (a price, a yield, a positioning number) turned into a score between -1 and +1
 * for that market, with a fixed weight. The call is the weighted average. The same rules run over past weeks
 * to give an honest backtest. Text is written from the numbers, so every bullet can be checked.
 */
import { calendar, cotRows, lastOf, ohlc, series, spot, type Bar, type Ev } from "./hubdata";

// ================================================================ markets
export type Cls = "metals" | "energy" | "fx" | "crypto";
type CotCat = "mm" | "lev" | "am";
export type Asset = {
  id: string; name: string; short: string; sym: string; cls: Cls; dp: number; pre: string; ccy: string[];
  hist: string; live?: string; scaleTo?: string;            // price history series; live spot; rescale a proxy to the live spot
  cot?: { code: string; cat: CotCat; inv?: boolean; what: string };
  usdInv?: boolean;                                          // quoted USD per unit (EURUSD) vs units per USD (USDJPY)
  factors: string[]; level: number;                          // level: round-number step for "cleared $4,500"
};
const METAL = ["trend", "stretch", "cot", "crowd", "dollar", "realYield", "ryLevel", "fed", "vixHaven"];
export const ASSETS: Asset[] = [
  { id: "gold", name: "Gold", short: "gold", sym: "XAUUSD", cls: "metals", dp: 0, pre: "$", ccy: ["USD"], hist: "px:PAXG", live: "XAU", scaleTo: "XAU", cot: { code: "088691", cat: "mm", what: "" }, factors: METAL, level: 100 },
  { id: "silver", name: "Silver", short: "silver", sym: "XAGUSD", cls: "metals", dp: 2, pre: "$", ccy: ["USD"], hist: "spot:XAG", live: "XAG", cot: { code: "084691", cat: "mm", what: "" }, factors: ["trend", "stretch", "cot", "crowd", "dollar", "realYield", "fed", "vixRisk"], level: 1 },
  { id: "platinum", name: "Platinum", short: "platinum", sym: "XPTUSD", cls: "metals", dp: 0, pre: "$", ccy: ["USD"], hist: "spot:XPT", live: "XPT", cot: { code: "076651", cat: "mm", what: "" }, factors: ["trend", "stretch", "cot", "crowd", "dollar", "vixRisk"], level: 50 },
  { id: "copper", name: "Copper", short: "copper", sym: "HG", cls: "metals", dp: 3, pre: "$", ccy: ["USD", "CNY"], hist: "spot:HG", live: "HG", cot: { code: "085692", cat: "mm", what: "" }, factors: ["trend", "stretch", "cot", "crowd", "dollar", "vixRisk"], level: 0.25 },
  { id: "wti", name: "WTI crude oil", short: "oil", sym: "USOIL", cls: "energy", dp: 2, pre: "$", ccy: ["USD"], hist: "fred:DCOILWTICO", cot: { code: "067651", cat: "mm", what: "" }, factors: ["trend", "stretch", "cot", "crowd", "dollar", "stocks", "vixRisk"], level: 5 },
  { id: "brent", name: "Brent crude oil", short: "Brent", sym: "UKOIL", cls: "energy", dp: 2, pre: "$", ccy: ["USD"], hist: "fred:DCOILBRENTEU", cot: { code: "06765T", cat: "mm", what: "" }, factors: ["trend", "stretch", "cot", "crowd", "dollar", "stocks", "vixRisk"], level: 5 },
  { id: "natgas", name: "Natural gas", short: "gas", sym: "NGAS", cls: "energy", dp: 2, pre: "$", ccy: ["USD"], hist: "fred:DHHNGSP", cot: { code: "023651", cat: "mm", what: "" }, factors: ["trend", "stretch", "cot"], level: 0.5 },
  { id: "eurusd", name: "EUR/USD", short: "the euro", sym: "EURUSD", cls: "fx", dp: 4, pre: "", ccy: ["USD", "EUR"], hist: "fx:EUR", usdInv: true, cot: { code: "099741", cat: "lev", what: "euro" }, factors: ["trend", "stretch", "cot", "crowd", "fed", "vixRisk0"], level: 0.01 },
  { id: "gbpusd", name: "GBP/USD", short: "the pound", sym: "GBPUSD", cls: "fx", dp: 4, pre: "", ccy: ["USD", "GBP"], hist: "fx:GBP", usdInv: true, cot: { code: "096742", cat: "lev", what: "pound" }, factors: ["trend", "stretch", "cot", "crowd", "fed", "vixRisk0"], level: 0.01 },
  { id: "usdjpy", name: "USD/JPY", short: "dollar-yen", sym: "USDJPY", cls: "fx", dp: 2, pre: "", ccy: ["USD", "JPY"], hist: "fx:JPY", cot: { code: "097741", cat: "lev", inv: true, what: "yen" }, factors: ["trend", "stretch", "cot", "crowd", "fed", "vixHavenFx"], level: 1 },
  { id: "audusd", name: "AUD/USD", short: "the Aussie", sym: "AUDUSD", cls: "fx", dp: 4, pre: "", ccy: ["USD", "AUD", "CNY"], hist: "fx:AUD", usdInv: true, cot: { code: "232741", cat: "lev", what: "Australian dollar" }, factors: ["trend", "stretch", "cot", "crowd", "fed", "vixRisk"], level: 0.01 },
  { id: "usdcad", name: "USD/CAD", short: "dollar-CAD", sym: "USDCAD", cls: "fx", dp: 4, pre: "", ccy: ["USD", "CAD"], hist: "fx:CAD", cot: { code: "090741", cat: "lev", inv: true, what: "Canadian dollar" }, factors: ["trend", "stretch", "cot", "crowd", "fed", "oilCad"], level: 0.01 },
  { id: "usdchf", name: "USD/CHF", short: "dollar-franc", sym: "USDCHF", cls: "fx", dp: 4, pre: "", ccy: ["USD", "CHF"], hist: "fx:CHF", cot: { code: "092741", cat: "lev", inv: true, what: "Swiss franc" }, factors: ["trend", "stretch", "cot", "crowd", "fed", "vixHavenFx"], level: 0.01 },
  { id: "nzdusd", name: "NZD/USD", short: "the kiwi", sym: "NZDUSD", cls: "fx", dp: 4, pre: "", ccy: ["USD", "NZD"], hist: "fx:NZD", usdInv: true, cot: { code: "112741", cat: "lev", what: "New Zealand dollar" }, factors: ["trend", "stretch", "cot", "crowd", "fed", "vixRisk"], level: 0.01 },
  { id: "btc", name: "Bitcoin", short: "bitcoin", sym: "BTCUSD", cls: "crypto", dp: 0, pre: "$", ccy: ["USD"], hist: "px:BTC", live: "BTC", cot: { code: "133741", cat: "am", what: "bitcoin" }, factors: ["trend", "stretch", "cot", "crowd", "dollar", "realYield", "fed", "vixRisk"], level: 5000 },
  { id: "eth", name: "Ether", short: "ether", sym: "ETHUSD", cls: "crypto", dp: 0, pre: "$", ccy: ["USD"], hist: "px:ETH", live: "ETH", cot: { code: "146021", cat: "am", what: "ether" }, factors: ["trend", "stretch", "cot", "crowd", "dollar", "realYield", "fed", "vixRisk"], level: 250 },
];
export const CLASSES: { id: Cls; name: string }[] = [{ id: "metals", name: "Metals" }, { id: "energy", name: "Energy" }, { id: "fx", name: "Forex" }, { id: "crypto", name: "Crypto" }];
export type Weights = Record<string, number>;          // "factor" or "factor@class" -> weight
const W0: Weights = { trend: 1.2, stretch: 0.8, cot: 0.8, crowd: 0.5, dollar: 1, realYield: 1, ryLevel: 0.5, fed: 0.8, vixHaven: 0.5, vixRisk: 0.6, vixRisk0: 0.4, vixHavenFx: 0.6, stocks: 0.7, oilCad: 0.7 };
// candidates compared in the research log; weights are picked on 2018-2022 only, 2023 on stays untouched for checking
export const VARIANTS: Record<string, Weights> = {
  v0: W0,                                                // the first guess, before looking at results
  // tried on 1 Oct 2026 and dropped: a version leaning on trend by class (2023-on 51%) and a core of Fed path, crowding and VIX only (52.7%)
  // chosen: 58% on 2018-2022, 53% on 2023 on (forex 56%)
  v3: { fed: 1.2, crowd: 0.8, vixRisk: 0.6, vixRisk0: 0.6, realYield: 0.6, stocks: 0.6, oilCad: 0.5, "stretch@fx": 0.6, stretch: 0.2, trend: 0.05, cot: 0.2, dollar: 0.2, vixHaven: 0.3, vixHavenFx: 0.2, ryLevel: 0.3 },
};
export const SPLIT = "2023-01-01";                     // weights were chosen on weeks before this; weeks from it on are the out-of-sample check
let W: Weights = VARIANTS.v3;
const wOf = (k: string, cls: Cls, ws: Weights = W) => ws[k + "@" + cls] ?? ws[k] ?? 1;
export const FACTOR_INFO: [string, string][] = [
  ["Trend", "Price against its 20 week and 50 week averages."],
  ["Stretch", "Weekly RSI. Above 70 counts against more upside, below 30 against more downside."],
  ["Positioning", "CFTC Commitments of Traders: the weekly change in the net position of hedge funds (managed money), leveraged funds or asset managers, and how crowded it is against the last 3 years."],
  ["Dollar", "The dollar index, calculated with the DXY weights from ECB reference rates. A weaker dollar helps dollar-priced metals, oil and crypto."],
  ["Real yields", "10 year inflation-protected Treasury yield (FRED DFII10): the change over 4 weeks, and the level against 10 years."],
  ["Fed path", "The 4 week change in 2 year Treasury yields (FRED DGS2), the market's read of where the Fed is heading."],
  ["Fear gauge", "The VIX (Cboe, via FRED). Fear supports gold, the yen and the franc, and weighs on oil, copper, crypto and the Aussie and kiwi."],
  ["Oil stocks", "Weekly US crude inventories excluding the strategic reserve (EIA, WCESTUS1)."],
  ["Oil and CAD", "The 4 week change in WTI, which tends to move the Canadian dollar."],
];
export const THRESH = { lean: 0.1, firm: 0.3 };

// ================================================================ weekly alignment
const DAYMS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function lastCompletedFriday(nowMs = Date.now()) {
  const d = new Date(iso(nowMs) + "T00:00:00Z"); let t = d.getTime() - DAYMS;     // a Friday counts once it's over (UTC)
  while (new Date(t).getUTCDay() !== 5) t -= DAYMS;
  return iso(t);
}
export function fridays(from: string, to: string) {
  const out: string[] = []; let t = Date.parse(from + "T00:00:00Z");
  while (new Date(t).getUTCDay() !== 5) t += DAYMS;
  for (const end = Date.parse(to + "T00:00:00Z"); t <= end; t += 7 * DAYMS) out.push(iso(t));
  return out;
}
export type Row = { d: string; v: number };
export function weekly(rows: Row[], weeks: string[], stale = 9) {
  const out: (number | null)[] = []; let j = 0, last: Row | null = null;
  for (const w of weeks) {
    while (j < rows.length && rows[j].d <= w) last = rows[j++];
    out.push(last && (Date.parse(w) - Date.parse(last.d)) / DAYMS <= stale ? last.v : null);
  }
  return out;
}
const nz = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

// the dollar index, DXY weights on ECB reference rates (rates are units of currency per US dollar)
export function dxyRows(): Row[] {
  const ccy: [string, number][] = [["EUR", 0.576], ["JPY", 0.136], ["GBP", 0.119], ["CAD", 0.091], ["SEK", 0.042], ["CHF", 0.036]];
  const maps = ccy.map(([c]) => new Map(series("ecb:" + c).map((r) => [r.d, r.v])));
  return series("ecb:EUR").map((r) => {
    let v = 50.14348112;
    for (let k = 0; k < ccy.length; k++) { const x = maps[k].get(r.d); if (!x) return null; v *= Math.pow(x, ccy[k][1]); }
    return { d: r.d, v };
  }).filter(Boolean) as Row[];
}
function despike(rows: Row[], thr = 0.07) {
  return rows.filter((r, k) => {
    if (k === 0 || k === rows.length - 1) return true;
    const a = r.v / rows[k - 1].v - 1, b = rows[k + 1].v / r.v - 1;
    return !(Math.abs(a) > thr && Math.abs(b) > thr && Math.sign(a) !== Math.sign(b));
  });
}
function priceRows(a: Asset): Row[] {
  if (a.hist.startsWith("fx:")) {
    const rows = series("ecb:" + a.hist.slice(3));
    return a.usdInv ? rows.map((r) => ({ d: r.d, v: 1 / r.v })) : rows;
  }
  let rows = series(a.hist);
  if (a.hist.startsWith("fred:")) rows = despike(rows);
  const k = scaleK(a, rows);
  if (k !== 1) rows = rows.map((r) => ({ d: r.d, v: r.v * k }));
  return rows;
}
// PAX Gold history, rescaled so the latest close matches spot gold
function scaleK(a: Asset, rows: Row[]) {
  if (!a.scaleTo) return 1;
  const sp = lastOf("spot:" + a.scaleTo), pr = rows.length ? rows[rows.length - 1].v : 0;
  const k = sp && pr ? sp.v / pr : 1;
  return k > 0.9 && k < 1.1 ? k : 1;
}

// ================================================================ candles
// Real highs and lows where a free source has them: exchange candles (Coinbase for crypto and PAX Gold, Kraken for forex)
// and the candles our own minute polls build. Elsewhere a candle is built from daily closes: it opens at the previous close
// and has no wicks of its own, and a weekly candle's high and low are its highest and lowest daily close.
export type Candle = { t: string; o: number; h: number; l: number; c: number; r: boolean };
export function candleSource(a: Asset) {
  if (a.cls === "crypto") return "Coinbase daily candles";
  if (a.scaleTo) return "PAX Gold candles from Coinbase, scaled to spot gold";
  if (a.cls === "fx") return a.id === "nzdusd" ? "ECB daily rates" : "Kraken candles, ECB rates before them";
  if (a.hist.startsWith("spot:")) return "gold-api spot, sampled every minute";
  return "EIA daily closes, via FRED";
}
export function dailyCandles(a: Asset): Candle[] {
  const raw = series(a.hist), closes = priceRows(a), k = scaleK(a, raw.length && a.hist.startsWith("fred:") ? despike(raw) : raw);
  const sids = a.hist.startsWith("px:") ? [a.hist, "live:" + a.id] : a.cls === "fx" ? ["kr:" + a.sym, "live:" + a.id] : a.live ? ["live:" + a.id] : [];
  const maps = sids.map((sid, n) => new Map(ohlc(sid).map((b) => [b.d, n === 0 && k !== 1 ? { d: b.d, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k } : b])));
  const cm = new Map(closes.map((r) => [r.d, r.v])), lastD = closes.length ? closes[closes.length - 1].d : "";
  const extra = new Set<string>();                                            // today's candle, before today's close is in the history
  for (const m of maps) for (const d of m.keys()) if (d > lastD) extra.add(d);
  const days = [...closes.map((r) => r.d), ...[...extra].sort()], tol = a.cls === "fx" ? 0.012 : 0.05, weekend = a.cls !== "crypto", today = iso(Date.now());
  const out: Candle[] = []; let prev: number | null = null;
  for (const d of days) {
    const wd = new Date(d + "T12:00:00Z").getUTCDay(), cv = cm.get(d);
    if (weekend && (wd === 0 || wd === 6)) continue;                          // markets that close at the weekend
    const ok = (b: Bar | undefined) => !!b && (cv == null ? prev == null || Math.abs(b.c / prev - 1) < tol * 2 : Math.abs(b.c / cv - 1) <= tol);
    let real: Bar | undefined;
    for (const m of maps) { const b = m.get(d); if (ok(b)) { real = b; break; } }
    // today: the exchange candle is fetched every few hours, our own polls run every minute, so take the widest range and the latest price
    const lv = maps.length > 1 ? maps[maps.length - 1].get(d) : undefined;
    if (real && lv && lv !== real && d === today && ok(lv)) real = { d, o: real.o, h: Math.max(real.h, lv.h), l: Math.min(real.l, lv.l), c: lv.c };
    if (real) out.push({ t: d, o: real.o, h: Math.max(real.h, real.o, real.c), l: Math.min(real.l, real.o, real.c), c: real.c, r: true });
    else if (cv != null) { const o = prev ?? cv; out.push({ t: d, o, h: Math.max(o, cv), l: Math.min(o, cv), c: cv, r: false }); }
    else continue;
    prev = out[out.length - 1].c;
  }
  // thinly traded days can print a stray high or low: cap each wick at four times the typical daily range
  const rng = out.filter((x) => x.r).map((x) => (x.h - x.l) / x.c).sort((x, y) => x - y);
  if (rng.length >= 20) {
    const cap = Math.max(4 * rng[Math.floor(rng.length / 2)], 0.002);
    for (const x of out) if (x.r) { const top = Math.max(x.o, x.c), bot = Math.min(x.o, x.c); x.h = Math.min(x.h, top * (1 + cap)); x.l = Math.max(x.l, bot * (1 - cap)); }
  }
  return out;
}
// candles from a plain daily series (yields, the VIX, the dollar index)
export function closeCandles(rows: Row[]): Candle[] {
  const out: Candle[] = []; let prev: number | null = null;
  for (const r of rows) { const o = prev ?? r.v; out.push({ t: r.d, o, h: Math.max(o, r.v), l: Math.min(o, r.v), c: r.v, r: false }); prev = r.v; }
  return out;
}
// weeks end on Friday, like the calls; a week still in progress is the last candle
export function weeklyCandles(days: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const x of days) {
    const t = Date.parse(x.t + "T00:00:00Z"), fri = iso(t + ((5 - new Date(t).getUTCDay() + 7) % 7) * DAYMS), cur = out[out.length - 1];
    if (cur && cur.t === fri) { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.r = cur.r || x.r; }
    else out.push({ t: fri, o: x.o, h: x.h, l: x.l, c: x.c, r: x.r });
  }
  return out;
}
const smaOf = (xs: number[], i: number, n: number) => (i + 1 >= n ? mean(xs.slice(i + 1 - n, i + 1)) : null);

// ================================================================ small statistics
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 0; };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
function back(arr: (number | null)[], i: number, n: number) { const out: number[] = []; for (let k = Math.max(0, i - n + 1); k <= i; k++) if (nz(arr[k])) out.push(arr[k]!); return out; }
function sma(arr: (number | null)[], i: number, n: number) { const xs = back(arr, i, n); return xs.length >= n * 0.9 ? mean(xs) : null; }
function changes(arr: (number | null)[], i: number, n: number, pct = true) {
  const out: number[] = [];
  for (let k = Math.max(1, i - n + 1); k <= i; k++) if (nz(arr[k]) && nz(arr[k - 1])) out.push(pct ? arr[k]! / arr[k - 1]! - 1 : arr[k]! - arr[k - 1]!);
  return out;
}
function rsi(arr: (number | null)[], i: number, n = 14) {
  const ch = changes(arr, i, n); if (ch.length < n - 2) return null;
  const up = mean(ch.map((c) => Math.max(0, c))), dn = mean(ch.map((c) => Math.max(0, -c)));
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}
const pctRank = (xs: number[], v: number) => (xs.length ? xs.filter((x) => x < v).length / xs.length : 0.5);
function prevVal(arr: (number | null)[], i: number, k = 1) { const j = i - k; return j >= 0 && nz(arr[j]) ? arr[j]! : null; }

// ================================================================ formatting
const nf = (v: number, dp = 0) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtPx = (a: Asset, v: number) => a.pre + nf(v, a.dp);
const pctS = (x: number) => { const p = Math.abs(x * 100); return (p >= 10 ? nf(p, 0) : p >= 1 ? nf(p, 1) : nf(p, 2)) + "%"; };
function about(n: number) { const a = Math.abs(n); const r = a >= 100_000 ? 1000 : a >= 10_000 ? 1000 : a >= 1000 ? 100 : 10; return nf(Math.round(a / r) * r); }
const months = (w: number) => (w >= 52 ? "1 year" : w >= 26 ? "6 month" : "3 month");

// ================================================================ the inputs, as weekly arrays
export type Ctx = {
  weeks: string[]; px: Record<string, (number | null)[]>; pxDate: Record<string, string>;
  dxy: (number | null)[]; ry: (number | null)[]; y2: (number | null)[]; vix: (number | null)[]; wti: (number | null)[]; stocks: (number | null)[];
  cot: Record<string, { net: (number | null)[]; name: string; last: { d: string; l: number; s: number; oi: number } | null }>;
};
export function buildCtx(nowMs = Date.now()): Ctx {
  const end = lastCompletedFriday(nowMs), weeks = fridays("2017-01-06", end);
  const px: Ctx["px"] = {}, pxDate: Ctx["pxDate"] = {};
  for (const a of ASSETS) { const rows = priceRows(a); px[a.id] = weekly(rows, weeks, 6); pxDate[a.id] = rows.length ? rows[rows.length - 1].d : ""; }
  const cot: Ctx["cot"] = {};
  for (const a of ASSETS) if (a.cot) {
    const rows = cotRows(a.cot.code), cat = a.cot.cat;
    // a Tuesday report is public that Friday, so it belongs to the week ending three days later
    const net = rows.map((r: any) => ({ d: iso(Date.parse(r.d) + 3 * DAYMS), v: nz(r[cat + "_l"]) && nz(r[cat + "_s"]) ? r[cat + "_l"] - r[cat + "_s"] : NaN })).filter((r: Row) => Number.isFinite(r.v));
    const lr = rows.length ? rows[rows.length - 1] : null;
    cot[a.id] = { net: weekly(net, weeks, 6), name: lr ? lr.name : "", last: lr && nz(lr[cat + "_l"]) && nz(lr[cat + "_s"]) ? { d: lr.d, l: lr[cat + "_l"], s: lr[cat + "_s"], oi: lr.oi } : null };
  }
  return {
    weeks, px, pxDate, cot,
    dxy: weekly(dxyRows(), weeks), ry: weekly(series("fred:DFII10"), weeks), y2: weekly(series("fred:DGS2"), weeks),
    vix: weekly(series("fred:VIXCLS"), weeks), wti: weekly(series("fred:DCOILWTICO"), weeks, 10), stocks: weekly(series("fred:WCESTUS1"), weeks, 10),
  };
}

// ================================================================ the factors
export type F = { key: string; s: number; w: number; text: string; short: string };
// the factors grouped into the columns of the signal matrix
export const COLS: { id: string; name: string; keys: string[] }[] = [
  { id: "trend", name: "Trend", keys: ["trend"] }, { id: "stretch", name: "Stretch", keys: ["stretch"] }, { id: "cot", name: "Fund flows", keys: ["cot"] },
  { id: "crowd", name: "Crowding", keys: ["crowd"] }, { id: "dollar", name: "Dollar", keys: ["dollar"] }, { id: "realYield", name: "Real yields", keys: ["realYield", "ryLevel"] },
  { id: "fed", name: "Fed path", keys: ["fed"] }, { id: "fear", name: "Fear gauge", keys: ["vixHaven", "vixRisk", "vixRisk0", "vixHavenFx"] }, { id: "oil", name: "Oil link", keys: ["stocks", "oilCad"] },
];
export type Cell = { s: number; c: number; w: number; text: string } | null | undefined;   // undefined: not used for this market; null: no data yet
const WHO: Record<CotCat, string> = { mm: "Hedge funds", lev: "Leveraged funds", am: "Asset managers" };
const usdBased = (a: Asset) => a.cls !== "fx";                 // priced in dollars, so a weaker dollar helps
const DOLLAR_WHY: Record<Cls, string> = { metals: "making {x} cheaper for buyers outside the US", energy: "which makes {x} cheaper for buyers outside the US", crypto: "and a softer dollar has tended to go with firmer crypto", fx: "" };

function factor(key: string, a: Asset, c: Ctx, i: number): F | null {
  const p = c.px[a.id], w = wOf(key, a.cls), x = a.short;
  const mk = (s: number, text: string, short: string): F => ({ key, s: clamp(s, -1, 1), w, text, short });
  switch (key) {
    case "trend": {
      const v = p[i], m20 = sma(p, i, 20), m50 = sma(p, i, 50);
      if (!nz(v) || m20 === null || m50 === null) return null;
      if (v > m20 && v > m50) return mk(m20 > m50 ? 0.9 : 0.6, `Price sits above its 20 week and 50 week averages, with the 50 week near ${fmtPx(a, m50)}.`, "an intact uptrend");
      if (v < m20 && v < m50) return mk(m20 < m50 ? -0.9 : -0.6, `Price is below its 20 week and 50 week averages, with the 50 week near ${fmtPx(a, m50)} overhead.`, "a downtrend");
      return mk(0, `Price is between its 20 week (${fmtPx(a, m20)}) and 50 week (${fmtPx(a, m50)}) averages.`, "a mixed trend");
    }
    case "stretch": {
      const r = rsi(p, i), v = p[i], pv = prevVal(p, i);
      if (r === null || !nz(v) || pv === null) return null;
      const ch = v / pv - 1, wk = Math.abs(ch) >= 0.02 ? `${a.name} ${ch > 0 ? "rose" : "fell"} ${pctS(ch)} in a week and ` : "";
      if (r >= 70) return mk(-0.4 - (r - 70) / 40, `${wk}${wk ? "m" : "M"}omentum is near overbought (weekly RSI ${nf(r)}).`, "stretched momentum");
      if (r <= 30) return mk(0.4 + (30 - r) / 40, `${wk}${wk ? "m" : "M"}omentum is near oversold (weekly RSI ${nf(r)}), which often slows the selling.`, "oversold momentum");
      return mk(0, `Weekly RSI is ${nf(r)}, neither stretched nor oversold.`, "");
    }
    case "cot": case "crowd": {
      const ct = a.cot && c.cot[a.id]; if (!ct) return null;
      const n = ct.net, v = n[i], pv = prevVal(n, i);
      if (!nz(v) || pv === null) return null;
      const d = v - pv, sdD = sd(changes(n, i, 104, false)), hist = back(n, i, 156);
      if (hist.length < 52 || !sdD) return null;
      const pr = pctRank(hist, v), sign = a.cot!.inv ? -1 : 1, what = a.cot!.what ? a.cot!.what + " " : "", who = WHO[a.cot!.cat];
      const extreme = pr >= 0.9 || pr <= 0.1;
      if (key === "crowd") {
        if (!extreme) return mk(0, "", "");
        // positioning at a 3 year extreme leaves fewer new buyers (or sellers) to push it further
        const longSide = pr >= 0.9;
        const txt = v >= 0
          ? (longSide ? `At about ${about(v)} net long ${what}contracts, ${who.toLowerCase()} are near their biggest bet in 3 years, so the trade is crowded.` : `${who} hold only about ${about(v)} net long ${what}contracts, near a 3 year low, so there's room to buy.`)
          : (longSide ? `${who}' net short of about ${about(v)} ${what}contracts is the smallest in 3 years.` : `${who} are about ${about(v)} ${what}contracts net short, near the biggest short in 3 years, so the trade is crowded.`);
        return mk((longSide ? -0.45 : 0.45) * sign, txt, longSide ? (sign > 0 ? "crowded longs" : `a crowded ${a.cot!.what} long`) : (sign > 0 ? "room to buy" : `a crowded ${a.cot!.what} short`));
      }
      const z = d / sdD;
      if (Math.abs(z) < 0.25) return mk(0, "", "");
      const lvl = extreme ? "" : `, and at ${about(v)} the bet is ${pr >= 0.7 ? "on the high side for 3 years" : pr <= 0.3 ? "on the low side for 3 years" : "only mid range"}`;
      const text = v >= 0
        ? `${who} ${d >= 0 ? "added" : "cut"} about ${about(d)} net long ${what}contracts${lvl}.`
        : `${who} ${d <= 0 ? "added about " + about(d) + " contracts to" : "trimmed about " + about(d) + " contracts from"} their net short ${what}position${extreme ? "" : `, now about ${about(v)}`}.`;
      const sh = d * sign > 0 ? (a.cot!.inv ? `funds selling the ${a.cot!.what}` : "funds adding exposure") : (a.cot!.inv ? `funds buying the ${a.cot!.what}` : "funds cutting exposure");
      return mk(clamp(z, -1.5, 1.5) * 0.45 * sign, text, sh);
    }
    case "dollar": {
      if (!usdBased(a)) return null;
      const v = c.dxy[i], pv = prevVal(c.dxy, i); if (!nz(v) || pv === null) return null;
      const ch = v / pv - 1, s0 = sd(changes(c.dxy, i, 52)); if (!s0) return null;
      const lo = back(c.dxy, i, 13), hi13 = Math.max(...lo), lo13 = Math.min(...lo);
      const tag = v <= lo13 ? `, a ${months(13)} low` : v >= hi13 ? `, a ${months(13)} high` : "";
      const why = DOLLAR_WHY[a.cls].replace("{x}", x);
      if (Math.abs(ch) < 0.0015) return mk(0, `The dollar index was flat at ${nf(v, 2)}.`, "");
      return ch < 0
        ? mk(-clamp(ch / s0, -1.5, 1.5) * 0.55, `The dollar index fell ${pctS(ch)} to ${nf(v, 2)}${tag}, ${why}.`, "a weaker dollar")
        : mk(-clamp(ch / s0, -1.5, 1.5) * 0.55, `The dollar index rose ${pctS(ch)} to ${nf(v, 2)}${tag}${a.cls === "crypto" ? ", a headwind for crypto" : `, which makes ${x} dearer outside the US`}.`, "a firmer dollar");
    }
    case "realYield": {
      const v = c.ry[i], p1 = prevVal(c.ry, i), p4 = prevVal(c.ry, i, 4); if (!nz(v) || p1 === null || p4 === null) return null;
      const d1 = v - p1, d4 = v - p4, s = -clamp(d4 / 0.2, -1, 1) * 0.6 - clamp(d1 / 0.1, -1, 1) * 0.2;
      const dd = Math.abs(d1) >= 0.03 ? d1 : d4, when = Math.abs(d1) >= 0.03 ? "" : " over four weeks";
      if (Math.abs(dd) < 0.03) return mk(0, `Inflation adjusted 10 year yields were steady at ${nf(v, 2)}%.`, "");
      return dd < 0
        ? mk(s, `Inflation adjusted 10 year yields eased to ${nf(v, 2)}%${when}, so holding ${x} costs slightly less.`, "lower real yields")
        : mk(s, `Inflation adjusted 10 year yields rose to ${nf(v, 2)}%${when}, which raises the cost of holding ${x}.`, "rising real yields");
    }
    case "ryLevel": {
      const v = c.ry[i]; if (!nz(v)) return null;
      const hist = back(c.ry, i, 520); if (hist.length < 150) return null;
      const pr = pctRank(hist, v);
      if (pr >= 0.85) return mk(-0.35, `Real yields at ${nf(v, 2)}% are still historically high, so cash and bonds pay well.`, "high real yields");
      if (pr <= 0.15) return mk(0.35, `Real yields at ${nf(v, 2)}% are low against the last 10 years, which suits ${x}.`, "low real yields");
      return mk(0, "", "");
    }
    case "fed": {
      const v = c.y2[i], p4 = prevVal(c.y2, i, 4); if (!nz(v) || p4 === null) return null;
      const d = v - p4, usdUp = d > 0;
      if (Math.abs(d) < 0.12) return mk(0, `Two year Treasury yields are little changed over four weeks at ${nf(v, 2)}%.`, "");
      const txt = `Two year Treasury yields ${usdUp ? "rose" : "fell"} ${nf(Math.abs(d), 2)} points in four weeks to ${nf(v, 2)}%, so markets are pricing ${usdUp ? "a more hawkish Fed" : "more Fed cuts"}.`;
      const k = clamp(Math.abs(d) / 0.3, 0.4, 1) * 0.6;
      // a hawkish Fed lifts the dollar: bad for metals and crypto and for EURUSD-type pairs, good for USDJPY-type pairs
      const forUsd = a.cls === "fx" ? (a.usdInv ? -1 : 1) : -1;
      return mk((usdUp ? 1 : -1) * forUsd * k, txt, usdUp ? (forUsd > 0 ? "a more hawkish Fed" : "a more hawkish Fed") : "more Fed cuts priced");
    }
    case "vixHaven": case "vixRisk": case "vixRisk0": case "vixHavenFx": {
      const v = c.vix[i], pv = prevVal(c.vix, i); if (!nz(v) || pv === null) return null;
      const hist = back(c.vix, i, 52); if (hist.length < 40) return null;
      const pr = pctRank(hist, v), d = v - pv;
      if (key === "vixHaven") {
        if (pr <= 0.15) return mk(-0.3, `The VIX sits near ${nf(v)}, close to a 52 week low, so there is no fear bid.`, "no fear bid");
        if (pr >= 0.85 || d >= 4) return mk(0.35, `The VIX is up at ${nf(v)}${d >= 4 ? `, ${nf(d)} points higher on the week` : ", near a 52 week high"}, and fear tends to support gold.`, "a fear bid");
        return mk(0, "", "");
      }
      if (key === "vixHavenFx") {
        const ccyName = a.id === "usdjpy" ? "yen" : "franc";
        if (d >= 3 || pr >= 0.85) return mk(-0.45, `The VIX jumped to ${nf(v)}, and the ${ccyName} tends to gain when fear rises.`, `a fear bid for the ${ccyName}`);
        if (pr <= 0.2 && d <= 0) return mk(0.3, `The VIX is near ${nf(v)}, close to a 52 week low, so there is little demand for the ${ccyName} as a safe haven.`, "calm markets");
        return mk(0, "", "");
      }
      const k = key === "vixRisk0" ? 0.6 : 1;
      if (d >= 3 || pr >= 0.85) return mk(-0.45 * k, `The VIX jumped to ${nf(v)}${d >= 3 ? `, up ${nf(d)} points on the week` : ""}, a sign that investors are cutting risk.`, "rising fear");
      if (pr <= 0.2 && d <= 0) return mk(0.3 * k, `The VIX eased to ${nf(v)}, close to a 52 week low, so markets are calm${a.cls === "fx" ? "" : ` and ${x} buyers have room`}.`, "calm markets");
      return mk(0, "", "");
    }
    case "stocks": {
      const v = c.stocks[i], pv = prevVal(c.stocks, i); if (!nz(v) || pv === null) return null;
      const d = v - pv, s0 = sd(changes(c.stocks, i, 52, false)); if (!s0) return null;
      const m = Math.abs(d) / 1000;
      if (m < 0.5) return mk(0, `US crude stocks were little changed last week (EIA).`, "");
      return d < 0
        ? mk(clamp(-d / s0, 0, 1.5) * 0.4, `US crude stocks fell ${nf(m, 1)} million barrels last week (EIA), a tighter market.`, "falling crude stocks")
        : mk(-clamp(d / s0, 0, 1.5) * 0.4, `US crude stocks rose ${nf(m, 1)} million barrels last week (EIA), a sign of softer demand.`, "rising crude stocks");
    }
    case "oilCad": {
      const v = c.wti[i], p4 = prevVal(c.wti, i, 4); if (!nz(v) || p4 === null) return null;
      const ch = v / p4 - 1;
      if (Math.abs(ch) < 0.03) return mk(0, "", "");
      return mk(-clamp(ch / 0.08, -1, 1) * 0.45, `Oil is ${ch > 0 ? "up" : "down"} ${pctS(ch)} in four weeks, which tends to ${ch > 0 ? "support" : "weigh on"} the Canadian dollar.`, ch > 0 ? "firmer oil" : "weaker oil");
    }
  }
  return null;
}

// ================================================================ the call
export type Call = { score: number; dir: -1 | 0 | 1; label: string; conf: "low" | "moderate" | "high"; coverage: number; agree: number };
export function score(a: Asset, c: Ctx, i: number, ws?: Weights): { call: Call; fs: F[] } {
  let fs = a.factors.map((k) => factor(k, a, c, i)).filter(Boolean) as F[];
  if (ws) fs = fs.map((f) => ({ ...f, w: wOf(f.key, a.cls, ws) }));
  const tw = a.factors.reduce((t, k) => t + wOf(k, a.cls, ws), 0), aw = fs.reduce((t, f) => t + f.w, 0);
  const sc = aw ? fs.reduce((t, f) => t + f.s * f.w, 0) / aw : 0;
  const dir = sc >= THRESH.lean ? 1 : sc <= -THRESH.lean ? -1 : 0;
  const voting = fs.filter((f) => Math.abs(f.s) >= 0.1), vw = voting.reduce((t, f) => t + f.w, 0);
  const agree = vw ? voting.filter((f) => Math.sign(f.s) === Math.sign(sc)).reduce((t, f) => t + f.w, 0) / vw : 0;
  const coverage = tw ? aw / tw : 0;
  const conf: Call["conf"] = Math.abs(sc) >= THRESH.firm && agree >= 0.75 && coverage >= 0.8 ? "high" : (Math.abs(sc) >= 0.18 || agree >= 0.7) && coverage >= 0.6 ? "moderate" : "low";
  const label = dir === 0 ? "No clear lean" : `${Math.abs(sc) >= THRESH.firm ? "" : "Leaning "}${dir > 0 ? "bullish" : "bearish"}`;
  return { call: { score: Math.round(sc * 100) / 100, dir, label: label[0].toUpperCase() + label.slice(1), conf, coverage, agree }, fs };
}

// ================================================================ backtest: the same rules on past weeks, judged on the next week's move
export type Back = { n: number; hits: number; rate: number; upRate: number; from: string; avgBull: number | null; avgBear: number | null;
  early: { n: number; hits: number; up: number; tot: number }; late: { n: number; hits: number; up: number; tot: number };
  weeks: { wk: string; px: number; dir: number; next: number | null }[] };
export function backtest(a: Asset, c: Ctx, upto = c.weeks.length - 1): Back | null {
  const p = c.px[a.id]; let n = 0, hits = 0, ups = 0, tot = 0, from = "";
  const bull: number[] = [], bear: number[] = [], weeks: Back["weeks"] = [];
  const early = { n: 0, hits: 0, up: 0, tot: 0 }, late = { n: 0, hits: 0, up: 0, tot: 0 };
  for (let i = 52; i <= upto; i++) {
    if (!nz(p[i])) continue;
    const { call } = score(a, c, i), next = i < upto && nz(p[i + 1]) ? p[i + 1]! : null;
    if (upto - i < 104) weeks.push({ wk: c.weeks[i], px: p[i]!, dir: call.coverage < 0.6 ? 0 : call.dir, next });
    if (next === null) continue;
    const r = next / p[i]! - 1, part = c.weeks[i] >= SPLIT ? late : early; tot++; part.tot++; if (r > 0) { ups++; part.up++; }
    if (call.coverage < 0.6 || call.dir === 0) continue;
    n++; part.n++; if (!from) from = c.weeks[i];
    if (Math.sign(r) === call.dir) { hits++; part.hits++; }
    (call.dir > 0 ? bull : bear).push(r);
  }
  if (n < 10) return null;
  return { n, hits, rate: hits / n, upRate: tot ? ups / tot : 0.5, from, avgBull: bull.length ? mean(bull) : null, avgBear: bear.length ? mean(bear) : null, early, late, weeks };
}

// ================================================================ research: does each factor's sign line up with next week's move?
export function factorStats(c: Ctx) {
  const st = new Map<string, { n: [number, number]; h: [number, number]; r: [number, number] }>();
  const add = (k: string, late: number, hit: boolean, r: number) => {
    const x = st.get(k) || { n: [0, 0], h: [0, 0], r: [0, 0] }; x.n[late]++; if (hit) x.h[late]++; x.r[late] += r; st.set(k, x);
  };
  for (const a of ASSETS) {
    const p = c.px[a.id];
    for (let i = 52; i < c.weeks.length - 1; i++) {
      if (!nz(p[i]) || !nz(p[i + 1])) continue;
      const r = p[i + 1]! / p[i]! - 1, late = c.weeks[i] >= "2023-01-01" ? 1 : 0;
      for (const k of a.factors) {
        const f = factor(k, a, c, i); if (!f || Math.abs(f.s) < 0.1) continue;
        add(k, late, Math.sign(f.s) === Math.sign(r), Math.sign(f.s) * r);
        add(k + "@" + a.cls, late, Math.sign(f.s) === Math.sign(r), Math.sign(f.s) * r);
      }
      for (const [v, ws] of Object.entries(VARIANTS)) {
        const { call } = score(a, c, i, ws);
        if (call.dir && call.coverage >= 0.6) { add("MODEL-" + v, late, call.dir === Math.sign(r), call.dir * r); add("MODEL-" + v + "@" + a.cls, late, call.dir === Math.sign(r), call.dir * r); }
        if (call.dir && Math.abs(call.score) >= THRESH.firm) add("FIRM-" + v, late, call.dir === Math.sign(r), call.dir * r);
      }
      add("UP", late, r > 0, r);
    }
  }
  return [...st.entries()].sort().map(([k, x]) => `${k}: early ${x.n[0]} ${x.n[0] ? Math.round((x.h[0] / x.n[0]) * 1000) / 10 : "-"}% ${x.n[0] ? Math.round((x.r[0] / x.n[0]) * 1e5) / 10 : "-"}bp | late ${x.n[1]} ${x.n[1] ? Math.round((x.h[1] / x.n[1]) * 1000) / 10 : "-"}% ${x.n[1] ? Math.round((x.r[1] / x.n[1]) * 1e5) / 10 : "-"}bp`);
}

// ================================================================ the numbers traders look up: moves over each period, ranges, the 52 week range, seasonality
export const PERIODS = [["d1", "1D", "Last session"], ["w1", "1W", "1 week"], ["m1", "1M", "1 month"], ["m3", "3M", "3 months"], ["ytd", "YTD", "This year"], ["y1", "1Y", "1 year"]] as const;
export type Period = (typeof PERIODS)[number][0];
export type Stats = {
  last: number | null; lastD: string; from: string;               // from: the first daily close we hold
  ref: Record<Period, { d: string; c: number } | null>;            // the close each period's change is measured from

  ret: Record<Period, number | null>; path: Record<Period, number[]>;
  hi52: number | null; lo52: number | null; at52: number | null; offHi: number | null; offLo: number | null;
  adr: number | null; move: number | null; wkAvg: number | null; wkNow: number | null; realRange: boolean;
  rsi: number | null; ma50: number | null; ma200: number | null;
  season: { m: number; avg: number; up: number; n: number }[]; seasonFrom: string;
};
const thin = (xs: number[], n = 40) => { if (xs.length <= n) return xs; const out: number[] = []; for (let k = 0; k < n; k++) out.push(xs[Math.round((k / (n - 1)) * (xs.length - 1))]); return out; };
const r4 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e5) / 1e5);
export function marketStats(dc: Candle[], wc: Candle[], nowMs = Date.now()): Stats {
  const n = dc.length, empty = { d1: null, w1: null, m1: null, m3: null, ytd: null, y1: null } as Record<Period, number | null>;
  const st: Stats = { last: null, lastD: "", from: n ? dc[0].t : "", ref: { d1: null, w1: null, m1: null, m3: null, ytd: null, y1: null }, ret: { ...empty }, path: { d1: [], w1: [], m1: [], m3: [], ytd: [], y1: [] }, hi52: null, lo52: null, at52: null, offHi: null, offLo: null,
    adr: null, move: null, wkAvg: null, wkNow: null, realRange: false, rsi: null, ma50: null, ma200: null, season: [], seasonFrom: "" };
  if (n < 2) return st;
  const last = dc[n - 1], lastMs = Date.parse(last.t + "T00:00:00Z"), cl = dc.map((x) => x.c);
  st.last = last.c; st.lastD = last.t;
  // the close on or before a date, if there is one within a week of it
  const before = (ms: number) => { let k = n - 1; while (k >= 0 && Date.parse(dc[k].t + "T00:00:00Z") > ms) k--; return k >= 0 && ms - Date.parse(dc[k].t + "T00:00:00Z") <= 7 * DAYMS ? k : -1; };
  const refs: Record<Period, number> = { d1: n - 2, w1: before(lastMs - 7 * DAYMS), m1: before(lastMs - 30 * DAYMS), m3: before(lastMs - 91 * DAYMS),
    ytd: before(Date.parse(last.t.slice(0, 4) + "-01-01T00:00:00Z") - DAYMS), y1: before(lastMs - 365 * DAYMS) };
  // the last session's move only while it's recent: series that arrive days late (FRED oil and gas) would compare an old day with today's
  if (nowMs - lastMs > 4 * DAYMS) refs.d1 = -1;
  for (const [p] of PERIODS) {
    const k = refs[p]; if (k < 0 || !(dc[k].c > 0)) continue;
    st.ret[p] = r4(last.c / dc[k].c - 1); st.ref[p] = { d: dc[k].t, c: dc[k].c };
    st.path[p] = thin(cl.slice(k), p === "d1" ? 2 : 40).map((v) => +v.toPrecision(7));
  }
  // the last year's range
  const y0 = before(lastMs - 365 * DAYMS), yr = dc.slice(y0 >= 0 ? y0 : 0);
  if (yr.length >= 120) {
    const hi = Math.max(...yr.map((x) => x.h)), lo = Math.min(...yr.map((x) => x.l));
    st.hi52 = hi; st.lo52 = lo; st.at52 = hi > lo ? r4((last.c - lo) / (hi - lo)) : null; st.offHi = r4(last.c / hi - 1); st.offLo = r4(last.c / lo - 1);
  }
  // how far it usually moves: the daily range where candles have real highs and lows, the daily close-to-close move everywhere
  const d20 = dc.slice(-21), real = d20.filter((x) => x.r).length >= 15;
  const moves = d20.slice(1).map((x, k) => Math.abs(x.c / d20[k].c - 1)).filter(Number.isFinite);
  st.move = moves.length >= 10 ? r4(mean(moves)) : null;
  if (real) { const rs = dc.slice(-15, -1).filter((x) => x.r).map((x) => (x.h - x.l) / x.c); st.adr = rs.length >= 10 ? r4(mean(rs)) : null; }
  const wk = wc.slice(-27, -1), wr = wk.slice(1).map((x, k) => (x.h - x.l) / wk[k].c).filter(Number.isFinite);
  st.wkAvg = wr.length >= 12 ? r4(mean(wr)) : null; st.realRange = real;
  if (wc.length >= 2) { const cw = wc[wc.length - 1], pw = wc[wc.length - 2]; st.wkNow = r4((cw.h - cw.l) / pw.c); }
  // momentum and distance from the averages, on daily closes
  const ch = cl.slice(-15).slice(1).map((v, k) => v / cl.slice(-15)[k] - 1);
  if (ch.length >= 12) { const up = mean(ch.map((c) => Math.max(0, c))), dn = mean(ch.map((c) => Math.max(0, -c))); st.rsi = dn === 0 ? 100 : Math.round(100 - 100 / (1 + up / dn)); }
  if (n >= 50) st.ma50 = r4(last.c / mean(cl.slice(-50)) - 1);
  if (n >= 200) st.ma200 = r4(last.c / mean(cl.slice(-200)) - 1);
  // seasonality: each calendar month's return, close to close, over every complete month we have
  const me = new Map<string, number>();
  for (const x of dc) me.set(x.t.slice(0, 7), x.c);
  const ms = [...me.entries()], curM = last.t.slice(0, 7), by: number[][] = Array.from({ length: 12 }, () => []);
  for (let k = 1; k < ms.length; k++) {
    const [ym, v] = ms[k], [pym, pv] = ms[k - 1];
    if (ym === curM) continue;
    const gap = (Number(ym.slice(0, 4)) - Number(pym.slice(0, 4))) * 12 + Number(ym.slice(5)) - Number(pym.slice(5));
    if (gap !== 1 || !(pv > 0)) continue;
    by[Number(ym.slice(5)) - 1].push(v / pv - 1);
    if (!st.seasonFrom) st.seasonFrom = ym;
  }
  st.season = by.map((xs, m) => ({ m, avg: xs.length ? r4(mean(xs))! : 0, up: xs.length ? Math.round((xs.filter((x) => x > 0).length / xs.length) * 100) / 100 : 0, n: xs.length }));
  return st;
}

// weekly-return correlations between markets, and with the macro inputs, so the page can say what moves together
export function pearson(x: number[], y: number[]) {
  const n = x.length; if (n < 8) return null;
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { const a = x[k] - mx, b = y[k] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100 : null;
}
export function weeklyReturns(arr: (number | null)[], pct = true) { return arr.map((v, k) => (k && nz(v) && nz(arr[k - 1]) ? (pct ? v / arr[k - 1]! - 1 : v - arr[k - 1]!) : null)); }
export function corrOver(a: (number | null)[], b: (number | null)[], weeks: number) {
  const x: number[] = [], y: number[] = [], n = Math.min(a.length, b.length);
  for (let k = Math.max(0, n - weeks); k < n; k++) if (nz(a[k]) && nz(b[k])) { x.push(a[k]!); y.push(b[k]!); }
  return x.length >= weeks * 0.7 ? pearson(x, y) : null;
}

// ================================================================ the brief, written like a weekly post
export type Brief = {
  id: string; name: string; sym: string; cls: Cls; asOf: string; title: string; call: Call; px: number | null; pxTxt: string; chg: number | null;
  priceLine: string; forIt: string[]; against: string[]; verdict: string; watch: Ev[]; watchLine: string;
  live: { price: number; at: number; chg: number | null } | null; back: Back | null; notes: string[];
  cot: { name: string; net: number; chg: number; pct: number; who: string; inv: boolean; what: string; long: number | null; short: number | null; hist: number[]; lo: number; hi: number } | null;
  recent: { wk: string; dir: number; res: number | null }[];
  cells: Record<string, Cell>; drivers: { key: string; name: string; c: number; s: number; text: string }[];
  chart: { wk: string; px: number; o: number; h: number; l: number; r: boolean; m20: number | null; m50: number | null }[]; pxDate: string;
  day: { t: string; o: number; h: number; l: number; c: number; r: boolean; m20: number | null; m50: number | null }[]; cndSrc: string;
  stats: Stats;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const short = (d: string) => { const t = new Date(d + "T12:00:00Z"); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${String(t.getUTCFullYear()).slice(2)}`; };
function dow(utc: number) {                                              // the day as seen in Malta, where the posts go out
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "numeric", timeZone: "Europe/Malta" }).formatToParts(new Date(utc * 1000)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${MON[Number(p.month) - 1]}`;
}
const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

function priceLine(a: Asset, p: (number | null)[], i: number) {
  const v = p[i], pv = prevVal(p, i); if (!nz(v)) return { line: "", chg: null as number | null };
  if (pv === null) return { line: `Price: ${fmtPx(a, v)}.`, chg: null };
  const ch = v / pv - 1, dir = ch >= 0 ? "up" : "down";
  let line = `Price: ${fmtPx(a, v)}, ${Math.abs(ch) < 0.0005 ? "flat" : `${dir} ${pctS(ch)}`} on the week.`;
  const step = a.level, crossed: number[] = [];
  if (ch > 0) for (let L = Math.ceil(pv / step) * step; L <= v; L += step) crossed.push(L);
  else for (let L = Math.floor(pv / step) * step; L >= v; L -= step) crossed.push(L);
  const prior = back(p, i - 1, 52), n13 = back(p, i - 1, 13), n26 = back(p, i - 1, 26);
  let ext = "";
  if (prior.length >= 50 && (ch > 0 ? v > Math.max(...prior) : v < Math.min(...prior))) ext = months(52);
  else if (n26.length >= 24 && (ch > 0 ? v > Math.max(...n26) : v < Math.min(...n26))) ext = months(26);
  else if (n13.length >= 12 && (ch > 0 ? v > Math.max(...n13) : v < Math.min(...n13))) ext = months(13);
  const lv = crossed.slice(-2).map((L) => fmtPx(a, L));
  if (lv.length && ext) line += ` ${ch > 0 ? "Cleared" : "Broke below"} ${join(lv)} for a ${ext} ${ch > 0 ? "high" : "low"}.`;
  else if (lv.length) line += ` ${ch > 0 ? "Cleared" : "Broke below"} ${join(lv)}.`;
  else if (ext) line += ` That's a ${ext} ${ch > 0 ? "high" : "low"}.`;
  return { line, chg: ch };
}

export function brief(a: Asset, c: Ctx, nowS = Date.now() / 1000, bt: (a: Asset, c: Ctx, i: number) => Back | null = backtest): Brief {
  const p = c.px[a.id];
  let i = c.weeks.length - 1; while (i > 0 && !nz(p[i])) i--;           // this market's latest complete week
  if (!nz(p[i])) i = c.weeks.length - 1;                                  // no history yet: the latest week, with the live price
  const { call, fs } = score(a, c, i);
  const sp0 = a.live ? spotNow(a.live) : null;
  const bk = bt(a, c, i);
  if (call.dir) {
    const L = bk?.late, lr = L && L.n >= 40 ? L.hits / L.n : null, base = L && L.tot ? Math.max(L.up, L.tot - L.up) / L.tot : 0.5;
    let lvl = lr === null ? 0 : lr >= 0.56 && lr >= base + 0.03 ? 2 : lr >= 0.53 && lr >= base + 0.01 ? 1 : 0;
    if (call.agree < 0.6 || call.coverage < 0.8) lvl = Math.max(0, lvl - 1);
    call.conf = (["low", "moderate", "high"] as const)[lvl];
  }
  const pl = nz(p[i]) ? priceLine(a, p, i) : { line: sp0 ? `Price: ${fmtPx(a, sp0.price)} (live spot).` : "", chg: null as number | null };
  const pos = fs.filter((f) => f.s >= 0.08 && f.text).sort((x, y) => y.s * y.w - x.s * x.w);
  const neg = fs.filter((f) => f.s <= -0.08 && f.text).sort((x, y) => x.s * x.w - y.s * y.w);
  const pros = call.dir >= 0 ? pos : neg, cons = call.dir >= 0 ? neg : pos;
  const sp = (xs: F[]) => xs.map((f) => f.short).filter(Boolean).slice(0, 2);
  const why = sp(pros), but = sp(cons).slice(0, 1);
  const watch = calendar().filter((e) => a.ccy.includes(e.ccy) && e.utc > nowS - 3600 && e.utc < nowS + 8 * 86400).slice(0, 8);
  const big = watch.find((e) => e.ccy === "USD") || watch[0];
  let verdict: string;
  if (call.dir === 0) {
    const bu = sp(pos)[0], be = sp(neg)[0];
    verdict = bu && be ? `No clear lean: ${bu} and ${be} roughly cancel out.` : bu || be ? `No clear lean: ${bu || be} on its own isn't enough for a call.` : "No clear lean this week.";
  }
  else verdict = `${why.length ? join(why)[0].toUpperCase() + join(why).slice(1) : "The balance of signals"} ${why.length > 1 ? "outweigh" : "outweighs"} ${but.length ? but[0] : "the risks for now"}.`;
  if (big) verdict += ` ${big.title} on ${dow(big.utc).split(" ")[0]} is the main risk to this view.`;
  const days = new Map<string, string[]>();
  for (const e of watch) { const k = dow(e.utc); days.set(k, [...(days.get(k) || []), e.title.replace(/\s+m\/m$|\s+y\/y$|\s+q\/q$/i, (m) => m)]); }
  const watchLine = [...days.entries()].slice(0, 4).map(([d, t]) => `${join([...new Set(t)].slice(0, 3))} ${d}`).join(". ");
  const notes: string[] = [];
  const miss = a.factors.filter((k) => !fs.find((f) => f.key === k));
  if (miss.includes("trend")) notes.push("Not enough price history yet for the trend factors. They switch on once we have 50 weeks of data.");
  if (call.coverage < 0.6) notes.push("Fewer than 60% of this market's factors have data, so treat the call with extra caution.");
  if (a.id === "gold") notes.push("Gold's price history uses PAX Gold (a token backed by one ounce of gold each), rescaled to the current spot price.");
  const live = sp0 ? { price: sp0.price, at: sp0.at, chg: nz(p[i]) ? sp0.price / p[i]! - 1 : null } : null;
  let cot: Brief["cot"] = null;
  if (a.cot && c.cot[a.id]) {
    const n = c.cot[a.id].net, v = n[i], pv = prevVal(n, i), hist = back(n, i, 156);
    const last = c.cot[a.id].last;
    if (nz(v) && pv !== null && hist.length >= 52) cot = { name: c.cot[a.id].name, net: v, chg: v - pv, pct: pctRank(hist, v), who: WHO[a.cot.cat], inv: !!a.cot.inv, what: a.cot.what,
      long: last ? last.l : null, short: last ? last.s : null, hist: back(n, i, 156), lo: Math.min(...hist), hi: Math.max(...hist) };
  }
  // each factor's share of the score, for the matrix and the "what's driving it" bars
  const aw = fs.reduce((t, f) => t + f.w, 0) || 1, cells: Record<string, Cell> = {};
  for (const col of COLS) {
    const used = col.keys.filter((k) => a.factors.includes(k));
    if (!used.length) continue;
    const got = fs.filter((f) => used.includes(f.key));
    cells[col.id] = got.length ? { s: Math.max(-1, Math.min(1, got.reduce((t, f) => t + f.s * f.w, 0) / got.reduce((t, f) => t + f.w, 0))), c: got.reduce((t, f) => t + (f.s * f.w) / aw, 0), w: got.reduce((t, f) => t + f.w, 0), text: got.map((f) => f.text).filter(Boolean).join(" ") } : null;
  }
  const drivers = COLS.filter((col) => cells[col.id]).map((col) => ({ key: col.id, name: col.name, c: cells[col.id]!.c, s: cells[col.id]!.s, text: cells[col.id]!.text })).sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
  // candles: two years of weeks (the week in progress is the last one) and six months of days, with their moving averages
  const dc = dailyCandles(a), wc = weeklyCandles(dc), wcl = wc.map((x) => x.c), dcl = dc.map((x) => x.c);
  const chart: Brief["chart"] = wc.map((x, k) => ({ wk: x.t, px: x.c, o: x.o, h: x.h, l: x.l, r: x.r, m20: smaOf(wcl, k, 20), m50: smaOf(wcl, k, 50) })).slice(-104);
  const day: Brief["day"] = dc.map((x, k) => ({ ...x, m20: smaOf(dcl, k, 20), m50: smaOf(dcl, k, 50) })).slice(-130);
  return {
    id: a.id, name: a.name, sym: a.sym, cls: a.cls, asOf: c.weeks[i], title: `${a.name.toUpperCase()} WEEKLY, ${short(c.weeks[i])}`, call,
    px: nz(p[i]) ? p[i] : null, pxTxt: nz(p[i]) ? fmtPx(a, p[i]!) : "", chg: pl.chg, priceLine: pl.line,
    forIt: pros.slice(0, 5).map((f) => f.text), against: cons.slice(0, 4).map((f) => f.text), verdict, watch, watchLine,
    live, back: bk, notes, cot, recent: [], cells, drivers, chart, day, cndSrc: candleSource(a), pxDate: c.pxDate[a.id] || "", stats: marketStats(dc, wc, nowS * 1000),
  };
}
function spotNow(sym: string) { const s = spot[sym]; if (s && Date.now() - s.at < 6 * 3600_000) return s; const l = lastOf("spot:" + sym); return l ? { price: l.v, at: Date.parse(l.d + "T12:00:00Z") } : null; }

export const sides = (dir: number) => (dir ? ["For it", "Against it"] : ["Bullish side", "Bearish side"]);
// the post as it would go on Telegram
export function postText(b: Brief, url: string) {
  const L = [`📊 ${b.title}`, `Call: ${b.call.label}${b.call.dir ? `, ${b.call.conf} confidence` : ""}.`, b.priceLine, ""];
  const [h1, h2] = sides(b.call.dir);
  if (b.forIt.length) { L.push(h1 + ":"); for (const t of b.forIt) L.push((b.call.dir ? "✅ " : "🟢 ") + t); L.push(""); }
  if (b.against.length) { L.push(h2 + ":"); for (const t of b.against) L.push("🔻 " + t); L.push(""); }
  L.push(b.verdict);
  if (b.watchLine) L.push("", "👀 Watch: " + b.watchLine + ".");
  L.push("", `Model call from public data, not advice. Data and track record: ${url}`);
  return L.join("\n");
}
