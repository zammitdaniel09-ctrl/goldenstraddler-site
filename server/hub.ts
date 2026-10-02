/*
 * Markets hub: keeps this week's briefs in memory, freezes each week's calls so they can be graded,
 * and renders /markets and /markets/<market> on the server (so search engines read the text).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { all, now, one, run } from "./db";
import { esc, getS, siteUrl } from "./util";
import { COT, calendar, kvGet, kvSet, refreshAll, series, sources, startHubData } from "./hubdata";
import { intraday, quotes, startLive } from "./hublive";
import { ASSETS, CLASSES, COLS, FACTOR_INFO, THRESH, backtest, brief, buildCtx, closeCandles, dxyRows, factorStats, fmtPx, postText, short, sides, weeklyCandles, type Asset, type Back, type Brief, type Candle, type Ctx } from "./hubmodel";

const state = { briefs: [] as Brief[], at: 0, asOf: "", busy: false, err: "", sig: "", statsDone: false, macro: [] as Macro[] };
const backCache = new Map<string, Back | null>();
const cachedBack = (a: Asset, c: Ctx, i: number) => {
  // keyed on the data too, so a backtest is redone when history arrives or changes, but not on every refresh
  const p = c.px[a.id], n = p.filter((x) => x != null).length, ct = c.cot[a.id]?.net.filter((x) => x != null).length || 0;
  const k = `${a.id}:${c.weeks[i]}:${n}:${p[i] ?? ""}:${ct}:${c.ry.filter((x) => x != null).length}:${c.vix.filter((x) => x != null).length}`;
  if (!backCache.has(k)) backCache.set(k, backtest(a, c, i));
  return backCache.get(k)!;
};

export async function computeHub() {
  if (state.busy) return; state.busy = true;
  try {
    const c = buildCtx(), out: Brief[] = [];
    for (const a of ASSETS) { out.push(brief(a, c, Date.now() / 1000, cachedBack)); await Bun.sleep(0); }   // let requests through between markets
    if (backCache.size > 200) for (const k of [...backCache.keys()].slice(0, backCache.size - 64)) backCache.delete(k);
    freeze(out, c);
    state.briefs = out; state.at = now(); state.asOf = c.weeks[c.weeks.length - 1]; state.err = ""; state.macro = macroOf(out);
    // one line per market in the logs whenever the calls change, so they can be checked against the data
    const sig = out.map((b) => b.id + b.asOf + b.call.score).join();
    if (sig !== state.sig && out.some((b) => b.px !== null)) {
      state.sig = sig;
      for (const b of out) { const p = c.px[b.id], n = c.weeks.length; console.log(`hub ${b.id} ${b.asOf} ${b.call.label} ${b.call.score} | last weeks ${p.slice(n - 4).map((v) => (v == null ? "-" : +v.toPrecision(6))).join(" ")} | ${b.priceLine}`); }
      if (!state.statsDone && out.filter((b) => b.back).length >= 8) { state.statsDone = true; setTimeout(() => { try { for (const l of factorStats(buildCtx())) console.log("hub stat " + l); } catch (e: any) { console.error("hub stat", e.message); } }, 20_000); }
    }
    kvSet("briefs_at", String(state.at));
  } catch (e: any) { state.err = e.message; console.error("hub compute", e.stack || e.message); }
  finally { state.busy = false; }
}

// each market's call for a week is stored once, then marked right or wrong when the next week's price is in
function freeze(bs: Brief[], c: Ctx) {
  for (const b of bs) {
    if (b.px === null || b.call.coverage < 0.6) continue;
    run("INSERT OR IGNORE INTO hub_calls (wk, asset, score, dir, conf, px, at) VALUES (?, ?, ?, ?, ?, ?, ?)", b.asOf, b.id, b.call.score, b.call.dir, b.call.conf, b.px, now());
  }
  const open = all<{ wk: string; asset: string; dir: number; px: number }>("SELECT wk, asset, dir, px FROM hub_calls WHERE hit IS NULL");
  for (const r of open) {
    const i = c.weeks.indexOf(r.wk), p = c.px[r.asset];
    if (i < 0 || !p || i + 1 >= c.weeks.length || p[i + 1] == null) continue;
    const next = p[i + 1]!, hit = r.dir === 0 ? -1 : Math.sign(next - r.px) === r.dir ? 1 : 0;
    run("UPDATE hub_calls SET next_px = ?, hit = ? WHERE wk = ? AND asset = ?", next, hit, r.wk, r.asset);
  }
}
const liveRecord = (asset?: string) => one<{ n: number; hits: number; since: string | null }>(
  `SELECT COUNT(*) n, COALESCE(SUM(hit), 0) hits, MIN(wk) since FROM hub_calls WHERE hit IN (0, 1)${asset ? " AND asset = ?" : ""}`, ...(asset ? [asset] : []))!;

// the macro tiles at the top: the inputs most of the calls lean on
function macroOf(bs: Brief[]): Macro[] {
  const tile = (id: string, name: string, wc: OB[], unit: string, dp: number, mode: "pct" | "pts", note: string): Macro | null => {
    const xs = wc.slice(-53); if (xs.length < 3) return null;
    const v = xs[xs.length - 1].c, p = xs[xs.length - 2].c, chg = mode === "pct" ? v / p - 1 : v - p;
    return { id, name, v, unit, dp, chg, chgTxt: mode === "pct" ? pct(chg, 2) : sgn(chg, 2), bars: xs.slice(-52), note, good: 0 };
  };
  const wk = (rows: { d: string; v: number }[]) => weeklyCandles(closeCandles(rows.filter((r) => Number.isFinite(r.v))));
  const fromBrief = (id: string) => (bs.find((b) => b.id === id)?.chart || []).map((x) => ({ o: x.o, h: x.h, l: x.l, c: x.px }));
  return [tile("dxy", "Dollar index", wk(dxyRows()), "", 2, "pct", "DXY weights, ECB rates"), tile("ry", "US 10y real yield", wk(series("fred:DFII10")), "%", 2, "pts", "FRED DFII10"),
    tile("y2", "US 2y yield", wk(series("fred:DGS2")), "%", 2, "pts", "FRED DGS2"), tile("vix", "VIX", wk(series("fred:VIXCLS")), "", 1, "pts", "Cboe, via FRED"),
    tile("gold", "Gold", fromBrief("gold"), "$", 0, "pct", "Spot, weekly candles"), tile("wti", "WTI crude", fromBrief("wti"), "$", 2, "pct", "EIA spot, weekly candles")].filter(Boolean) as Macro[];
}

export function startHub() {
  startLive();
  setTimeout(() => computeHub(), 3000);                     // from whatever is cached, straight away
  startHubData(() => computeHub());
}
export const hubPublic = () => getS("hub_public") !== "0";   // on for good; Admin can still switch it off
const SRC_NAMES: Record<string, string> = { "kraken:fx": "Forex candles (Kraken)", ecb: "ECB exchange rates", spot: "Spot prices (gold-api)", calendar: "Release calendar", "eia:WCESTUS1": "EIA crude stocks" };
const srcName = (k: string) => SRC_NAMES[k] || (k.startsWith("fred:") ? "FRED " + k.slice(5) : k.startsWith("cot:") ? "CFTC positioning: " + (COT[k.slice(4)]?.name || k.slice(4)) : k.startsWith("coin:") ? "Price history: " + k.slice(5) : k);
export function hubStatus() {
  return { public: hubPublic(), computedAt: state.at, asOf: state.asOf, err: state.err, sources: sources().map((r) => ({ ...r, name: srcName(r.src) })), markets: state.briefs.length, live: liveRecord() };
}
export async function hubRefreshNow(force = false) { await refreshAll(undefined, force); await computeHub(); }

// ================================================================ rendering
const nf = (v: number, dp = 0) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (x: number, dp = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + nf(Math.abs(x * 100), dp) + "%";
const sgn = (x: number, dp = 2) => (x > 0 ? "+" : x < 0 ? "−" : "") + nf(Math.abs(x), dp);
const cls = (dir: number) => (dir > 0 ? "up" : dir < 0 ? "dn" : "flat");
const confDots = (c: string) => `<span class="conf" data-c="${c}" title="${c} confidence"><i></i><i></i><i></i></span>`;
function dayTime(utc: number) { return new Date(utc * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).replace(",", "") + " UTC"; }
const ASSET = new Map(ASSETS.map((a) => [a.id, a]));
const clsName = (c: string) => CLASSES.find((x) => x.id === c)?.name || c;
const art = (id: string, k = "") => `<svg class="art${k ? " " + k : ""}" aria-hidden="true"><use href="#art-${id}"/></svg>`;
const monthYear = (d: string) => new Date(d + "T12:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const pillHtml = (b: Brief) => `<span class="pill ${cls(b.call.dir)}">${esc(b.call.label)}</span>`;

// ---------------------------------------------------------------- small charts, drawn on the server so they show without scripts
function spark(vals: number[], o: { w?: number; h?: number; area?: boolean; dot?: boolean; k?: string; base?: number | null } = {}) {
  const xs = vals.filter((v) => Number.isFinite(v)); if (xs.length < 2) return `<svg class="spark empty" viewBox="0 0 100 30" aria-hidden="true"></svg>`;
  const W = o.w || 100, H = o.h || 30, lo = Math.min(...xs, o.base ?? Infinity), hi = Math.max(...xs, o.base ?? -Infinity), r = hi - lo || 1;
  const X = (i: number) => (i / (xs.length - 1)) * W, Y = (v: number) => 2 + (1 - (v - lo) / r) * (H - 4);
  const d = xs.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const up = xs[xs.length - 1] >= xs[0];
  return `<svg class="spark ${o.k || (up ? "up" : "dn")}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${o.area ? `<path class="ar" d="${d}L${W} ${H}L0 ${H}Z"/>` : ""}${o.base != null ? `<path class="bl" d="M0 ${Y(o.base).toFixed(1)}H${W}"/>` : ""}<path class="ln" d="${d}"/>${o.dot ? `<circle cx="${X(xs.length - 1).toFixed(1)}" cy="${Y(xs[xs.length - 1]).toFixed(1)}" r="1.8"/>` : ""}</svg>`;
}
// small candlestick charts: one path per colour keeps them light
type OB = { o: number; h: number; l: number; c: number };
const toOB = (x: { o: number; h: number; l: number; px: number }): OB => ({ o: x.o, h: x.h, l: x.l, c: x.px });
function minic(bars: OB[], o: { h?: number } = {}) {
  const xs = bars.filter((b) => [b.o, b.h, b.l, b.c].every(Number.isFinite));
  if (xs.length < 3) return `<svg class="cdl empty" viewBox="0 0 100 30" aria-hidden="true"></svg>`;
  const S = 6, W = xs.length * S, H = o.h || 30, lo = Math.min(...xs.map((b) => b.l)), hi = Math.max(...xs.map((b) => b.h)), r = hi - lo || Math.abs(hi) * 0.01 || 1;
  const Y = (v: number) => 1.5 + (1 - (v - lo) / r) * (H - 3), f = (v: number) => v.toFixed(1);
  const P = { wu: "", wd: "", bu: "", bd: "" };
  xs.forEach((b, i) => {
    const x = i * S + S / 2, up = b.c >= b.o, y1 = Y(Math.max(b.o, b.c)), y2 = Math.max(Y(Math.min(b.o, b.c)), y1 + 0.8);
    P[up ? "wu" : "wd"] += `M${x} ${f(Y(b.h))}V${f(Y(b.l))}`;
    P[up ? "bu" : "bd"] += `M${x - 2.1} ${f(y1)}H${x + 2.1}V${f(y2)}H${x - 2.1}Z`;
  });
  return `<svg class="cdl" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="wu" d="${P.wu}"/><path class="wd" d="${P.wd}"/><path class="bu" d="${P.bu}"/><path class="bd" d="${P.bd}"/></svg>`;
}
// score as a needle on a −1..+1 track (the visible range is ±0.6, where nearly all scores sit)
const meter = (sc: number) => `<span class="meter" title="Score ${sgn(sc)}"><i style="left:${(50 + Math.max(-1, Math.min(1, sc / 0.6)) * 50).toFixed(1)}%"></i></span>`;
function gauge(sc: number) {
  const k = Math.max(-1, Math.min(1, sc / 0.6)), ang = Math.PI * (1 - (k + 1) / 2), cx = 100, cy = 96, r = 80;
  const nx = cx + Math.cos(ang) * (r - 14), ny = cy - Math.sin(ang) * (r - 14);
  const seg = (a0: number, a1: number, c: string) => { const p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy - Math.sin(a) * r).toFixed(1)}`; return `<path d="M${p(a0)}A${r} ${r} 0 0 1 ${p(a1)}" class="${c}"/>`; };
  return `<svg class="gauge" viewBox="0 0 200 112" role="img" aria-label="Score ${sgn(sc)} on a scale from −1 to +1">
    ${seg(Math.PI, Math.PI * 0.6, "g-dn")}${seg(Math.PI * 0.6, Math.PI * 0.4, "g-mid")}${seg(Math.PI * 0.4, 0, "g-up")}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="g-nd"/><circle cx="${cx}" cy="${cy}" r="5" class="g-hub"/>
    <text x="22" y="110" class="g-lb">Bearish</text><text x="178" y="110" text-anchor="end" class="g-lb">Bullish</text></svg>`;
}

// ---------------------------------------------------------------- where to watch a release, and the official source
const OFFICIAL: [RegExp, string, string, string][] = [
  [/FOMC|Federal Funds|Fed Chair|Powell|Fed /i, "https://www.federalreserve.gov/newsevents.htm", "Federal Reserve", "the Fed"],
  [/Non-Farm|Unemployment Rate|Average Hourly|JOLTS|CPI|PPI|Employment Cost/i, "https://www.bls.gov/schedule/news_release/", "U.S. Bureau of Labor Statistics", "BLS"],
  [/GDP|PCE|Personal (Income|Spending)/i, "https://www.bea.gov/news/schedule", "U.S. Bureau of Economic Analysis", "BEA"],
  [/Unemployment Claims/i, "https://www.dol.gov/ui/data.pdf", "U.S. Department of Labor", "Labor Dept"],
  [/Retail Sales|Durable Goods/i, "https://www.census.gov/economic-indicators/", "U.S. Census Bureau", "Census"],
  [/ISM/i, "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/", "Institute for Supply Management", "ISM"],
];
const CB: Record<string, [string, string, string]> = { EUR: ["https://www.ecb.europa.eu/press/html/index.en.html", "European Central Bank", "ECB"], GBP: ["https://www.bankofengland.co.uk/news", "Bank of England", "BoE"],
  JPY: ["https://www.boj.or.jp/en/", "Bank of Japan", "BoJ"], AUD: ["https://www.rba.gov.au/media-releases/", "Reserve Bank of Australia", "RBA"], CAD: ["https://www.bankofcanada.ca/press/", "Bank of Canada", "BoC"],
  NZD: ["https://www.rbnz.govt.nz/news-and-events", "Reserve Bank of New Zealand", "RBNZ"], CHF: ["https://www.snb.ch/en/", "Swiss National Bank", "SNB"] };
function official(e: { ccy: string; title: string }): [string, string, string] | null {
  if (e.ccy === "USD") { const m = OFFICIAL.find(([re]) => re.test(e.title)); return m ? [m[1], m[2], m[3]] : null; }
  return CB[e.ccy] || null;
}
const COUNTRY: Record<string, string> = { USD: "US", EUR: "Euro area", GBP: "UK", JPY: "Japan", AUD: "Australia", CAD: "Canada", NZD: "New Zealand", CHF: "Switzerland", CNY: "China" };
const ytUrl = (e: { ccy: string; title: string }) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${COUNTRY[e.ccy] || e.ccy} ${e.title} live`);
function evLinks(e: { ccy: string; title: string }) {
  const o = official(e);
  return `<span class="ev-l"><a href="${ytUrl(e)}" target="_blank" rel="noopener nofollow" class="yt"><svg aria-hidden="true"><use href="#i-play"/></svg>Watch on YouTube</a>${o ? `<a href="${o[0]}" target="_blank" rel="noopener" title="${esc(o[1])}">Source: ${esc(o[2])}</a>` : ""}</span>`;
}

// ---------------------------------------------------------------- pieces
function backLine(b: Back | null) {
  if (!b) return "Not enough history for a backtest yet.";
  const L = b.late, E = b.early, r = (x: { n: number; hits: number }) => nf((x.hits / x.n) * 100) + "%";
  const parts: string[] = [];
  if (L.n >= 20) parts.push(`Since 2023, on data the weights never saw: right ${r(L)} of ${nf(L.n)} weekly calls, while price rose in ${nf((L.up / L.tot) * 100)}% of weeks.`);
  if (E.n >= 20) parts.push(`${monthYear(b.from)} to 2022: ${r(E)} of ${nf(E.n)}.`);
  return parts.join(" ") || `Backtest since ${monthYear(b.from)}: right ${nf(b.rate * 100)}% of ${nf(b.n)} weekly calls.`;
}
function livePx(b: Brief) {
  const a = ASSET.get(b.id)!, q = quotes.get(b.id), fresh = q && Date.now() - q.t < 15 * 60_000;
  const p = fresh ? q!.p : b.live && Date.now() - b.live.at < 36 * 3600_000 ? b.live.price : b.px;
  const sinceFri = p != null && b.px && (fresh || (b.live && Date.now() - b.live.at < 36 * 3600_000));
  const ch = sinceFri ? p! / b.px! - 1 : b.chg;
  return { txt: p != null ? fmtPx(a, p) : "–", ch, live: !!fresh, asOf: fresh ? "" : b.pxDate, weekly: !sinceFri };
}
function quoteHtml(b: Brief, big = false) {
  const q = livePx(b);
  return `<div class="q${big ? " big" : ""}" data-live="${b.id}"><b class="num px">${esc(q.txt)}</b><span class="num ch ${q.ch == null ? "" : q.ch >= 0 ? "up" : "dn"}">${q.ch == null ? "" : pct(q.ch, 2)}</span><span class="lbl">${q.live ? `<i class="dot"></i>live, since Friday's close` : q.weekly ? `week to ${esc(short(b.asOf))}${q.asOf ? `, last print ${esc(short(q.asOf))}` : ""}` : "since Friday's close"}</span></div>`;
}
function driversHtml(b: Brief, max = 6) {
  const ds = b.drivers.filter((d) => Math.abs(d.c) >= 0.005).slice(0, max);
  if (!ds.length) return "";
  const m = Math.max(0.08, ...ds.map((d) => Math.abs(d.c)));
  return `<div class="drv"><h4>What's driving it</h4><ul>${ds.map((d) => `<li title="${esc(d.text)}"><span class="drv-n">${esc(d.name)}</span><span class="drv-b"><i class="${d.c >= 0 ? "pos" : "neg"}" style="width:${((Math.abs(d.c) / m) * 50).toFixed(1)}%"></i></span><span class="num drv-v ${d.c >= 0 ? "up" : "dn"}">${sgn(d.c)}</span></li>`).join("")}</ul></div>`;
}
function watchHtml(all: Brief["watch"], max: number) {
  if (!all.length) return `<p class="fine">No high-impact releases for this market in the next week.</p>`;
  const evs = all.slice(0, max), more = all.length - evs.length;
  return `<ul class="bf-wl">${evs.map((e) => `<li><time class="num" datetime="${new Date(e.utc * 1000).toISOString()}" data-utc="${e.utc}">${esc(dayTime(e.utc))}</time><span><b>${esc(e.ccy)}</b> ${esc(e.title)}${e.fc || e.prev ? ` <em>${e.fc ? "forecast " + esc(e.fc) : ""}${e.fc && e.prev ? ", " : ""}${e.prev ? "previous " + esc(e.prev) : ""}</em>` : ""}${evLinks(e)}</span></li>`).join("")}</ul>${more > 0 ? `<p class="fine">And ${more} more this week.</p>` : ""}`;
}
function briefHtml(b: Brief) {
  const [h1, h2] = sides(b.call.dir), url = `/markets/${b.id}`;
  const li = (xs: string[], k: string) => xs.map((t) => `<li><svg aria-hidden="true"><use href="#${k}"/></svg><span>${esc(t)}</span></li>`).join("");
  const wk = b.chart.slice(-52).map(toOB);
  return `<article class="bf" id="${b.id}" data-cls="${b.cls}">
  <header class="bf-h">
    ${art(b.id)}
    <div class="bf-id"><p class="bf-t num">${esc(b.title)}</p><h3 class="bf-n"><a href="${url}">${esc(b.name)}</a> <span class="bf-sym num">${esc(b.sym)}</span></h3></div>
    ${quoteHtml(b)}
  </header>
  <div class="bf-sig">
    <div class="bf-call ${cls(b.call.dir)}"><b>${esc(b.call.label)}</b>${b.call.dir ? `${confDots(b.call.conf)}<span class="cf">${esc(b.call.conf)} confidence</span>` : ""}</div>
    <div class="bf-score">${meter(b.call.score)}<span class="num">${sgn(b.call.score)}</span></div>
  </div>
  ${wk.length > 8 ? `<div class="bf-ch">${minic(wk, { h: 46 })}<span class="fine">52 weeks</span></div>` : ""}
  <p class="bf-px">${esc(b.priceLine || "Price data is still coming in.")}</p>
  ${driversHtml(b, 4)}
  <div class="bf-body">
    ${b.forIt.length ? `<div class="bf-s"><h4>${h1}</h4><ul class="pro">${li(b.forIt, b.call.dir ? "i-check" : "i-up")}</ul></div>` : ""}
    ${b.against.length ? `<div class="bf-s"><h4>${h2}</h4><ul class="con">${li(b.against, "i-down")}</ul></div>` : ""}
  </div>
  <p class="bf-v">${esc(b.verdict)}</p>
  <div class="bf-w"><h4><svg aria-hidden="true"><use href="#i-eye"/></svg>Watch</h4>${watchHtml(b.watch, 3)}</div>
  <footer class="bf-f">
    <p class="bf-bt fine">${esc(backLine(b.back))}</p>
    ${b.notes.map((n) => `<p class="bf-note fine">${esc(n)}</p>`).join("")}
    <div class="bf-act"><button class="btn sm" type="button" data-copy><svg aria-hidden="true"><use href="#i-copy"/></svg>Copy as Telegram post</button><a class="btn sm pri" href="${url}">Charts and full data</a></div>
    <template class="bf-post">${esc(postText(b, siteUrl() + url))}</template>
  </footer>
</article>`;
}

// ---------------------------------------------------------------- the desk: board, signal matrix, positioning, track record
function boardHtml(bs: Brief[]) {
  const rows = bs.map((b) => {
    const q = livePx(b), wk = b.chart.slice(-26).map(toOB);
    return `<tr data-cls="${b.cls}" data-name="${esc(b.name)}" data-score="${b.call.score}" data-week="${b.chg ?? -9}" data-href="#${b.id}">
      <th scope="row"><a href="#${b.id}" class="mkt-n">${art(b.id, "sm")}<span><b>${esc(b.name)}</b><span class="num">${esc(b.sym)}</span></span></a></th>
      <td class="num px-c" data-live="${b.id}"><b class="px">${esc(q.txt)}</b><span class="ch ${q.ch == null ? "" : q.ch >= 0 ? "up" : "dn"}">${q.ch == null ? "" : pct(q.ch, 2)}</span></td>
      <td class="sp-c">${minic(wk, { h: 34 })}</td>
      <td class="num ${b.chg == null ? "" : b.chg >= 0 ? "up" : "dn"}">${b.chg == null ? "–" : pct(b.chg)}</td>
      <td>${pillHtml(b)}${b.call.dir ? confDots(b.call.conf) : ""}</td>
      <td class="sc-c"><span class="sc-w">${meter(b.call.score)}<span class="num">${sgn(b.call.score)}</span></span></td></tr>`;
  }).join("");
  const sb = (k: string, t: string) => `<button type="button" class="sort" data-sort="${k}">${t}</button>`;
  return `<div class="tblw"><table class="board" id="board"><thead><tr><th scope="col">${sb("name", "Market")}</th><th scope="col">Price</th><th scope="col" class="sp-c">26 weeks</th><th scope="col">${sb("week", "Week")}</th><th scope="col">Call</th><th scope="col">${sb("score", "Score")}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function matrixHtml(bs: Brief[]) {
  const head = COLS.map((c) => `<th scope="col"><span>${esc(c.name)}</span></th>`).join("");
  const rows = bs.map((b) => `<tr data-cls="${b.cls}"><th scope="row"><a href="#${b.id}" class="mkt-n">${art(b.id, "sm")}<b>${esc(b.name)}</b></a></th>${COLS.map((c) => {
    const x = b.cells[c.id];
    if (x === undefined) return `<td class="mx na" aria-label="Not used for ${esc(b.name)}"></td>`;
    if (x === null) return `<td class="mx nd" data-tip="${esc(c.name)}: no data yet for ${esc(b.name)}." tabindex="0"><span>·</span></td>`;
    const k = Math.abs(x.s) < 0.08 ? "z" : x.s > 0 ? "p" : "n";
    return `<td class="mx ${k}" style="--a:${Math.min(1, Math.abs(x.s)).toFixed(2)}" tabindex="0" data-tip="${esc(c.name)} for ${esc(b.name)}: ${esc(x.text || "neutral this week.")}"><span class="num">${sgn(x.s, 1)}</span></td>`;
  }).join("")}<td class="mx-sc"><span class="sc-w">${meter(b.call.score)}<span class="num ${cls(b.call.dir)}">${sgn(b.call.score)}</span></span></td></tr>`).join("");
  return `<div class="tblw mx-w"><table class="matrix"><thead><tr><th scope="col">Market</th>${head}<th scope="col">Score</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="mx-key fine"><span class="k p"></span>pushes the market up<span class="k n"></span>pushes it down<span class="k z"></span>neutral<span class="k na"></span>not used for that market. Darker means stronger. Tap or hover a cell for the reason.</p>`;
}
function positioningHtml(bs: Brief[]) {
  const rows = bs.filter((b) => b.cot).map((b) => {
    const c = b.cot!, share = c.long != null && c.short != null && c.long + c.short > 0 ? c.long / (c.long + c.short) : null;
    const rng = c.hi - c.lo || 1, at = ((c.net - c.lo) / rng) * 100;
    return `<tr data-cls="${b.cls}"><th scope="row"><a href="#${b.id}" class="mkt-n">${art(b.id, "sm")}<span><b>${esc(b.name)}</b><span class="num">${esc(c.what || b.sym)}</span></span></a></th>
      <td>${esc(c.who)}</td>
      <td class="num ${c.net >= 0 ? "up" : "dn"}">${c.net >= 0 ? "Long" : "Short"} ${nf(Math.abs(c.net))}</td>
      <td class="num ${c.chg >= 0 ? "up" : "dn"}">${c.chg >= 0 ? "+" : "−"}${nf(Math.abs(c.chg))}</td>
      <td>${share == null ? "–" : `<span class="share" title="${nf(share * 100)}% of their contracts are long"><i style="width:${(share * 100).toFixed(1)}%"></i></span><span class="num fine">${nf(share * 100)}% long</span>`}</td>
      <td><span class="rng" title="3 year range: ${nf(c.lo)} to ${nf(c.hi)}"><i style="left:${at.toFixed(1)}%"></i></span><span class="num fine">${nf(c.pct * 100)}th pct</span></td>
      <td class="sp-c">${spark(c.hist.slice(-52), { base: 0, k: "pos" })}</td></tr>`;
  }).join("");
  return `<div class="tblw"><table class="board pos"><thead><tr><th scope="col">Market</th><th scope="col">Who</th><th scope="col">Net position</th><th scope="col">Week change</th><th scope="col">Long share</th><th scope="col">3 year range</th><th scope="col" class="sp-c">1 year</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="fine mx-key">CFTC Commitments of Traders, futures only, contracts. Hedge funds are "managed money" in metals and energy; currencies use leveraged funds and crypto uses asset managers. Data is as of Tuesday and published on Friday.</p>`;
}
function classStats(bs: Brief[]) {
  const by = new Map<string, { e: [number, number, number, number]; l: [number, number, number, number] }>();
  for (const b of bs) if (b.back) {
    const x = by.get(b.cls) || { e: [0, 0, 0, 0], l: [0, 0, 0, 0] };
    const E = b.back.early, L = b.back.late;
    x.e[0] += E.n; x.e[1] += E.hits; x.e[2] += E.up; x.e[3] += E.tot; x.l[0] += L.n; x.l[1] += L.hits; x.l[2] += L.up; x.l[3] += L.tot;
    by.set(b.cls, x);
  }
  return by;
}
function recordHtml(bs: Brief[]) {
  const by = classStats(bs), bar = (v: number | null, k: string, lab: string) => v == null ? "" :
    `<div class="tr-b ${k}"><span class="lb">${lab}</span><span class="tk"><i style="width:${(v * 100).toFixed(1)}%"></i><em style="left:50%"></em></span><b class="num">${nf(v * 100)}%</b></div>`;
  const groups = CLASSES.filter((c) => by.has(c.id)).map((c) => { const x = by.get(c.id)!;
    return `<div class="tr-g"><h4>${c.name}</h4>${bar(x.e[0] >= 20 ? x.e[1] / x.e[0] : null, "e", `2018 to 2022, ${nf(x.e[0])} calls`)}${bar(x.l[0] >= 20 ? x.l[1] / x.l[0] : null, "l", `2023 on, ${nf(x.l[0])} calls`)}${bar(x.l[3] ? x.l[2] / x.l[3] : null, "b", "Up weeks since 2023")}</div>`; }).join("");
  const per = bs.filter((b) => b.back && b.back.late.n >= 20).map((b) => ({ b, r: b.back!.late.hits / b.back!.late.n, up: b.back!.late.up / b.back!.late.tot })).sort((x, y) => y.r - x.r);
  const lr = liveRecord();
  return `<div class="tr-wrap"><div class="tr-gs">${groups}</div>
    <div class="tr-per"><h4>Each market since 2023</h4><table class="board small"><thead><tr><th scope="col">Market</th><th scope="col">Calls</th><th scope="col">Right</th><th scope="col">Up weeks</th></tr></thead><tbody>${per.map((x) =>
      `<tr><th scope="row"><a href="/markets/${x.b.id}" class="mkt-n">${art(x.b.id, "sm")}<b>${esc(x.b.name)}</b></a></th><td class="num">${x.b.back!.late.n}</td><td class="num ${x.r > x.up ? "up" : ""}">${nf(x.r * 100)}%</td><td class="num">${nf(x.up * 100)}%</td></tr>`).join("")}</tbody></table>
    <p class="fine">${lr.n ? `Live, graded weekly since ${esc(short(lr.since!))}: ${lr.hits} of ${lr.n} calls right.` : "The live record starts with this week's calls and is graded every weekend."} The dashed line is a coin flip.</p></div></div>`;
}
function deskHtml(bs: Brief[]) {
  const t = (id: string, name: string, on = false) => `<button role="tab" type="button" id="dt-${id}" aria-controls="dp-${id}" aria-selected="${on}" data-desk="${id}">${name}</button>`;
  const p = (id: string, html: string, on = false) => `<div role="tabpanel" id="dp-${id}" aria-labelledby="dt-${id}" class="dp"${on ? "" : " hidden"}>${html}</div>`;
  return `<section class="mk-desk" id="desk"><div class="wrap">
  <div class="desk-h"><h2>The desk</h2><div class="tabs desk-t" role="tablist" aria-label="Views">${t("board", "Board", true)}${t("matrix", "Signal matrix")}${t("pos", "Positioning")}${t("rec", "Track record")}</div></div>
  <div class="tabs mk-tabs" role="tablist" aria-label="Asset class"><button role="tab" type="button" data-f="all" aria-selected="true">All markets</button>${CLASSES.map((c) => `<button role="tab" type="button" data-f="${c.id}" aria-selected="false">${c.name}</button>`).join("")}</div>
  ${p("board", boardHtml(bs), true)}${p("matrix", matrixHtml(bs))}${p("pos", positioningHtml(bs))}${p("rec", recordHtml(bs))}
</div></section>`;
}

// ---------------------------------------------------------------- the top of the page
function tickerHtml(bs: Brief[]) {
  const items = bs.map((b) => { const q = livePx(b); return `<li data-live="${b.id}"><a href="/markets/${b.id}"><b>${esc(b.sym)}</b><span class="num px">${esc(q.txt)}</span><span class="num ch ${q.ch == null ? "" : q.ch >= 0 ? "up" : "dn"}">${q.ch == null ? "" : pct(q.ch, 2)}</span></a></li>`; }).join("");
  return `<div class="tape" aria-label="Prices"><div class="tape-in"><ul>${items}</ul><ul aria-hidden="true">${items}</ul></div></div>`;
}
type Macro = { id: string; name: string; v: number; unit: string; dp: number; chg: number; chgTxt: string; bars: OB[]; note: string; good: number };
function macroHtml(ms: Macro[]) {
  return `<div class="pulse">${ms.map((m) => `<div class="pl-t"><span class="pl-n">${esc(m.name)}</span><b class="num">${m.unit === "$" ? "$" : ""}${nf(m.v, m.dp)}${m.unit === "%" ? "%" : ""}</b>
    <span class="num pl-c ${m.chg === 0 ? "" : m.chg > 0 ? "up" : "dn"}">${esc(m.chgTxt)} <span class="fine">on the week</span></span>${minic(m.bars, { h: 38 })}<span class="pl-x fine">${esc(m.note)}</span></div>`).join("")}</div>`;
}
function nextHtml() {
  const t = Date.now() / 1000, evs = calendar().filter((e) => e.utc > t - 900).slice(0, 12);
  if (!evs.length) return "";
  const days = new Map<string, typeof evs>();
  for (const e of evs) { const k = new Date(e.utc * 1000).toISOString().slice(0, 10); days.set(k, [...(days.get(k) || []), e]); }
  return `<section class="mk-next" aria-labelledby="nx-h"><div class="wrap"><div class="nx-h"><h2 id="nx-h">Releases ahead</h2><span class="fine">High impact only. Times in your time zone.</span></div><ol class="nx-l">${evs.map((e) =>
    `<li class="nx-i"><div class="nx-t"><time class="num" data-utc="${e.utc}" datetime="${new Date(e.utc * 1000).toISOString()}">${esc(dayTime(e.utc))}</time><span class="cd num" data-cd="${e.utc}"></span></div><div class="nx-m"><b class="ccy">${esc(e.ccy)}</b><span class="nx-n">${esc(e.title)}</span></div>${e.fc || e.prev ? `<div class="nx-f num">${e.fc ? `<span>Forecast <b>${esc(e.fc)}</b></span>` : ""}${e.prev ? `<span>Previous <b>${esc(e.prev)}</b></span>` : ""}</div>` : ""}${evLinks(e)}</li>`).join("")}</ol></div></section>`;
}
function summary(bs: Brief[]) {
  let n = 0, hits = 0, up = 0, tot = 0;
  for (const b of bs) if (b.back) { n += b.back.late.n; hits += b.back.late.hits; up += b.back.late.up; tot += b.back.late.tot; }
  const fx = classStats(bs).get("fx"), lr = liveRecord();
  return { n, all: n ? hits / n : null, up: tot ? up / tot : null, fx: fx && fx.l[0] >= 50 ? fx.l[1] / fx.l[0] : null, fxUp: fx && fx.l[3] ? fx.l[2] / fx.l[3] : null, lr };
}
// written from the numbers, so it stays true as weeks are added
function verdictOnTest(bs: Brief[]) {
  const by = classStats(bs), good: string[] = [], flat: string[] = [];
  for (const c of CLASSES) {
    const x = by.get(c.id); if (!x || x.l[0] < 60) continue;
    const late = x.l[1] / x.l[0], base = Math.max(x.l[2], x.l[3] - x.l[2]) / (x.l[3] || 1), early = x.e[0] ? x.e[1] / x.e[0] : 0;
    if (late >= base + 0.02 && early >= 0.53) good.push(c.name.toLowerCase()); else if (late <= base + 0.005) flat.push(c.name.toLowerCase());
  }
  const j = (xs: string[]) => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);
  let t = "What the test says: weekly direction is hard.";
  if (good.length) t += ` The model has held up on unseen data in ${j(good)}, where it beat both a coin flip and simply following the market's usual direction.`;
  if (flat.length) t += ` In ${j(flat)} it hasn't beaten ${good.length ? "that bar" : "a coin flip or the market's usual direction"} since 2023, so read those calls as a summary of the data, not a forecast.`;
  return t;
}
function methodHtml() {
  const seller = getS("seller_name") || "the operator of GoldenStraddler";
  return `<section class="mk-method" id="method"><div class="wrap">
  <h2>How the calls work</h2>
  <div class="mk-cols">
    <div>
      <p>Each market gets a score between −1 and +1 from a handful of measured factors. Every factor turns one fact into a small score for that market, with a fixed weight, and the call is the weighted average: above +${THRESH.lean} leans bullish, below −${THRESH.lean} leans bearish, beyond ${THRESH.firm} either way drops the word "leaning".</p>
      <p>The same rules run over every past week to give the backtest. A call counts as right when the next week's close moves the way it said. The weights were chosen by looking at 2018 to 2022 only. From 2023 on, the model runs on data it never saw, so that's the honest test. Next to each hit rate we show how often the market simply went up, because always saying "bullish" would score that much.</p>
      <p>${esc(verdictOnTest(state.briefs))} Confidence on each call comes from that market's own record since 2023, lowered when today's factors disagree or some have no data.</p>
      <dl class="mk-f">${FACTOR_INFO.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    </div>
    <div class="mk-disc">
      <h3>Who made this, and what it isn't</h3>
      <p>Prepared by ${esc(seller)}, which runs GoldenStraddler. The calls are generated automatically by the model described here, from data for the week ending ${esc(short(state.asOf))}. Prices, yields, positioning and the calendar are facts from the sources below. The call and the confidence are the model's opinion.</p>
      <p>This is general market information, not personal investment advice. It doesn't consider your goals, finances or experience. Backtests and past calls don't predict future results.</p>
      <p><b>Conflicts of interest.</b> We sell the GoldenStraddler EA, and we earn commission from partner brokers when people we refer trade with them. Our own trading account runs the EA on gold news releases and doesn't follow these calls.</p>
      <h3>Sources</h3>
      <ul class="mk-src">
        <li>Federal Reserve Bank of St. Louis, FRED: 10 year real yield (DFII10), 2 year Treasury (DGS2), VIX (VIXCLS, © Cboe), and WTI, Brent and Henry Hub spot prices from the U.S. Energy Information Administration.</li>
        <li>U.S. Energy Information Administration: weekly US crude oil stocks excluding the strategic reserve (WCESTUS1).</li>
        <li>European Central Bank reference rates, via Frankfurter. Our dollar index applies the DXY weights to these rates.</li>
        <li>U.S. Commodity Futures Trading Commission, Commitments of Traders.</li>
        <li>Live prices: gold-api.com (metals, crypto) and Kraken's public ticker (forex). Price history: Coinbase and Kraken (bitcoin, ether, PAX Gold). Calendar: ForexFactory.</li>
      </ul>
      <p class="fine">Market artwork on this page is our own. "Watch on YouTube" opens a YouTube search for the release; we don't run or vouch for those channels.</p>
    </div>
  </div>
</div></section>`;
}

export function renderHub(path: string): { title: string; desc: string; html: string } | null {
  const bs = state.briefs;
  if (!bs.length) return { title: "Markets this week | GoldenStraddler", desc: "Weekly calls for gold, oil, forex and crypto from a scoring model on public data.",
    html: `<section class="mk-head"><div class="wrap"><h1>Markets this week</h1><p class="lede">The first briefs are being prepared from the latest data. Check back in a few minutes.</p></div></section>` };
  if (path === "/markets") {
    const s = summary(bs), gold = bs.find((b) => b.id === "gold");
    const bull = bs.filter((b) => b.call.dir > 0).length, bear = bs.filter((b) => b.call.dir < 0).length;
    const html = `${tickerHtml(bs)}
<section class="mk-head"><div class="wrap mk-hg">
  <div class="mk-hl">
    <p class="mk-wk num">Week ending ${esc(short(state.asOf))}</p>
    <h1>Markets this week</h1>
    <p class="lede">Calls for ${bs.length} markets from a scoring model that runs on public data: the dollar, yields, trend, fear and how the big funds are positioned. Every point is a number you can check, and every call is graded.</p>
    <div class="mk-stats">
      <div><b class="num"><span class="up">${bull}</span> / <span class="dn">${bear}</span></b><span>bullish and bearish calls this week, ${bs.length - bull - bear} with no clear lean</span></div>
      ${s.fx != null ? `<div><b class="num">${nf(s.fx * 100)}%</b><span>forex calls right since 2023, on data the model never saw (up weeks ${nf((s.fxUp || 0) * 100)}%)</span></div>` : ""}
      ${s.all != null ? `<div><b class="num">${nf(s.all * 100)}%</b><span>all ${nf(s.n)} calls since 2023, against a ${nf((s.up || 0) * 100)}% up-week rate</span></div>` : ""}
      <div><b class="num">${s.lr.n ? `${s.lr.hits}/${s.lr.n}` : "Live"}</b><span>${s.lr.n ? `graded live since ${esc(short(s.lr.since!))}` : "record starts with this week's calls"}</span></div>
    </div>
  </div>
  <div class="mk-hr"><h2 class="sr">Macro pulse</h2>${macroHtml(state.macro)}</div>
</div></section>
${nextHtml()}
${deskHtml(bs)}
<section class="mk-briefs"><div class="wrap">
  <div class="mk-bh"><h2>The briefs</h2><p class="fine">One per market, written from the numbers. Copy any of them as a Telegram post.</p></div>
  ${CLASSES.map((c) => `<h3 class="mk-cls" data-cls="${c.id}">${c.name}</h3><div class="mk-grid" data-cls="${c.id}">${bs.filter((b) => b.cls === c.id).map((b) => briefHtml(b)).join("")}</div>`).join("")}
</div></section>
${methodHtml()}`;
    return { title: "Markets this week: gold, oil, forex and crypto calls | GoldenStraddler",
      desc: `Weekly model calls for 16 markets with live prices, a signal matrix, fund positioning and the data behind every call.${gold ? ` Gold: ${gold.call.label.toLowerCase()}.` : ""}`.slice(0, 300), html };
  }
  const id = path.slice("/markets/".length), b = bs.find((x) => x.id === id);
  if (!b) return null;
  return { title: `${b.name} weekly outlook: ${b.call.label}${b.call.dir ? `, ${b.call.conf} confidence` : ""} | GoldenStraddler`, desc: `${b.priceLine} ${b.verdict}`.slice(0, 300), html: oneHtml(b, bs) + methodHtml() };
}

// ---------------------------------------------------------------- one market
function oneHtml(b: Brief, bs: Brief[]) {
  const a = ASSET.get(b.id)!, [h1, h2] = sides(b.call.dir), li = (xs: string[], k: string) => xs.map((t) => `<li><svg aria-hidden="true"><use href="#${k}"/></svg><span>${esc(t)}</span></li>`).join("");
  const others = bs.filter((x) => x.cls === b.cls && x.id !== b.id);
  const intr = intraday(b.id);
  return `${tickerHtml(bs)}
<section class="mk-one"><div class="wrap">
  <p class="crumbs"><a href="/markets">Markets</a> <span aria-hidden="true">/</span> ${esc(clsName(b.cls))} <span aria-hidden="true">/</span> ${esc(b.name)}</p>
  <header class="one-h">
    ${art(b.id, "xl")}
    <div class="one-id">
      <p class="bf-t num">${esc(b.title)}</p>
      <h1>${esc(b.name)} <span class="bf-sym num">${esc(b.sym)}</span></h1>
      <div class="bf-call ${cls(b.call.dir)}"><b>${esc(b.call.label)}</b>${b.call.dir ? `${confDots(b.call.conf)}<span class="cf">${esc(b.call.conf)} confidence</span>` : ""}</div>
      <p class="one-v">${esc(b.verdict)}</p>
    </div>
    <div class="one-q">${quoteHtml(b, true)}${intr.length > 3 ? `<div class="one-i">${minic(intr, { h: 40 })}<span class="fine">Last 24 hours, hourly candles</span></div>` : ""}</div>
    <div class="one-g">${gauge(b.call.score)}<p class="num">Score ${sgn(b.call.score)}</p></div>
  </header>
  <div class="one-grid">
    <div class="one-main">
      ${priceChart(a, b)}
      <div class="card2">${driversHtml(b, 9)}</div>
      <div class="card2 one-brief">
        <p class="bf-px">${esc(b.priceLine)}</p>
        ${b.forIt.length ? `<div class="bf-s"><h4>${h1}</h4><ul class="pro">${li(b.forIt, b.call.dir ? "i-check" : "i-up")}</ul></div>` : ""}
        ${b.against.length ? `<div class="bf-s"><h4>${h2}</h4><ul class="con">${li(b.against, "i-down")}</ul></div>` : ""}
        <p class="bf-v">${esc(b.verdict)}</p>
        <div class="bf-act"><button class="btn sm" type="button" data-copy><svg aria-hidden="true"><use href="#i-copy"/></svg>Copy as Telegram post</button></div>
        <template class="bf-post">${esc(postText(b, siteUrl() + "/markets/" + b.id))}</template>
      </div>
      <div class="card2 bf-w"><h4><svg aria-hidden="true"><use href="#i-eye"/></svg>Releases to watch</h4>${watchHtml(b.watch, 10)}</div>
    </div>
    <aside class="one-side">
      ${positionChart(b)}
      ${testCard(b)}
      ${historyHtml(b)}
      ${others.length ? `<div class="card2 one-more"><h4>More ${esc(clsName(b.cls).toLowerCase())}</h4><ul>${others.map((o) => `<li><a href="/markets/${o.id}" class="mkt-n">${art(o.id, "sm")}<b>${esc(o.name)}</b></a>${pillHtml(o)}</li>`).join("")}</ul></div>` : ""}
      ${b.notes.length ? `<div class="card2">${b.notes.map((n) => `<p class="fine">${esc(n)}</p>`).join("")}</div>` : ""}
    </aside>
  </div>
</div></section>`;
}
// ---------------------------------------------------------------- the main chart: daily and weekly candles, averages, the model's calls, a crosshair
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function niceTicks(lo: number, hi: number, n: number) {
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p, st = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p, out: number[] = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) out.push(Number(v.toPrecision(12)));
  return out;
}
type CB = { t: string; o: number; h: number; l: number; c: number; r: boolean; m20: number | null; m50: number | null };
const dayLabel = (t: string, tf: string) => { const d = new Date(t + "T12:00:00Z"); return `${tf === "w" ? "Week to " : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] + " "}${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
function readout(a: Asset, x: CB, prev: CB | undefined, tf: string) {
  const ch = prev ? x.c / prev.c - 1 : null;
  return `<b>${esc(dayLabel(x.t, tf))}</b><span>O <i>${esc(fmtPx(a, x.o))}</i></span><span>H <i>${esc(fmtPx(a, x.h))}</i></span><span>L <i>${esc(fmtPx(a, x.l))}</i></span><span>C <i>${esc(fmtPx(a, x.c))}</i></span>${ch == null ? "" : `<span class="${ch >= 0 ? "up" : "dn"}">${pct(ch, 2)}</span>`}`;
}
function candlePanel(a: Asset, bs: CB[], tf: "d" | "w", o: { calls?: Map<string, { dir: number; right: boolean | null }>; live?: string; current: boolean; sm?: boolean }) {
  const W = o.sm ? 430 : 760, H = o.sm ? 330 : 340, L = 4, R = o.sm ? 82 : 74, T = 12, B = o.sm ? 28 : 24, n = bs.length, f = (v: number) => v.toFixed(1);
  const vals = bs.flatMap((x) => [x.h, x.l, x.m20 ?? x.c, x.m50 ?? x.c]);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1, y0 = lo - pad, y1 = hi + pad;
  const step = (W - L - R) / n, bw = Math.max(1.2, Math.min(15, step * 0.66)), fs = o.sm ? 4.5 : 4;
  const X = (k: number) => L + step * (k + 0.5), Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const grid = niceTicks(y0, y1, o.sm ? 5 : 6).map((v) => `<path d="M${L} ${f(Y(v))}H${W - R}" class="gr"/><text x="${W - R + 8}" y="${f(Y(v) + fs)}" class="ax">${esc(fmtPx(a, v))}</text>`).join("");
  // month lines; a weekly chart marks quarters, and a new year shows the year
  let xl = "", lastX = -1e9;
  bs.forEach((x, k) => {
    if (!k || x.t.slice(5, 7) === bs[k - 1].t.slice(5, 7)) return;
    const m = Number(x.t.slice(5, 7)), yr = x.t.slice(0, 4) !== bs[k - 1].t.slice(0, 4), xx = X(k);
    if ((tf === "w" && (m - 1) % 3 !== 0 && !yr) || xx - lastX < (o.sm ? 54 : 50) || xx > W - R - 16) return;
    lastX = xx;
    xl += `<path d="M${f(xx)} ${T}V${H - B}" class="gv"/><text x="${f(xx)}" y="${H - (o.sm ? 9 : 7)}" text-anchor="middle" class="ax${yr ? " yr" : ""}">${yr ? x.t.slice(0, 4) : MON[m - 1]}</text>`;
  });
  const one = (x: CB, k: number) => {
    const xx = X(k), up = x.c >= x.o, ya = Y(Math.max(x.o, x.c)), yb = Math.max(Y(Math.min(x.o, x.c)), ya + 1);
    return { up, w: `M${f(xx)} ${f(Y(x.h))}V${f(Y(x.l))}`, b: `M${f(xx - bw / 2)} ${f(ya)}h${f(bw)}V${f(yb)}h${f(-bw)}Z` };
  };
  const P = { wu: "", wd: "", cu: "", cd: "" };
  bs.slice(0, -1).forEach((x, k) => { const c = one(x, k); P[c.up ? "wu" : "wd"] += c.w; P[c.up ? "cu" : "cd"] += c.b; });
  const last = bs[n - 1], prev = bs[n - 2], lc = one(last, n - 1);
  const line = (g: (x: CB) => number | null) => { let d = "", on = false; bs.forEach((x, k) => { const v = g(x); if (v == null) { on = false; return; } d += `${on ? "L" : "M"}${f(X(k))} ${f(Y(v))}`; on = true; }); return d; };
  // each call sits on the week it was for: a mark under the candle for bullish, over it for bearish
  let hits = 0, graded = 0, marks = "";
  if (o.calls) bs.forEach((x, k) => {
    const made = new Date(Date.parse(x.t + "T00:00:00Z") - 7 * 86_400_000).toISOString().slice(0, 10), cl = o.calls!.get(made);
    if (!cl || !cl.dir) return;
    if (cl.right !== null) { graded++; if (cl.right) hits++; }
    const xx = X(k), sz = Math.max(2.6, Math.min(4.5, step * 0.42));
    const tri = cl.dir > 0 ? `M${f(xx)} ${f(Y(x.l) + 4)}l${f(sz)} ${f(sz * 1.5)}h${f(-2 * sz)}z` : `M${f(xx)} ${f(Y(x.h) - 4)}l${f(sz)} ${f(-sz * 1.5)}h${f(-2 * sz)}z`;
    marks += `<path d="${tri}" class="${cl.dir > 0 ? "bu" : "be"}${cl.right === false ? " miss" : ""}${cl.right === null ? " open" : ""}"><title>${esc(dayLabel(x.t, "w"))}: called ${cl.dir > 0 ? "bullish" : "bearish"}${cl.right === null ? ", still open" : cl.right ? ", right" : ", wrong"}</title></path>`;
  });
  const yl = Y(last.c), lup = prev ? last.c >= prev.c : last.c >= last.o, th = o.sm ? 20 : 18;
  const dp = Math.min(6, a.dp + 2), data = { W, H, L, R, T, B, y0, y1, dp: a.dp, pre: a.pre, tf, b: bs.map((x) => [x.t, +x.o.toFixed(dp), +x.h.toFixed(dp), +x.l.toFixed(dp), +x.c.toFixed(dp)]) };
  const what = tf === "w" ? `${n} weekly candles` : `${n} daily candles`;
  return { hits, graded, ro: readout(a, last, prev, tf), svg: `<svg class="pc-svg${o.sm ? " sm" : " lg"}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(a.name)}: ${what}, last close ${esc(fmtPx(a, last.c))}" data-c="${esc(JSON.stringify(data))}"${o.live && o.current ? ` data-live-c="${o.live}"` : ""}>
      ${grid}${xl}<path d="${line((x) => x.m50)}" class="m50"/><path d="${line((x) => x.m20)}" class="m20"/>
      <path class="wu" d="${P.wu}"/><path class="wd" d="${P.wd}"/><path class="cu" d="${P.cu}"/><path class="cd" d="${P.cd}"/>
      <g class="lc ${lc.up ? "u" : "d"}"><path class="w" d="${lc.w}"/><path class="b" d="${lc.b}"/></g>${marks}
      <g class="lpx ${lup ? "u" : "d"}"><path d="M${L} ${f(yl)}H${W - R}" class="lpl"/><rect x="${W - R + 2}" y="${f(yl - th / 2)}" width="${R - 4}" height="${th}" rx="4"/><text x="${W - R + 8}" y="${f(yl + fs)}">${esc(fmtPx(a, last.c))}</text></g>
      <g class="xh" visibility="hidden"><path class="xv"/><path class="xz"/><rect class="xt" x="${W - R + 2}" width="${R - 4}" height="${th}" rx="4"/><text class="xtt" x="${W - R + 8}"></text><rect class="xd" y="${H - B + 3}" height="${th}" rx="4"/><text class="xdt" y="${H - B + 3 + th / 2 + fs}" text-anchor="middle"></text></g>
    </svg>` };
}
function priceChart(a: Asset, b: Brief) {
  const today = new Date().toISOString().slice(0, 10), live = quotes.has(b.id) ? b.id : undefined;
  const wk: CB[] = b.chart.map((x) => ({ t: x.wk, o: x.o, h: x.h, l: x.l, c: x.px, r: x.r, m20: x.m20, m50: x.m50 }));
  const showD = b.day.length >= 15, showW = wk.length >= 8;
  if (!showD && !showW) return `<div class="card2"><p class="fine">The chart appears once this market has a few weeks of price history.</p></div>`;
  const realD = b.day.filter((x) => x.r).length / (b.day.length || 1);
  const def = showD && (!showW || (b.day.length >= 40 && realD >= 0.6)) ? "d" : "w";
  const calls = new Map<string, { dir: number; right: boolean | null }>((b.back?.weeks || []).map((w) => [w.wk, { dir: w.dir, right: w.next == null ? null : Math.sign(w.next - w.px) === w.dir }]));
  const src = realD >= 0.6 ? `Highs and lows: ${b.cndSrc}.` : realD > 0 ? `Highs and lows where we have them (${b.cndSrc}); older candles are built from daily closes, so they open at the previous close and carry no wicks.` : `Built from ${b.cndSrc}: each candle opens at the previous close, so it has no wicks of its own.`;
  // a wide chart for desktops and a shorter span for phones, so the labels stay readable
  const both = (bs: CB[], tf: "d" | "w", o: { calls?: typeof calls; current: boolean }) => {
    const lg = candlePanel(a, bs, tf, { ...o, live }), sm = candlePanel(a, bs.slice(tf === "d" ? -66 : -52), tf, { ...o, live, sm: true });
    return { ...lg, html: `<div class="pc-ro num" aria-hidden="true">${lg.ro}</div>${lg.svg}${sm.svg}` };
  };
  const D = showD ? both(b.day, "d", { current: b.day[b.day.length - 1].t === today }) : null;
  const Wp = showW ? both(wk, "w", { calls, current: wk[wk.length - 1].t >= today }) : null;
  const tab = (k: string, lab: string) => `<button type="button" role="tab" data-tf="${k}" aria-selected="${def === k}">${lab}</button>`;
  return `<figure class="card2 pc" data-pc>
    <figcaption><div class="pc-top"><b>${esc(a.name)} candles</b>${D && Wp ? `<div class="pc-tf" role="tablist" aria-label="Timeframe">${tab("d", "Daily")}${tab("w", "Weekly")}</div>` : ""}</div>
      <span class="pc-k"><i class="k1"></i>20 period average<i class="k3"></i>50 period average</span></figcaption>
    ${D ? `<div class="pc-v" data-tf="d"${def === "d" ? "" : " hidden"}>${D.html}<p class="fine pc-n">Daily candles, about six months (three on a phone). ${esc(src)}</p></div>` : ""}
    ${Wp ? `<div class="pc-v" data-tf="w"${def === "w" ? "" : " hidden"}>${Wp.html}<p class="fine pc-n">Weekly candles to each Friday, two years (one on a phone); the last one is this week so far. A mark under a candle is a bullish call for that week, over it bearish; hollow marks were wrong${Wp.graded ? `, ${Wp.hits} of ${Wp.graded} right over these two years` : ""}. Calls are graded on Friday closes.</p></div>` : ""}
  </figure>`;
}
function positionChart(b: Brief) {
  const c = b.cot; if (!c || c.hist.length < 20) return "";
  const h = c.hist, W = 360, H = 150, T = 8, B = 18, lo = Math.min(...h, 0), hi = Math.max(...h, 0), r = hi - lo || 1;
  const X = (k: number) => (k / (h.length - 1)) * W, Y = (v: number) => T + (1 - (v - lo) / r) * (H - T - B);
  const sorted = [...h].sort((x, y) => x - y), p10 = sorted[Math.floor(sorted.length * 0.1)], p90 = sorted[Math.floor(sorted.length * 0.9)];
  const d = h.map((v, k) => `${k ? "L" : "M"}${X(k).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const share = c.long != null && c.short != null && c.long + c.short > 0 ? c.long / (c.long + c.short) : null;
  return `<figure class="card2 posc"><figcaption><b>${esc(c.who)} in ${esc(c.what || b.name.toLowerCase())} futures</b><span class="fine">Net position over 3 years, CFTC. The band is the middle 80%.</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net position over 3 years"><rect x="0" y="${Y(p90).toFixed(1)}" width="${W}" height="${(Y(p10) - Y(p90)).toFixed(1)}" class="band"/><path d="M0 ${Y(0).toFixed(1)}H${W}" class="zero"/><path d="${d}" class="ln"/><circle cx="${W}" cy="${Y(h[h.length - 1]).toFixed(1)}" r="3.5" class="lp"/></svg>
    <dl class="kv"><div><dt>Net</dt><dd class="num ${c.net >= 0 ? "up" : "dn"}">${c.net >= 0 ? "Long" : "Short"} ${nf(Math.abs(c.net))}</dd></div><div><dt>This week</dt><dd class="num">${c.chg >= 0 ? "+" : "−"}${nf(Math.abs(c.chg))}</dd></div>
      <div><dt>3 year percentile</dt><dd class="num">${nf(c.pct * 100)}th</dd></div>${share != null ? `<div><dt>Long share</dt><dd class="num">${nf(share * 100)}%</dd></div>` : ""}</dl></figure>`;
}
function testCard(b: Brief) {
  const bk = b.back; if (!bk) return `<div class="card2"><h4>Backtest</h4><p class="fine">Not enough history for a backtest yet.</p></div>`;
  const row = (lab: string, v: number | null, k: string) => v == null ? "" : `<div class="tr-b ${k}"><span class="lb">${lab}</span><span class="tk"><i style="width:${(v * 100).toFixed(1)}%"></i><em style="left:50%"></em></span><b class="num">${nf(v * 100)}%</b></div>`;
  const E = bk.early, L = bk.late;
  return `<div class="card2"><h4>How this model has done on ${esc(b.name)}</h4>
    ${row(`2018 to 2022, ${E.n} calls`, E.n >= 10 ? E.hits / E.n : null, "e")}${row(`2023 on, ${L.n} calls`, L.n >= 10 ? L.hits / L.n : null, "l")}${row("Up weeks since 2023", L.tot ? L.up / L.tot : null, "b")}
    <p class="fine">${esc(backLine(bk))} The dashed line is a coin flip.</p></div>`;
}
function historyHtml(b: Brief) {
  const ws = (b.back?.weeks || []).filter((w) => w.next !== null).slice(-10).reverse();
  if (!ws.length) return "";
  const lr = liveRecord(b.id);
  return `<div class="card2 mk-hist"><h4>Recent weeks</h4><table><thead><tr><th scope="col">Week</th><th scope="col">Call</th><th scope="col">Next week</th><th scope="col"></th></tr></thead><tbody>${ws.map((w) => {
    const r = w.next! / w.px - 1, right = w.dir ? Math.sign(r) === w.dir : null;
    return `<tr><td class="num">${esc(short(w.wk))}</td><td><span class="pill ${cls(w.dir)}">${w.dir > 0 ? "Bullish" : w.dir < 0 ? "Bearish" : "No lean"}</span></td><td class="num ${r >= 0 ? "up" : "dn"}">${pct(r)}</td><td>${right === null ? "" : right ? `<span class="ok">Right</span>` : `<span class="no">Wrong</span>`}</td></tr>`;
  }).join("")}</tbody></table><p class="fine">${lr.n ? `Graded live calls for ${esc(b.name)}: ${lr.hits} of ${lr.n} right since ${esc(short(lr.since!))}.` : "Weeks before the live launch are the backtest, run with the same rules."}</p></div>`;
}

// the home page teaser: six markets, their calls and live prices, and the artwork they need
let artSprite = "";
try { const m = readFileSync(join(import.meta.dir, "..", "web", "markets.html"), "utf8"); const i = m.indexOf("<defs>"), j = m.lastIndexOf("</symbol>"); if (i > 0 && j > i) artSprite = m.slice(i, j + 9); } catch {}
export function hubTeaser() {
  const pick = ["gold", "silver", "wti", "eurusd", "usdjpy", "btc"].map((id) => state.briefs.find((b) => b.id === id)).filter(Boolean) as Brief[];
  if (pick.length < 4) return "";
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${artSprite}</svg>
<section class="mt" aria-labelledby="mt-h"><div class="wrap">
  <div class="mt-h"><h2 id="mt-h">This week's market calls</h2><p>A scoring model on public data calls 16 markets every weekend, with the numbers behind each call and an honest track record.</p><a class="btn sm" href="/markets">Open the Markets desk</a></div>
  <ul class="mt-l">${pick.map((b) => { const q = livePx(b); return `<li><a href="/markets/${b.id}">${art(b.id)}<span class="mt-n"><b>${esc(b.name)}</b><span class="num ${q.ch == null ? "" : q.ch >= 0 ? "up" : "dn"}">${esc(q.txt)} ${q.ch == null ? "" : pct(q.ch, 2)}</span></span><span class="pill ${cls(b.call.dir)}">${esc(b.call.label)}</span>${meter(b.call.score)}</a></li>`; }).join("")}</ul>
</div></section>`;
}

// live prices for the page to poll
export function hubLive() {
  const out: Record<string, { txt: string; ch: number | null; live: boolean; p?: number }> = {};
  for (const b of state.briefs) { const q = livePx(b), lq = quotes.get(b.id); out[b.id] = { txt: q.txt, ch: q.ch == null ? null : Math.round(q.ch * 1e5) / 1e5, live: q.live, ...(q.live && lq ? { p: lq.p } : {}) }; }
  return { ok: true, t: Date.now(), q: out };
}

// the raw inputs behind one market, so anyone can check a number on the page
export function hubDetail(id: string) {
  const a = ASSET.get(id); if (!a) return null;
  const c = buildCtx(), p = c.px[id], n = c.weeks.length, wk = (arr: (number | null)[]) => c.weeks.slice(n - 10).map((w, k) => [w, arr[n - 10 + k]]);
  return { ok: true, id, source: a.hist, weekly: wk(p), dollarIndex: wk(c.dxy), realYield10y: wk(c.ry), twoYear: wk(c.y2), vix: wk(c.vix),
    positioning: c.cot[id] ? wk(c.cot[id].net) : null, raw: series(a.hist.startsWith("fx:") ? "ecb:" + a.hist.slice(3) : a.hist, c.weeks[n - 4]) };
}
export function hubJson() {
  return { ok: true, asOf: state.asOf, at: state.at, markets: state.briefs.map((b) => ({ id: b.id, name: b.name, cls: b.cls, call: b.call, price: b.px, chg: b.chg, verdict: b.verdict })) };
}
