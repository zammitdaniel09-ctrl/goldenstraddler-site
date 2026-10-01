(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MINUS = "−";
const eur = (c) => "€" + (c / 100).toLocaleString("en-IE", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, "0");

const top = $("top");
const onScroll = () => top.classList.toggle("scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true }); onScroll();

let skew = 0, GROUPS = [];

// ================================================================ hero illustration: one release
const W = 640, H = 380, X0 = 18;
let X1 = 506, LX = 514, FS = 12;
const S = 560, ARM = 120, REL = 240;
const PRE_MS = 4600, POST_MS = 7400, HOLD_MS = 2600, FADE_MS = 450;
const clockAt = (i) => (i <= REL ? -30 + 30 * i / REL : 60 * (i - REL) / (S - 1 - REL));
const xAt = (i) => X0 + (X1 - X0) * i / (S - 1);

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Price in points, simulated step by step together with the orders, so the drawing always
// follows the EA's real rules: 60-point stops either side, 100-point stop loss,
// trailing from +50 at 50 behind, fresh pair after an exit, everything pending removed at +60 s.
function run(seed, dir, lose) {
  const r = rng(seed), g = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const p = new Float64Array(S), trail = new Float64Array(S).fill(NaN);
  let x = 0, buy = 0, sell = 0, entry = 0, fill = -1, close = -1, best = -Infinity, tr = null, result = 0, base = 0, phase = "pre", k = 0;
  const imp = 150 + r() * 90, spike = 22 + r() * 18, runLen = 120 + Math.floor(r() * 30);
  let v = 0;
  const step = (drift, sd, pull = 0) => { v = 0.72 * v + 0.28 * drift + g() * sd; x += v - pull; };
  for (let i = 0; i < S; i++) {
    if (i < REL) {
      step(0, 1.05, 0.035 * x);
      if (i >= ARM) { const c = Math.max(sell + 16, Math.min(buy - 16, x)); if (c !== x) { x = c; v *= -0.5; } }
      if (i === ARM) { buy = x + 60; sell = x - 60; }
    } else {
      if (i === REL) { base = x; phase = "impulse"; k = 0; }
      k++;
      if (phase === "impulse") {
        const goal = lose ? (dir > 0 ? buy - base : base - sell) + spike : imp, n = lose ? 9 : 22;
        x = base + dir * goal * (1 - Math.pow(1 - Math.min(1, k / n), 3)) + g() * 2.2;
        if (k >= n) { phase = lose ? "snap" : "run"; k = 0; v = 0; }
      } else if (phase === "run") { step(dir * (0.55 + Math.sin(k / 9) * 2.2), 1.3); if (k >= runLen) phase = "turn"; }
      else if (phase === "turn") step(-dir * 2.2, 1.2);
      else if (phase === "snap") step(-dir * 3, 1.4);
      else step(0, 0.8, 0.08 * (x - base));            // calm after the exit
    }
    p[i] = x;
    if (i < REL || close >= 0) continue;
    if (fill < 0) { if (dir > 0 ? x >= buy : x <= sell) { fill = i; entry = dir > 0 ? buy : sell; } else continue; }
    const q = dir * (x - entry);
    best = Math.max(best, q);
    if (best >= 50) tr = Math.max(tr ?? -Infinity, Math.floor(best - 50));
    if (tr !== null) trail[i] = entry + dir * tr;
    if (q <= -100) { close = i; result = -100; }
    else if (tr !== null && q <= tr && i > fill) { close = i; result = tr; }
    if (close >= 0) { p[i] = x = entry + dir * result; base = x; phase = "calm"; v = 0; }
  }
  const rearm = close >= 0 && clockAt(close) < 60 ? { at: close, buy: p[close] + 60, sell: p[close] - 60 } : null;
  const sl = entry - dir * 100;
  const vals = [...p, buy, sell, sl]; if (rearm) vals.push(rearm.buy, rearm.sell);
  const lo = Math.min(...vals) - 18, hi = Math.max(...vals) + 18;
  return { p, trail, buy, sell, entry, sl, fill, close, result, dir, rearm, lo, hi, lose };
}

const svg = $("scope");
const mk = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
const txt = (attrs, s) => { const t = mk("text", { "font-family": "JetBrains Mono, ui-monospace, monospace", "font-size": FS, ...attrs }); t.textContent = s; return t; };
const G = {};
function buildScope() {
  // keep the labels readable when the chart is drawn small (phones)
  const w = svg.getBoundingClientRect().width || 560;
  FS = Math.round(Math.min(21, Math.max(12, 11.5 * 640 / w)));
  X1 = Math.round(W - FS * 0.6 * 13 - 16); LX = X1 + 8;
  svg.replaceChildren();
  for (let y = 40; y < H; y += 50) mk("line", { x1: 0, x2: W, y1: y, y2: y, stroke: "#161c25", "stroke-width": 1 });
  G.root = mk("g", {});
  const R = G.root;
  G.rel = mk("line", { x1: xAt(REL), x2: xAt(REL), y1: 14, y2: H - 8, stroke: "#2e3644", "stroke-dasharray": "3 5" }, R);
  G.relT = txt({ x: xAt(REL) + 6, y: 26, fill: "#6f7787" }, "release"); R.appendChild(G.relT);
  const lvl = (color, dash, w = 1.5) => mk("line", { stroke: color, "stroke-width": w, "stroke-dasharray": dash, opacity: 0 }, R);
  const lab = (color) => { const t = txt({ fill: color, opacity: 0, x: LX }, ""); R.appendChild(t); return t; };
  G.buy = lvl("#3FC4FC", "6 5"); G.sell = lvl("#d9dee7", "6 5"); G.sl = lvl("#F2616F", "3 4", 1.2);
  G.nbuy = lvl("#3FC4FC", "2 4", 1.2); G.nsell = lvl("#d9dee7", "2 4", 1.2);
  G.trail = mk("path", { fill: "none", stroke: "#3FC4FC", "stroke-width": 1.6, opacity: 0.95 }, R);
  G.buyT = lab("#3FC4FC"); G.sellT = lab("#d9dee7"); G.slT = lab("#F2616F"); G.trT = lab("#3FC4FC"); G.nbuyT = lab("#3FC4FC"); G.nsellT = lab("#d9dee7");
  G.price = mk("path", { fill: "none", stroke: "#E6B450", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, R);
  G.halo = mk("circle", { r: 11, fill: "#E6B450", opacity: 0.16 }, R);
  G.head = mk("circle", { r: 4, fill: "#E6B450" }, R);
  G.mark = mk("circle", { r: 6, fill: "none", "stroke-width": 2, opacity: 0 }, R);
  G.markT = txt({ "font-size": FS + 1, "font-weight": 600, opacity: 0 }, ""); R.appendChild(G.markT);
}
const say = $("scSay"), sayBox = $("scSayBox"), clock = $("scClock");
let lastSay = "";
function setSay(s, cls = "") { if (s !== lastSay) { say.textContent = s; lastSay = s; } sayBox.className = "say " + cls; }
const show = (el, on, op = 1) => el.setAttribute("opacity", on ? op : 0);
function hline(el, y, xa, xb) { el.setAttribute("x1", xa); el.setAttribute("x2", xb); el.setAttribute("y1", y); el.setAttribute("y2", y); }
function label(el, y, s, taken) {
  let yy = y + FS / 3; const gap = FS + 3;
  for (const t of taken) if (Math.abs(t - yy) < gap) yy = t + (yy >= t ? gap : -gap);
  taken.push(yy); el.setAttribute("y", yy); el.textContent = s;
}

function draw(R, i, evShort) {
  const k = (H - 40) / (R.hi - R.lo), y = (v) => 20 + (R.hi - v) * k;
  const side = R.dir > 0 ? "Buy" : "Sell", other = R.dir > 0 ? "sell" : "buy";
  let d = "";
  for (let j = 0; j <= i; j++) d += (j ? "L" : "M") + xAt(j).toFixed(1) + " " + y(R.p[j]).toFixed(1);
  G.price.setAttribute("d", d);
  const hx = xAt(i), hy = y(R.p[i]);
  G.head.setAttribute("cx", hx); G.head.setAttribute("cy", hy); G.halo.setAttribute("cx", hx); G.halo.setAttribute("cy", hy);
  const taken = [];
  const armed = i >= ARM, filled = R.fill >= 0 && i >= R.fill, closed = R.close >= 0 && i >= R.close;
  const over = i >= S - 1;
  const entryEl = R.dir > 0 ? G.buy : G.sell, otherEl = R.dir > 0 ? G.sell : G.buy;
  const entryT = R.dir > 0 ? G.buyT : G.sellT, otherT = R.dir > 0 ? G.sellT : G.buyT;
  // the pair placed at -15 s
  hline(G.buy, y(R.buy), xAt(ARM), closed ? xAt(R.close) : X1);
  hline(G.sell, y(R.sell), xAt(ARM), closed ? xAt(R.close) : X1);
  show(G.buy, armed && (!filled || R.dir > 0), filled ? (closed ? 0.35 : 1) : 1);
  show(G.sell, armed && (!filled || R.dir < 0), filled ? (closed ? 0.35 : 1) : 1);
  entryEl.setAttribute("stroke-dasharray", filled ? "0" : "6 5");
  if (armed && !closed) {
    label(entryT, y(R.dir > 0 ? R.buy : R.sell), filled ? "entry" : (R.dir > 0 ? "buy stop" : "sell stop"), taken); show(entryT, 1);
    if (!filled) { label(otherT, y(R.dir > 0 ? R.sell : R.buy), R.dir > 0 ? "sell stop" : "buy stop", taken); show(otherT, 1); } else show(otherT, 0);
  } else { show(entryT, 0); show(otherT, 0); }
  if (filled && !armed) show(otherEl, 0);
  // stop loss
  hline(G.sl, y(R.sl), xAt(Math.max(R.fill, 0)), closed ? xAt(R.close) : X1);
  show(G.sl, filled, closed ? 0.3 : 0.9);
  if (filled && !closed) { label(G.slT, y(R.sl), "stop loss", taken); show(G.slT, 1); } else show(G.slT, 0);
  // trailing stop
  let td = "", lastT = NaN;
  for (let j = Math.max(R.fill, 0); j <= i && R.fill >= 0; j++) {
    if (Number.isNaN(R.trail[j])) continue;
    const yy = y(R.trail[j]).toFixed(1);
    td += (td ? "H" + xAt(j).toFixed(1) + "V" + yy : "M" + xAt(j).toFixed(1) + " " + yy); lastT = R.trail[j];
  }
  if (td && !closed) td += "H" + X1;
  G.trail.setAttribute("d", td); show(G.trail, !!td, closed ? 0.4 : 0.95);
  if (td && !closed) { label(G.trT, y(lastT), "trailing stop", taken); show(G.trT, 1); } else show(G.trT, 0);
  // exit marker
  if (closed) {
    const cx = xAt(R.close), cy = y(R.p[R.close]), win = R.result >= 0, col = win ? "#3FC4FC" : "#F2616F";
    G.mark.setAttribute("cx", cx); G.mark.setAttribute("cy", cy); G.mark.setAttribute("stroke", col); show(G.mark, 1);
    G.markT.textContent = (win ? "+" : MINUS) + Math.abs(R.result) + " pts";
    G.markT.setAttribute("x", Math.min(cx + 10, LX - FS * 6)); G.markT.setAttribute("y", cy + (R.dir > 0 === win ? -12 : 22)); G.markT.setAttribute("fill", col); show(G.markT, 1);
  } else { show(G.mark, 0); show(G.markT, 0); }
  // fresh pair after the exit
  const ra = R.rearm && i >= R.rearm.at && !over;
  hline(G.nbuy, y(R.rearm ? R.rearm.buy : 0), xAt(R.rearm ? R.rearm.at : 0), X1); hline(G.nsell, y(R.rearm ? R.rearm.sell : 0), xAt(R.rearm ? R.rearm.at : 0), X1);
  show(G.nbuy, ra, 0.85); show(G.nsell, ra, 0.85);
  if (ra) { label(G.nbuyT, y(R.rearm.buy), "buy stop", taken); label(G.nsellT, y(R.rearm.sell), "sell stop", taken); }
  show(G.nbuyT, ra); show(G.nsellT, ra);
  // clock + caption
  const c = clockAt(i), s = Math.round(Math.abs(c));
  clock.textContent = (c < 0 ? "T" + MINUS : "T+") + pad(Math.floor(s / 60)) + ":" + pad(s % 60);
  if (over) setSay(R.rearm ? "Window over: the unused pair is removed" : (R.result >= 0 ? `Closed by the trailing stop, +${R.result} pts` : `Snapped back: closed at the stop loss, ${MINUS}100 pts`), R.result >= 0 ? "win" : "loss");
  else if (closed && R.rearm && i > R.close + 18) setSay("Window still open: a fresh pair goes on", R.result >= 0 ? "win" : "loss");
  else if (closed) setSay(R.result >= 0 ? `Closed by the trailing stop, +${R.result} pts` : `Snapped back: closed at the stop loss, ${MINUS}100 pts`, R.result >= 0 ? "win" : "loss");
  else if (filled && !Number.isNaN(R.trail[i])) setSay("Trailing 50 points behind price");
  else if (filled) setSay(`${side} stop filled, ${other} stop deleted`);
  else if (i >= REL) setSay(`${evShort} is out`);
  else if (armed) setSay("Armed: buy stop and sell stop, 60 pts either side");
  else setSay(`Waiting for ${evShort}`);
}

let evShort = "the release";
function startScope() {
  if (!svg) return;
  buildScope();
  if (reduce) { const R = run(7, 1, false), paint = () => { buildScope(); draw(R, S - 1, evShort); }; draw(R, S - 1, evShort); addEventListener("resize", paint); return; }
  let n = 0, R = null, t0 = 0, visible = true, raf = 0, rw = 0;
  addEventListener("resize", () => { clearTimeout(rw); rw = setTimeout(buildScope, 150); });
  const pattern = [false, false, true, false, false];
  const next = () => { const lose = pattern[n % pattern.length]; R = run(1000 + n * 7919, Math.random() < 0.5 ? 1 : -1, lose); n++; t0 = performance.now(); G.root.setAttribute("opacity", 1); };
  next();
  const frame = (t) => {
    raf = 0;
    const e = Math.max(0, t - t0);
    let i;
    if (e < PRE_MS) i = Math.floor(e / PRE_MS * REL);
    else if (e < PRE_MS + POST_MS) i = REL + Math.floor((e - PRE_MS) / POST_MS * (S - 1 - REL));
    else i = S - 1;
    draw(R, Math.min(i, S - 1), evShort);
    const end = PRE_MS + POST_MS + HOLD_MS;
    if (e > end) G.root.setAttribute("opacity", Math.max(0, 1 - (e - end) / FADE_MS));
    if (e > end + FADE_MS) next();
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const go = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) { t0 = performance.now() - 0; go(); } }).observe(svg);
  document.addEventListener("visibilitychange", go);
  go();
}

// ================================================================ live release clock
function groupEvents(list) {
  const m = new Map();
  for (const e of list) { const g = m.get(e.utc) || { utc: e.utc, titles: [] }; if (!g.titles.includes(e.title)) g.titles.push(e.title); m.set(e.utc, g); }
  return [...m.values()].sort((a, b) => a.utc - b.utc);
}
const names = (g) => g.titles.length > 2 ? `${g.titles[0]}, ${g.titles[1]} and ${g.titles.length - 2} more` : g.titles.join(" and ");
const when = (utc, long) => new Date(utc * 1000).toLocaleString(undefined, long ? { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return d ? `${d}d ${pad(h)}:${pad(m)}:${pad(ss)}` : h ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
let lastLater = "";
function tick() {
  const now = Date.now() + skew, list = GROUPS.filter((g) => g.utc * 1000 > now - 60000);
  if (!list.length) { $("next").hidden = true; return; }
  $("next").hidden = false;
  const g = list[0], left = g.utc * 1000 - now;
  $("nxTitle").textContent = names(g);
  $("nxWhen").textContent = when(g.utc, true) + ", your time";
  const armed = left <= 15000;
  $("nxChip").lastChild.textContent = armed ? "Armed now" : "Next high-impact USD release";
  const cnt = $("nxCount");
  cnt.textContent = armed ? (left > 0 ? "T" + MINUS + pad(Math.ceil(left / 1000)) + " s" : "Live") : fmtLeft(left);
  cnt.classList.toggle("armed", armed);
  const later = list.slice(1, 6), key = later.map((x) => x.utc).join();
  if (key !== lastLater) {
    lastLater = key;
    const ul = $("nxLater"); ul.replaceChildren();
    ul.hidden = !later.length;
    for (const x of later) { const li = document.createElement("li"), b = document.createElement("b"); b.textContent = when(x.utc, false); li.append(b, names(x)); ul.appendChild(li); }
  }
  // same data on the example licence card
  $("licNext").textContent = `${names(g)}, ${when(g.utc, false)}`;
  const arm = new Date(g.utc * 1000 - 15000);
  $("licArm").textContent = `Arms at ${arm.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}, your time`;
  const first = g.titles[0];
  if (first && evShort !== first) { evShort = first.length > 26 ? first.slice(0, 25) + "…" : first; $("scEv").textContent = evShort; }
}

// ================================================================ prices, methods, record
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
function applyPublic(j) {
  if (j.prices) {
    $("pLife").textContent = eur(j.prices.lifetime); $("pMon").textContent = eur(j.prices.monthly);
    const n = Math.ceil(j.prices.lifetime / j.prices.monthly);
    $("pTag").textContent = n > 1 && n <= 12 ? `Costs less than ${WORDS[n]} months of monthly` : "Pay once";
  }
  if (j.methods) {
    const m = j.methods, parts = [];
    if (m.card) parts.push("by <b>card, Apple Pay or Google Pay</b>");
    if (m.bank) parts.push("by <b>bank transfer</b>");
    if (m.crypto) parts.push("in <b>crypto</b>");
    const joined = parts.length > 1 ? parts.slice(0, -1).join(", ") + " or " + parts[parts.length - 1] : parts[0] || "";
    $("payLine").innerHTML = (joined ? "Pay " + joined + ". " : "") + "Got a discount code? Enter it at checkout.";
  }
  if (j.announcement) {
    const a = document.createElement("div"); a.className = "wrap"; a.style.marginBottom = "28px";
    const n = document.createElement("p"); n.className = "note"; n.textContent = j.announcement; a.appendChild(n);
    document.querySelector(".hero").prepend(a);
  }
  if (j.record && j.record.trades) record(j.record);
}
function record(r) {
  $("record").hidden = false;
  const since = new Date(r.since).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  $("recLede").textContent = `Streamed straight from our own ${r.demo ? "demo" : "live"} MT5 account since ${since}, every closed trade counted. It's one account on one broker, so your fills will differ.`;
  const stat = (k, v) => { const d = document.createElement("div"); d.className = "stat"; const s = document.createElement("span"); s.className = "lab"; s.textContent = k; const b = document.createElement("b"); b.textContent = v; d.append(s, b); return d; };
  const sg = (v) => (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(Math.round(v)).toLocaleString("en-GB");
  $("recStats").replaceChildren(stat("Closed trades", r.trades.toLocaleString("en-GB")), stat("Net points", sg(r.points)), stat("Won", Math.round(r.winRate * 100) + "%"),
    stat("Profit factor", r.pf == null ? "—" : r.pf.toFixed(2)), stat("Average per trade", sg(r.avg) + " pts"), stat("Deepest drawdown", MINUS + Math.round(r.maxDD) + " pts"));
  const c = r.curve || [], s = $("recCurve");
  if (c.length > 1) {
    const lo = Math.min(0, ...c), hi = Math.max(0, ...c), span = hi - lo || 1, y = (v) => 210 - (v - lo) / span * 200, x = (i) => i / (c.length - 1) * 600;
    let d = ""; c.forEach((v, i) => (d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)));
    s.innerHTML = `<line x1="0" x2="600" y1="${y(0)}" y2="${y(0)}" stroke="#2e3644" stroke-dasharray="3 5"/><path d="${d}" fill="none" stroke="#3FC4FC" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
}

async function load() {
  try {
    const t = Date.now(), r = await fetch("/api/public", { cache: "no-store" }), j = await r.json();
    skew = j.serverNow ? j.serverNow - (t + Date.now()) / 2 : 0;
    GROUPS = groupEvents(j.news || []);
    applyPublic(j);
  } catch { /* the page works without it */ }
  tick();
}

// ================================================================ question form
const f = $("askForm");
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f)), err = $("askErr"), b = f.querySelector("button");
  err.textContent = "";
  if (!/^\S+@\S+\.\S+$/.test(d.email || "")) { err.textContent = "Enter your email so we can reply."; return; }
  if ((d.message || "").trim().length < 5) { err.textContent = "Write your question first."; return; }
  b.disabled = true;
  try {
    const r = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, topic: "before buying" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || "That didn't send. Try again.");
    f.hidden = true; $("askSent").hidden = false;
  } catch (x) { err.textContent = x.message; } finally { b.disabled = false; }
});

startScope();
load();
setInterval(tick, 1000);
setInterval(load, 10 * 60 * 1000);
})();
