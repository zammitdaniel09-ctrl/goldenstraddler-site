// A journal account shared as a read-only results page (/j/<token>). Built on the server so it works without
// scripts and previews well in chat apps. The owner chooses whether money amounts and the trade list are shown.
import { esc } from "./util";
import { sharedAccount } from "./journal";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JS = require("../web/js/jstats.js");

const MINUS = "−";
const fmtN = (v: number, d = 2) => v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (v: number, s: string) => (v > 0 ? "+" : v < 0 ? MINUS : "") + s;
const cls = (v: number | null | undefined) => (v == null || !v ? "" : v > 0 ? "up" : "dn");
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function renderShare(tok: string) {
  const d = sharedAccount(tok);
  if (!d) return null;
  const a = d.account, cur = a.currency || "USD", start = a.balance_start > 0 ? a.balance_start : 0, money = !!d.opts.money;
  const ts = JS.enrich(d.trades, { tz: d.prefs.tz, dayStart: d.prefs.dayStart, be: d.prefs.be });
  const s = JS.summary(ts, { start });
  const amt = (v: number) => sign(v, (cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur + " ") + fmtN(Math.abs(v)));
  const pct = (v: number) => sign(v, fmtN(Math.abs(v) * 100, 1) + "%");
  const rr = (v: number) => sign(v, fmtN(Math.abs(v), 2) + "R");
  // what a result is shown in: money if the owner allows it, else a share of the starting balance, else R
  const unit = money ? "money" : start ? "pct" : "r";
  const show = (v: number, r?: number | null) => (unit === "money" ? amt(v) : unit === "pct" ? pct(v / start) : r != null ? rr(r) : "");
  const name = esc(a.name || "Trading account");
  const first = ts.length ? ts[0].ot : 0, last = ts.length ? ts[ts.length - 1].ct : 0;
  const title = `${a.name || "Trading account"}: trading results | GoldenStraddler Journal`;

  if (!ts.length) {
    return { title, desc: "A shared trading journal account.", main: `<div class="wrap sh-empty"><h1>${name}</h1><p>No closed trades here yet.</p></div>` };
  }
  const tile = (lab: string, val: string, k = "", small = "") => `<div class="sh-tile"><span class="lab">${esc(lab)}</span><b class="${k}">${esc(val)}</b>${small ? `<small>${esc(small)}</small>` : ""}</div>`;
  const netR = ts.reduce((x: number, t: any) => x + (t.r ?? 0), 0), rN = ts.filter((t: any) => t.r != null).length;
  const netShown = unit === "money" ? amt(s.net) : unit === "pct" ? pct(s.net / start) : rN ? rr(netR) : "–";
  const dd = unit === "money" ? (s.maxDD ? MINUS + amt(s.maxDD).replace(/^[+−]/, "") : "0") : unit === "pct" && s.maxDDpct != null ? MINUS + fmtN(s.maxDDpct * 100, 1) + "%" : "";
  const tiles = [
    tile(unit === "money" ? "Net result" : unit === "pct" ? "Return on the starting balance" : "Net result in R", netShown, cls(s.net), unit === "r" && rN < ts.length ? `${rN} of ${ts.length} trades have a stop` : ""),
    tile("Closed trades", String(s.n), "", `${s.wins} won, ${s.losses} lost`),
    tile("Win rate", fmtN(s.winRate * 100, 0) + "%"),
    tile("Profit factor", s.pf == null ? "–" : s.pf === Infinity ? "No losses" : fmtN(s.pf, 2)),
    dd ? tile("Deepest drawdown", dd, "dn") : (() => { const b = ts.reduce((x: any, t: any) => (t.net > x.net ? t : x)); return tile("Best trade", show(b.net, b.r) || "–", cls(b.net)); })(),
    tile("Average trade", unit === "money" ? amt(s.expectancy) : s.expR != null ? rr(s.expR) : unit === "pct" ? pct(s.expectancy / start) : "–", cls(s.expectancy)),
  ];
  // the curve, drawn here so the page needs no script
  const pts: [number, number][] = []; let acc = 0;
  for (const t of ts) { acc += unit === "r" ? t.r ?? 0 : t.net; pts.push([t.ct, unit === "pct" ? acc / start * 100 : acc]); }
  // drawn twice: a wide version and a narrow one for phones, so the labels stay readable
  const lo = Math.min(0, ...pts.map((p) => p[1])), hi = Math.max(0, ...pts.map((p) => p[1])), t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
  const lab = (v: number) => unit === "money" ? sign(v, fmtN(Math.abs(v), 0)) : unit === "pct" ? sign(v, fmtN(Math.abs(v), 1) + "%") : sign(v, fmtN(Math.abs(v), 1) + "R");
  const ticks = [lo, (lo + hi) / 2, hi].filter((v, i, arr) => arr.indexOf(v) === i);
  const draw = (W: number, H: number, k: string) => {
    const L = 8, R = W < 600 ? 62 : 70, T = 12, B = 26;
    const X = (t: number) => L + (t - t0) / (t1 - t0) * (W - L - R), Y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
    const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
    return `<svg class="${k}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative result after each closed trade">
${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" style="stroke:var(--edge)"/><text class="ax" x="${W - R + 8}" y="${(Y(v) + 4).toFixed(1)}">${esc(lab(v))}</text>`).join("")}
<line x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" style="stroke:var(--muted)" stroke-dasharray="3 5"/>
<path d="${path}L${X(t1).toFixed(1)} ${Y(0).toFixed(1)}L${X(t0).toFixed(1)} ${Y(0).toFixed(1)}Z" style="fill:var(--ice)" fill-opacity=".1"/>
<path d="${path}" fill="none" style="stroke:var(--ice)" stroke-width="2" stroke-linejoin="round"/>
<text class="ax" x="${L}" y="${H - 6}">${esc(day(t0))}</text><text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(day(t1))}</text></svg>`;
  };
  const curve = draw(960, 260, "c-wide") + draw(360, 220, "c-narrow");
  // months
  const months = new Map<string, { n: number; net: number; r: number }>();
  for (const t of ts) { const k = String(t.day).slice(0, 7), m = months.get(k) || { n: 0, net: 0, r: 0 }; m.n++; m.net += t.net; m.r += t.r ?? 0; months.set(k, m); }
  const monthRows = [...months.entries()].reverse().slice(0, 24).map(([k, m]) => {
    const v = unit === "r" ? m.r : m.net;
    return `<tr><td>${esc(new Date(k + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }))}</td><td class="n">${m.n}</td><td class="n ${cls(v)}">${esc(unit === "money" ? amt(m.net) : unit === "pct" ? pct(m.net / start) : rr(m.r))}</td></tr>`;
  }).join("");
  const tradeRows = d.opts.trades ? ts.slice(-25).reverse().map((t: any) => `<tr><td>${esc(day(t.ct))}</td><td><b>${esc(t.s)}</b></td><td class="hm">${t.d > 0 ? "Long" : "Short"}</td><td class="n hm">${t.r != null ? esc(rr(t.r)) : ""}</td><td class="n ${cls(t.net)}">${esc(show(t.net, t.r))}</td></tr>`).join("") : "";
  const badge = d.synced
    ? `<p class="sh-badge ok"><svg aria-hidden="true"><use href="#i-shield"/></svg>All ${s.n} trades synced straight from MetaTrader by the GoldenStraddler connector</p>`
    : `<p class="sh-badge">Includes trades imported from a file or entered by hand</p>`;
  const sub = [a.broker ? esc(a.broker) : "", a.demo ? "demo account" : "", `${esc(day(first))} to ${esc(day(last))}`].filter(Boolean).join(" · ");
  const main = `<div class="wrap">
<section class="sh-h"><h1>${name}</h1><p class="sub">${sub}</p>${badge}</section>
<div class="sh-tiles">${tiles.join("")}</div>
<section class="sh-card sh-curve"><h2>${unit === "money" ? "Cumulative result" : unit === "pct" ? "Return on the starting balance" : "Cumulative result in R"}</h2>${curve}</section>
<div class="sh-grid">
<section class="sh-card"><h2>By month</h2><table class="sh-t"><thead><tr><th>Month</th><th class="n">Trades</th><th class="n">Result</th></tr></thead><tbody>${monthRows}</tbody></table></section>
${tradeRows ? `<section class="sh-card"><h2>Latest trades</h2><table class="sh-t"><thead><tr><th>Closed</th><th>Symbol</th><th class="hm">Side</th><th class="n hm">R</th><th class="n">Result</th></tr></thead><tbody>${tradeRows}</tbody></table></section>` : ""}
</div>
<p class="sh-note">Closed trades only, after commission and swap. ${unit === "pct" ? `Percentages are of the starting balance the account holder entered. ` : ""}${unit === "r" ? "R is each trade's result divided by the amount its initial stop risked. " : ""}A trading journal records what happened; it doesn't predict what happens next.</p>
</div>`;
  const desc = `${s.n} closed trades from ${day(first)} to ${day(last)}, win rate ${fmtN(s.winRate * 100, 0)}%${s.pf != null && s.pf !== Infinity ? `, profit factor ${fmtN(s.pf, 2)}` : ""}.`;
  return { title, desc, main };
}
