// Live dashboard for one licence (customer area and admin). Exposes window.GSDash.
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const MINUS = "−", DASH = "–";
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const svgEl = (tag, a) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let LIVE = false, OFFSET = 0;
const nowSrv = () => Date.now() + OFFSET;
const pad = (n) => String(n).padStart(2, "0");

/* ------------------------------------------------------------ formatting */
let CUR = "USD";
function money(v, plus = true) {
  const a = Math.abs(v); let b;
  try { b = new Intl.NumberFormat("en-US", { style: "currency", currency: CUR, minimumFractionDigits: a >= 1e4 ? 0 : 2, maximumFractionDigits: a >= 1e4 ? 0 : 2 }).format(a); }
  catch (e) { b = a.toFixed(2) + " " + CUR; }
  return (v < -0.004 ? MINUS : plus && v > 0.004 ? "+" : "") + b;
}
const signed = (v, d = 0) => { const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); return v < 0 ? MINUS + s : v > 0 ? "+" + s : s; };
const pct = (v) => (v * 100).toFixed(1) + "%";
const tcls = (v) => (v > 0.004 ? "up" : v < -0.004 ? "dn" : "");
const mmss = (s) => { s = Math.max(0, Math.floor(s)); return pad(Math.floor(s / 60)) + ":" + pad(s % 60); };
const countdown = (s) => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400); return (d ? d + "d " : "") + pad(Math.floor(s % 86400 / 3600)) + ":" + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60); };
const when = (u) => { const d = new Date(u * 1000); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };
const ago = (ms) => { ms = Math.max(0, ms); return ms < 6e4 ? (ms / 1000).toFixed(1) + " s ago" : ms < 36e5 ? Math.round(ms / 6e4) + " min ago" : Math.round(ms / 36e5) + " h ago"; };
const dur = (s) => !isFinite(s) ? DASH : s < 60 ? Math.round(s) + "s" : s < 3600 ? Math.floor(s / 60) + "m " + pad(Math.round(s % 60)) + "s" : Math.floor(s / 3600) + "h " + pad(Math.floor(s % 3600 / 60)) + "m";
function parseTime(s) {
  const m = String(s || "").trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return { ms: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)), txt: `${m[1]}.${pad(m[2])}.${pad(m[3])} ${pad(m[4])}:${m[5]}${m[6] ? ":" + m[6] : ""}` };
}

function lineChart(box, vals, opt = {}) {
  box.replaceChildren();
  if (vals.length < 2) { box.appendChild(el("div", "empty", "No trades in this range.")); return; }
  const W = Math.max(280, box.clientWidth || 600), H = opt.h || 240, L = 58, R = 18, T = 14, B = 26;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H }); box.appendChild(svg);
  const tip = el("div", "tip"); box.appendChild(tip);
  const nt = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const Y = (v) => T + (nt.hi - v) / (nt.hi - nt.lo) * (H - T - B), X = (i) => L + i * (W - L - R) / (vals.length - 1);
  axis(svg, nt.ticks, Y, L, W - R, opt.fmt || ((v) => signed(v)));
  const col = vals[vals.length - 1] >= 0 ? css("--up") : css("--loss"), id = "g" + Math.random().toString(36).slice(2, 7);
  const defs = svgEl("defs", {}), lg = svgEl("linearGradient", { id, x1: 0, x2: 0, y1: 0, y2: 1 });
  lg.append(svgEl("stop", { offset: 0, "stop-color": col, "stop-opacity": ".28" }), svgEl("stop", { offset: 1, "stop-color": col, "stop-opacity": 0 }));
  defs.appendChild(lg); svg.appendChild(defs);
  const pts = vals.map((v, i) => [X(i), Y(v)]), line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
  svg.append(svgEl("path", { d: `${line}L${pts[pts.length - 1][0].toFixed(1)},${Y(0)}L${L},${Y(0)}Z`, fill: `url(#${id})` }),
    svgEl("path", { d: line, fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round" }));
  const last = pts[pts.length - 1];
  svg.appendChild(svgEl("circle", { cx: last[0], cy: last[1], r: 5, fill: col, stroke: css("--carbon"), "stroke-width": 2 }));
  const dot = svgEl("circle", { r: 5, fill: col, visibility: "hidden" }), cross = svgEl("line", { y1: T, y2: H - B, stroke: css("--edge2"), visibility: "hidden" });
  const hit = svgEl("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent", tabindex: 0 });
  svg.append(cross, dot, hit);
  let cur = vals.length - 1;
  const show = (i) => {
    cur = i = Math.max(0, Math.min(vals.length - 1, i)); const [px, py] = pts[i];
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
    tipRows(tip, opt.tip ? opt.tip(i) : [{ big: true, text: signed(vals[i]), cls: tcls(vals[i]) }]);
    placeTip(box, tip, px * box.clientWidth / W, py * box.clientWidth / W);
  };
  hit.addEventListener("pointermove", (e) => { const r = svg.getBoundingClientRect(); show(Math.round(((e.clientX - r.left) * W / r.width - L) / ((W - L - R) / (vals.length - 1)))); });
  hit.addEventListener("pointerleave", () => { tip.classList.remove("on"); dot.setAttribute("visibility", "hidden"); cross.setAttribute("visibility", "hidden"); });
  hit.addEventListener("focus", () => show(cur));
  hit.addEventListener("blur", () => tip.classList.remove("on"));
  hit.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { show(cur + (e.key === "ArrowRight" ? 1 : -1)); e.preventDefault(); } });
}
function niceTicks(min, max, n) {
  if (min === max) { min -= 1; max += 1; }
  const s0 = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(s0))), r = s0 / mag;
  const st = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag, lo = Math.floor(min / st) * st, hi = Math.ceil(max / st) * st, ticks = [];
  for (let v = lo; v <= hi + st / 2; v += st) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}
function axis(svg, ticks, Y, x0, x1, fmt) {
  ticks.forEach((v) => {
    svg.appendChild(svgEl("line", { x1: x0, x2: x1, y1: Y(v), y2: Y(v), class: v === 0 ? "axisl" : "gridl" }));
    const t = svgEl("text", { x: x0 - 8, y: Y(v) + 4, class: "tick", "text-anchor": "end" }); t.textContent = fmt(v); svg.appendChild(t);
  });
}
function tipRows(tip, rows) {
  tip.replaceChildren();
  rows.forEach((r) => {
    const d = el("div", r.big ? "tv " + (r.cls || "") : "tr");
    if (r.key) { const s = el("s"); s.style.background = r.key; d.appendChild(s); }
    d.appendChild(document.createTextNode(r.text)); tip.appendChild(d);
  });
}
function placeTip(box, tip, px, py) {
  tip.classList.add("on");
  let l = px + 14; if (l + tip.offsetWidth > box.clientWidth) l = px - tip.offsetWidth - 14;
  let t = py - tip.offsetHeight - 10; if (t < 0) t = py + 14;
  tip.style.left = Math.max(0, l) + "px"; tip.style.top = t + "px";
}
/* =========================================================== DASHBOARD */
const ST = { key: null, feed: null, status: null, statusAt: 0, lastPoll: 0, news: [] };
let DATA = { trades: [], source: "live", meta: {} }, FILTER = { range: "all", side: "all" }, DEMO = false;

function stats(tr) {
  const s = { n: tr.length, wins: 0, losses: 0, gW: 0, gL: 0, costs: 0, best: -Infinity, worst: Infinity, dd: 0, peak: 0, sp: 0, np: 0, curve: [0], mw: 0, ml: 0, du: 0, nd: 0 };
  let c = 0, w = 0, l = 0;
  tr.forEach((t) => {
    c += t.net; s.curve.push(c); s.peak = Math.max(s.peak, c); s.dd = Math.max(s.dd, s.peak - c);
    if (t.net > 0) { s.wins++; s.gW += t.net; w++; l = 0; } else if (t.net < 0) { s.losses++; s.gL -= t.net; l++; w = 0; } else w = l = 0;
    s.mw = Math.max(s.mw, w); s.ml = Math.max(s.ml, l); s.best = Math.max(s.best, t.net); s.worst = Math.min(s.worst, t.net); s.costs += t.costs;
    if (!isNaN(t.pts)) { s.sp += t.pts; s.np++; }
    if (t.ot && t.ct && t.ct.ms >= t.ot.ms) { s.du += (t.ct.ms - t.ot.ms) / 1000; s.nd++; }
  });
  s.net = c; s.wr = s.n ? s.wins / s.n : 0; s.pf = s.gL > 0 ? s.gW / s.gL : s.gW > 0 ? Infinity : 0; s.exp = s.n ? c / s.n : 0;
  s.aw = s.wins ? s.gW / s.wins : 0; s.al = s.losses ? s.gL / s.losses : 0; s.ap = s.np ? s.sp / s.np : NaN; s.ad = s.nd ? s.du / s.nd : NaN;
  return s;
}
const tms = (t) => (t.ct || t.ot)?.ms ?? 0;
function rangeTr() {
  let tr = DATA.trades.slice();
  if (FILTER.range !== "all" && tr.length) { const from = Math.max(...tr.map(tms)) - FILTER.range * 864e5; tr = tr.filter((t) => tms(t) > from); }
  return tr;
}
const filtered = () => { const tr = rangeTr(); return FILTER.side === "all" ? tr : tr.filter((t) => t.side === FILTER.side); };
function barPath(x, w, y0, y1, r) {
  const h = Math.abs(y1 - y0); r = Math.max(0, Math.min(r, w / 2, h)); if (h < 0.5) return "";
  const s = y1 < y0 ? 1 : -1;
  return `M${x},${y0}V${y1 + s * r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + s * r}V${y0}Z`;
}
function bars(id, items, opt) {
  const box = $(id); box.replaceChildren();
  if (!items.length) { box.appendChild(el("div", "empty", "No trades in this range.")); return; }
  const W = Math.max(280, box.clientWidth || 600), H = 220, L = 58, R = 12, T = 14, B = 26;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H }), tip = el("div", "tip"); box.append(svg, tip);
  const vals = items.map((d) => d.v), nt = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const Y = (v) => T + (nt.hi - v) / (nt.hi - nt.lo) * (H - T - B);
  axis(svg, nt.ticks, Y, L, W - R, opt.fmt || tickMoney);
  const band = (W - L - R) / items.length, bw = Math.max(2, Math.min(24, band - 2)), y0 = Y(0), up = css("--up"), dn = css("--loss"), mid = css("--deep"), hits = [];
  items.forEach((d, i) => {
    const p = svgEl("path", { d: barPath(L + i * band + (band - bw) / 2, bw, y0, Y(d.v), 4), fill: d.color || (d.v > 0 ? up : d.v < 0 ? dn : mid) });
    svg.appendChild(p);
    if (d.label !== undefined && i % (opt.every || 1) === 0) { const t = svgEl("text", { x: L + i * band + band / 2, y: H - 8, class: "tick", "text-anchor": "middle" }); t.textContent = d.label; svg.appendChild(t); }
    hits.push({ p, d, cx: L + i * band + band / 2, cy: Math.min(y0, Y(d.v)) });
  });
  const layer = svgEl("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent", tabindex: 0 }); svg.appendChild(layer);
  let cur = -1;
  const show = (i) => { cur = i = Math.max(0, Math.min(hits.length - 1, i)); hits.forEach((h, j) => h.p.setAttribute("opacity", j === i ? 1 : 0.4)); const h = hits[i]; tipRows(tip, opt.tip(h.d)); placeTip(box, tip, h.cx * box.clientWidth / W, h.cy * box.clientWidth / W); };
  const hide = () => { hits.forEach((h) => h.p.setAttribute("opacity", 1)); tip.classList.remove("on"); };
  layer.addEventListener("pointermove", (e) => { const r = svg.getBoundingClientRect(); show(Math.floor(((e.clientX - r.left) * W / r.width - L) / band)); });
  layer.addEventListener("pointerleave", hide); layer.addEventListener("blur", hide);
  layer.addEventListener("focus", () => show(cur < 0 ? hits.length - 1 : cur));
  layer.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { show(cur + (e.key === "ArrowRight" ? 1 : -1)); e.preventDefault(); } });
}
const tickMoney = (v) => { const a = Math.abs(v); return (v < 0 ? MINUS : "") + (a >= 1000 ? (a / 1000).toFixed(a >= 1e4 ? 0 : 1) + "k" : Number.isInteger(a) ? String(a) : a.toFixed(a < 10 ? 1 : 0)); };
function kpi(label, value, cls, sub, meter) {
  const d = el("div", "kpi"); d.append(el("span", "lab", label), el("div", "v " + (cls || ""), value));
  if (meter !== undefined) { const m = el("div", "meter"), b = el("b"); b.style.width = Math.max(0, Math.min(100, meter * 100)) + "%"; m.appendChild(b); d.appendChild(m); }
  if (sub) d.appendChild(el("div", "s", sub));
  return d;
}
function render() {
  const tr = filtered(), s = stats(tr), has = s.n > 0;
  $("netBig").textContent = has ? money(s.net) : DASH; $("netBig").className = "netv " + tcls(s.net);
  $("netSub").textContent = has ? `${s.n} closed trade${s.n === 1 ? "" : "s"}, ${money(s.gW, false)} won, ${money(-s.gL)} lost` : "No closed trades yet.";
  const mi = $("minis"); mi.replaceChildren();
  const bal = +DATA.meta.balance;
  [["Costs paid", has ? money(s.costs) : DASH, has && s.costs < 0 ? "dn" : ""], ["Balance", isNaN(bal) || !DATA.meta.balance ? DASH : money(bal, false)],
    ["Best trade", has ? money(s.best) : DASH, has ? tcls(s.best) : ""], ["Worst trade", has ? money(s.worst) : DASH, has ? tcls(s.worst) : ""]]
    .forEach(([k, v, c]) => { const d = el("div"); d.append(el("dt", "", k), el("dd", c || "", v)); mi.appendChild(d); });
  $("eqNote").textContent = has ? `${s.n} trades` : "";
  const k = $("kpis"); k.replaceChildren();
  k.append(kpi("Win rate", has ? pct(s.wr) : DASH, "", has ? `${s.wins} won, ${s.losses} lost` : "", has ? s.wr : 0),
    kpi("Profit factor", !has ? DASH : s.pf === Infinity ? "∞" : s.pf.toFixed(2), has ? (s.pf >= 1 ? "up" : "dn") : "", "gross won over gross lost"),
    kpi("Expectancy", has ? money(s.exp) : DASH, has ? tcls(s.exp) : "", "average net per trade"),
    kpi("Max drawdown", has ? money(-s.dd) : DASH, has && s.dd > 0 ? "dn" : "", "peak to trough, closed trades"),
    kpi("Average win", s.wins ? money(s.aw) : DASH, s.wins ? "up" : "", s.wins && s.losses ? `payoff ${(s.aw / s.al).toFixed(2)} to 1` : ""),
    kpi("Average loss", s.losses ? money(-s.al) : DASH, s.losses ? "dn" : "", s.losses ? `longest losing run ${s.ml}` : "no losing trades"),
    kpi("Points per trade", isNaN(s.ap) ? DASH : signed(s.ap), isNaN(s.ap) ? "" : tcls(s.ap), "average captured"),
    kpi("Hold time", isNaN(s.ad) ? DASH : dur(s.ad), "", isNaN(s.ad) ? "" : `longest winning run ${s.mw}`));
  lineChart($("eqChart"), s.curve, { fmt: tickMoney, tip: (i) => {
    const r = [{ big: true, text: money(s.curve[i]), cls: tcls(s.curve[i]) }];
    if (i) { const t = tr[i - 1]; r.push({ key: t.side === "BUY" ? css("--ice") : css("--white"), text: `#${i} ${t.side}, ${money(t.net)}` }, { text: (t.ct || t.ot)?.txt || "" }); } else r.push({ text: "Start of range" });
    return r;
  } });
  const cap = 120, sl = tr.slice(-cap), off = tr.length - sl.length;
  $("barsNote").textContent = tr.length > cap ? `last ${cap} of ${tr.length}` : has ? `${tr.length} trades` : "";
  bars("barChart", sl.map((t, i) => ({ v: t.net, t, i: off + i + 1 })), { tip: (d) => [{ big: true, text: money(d.v), cls: tcls(d.v) },
    { key: d.t.side === "BUY" ? css("--ice") : css("--white"), text: `#${d.i} ${d.t.side} ${isNaN(d.t.vol) ? "" : d.t.vol.toFixed(2) + " lot"}` }, { text: `${isNaN(d.t.pts) ? "" : signed(d.t.pts) + " pts, "}${d.t.ot?.txt || ""}` }] });
  const pa = tr.map((t) => t.pts).filter((v) => !isNaN(v));
  if (pa.length) {
    const mn = Math.min(...pa), mx = Math.max(...pa), st = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((x) => Math.max(1, mx - mn) / x <= 10) || 1000;
    const lo = Math.floor(mn / st) * st, bins = [];
    for (let b = lo; b <= Math.floor(mx / st) * st; b += st) bins.push({ f: b, t: b + st, c: 0 });
    pa.forEach((p) => bins[Math.min(bins.length - 1, Math.floor((p - lo) / st))].c++);
    bars("histChart", bins.map((b) => ({ v: b.c, b, color: b.t <= 0 ? css("--loss") : b.f >= 0 ? css("--up") : css("--deep"), label: (b.f < 0 ? MINUS : "") + Math.abs(b.f) })),
      { fmt: (v) => (Number.isInteger(v) ? String(v) : ""), every: bins.length > 8 ? 2 : 1, tip: (d) => [{ big: true, text: `${d.v} trade${d.v === 1 ? "" : "s"}` }, { text: `${signed(d.b.f)} to ${signed(d.b.t)} pts` }] });
  } else bars("histChart", [], {});
  if (has) {
    const hrs = Array.from({ length: 24 }, (_, h) => ({ h, v: 0, n: 0 }));
    tr.forEach((t) => { const tt = t.ot || t.ct; if (tt) { const h = new Date(tt.ms).getUTCHours(); hrs[h].v += t.net; hrs[h].n++; } });
    bars("hourChart", hrs.map((o) => ({ v: o.v, o, label: pad(o.h) })), { every: 3, tip: (d) => [{ big: true, text: d.o.n ? money(d.v) : "No trades", cls: tcls(d.v) }, { text: `${pad(d.o.h)}:00 to ${pad(d.o.h)}:59, ${d.o.n} trade${d.o.n === 1 ? "" : "s"}` }] });
  } else bars("hourChart", [], {});
  const sd = $("sides"); sd.replaceChildren();
  const all = rangeTr(), per = ["BUY", "SELL"].map((x) => ({ x, s: stats(all.filter((t) => t.side === x)) })), mx = Math.max(1e-9, ...per.map((p) => Math.abs(p.s.net)));
  per.forEach(({ x, s: q }) => {
    const row = el("div", "sideb"), nm = el("div", "nm"), i = el("i"); i.style.background = x === "BUY" ? css("--ice") : css("--white"); nm.append(i, x);
    const tk = el("div", "track"), b = el("b"); b.style.width = Math.abs(q.net) / mx * 100 + "%"; b.style.background = q.net < 0 ? css("--loss") : css("--up"); tk.appendChild(b);
    const f = el("div", "facts");
    [["Net", q.n ? money(q.net) : DASH, q.n ? tcls(q.net) : ""], ["Trades", String(q.n)], ["Win rate", q.n ? pct(q.wr) : DASH], ["Avg pts", isNaN(q.ap) ? DASH : signed(q.ap)]]
      .forEach(([a, v, c]) => { const sp = el("span", "", a + " "); sp.appendChild(el("strong", c || "", v)); f.appendChild(sp); });
    row.append(nm, tk, f); sd.appendChild(row);
  });
  const body = $("ledger"); body.replaceChildren();
  let run = 0; const running = tr.map((t) => (run += t.net)), shown = Math.min(tr.length, 300), dg = +(DATA.meta.digits || 2);
  for (let q = tr.length - 1; q >= tr.length - shown; q--) {
    const t = tr[q], r = el("tr"), td = (x, c) => r.appendChild(el("td", c || "", x));
    td(String(q + 1)); td(t.ot?.txt || t.ct?.txt || DASH, "w");
    const c = el("td"); c.appendChild(el("span", "chip" + (t.side === "SELL" ? " sell" : ""), t.side)); r.appendChild(c);
    td(isNaN(t.vol) ? DASH : t.vol.toFixed(2)); td(isNaN(t.op) ? DASH : t.op.toFixed(dg), "w"); td(isNaN(t.cp) ? DASH : t.cp.toFixed(dg), "w");
    td(isNaN(t.pts) ? DASH : signed(t.pts), tcls(t.pts)); td(money(t.gross), tcls(t.gross)); td(money(t.costs, false)); td(money(t.net), tcls(t.net)); td(money(running[q]), tcls(running[q]));
    body.appendChild(r);
  }
  if (!tr.length) { const r = el("tr"), c = el("td", "", "No closed trades yet. Each one appears here within a second of closing."); c.colSpan = 11; c.style.textAlign = "center"; r.appendChild(c); body.appendChild(r); }
  $("ledgerNote").textContent = tr.length ? "Newest first" : "";
  $("ledgerMore").textContent = tr.length > shown ? `Showing the latest ${shown} of ${tr.length}. Charts and stats use all of them.` : "";
  const src = $("srcTxt");
  src.textContent = DATA.source === "file" ? `${DATA.fileName}: ${DATA.trades.length} trades${DATA.meta.symbol ? " on " + DATA.meta.symbol : ""}. This file is only in your browser.` :
    ST.feed ? `Account ${ST.feed.account}${ST.feed.server ? " on " + ST.feed.server : ""}${ST.feed.demo ? " (demo)" : ""}, synced from MT5.` : "No data from MT5 yet. It appears here once the EA has checked its licence.";
}

/* --------------------------------------------------------- live panel */
const fresh = () => false || (ST.status && nowSrv() - ST.statusAt < 15000);
const winEnd = (st) => (st && st.ea && st.ea.window_end > 0 ? st.ea.window_end - (st.utc_offset || 0) : 0);
function stateView(st, fr) {
  if (!st) return ["Waiting for MT5", "chip dim"];
  if (!fr) return ["MT5 offline", "chip loss"];
  if (st.connected === false) return ["Broker disconnected", "chip loss"];
  return ({ "IN TRADE": ["In trade", "chip pulse"], ARMED: ["Armed", "chip gold pulse"], WAITING: ["Waiting for news", "chip"], PAUSED: ["Paused", "chip dim"],
    OFFLINE: ["EA not running", "chip loss"], "ALGO OFF": ["Algo Trading off", "chip loss"], REJECTED: ["Order rejected", "chip loss"], LICENCE: ["Licence needed", "chip loss"] })[(st.ea && st.ea.state) || "OFFLINE"] || ["Ready", "chip"];
}
function kvRow(box, k, v, c) { const d = el("div"); d.append(el("span", "", k), el("b", c || "", v)); box.appendChild(d); }
function renderLive() {
  const st = ST.status, fr = fresh(), age = nowSrv() - ST.statusAt, feed = ST.feed || {};
  const [tx, cl] = stateView(st, fr); $("lvChip").className = cl; $("lvChipTxt").textContent = tx;
  $("lvMode").textContent = st && st.ea ? (st.ea.mode === "always" ? "always on" : "news windows") : "";
  const kv = $("lvKv"); kv.replaceChildren();
  kvRow(kv, "Symbol", feed.symbol ? `${feed.symbol}, magic ${feed.magic}` : DASH);
  kvRow(kv, "Spread", st && st.spread !== undefined ? st.spread + " pts" : DASH);
  kvRow(kv, "Ping", st && st.ping_ms !== undefined ? st.ping_ms + " ms" : DASH);
  kvRow(kv, "Last update", st ? ago(age) : "never", st && !fr ? "dn" : "");
  renderPos(st, fr);
  const acc = $("lvAcc"); acc.replaceChildren();
  $("lvAccNote").textContent = st ? (st.demo ? "demo" : "live") + (st.server ? ", " + st.server : "") : "";
  kvRow(acc, "Balance", st ? money(+st.balance, false) : DASH); kvRow(acc, "Equity", st ? money(+st.equity, false) : DASH);
  kvRow(acc, "Today", st && st.today ? money(+st.today.net) : DASH, st && st.today ? tcls(+st.today.net) : ""); kvRow(acc, "Trades today", st && st.today ? String(st.today.trades) : DASH);
  renderNews(st, fr);
  const lc = $("liveChip"), lt = $("liveTxt");
  if (false) { lc.className = "chip gold"; lt.textContent = "Demo data"; }
  else if (!st) { lc.className = "chip dim"; lt.textContent = "Waiting for MT5"; }
  else if (fr) { lc.className = "chip pulse"; lt.textContent = "Live, " + (age / 1000).toFixed(1) + " s"; }
  else { lc.className = "chip loss"; lt.textContent = "MT5 offline"; }
}
function renderPos(st, fr) {
  const box = $("lvPos"), lab = $("lvPosLab"), note = $("lvPosNote"); box.replaceChildren();
  const set = (st && st.settings) || { trail_start: 50, trail_dist: 50, before: 15, after: 60 }, dg = (st && st.digits) || 2;
  if (st && st.position && fr) {
    const p = st.position; lab.textContent = "Open position";
    note.textContent = p.count > 1 ? `${p.count} positions` : st.ea && st.ea.mode === "news" && winEnd(st) * 1000 < nowSrv() ? "window closed, still trailing" : "other side deleted";
    const top = el("div", "pos-top"), sd = el("div", "sd");
    sd.append(el("span", "chip" + (p.side === "SELL" ? " sell" : ""), p.side), `${(+p.volume).toFixed(2)} lot at ${(+p.open).toFixed(dg)}`);
    top.append(sd, el("div", "big " + tcls(+p.profit), money(+p.profit)));
    const row = el("div", "pos-row"); row.appendChild(el("span", "", "SL " + (p.sl > 0 ? (+p.sl).toFixed(dg) : "none")));
    if (p.locked !== null && p.locked !== undefined) { const lk = el("span", "", p.locked >= 0 ? "Locked " : "At risk "); lk.appendChild(el("b", p.locked >= 0 ? "up" : "dn", money(+p.locked))); row.appendChild(lk); }
    const tr = el("div", "trail"), t = el("div", "t");
    t.append(el("span", "lab", "Trailing stop"), el("span", p.trail_active ? "up" : "", p.trail_active ? `Active, ${set.trail_dist} pts behind` : `${signed(+p.points || 0)} of ${set.trail_start} pts to start`));
    const m = el("div", "meter"), b = el("b"); b.style.width = (p.trail_active ? 100 : Math.max(0, Math.min(100, (+p.points || 0) / set.trail_start * 100))) + "%"; m.appendChild(b);
    tr.append(t, m); box.append(top, row, tr); return;
  }
  if (st && st.pending && fr) {
    const pd = st.pending; lab.textContent = "Straddle armed"; note.textContent = "waiting for a fill";
    const g = el("div", "pend");
    [["BUY STOP", "up", pd.buy_stop, pd.buy_sl], ["SELL STOP", "", pd.sell_stop, pd.sell_sl]].forEach(([n, c, pr, s]) => g.append(el("span", c, n), el("span", "lv", pr ? (+pr).toFixed(dg) : DASH), el("span", "sl", s ? "SL " + (+s).toFixed(dg) : "")));
    box.appendChild(g); return;
  }
  lab.textContent = "Position"; note.textContent = st && fr ? "flat" : "";
  const s = st && st.ea ? st.ea.state : "";
  const [t, p] = !st ? ["Waiting for MT5", "Attach GoldenStraddler to an XAUUSD chart with your licence key. The guide walks you through it."] :
    !fr ? ["MT5 is offline", `Nothing heard for ${ago(nowSrv() - ST.statusAt).replace(" ago", "")}. Check that the PC or VPS is on and MT5 is running.`] :
    s === "WAITING" ? ["Waiting for news", `Switches on ${set.before} s before the next high-impact USD release and off ${set.after} s after.`] :
    s === "PAUSED" ? ["Paused", "Press RESUME on the MT5 panel to trade the next window."] :
    s === "OFFLINE" ? ["Trading EA not running", "Attach GoldenStraddler to the XAUUSD chart and turn on Algo Trading."] :
    s === "ALGO OFF" ? ["Algo Trading is off", "Turn on Algo Trading in the MT5 toolbar."] :
    s === "REJECTED" ? ["Order rejected", "The broker refused the last order. The EA retries every second."] :
    s === "LICENCE" ? ["Licence needed", "The EA isn't placing new orders. Check your licence status above, or the message on the MT5 panel."] : ["Placing the straddle", "Orders go out on the next tick."];
  const f = el("div", "flat"); f.append(el("div", "t", t), el("p", "", p)); box.appendChild(f);
}
function renderNews(st, fr) {
  const set = (st && st.settings) || { before: 15, after: 60 };
  const list = st && Array.isArray(st.news) && st.news.length ? st.news : ST.news;
  const now = nowSrv() / 1000, up = list.filter((e) => e.utc + set.after > now).sort((a, b) => a.utc - b.utc);
  $("newsSrc").textContent = list === ST.news ? (list.length ? "from ForexFactory" : "") : "from your EA";
  const card = $("nextCard"); card.replaceChildren();
  const we = winEnd(st);
  if (fr && we > now) {
    const cur = up.find((e) => e.utc - set.before <= now && e.utc + set.after > now);
    card.append(el("span", "lab", "News window live"), el("div", "cd", "Off in " + mmss(we - now)), el("div", "ttl", cur ? cur.title : "Manual window"), el("div", "meta", "Straddle, trail and re-arm run until the window closes."));
  } else {
    const nx = up.find((e) => e.utc - set.before > now);
    if (!nx) card.append(el("span", "lab", "Next release"), el("div", "ttl", "Nothing scheduled right now"), el("div", "meta", "The schedule refreshes every hour."));
    else { const sec = nx.utc - set.before - now; card.append(el("span", "lab", "Switches on in"), el("div", "cd" + (sec < 600 ? " soon" : ""), countdown(sec)), el("div", "ttl", nx.title), el("div", "meta", `Release ${when(nx.utc)} your time. On ${set.before} s before, off ${set.after} s after.`)); }
  }
  const ul = $("evList"); ul.replaceChildren();
  if (!up.length) { const li = el("li"); li.appendChild(el("span", "empty", "No high-impact USD releases found for this week yet.")); ul.appendChild(li); return; }
  up.slice(0, 6).forEach((e) => {
    const li = el("li"), tm = el("time", "", when(e.utc)); tm.dateTime = new Date(e.utc * 1000).toISOString();
    const b = el("b"); b.append(el("span", "folder"), e.title);
    li.append(tm, b, el("span", "src", e.src === 2 ? "MT5" : "FF")); ul.appendChild(li);
  });
}

/* ------------------------------------------------------------ data I/O */
const fromServer = (t) => ({ id: t.id, side: t.side, vol: +t.volume, op: +t.open_price, cp: +t.close_price, pts: +t.points, gross: +t.gross,
  costs: (+t.commission || 0) + (+t.swap || 0) + (+t.fee || 0), net: +t.net, ot: parseTime(t.open_time), ct: parseTime(t.close_time) });
const sortTr = () => DATA.trades.sort((a, b) => tms(a) - tms(b));

/* ------------------------------------------------------------ wiring */
let LIC = "", BASE = "/api/me", started = false;
async function loadState(force) {
  const r = await fetch(`${BASE}/state?licence=${encodeURIComponent(LIC)}`, { cache: "no-store" });
  if (r.status === 401) { location.reload(); return; }
  const j = await r.json();
  OFFSET = j.serverNow - Date.now(); ST.lastPoll = Date.now();
  const c = j.current;
  if (c) {
    ST.key = c.feed.key; ST.feed = c.feed; ST.status = c.status; ST.statusAt = c.statusAt; CUR = c.feed.currency || "USD";
    DATA = { trades: (c.trades || []).map(fromServer), source: "live", meta: { digits: (c.status && c.status.digits) || 2, balance: c.status && c.status.balance } }; sortTr();
  } else { ST.feed = null; ST.status = null; ST.statusAt = 0; DATA = { trades: [], source: "live", meta: {} }; }
  render(); renderLive();
}
async function loadNews() { try { const r = await fetch(`${BASE}/news`, { cache: "no-store" }); const j = await r.json(); ST.news = j.events || []; renderLive(); } catch (e) {} }
let es = null;
function openStream() {
  if (!window.EventSource || BASE !== "/api/me") return;
  if (es) es.close();
  es = new EventSource(`${BASE}/stream?licence=${encodeURIComponent(LIC)}`);
  es.addEventListener("hello", (e) => { try { OFFSET = JSON.parse(e.data).serverNow - Date.now(); } catch (x) {} });
  es.addEventListener("status", (e) => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } if (d.licence !== LIC) return;
    OFFSET = d.serverNow - Date.now(); ST.status = d.status; ST.statusAt = d.statusAt; if (DATA.meta) DATA.meta.balance = d.status && d.status.balance; renderLive(); });
  es.addEventListener("trades", (e) => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } if (d.licence === LIC) loadState(); });
}
function wire() {
  const seg = (id, k) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; FILTER[k] = b.dataset.v; $(id).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); render(); });
  seg("rangeSeg", "range"); seg("sideSeg", "side");
  let rT, lw = 0;
  new ResizeObserver((en) => { const w = Math.round(en[0].contentRect.width); if (w === lw) return; lw = w; clearTimeout(rT); rT = setTimeout(render, 120); }).observe(document.body);
  setInterval(() => { renderLive(); if (Date.now() - ST.lastPoll > 30000 && document.visibilityState === "visible") loadState().catch(() => {}); }, 1000);
  setInterval(loadNews, 600000);
}
window.GSDash = {
  async show(licenceId, base) {
    LIC = licenceId; BASE = base || "/api/me";
    if (!started) { started = true; wire(); loadNews(); }
    await loadState(true); openStream();
  },
  refresh: () => loadState(true),
};
})();
