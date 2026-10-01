/*
 * Markets hub: keeps this week's briefs in memory, freezes each week's calls so they can be graded,
 * and renders /markets and /markets/<market> on the server (so search engines read the text).
 */
import { all, now, one, run } from "./db";
import { esc, getS, siteUrl } from "./util";
import { calendar, kvGet, kvSet, refreshAll, series, sources, startHubData } from "./hubdata";
import { ASSETS, CLASSES, FACTOR_INFO, THRESH, backtest, brief, buildCtx, fmtPx, postText, short, sides, type Asset, type Back, type Brief, type Ctx } from "./hubmodel";

const state = { briefs: [] as Brief[], at: 0, asOf: "", busy: false, err: "" };
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
    state.briefs = out; state.at = now(); state.asOf = c.weeks[c.weeks.length - 1]; state.err = "";
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

export function startHub() {
  setTimeout(() => computeHub(), 3000);                     // from whatever is cached, straight away
  startHubData(() => computeHub());
}
export const hubPublic = () => getS("hub_public") === "1";
export function hubStatus() {
  return { public: hubPublic(), computedAt: state.at, asOf: state.asOf, err: state.err, sources: sources(), markets: state.briefs.length, live: liveRecord() };
}
export async function hubRefreshNow(force = false) { await refreshAll(undefined, force); await computeHub(); }

// ================================================================ rendering
const nf = (v: number, dp = 0) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (x: number, dp = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + nf(Math.abs(x * 100), dp) + "%";
const cls = (dir: number) => (dir > 0 ? "up" : dir < 0 ? "dn" : "flat");
const confDots = (c: string) => `<span class="conf" data-c="${c}" title="${c} confidence"><i></i><i></i><i></i></span>`;
function dayTime(utc: number) { return new Date(utc * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).replace(",", "") + " UTC"; }
const ASSET = new Map(ASSETS.map((a) => [a.id, a]));
const clsName = (c: string) => CLASSES.find((x) => x.id === c)?.name || c;

const monthYear = (d: string) => new Date(d + "T12:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
function backLine(b: Back | null) {
  if (!b) return "Not enough history for a backtest yet.";
  return `Backtest since ${monthYear(b.from)}: right ${nf(b.rate * 100)}% of ${nf(b.n)} weekly calls. Price rose in ${nf(b.upRate * 100)}% of weeks, so that's the bar to beat.`;
}
function cotLine(b: Brief) {
  const c = b.cot; if (!c) return "";
  const side = c.net >= 0 ? "net long" : "net short";
  return `<div class="bf-cot"><span>${esc(c.who)} ${side} <b class="num">${nf(Math.abs(c.net))}</b> <span class="num ${c.chg >= 0 ? "up" : "dn"}">${c.chg >= 0 ? "+" : "−"}${nf(Math.abs(c.chg))}</span></span>
    <span class="pctl" title="Where this sits in the last 3 years"><i style="left:${(c.pct * 100).toFixed(0)}%"></i></span><span class="fine">${nf(c.pct * 100)}th percentile, 3 years</span></div>`;
}
function watchHtml(all: Brief["watch"], max: number) {
  if (!all.length) return `<p class="fine">No high-impact releases for this market in the next week.</p>`;
  const evs = all.slice(0, max), more = all.length - evs.length;
  return `<ul class="bf-wl">${evs.map((e) => `<li><time class="num" datetime="${new Date(e.utc * 1000).toISOString()}" data-utc="${e.utc}">${esc(dayTime(e.utc))}</time><span><b>${esc(e.ccy)}</b> ${esc(e.title)}${e.fc || e.prev ? ` <em>${e.fc ? "forecast " + esc(e.fc) : ""}${e.fc && e.prev ? ", " : ""}${e.prev ? "previous " + esc(e.prev) : ""}</em>` : ""}</span></li>`).join("")}</ul>${more > 0 ? `<p class="fine">And ${more} more this week.</p>` : ""}`;
}
function briefHtml(b: Brief, full = false) {
  const a = ASSET.get(b.id)!, [h1, h2] = sides(b.call.dir), url = `/markets/${b.id}`;
  const live = b.live && b.live.chg !== null && Math.abs(Date.now() - b.live.at) < 36 * 3600_000
    ? `<p class="bf-live"><span class="dot"></span>Now <b class="num">${esc(fmtPx(a, b.live.price))}</b> <span class="num ${b.live.chg >= 0 ? "up" : "dn"}">${pct(b.live.chg, 2)}</span> since the weekly close</p>` : "";
  const li = (xs: string[], k: string) => xs.map((t) => `<li><svg aria-hidden="true"><use href="#${k}"/></svg><span>${esc(t)}</span></li>`).join("");
  return `<article class="bf${full ? " full" : ""}" id="${b.id}" data-cls="${b.cls}">
  <header class="bf-h">
    <p class="bf-t num">${esc(b.title)}</p>
    <h${full ? 1 : 3} class="bf-n">${full ? esc(b.name) : `<a href="${url}">${esc(b.name)}</a>`} <span class="bf-sym num">${esc(b.sym)}</span></h${full ? 1 : 3}>
    <p class="bf-call ${cls(b.call.dir)}"><b>${esc(b.call.label)}</b>${b.call.dir ? `${confDots(b.call.conf)}<span class="cf">${esc(b.call.conf)} confidence</span>` : ""}</p>
  </header>
  <p class="bf-px">${esc(b.priceLine || "Price data is still coming in.")}</p>${live}
  <div class="bf-body">
    ${b.forIt.length ? `<div class="bf-s"><h4>${h1}</h4><ul class="pro">${li(b.forIt, b.call.dir ? "i-check" : "i-up")}</ul></div>` : ""}
    ${b.against.length ? `<div class="bf-s"><h4>${h2}</h4><ul class="con">${li(b.against, "i-down")}</ul></div>` : ""}
  </div>
  <p class="bf-v">${esc(b.verdict)}</p>
  <div class="bf-w"><h4><svg aria-hidden="true"><use href="#i-eye"/></svg>Watch</h4>${watchHtml(b.watch, full ? 10 : 3)}</div>
  <footer class="bf-f">
    ${cotLine(b)}
    <p class="bf-bt fine">${esc(backLine(b.back))}</p>
    ${b.notes.map((n) => `<p class="bf-note fine">${esc(n)}</p>`).join("")}
    <div class="bf-act"><button class="btn sm" type="button" data-copy><svg aria-hidden="true"><use href="#i-copy"/></svg>Copy as Telegram post</button>${full ? "" : `<a class="btn sm" href="${url}">Full data</a>`}</div>
    <template class="bf-post">${esc(postText(b, siteUrl() + url))}</template>
  </footer>
</article>`;
}

function boardHtml(bs: Brief[]) {
  const rows = bs.map((b) => {
    const w = Math.min(50, (Math.abs(b.call.score) / 0.6) * 50);
    return `<tr data-cls="${b.cls}"><th scope="row"><a href="#${b.id}">${esc(b.name)}</a><span class="num">${esc(b.sym)}</span></th>
      <td><span class="pill ${cls(b.call.dir)}">${esc(b.call.label)}</span></td>
      <td class="sc"><span class="bar" title="Score ${b.call.score}"><i class="${b.call.score >= 0 ? "pos" : "neg"}" style="width:${w.toFixed(1)}%"></i></span><span class="num">${b.call.score > 0 ? "+" : ""}${b.call.score.toFixed(2)}</span></td>
      <td class="num ${b.chg == null ? "" : b.chg >= 0 ? "up" : "dn"}">${b.chg == null ? "–" : pct(b.chg)}</td>
      <td class="hide-s">${b.cot ? `<span class="pctl sm"><i style="left:${(b.cot.pct * 100).toFixed(0)}%"></i></span>` : "–"}</td></tr>`;
  }).join("");
  return `<div class="tblw"><table class="board"><thead><tr><th scope="col">Market</th><th scope="col">Call</th><th scope="col">Score</th><th scope="col">Week</th><th scope="col" class="hide-s">Fund positioning</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function nextHtml() {
  const t = Date.now() / 1000, evs = calendar().filter((e) => e.utc > t - 600).slice(0, 10);
  if (!evs.length) return "";
  return `<section class="mk-next" aria-label="Next high-impact releases"><div class="wrap"><ol>${evs.map((e) =>
    `<li><time class="num" data-utc="${e.utc}" datetime="${new Date(e.utc * 1000).toISOString()}">${esc(dayTime(e.utc))}</time><b>${esc(e.ccy)}</b><span>${esc(e.title)}</span><span class="cd num" data-cd="${e.utc}"></span></li>`).join("")}</ol></div></section>`;
}
function methodHtml(asOfTxt: string) {
  const seller = getS("seller_name") || "the operator of GoldenStraddler";
  return `<section class="mk-method" id="method"><div class="wrap">
  <h2>How the calls work</h2>
  <div class="mk-cols">
    <div>
      <p>Each market gets a score between −1 and +1 from a handful of measured factors. Every factor turns one fact into a small score for that market, with a fixed weight, and the call is the weighted average: above +${THRESH.lean} leans bullish, below −${THRESH.lean} leans bearish, beyond ${THRESH.firm} either way drops the word "leaning". Confidence rises when more of the factors agree and all of them have data.</p>
      <p>The same rules run over every past week to give the backtest. A call counts as right when the next week's close moves the way it said. Next to the hit rate we show how often the market simply went up, because always saying "bullish" would score that much.</p>
      <dl class="mk-f">${FACTOR_INFO.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    </div>
    <div class="mk-disc">
      <h3>Who made this, and what it isn't</h3>
      <p>Prepared by ${esc(seller)}, which runs GoldenStraddler. The calls are generated automatically by the model described here, from data updated ${esc(asOfTxt)}. Prices, yields, positioning and the calendar are facts from the sources below. The call and the confidence are the model's opinion.</p>
      <p>This is general market information, not personal investment advice. It doesn't consider your goals, finances or experience. Backtests and past calls don't predict future results.</p>
      <p><b>Conflicts of interest.</b> We sell the GoldenStraddler EA, and we earn commission from partner brokers when people we refer trade with them. Our own trading account runs the EA on gold news releases and doesn't follow these calls.</p>
      <h3>Sources</h3>
      <ul class="mk-src">
        <li>Federal Reserve Bank of St. Louis, FRED: 10 year real yield (DFII10), 2 year Treasury (DGS2), VIX (VIXCLS, © Cboe), WTI and Brent spot, Henry Hub gas and US crude stocks (U.S. Energy Information Administration).</li>
        <li>European Central Bank reference rates, via Frankfurter. Our dollar index applies the DXY weights to these rates.</li>
        <li>U.S. Commodity Futures Trading Commission, Commitments of Traders.</li>
        <li>Coinbase and Kraken public market data (bitcoin, ether, PAX Gold), gold-api.com spot prices, the ForexFactory calendar.</li>
      </ul>
    </div>
  </div>
</div></section>`;
}
function summaryHtml(bs: Brief[]) {
  let n = 0, hits = 0, up = 0, tot = 0;
  for (const b of bs) if (b.back) { n += b.back.n; hits += b.back.hits; up += b.back.upRate * b.back.n; tot += b.back.n; }
  const lr = liveRecord();
  return { back: n ? `Backtest: <b>${nf((hits / n) * 100)}%</b> of ${nf(n)} weekly calls right, against a ${nf((up / tot) * 100)}% up-week rate` : "",
    live: lr.n ? `Live since ${short(lr.since!)}: <b>${lr.hits}</b> of ${lr.n} right` : "Live record: starts with this week's calls" };
}
const asOfText = () => (state.asOf ? `for the week ending ${short(state.asOf)}` : "");

export function renderHub(path: string): { title: string; desc: string; html: string } | null {
  const bs = state.briefs;
  if (!bs.length) return { title: "Markets this week | GoldenStraddler", desc: "Weekly calls for gold, oil, forex and crypto from a scoring model on public data.",
    html: `<section class="mk-head"><div class="wrap"><h1>Markets this week</h1><p class="lede">The first briefs are being prepared from the latest data. Check back in a few minutes.</p></div></section>` };
  if (path === "/markets") {
    const s = summaryHtml(bs), gold = bs.find((b) => b.id === "gold");
    const tabs = `<div class="tabs mk-tabs" role="tablist" aria-label="Markets"><button role="tab" type="button" data-f="all" aria-selected="true">All</button>${CLASSES.map((c) => `<button role="tab" type="button" data-f="${c.id}" aria-selected="false">${c.name}</button>`).join("")}</div>`;
    const html = `<section class="mk-head"><div class="wrap">
  <h1>Markets this week</h1>
  <p class="lede">A call for ${bs.length} markets from a scoring model that runs on public data: the dollar, yields, trend, fear and how the big funds are positioned. Every point is a number you can check, and every call gets graded.</p>
  <p class="mk-meta"><span>Week ending <b>${esc(short(state.asOf))}</b></span><span>${s.back}</span><span>${s.live}</span></p>
</div></section>
${nextHtml()}
<section class="mk-boardw"><div class="wrap">
  <div class="mk-bh"><h2>The board</h2><a href="#method" class="fine">How the score works</a></div>
  ${boardHtml(bs)}
</div></section>
<section class="mk-briefs"><div class="wrap">
  ${tabs}
  ${CLASSES.map((c) => `<h2 class="mk-cls" data-cls="${c.id}">${c.name}</h2><div class="mk-grid" data-cls="${c.id}">${bs.filter((b) => b.cls === c.id).map((b) => briefHtml(b)).join("")}</div>`).join("")}
</div></section>
${methodHtml(asOfText())}`;
    return { title: "Markets this week: gold, oil, forex and crypto calls | GoldenStraddler",
      desc: `Weekly model calls with the data behind them.${gold ? ` Gold: ${gold.call.label.toLowerCase()}. ${gold.verdict}` : ""}`.slice(0, 300), html };
  }
  const id = path.slice("/markets/".length), b = bs.find((x) => x.id === id);
  if (!b) return null;
  const a = ASSET.get(id)!;
  const html = `<section class="mk-one"><div class="wrap">
  <p class="crumbs"><a href="/markets">Markets</a> <span aria-hidden="true">/</span> ${esc(clsName(b.cls))}</p>
  <div class="mk-onegrid">
    ${briefHtml(b, true)}
    <aside class="mk-side">
      ${chartHtml(a, b)}
      ${historyHtml(a, b)}
    </aside>
  </div>
</div></section>
${methodHtml(asOfText())}`;
  return { title: `${b.name} weekly outlook: ${b.call.label}${b.call.dir ? `, ${b.call.conf} confidence` : ""} | GoldenStraddler`, desc: `${b.priceLine} ${b.verdict}`.slice(0, 300), html };
}

// weekly closes with the model's call each week: filled marks were right the next week, hollow ones wrong
function chartHtml(a: Asset, b: Brief) {
  const ws = (b.back?.weeks || []).slice(-78);
  if (ws.length < 8) return "";
  const W = 560, H = 220, P = 10, lo = Math.min(...ws.map((w) => w.px)), hi = Math.max(...ws.map((w) => w.px));
  const X = (k: number) => P + (k / (ws.length - 1)) * (W - 2 * P), Y = (v: number) => P + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * P - 14);
  const d = ws.map((w, k) => `${k ? "L" : "M"}${X(k).toFixed(1)} ${Y(w.px).toFixed(1)}`).join("");
  const marks = ws.map((w, k) => {
    if (!w.dir) return "";
    const right = w.next === null ? null : Math.sign(w.next - w.px) === w.dir, x = X(k), y = Y(w.px) + (w.dir > 0 ? 9 : -9);
    const tri = w.dir > 0 ? `M${x} ${y - 4}l4 6h-8z` : `M${x} ${y + 4}l4 -6h-8z`;
    return `<path d="${tri}" class="${w.dir > 0 ? "bu" : "be"}${right === false ? " miss" : ""}${right === null ? " open" : ""}"/>`;
  }).join("");
  const hits = ws.filter((w) => w.dir && w.next !== null && Math.sign(w.next - w.px) === w.dir).length, calls = ws.filter((w) => w.dir && w.next !== null).length;
  return `<figure class="mk-chart"><figcaption><b>Weekly closes and the model's calls</b><span class="fine">Last ${ws.length} weeks: ${hits} of ${calls} calls right. Hollow marks were wrong.</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(a.name)} weekly closes with the model's weekly calls"><path d="${d}" class="ln"/>${marks}
    <text x="${W - P}" y="${H - 2}" text-anchor="end" class="ax">${esc(fmtPx(a, lo))} to ${esc(fmtPx(a, hi))}</text></svg></figure>`;
}
function historyHtml(a: Asset, b: Brief) {
  const ws = (b.back?.weeks || []).filter((w) => w.next !== null).slice(-10).reverse();
  if (!ws.length) return "";
  const lr = liveRecord(b.id);
  return `<div class="mk-hist"><h3>Recent weeks</h3><table><thead><tr><th scope="col">Week</th><th scope="col">Call</th><th scope="col">Next week</th><th scope="col"></th></tr></thead><tbody>${ws.map((w) => {
    const r = w.next! / w.px - 1, right = w.dir ? Math.sign(r) === w.dir : null;
    return `<tr><td class="num">${esc(short(w.wk))}</td><td><span class="pill ${cls(w.dir)}">${w.dir > 0 ? "Bullish" : w.dir < 0 ? "Bearish" : "No lean"}</span></td><td class="num ${r >= 0 ? "up" : "dn"}">${pct(r)}</td><td>${right === null ? "" : right ? "Right" : "Wrong"}</td></tr>`;
  }).join("")}</tbody></table><p class="fine">${lr.n ? `Graded live calls for ${esc(b.name)}: ${lr.hits} of ${lr.n} right since ${esc(short(lr.since!))}.` : "Weeks before the live launch are the backtest, run with the same rules."}</p></div>`;
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
