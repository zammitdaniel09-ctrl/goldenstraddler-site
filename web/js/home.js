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

// ================================================================ small helpers
const toastEl = $("toast");
let toastT = 0;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2600); }
const usd = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sg = (v, d = 0) => (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
// count a number up the first time it scrolls into view
const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { seen.unobserve(e.target); e.target._go && e.target._go(); } }, { threshold: 0.4 });
function countUp(el, to, fmt, ms = 1100) {
  el.textContent = fmt(reduce ? to : 0);
  if (reduce) return;
  el._go = () => { const t0 = performance.now(); const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(k < 1 ? to * e : to); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
  seen.observe(el);
}
// countdown digits that roll when they change
function roll(el, tokens) {
  if (el._n !== tokens.length) { el.replaceChildren(); el._n = tokens.length; el._s = tokens.map(() => { const s = document.createElement("span"); el.appendChild(s); return s; }); }
  tokens.forEach((t, i) => {
    const sp = el._s[i];
    if (sp.textContent === t.v && sp.className.startsWith(t.c)) return;
    sp.textContent = t.v; sp.className = t.c;
    if (t.c === "" && !reduce && el._ready) { void sp.offsetWidth; sp.className = "r"; }
  });
  el._ready = true;
}
function tokens(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60, out = [];
  const num = (n) => { for (const ch of pad(n)) out.push({ v: ch, c: "" }); }, sep = () => out.push({ v: ":", c: "sep" });
  if (d) { for (const ch of String(d)) out.push({ v: ch, c: "" }); out.push({ v: "d", c: "u" }); }
  if (d || h) { num(h); sep(); }
  num(m); sep(); num(ss);
  return out;
}

// ================================================================ releases: names, the countdown card and the week board
function groupEvents(list) {
  const m = new Map();
  for (const e of list) { const g = m.get(e.utc) || { utc: e.utc, titles: [], items: [] }; if (!g.titles.includes(e.title)) { g.titles.push(e.title); g.items.push(e); } m.set(e.utc, g); }
  return [...m.values()].sort((a, b) => a.utc - b.utc);
}
const names = (g) => g.titles.length > 2 ? `${g.titles[0]}, ${g.titles[1]} and ${g.titles.length - 2} more` : g.titles.join(" and ");
const SHORT = [[/non-farm/i, "NFP"], [/fomc|federal funds/i, "FOMC"], [/^core cpi/i, "Core CPI"], [/^cpi/i, "CPI"], [/core pce/i, "Core PCE"], [/gdp/i, "GDP"], [/^core ppi|^ppi/i, "PPI"],
  [/retail sales/i, "Retail Sales"], [/ism services/i, "ISM Services"], [/ism manufacturing/i, "ISM"], [/jolts/i, "JOLTS"], [/unemployment claims|jobless/i, "Jobless Claims"], [/powell|fed chair/i, "Powell"]];
function shortName(g) { for (const [re, n] of SHORT) if (g.titles.some((t) => re.test(t))) return n; const t = g.titles[0] || "the release"; return t.length > 22 ? t.slice(0, 21) + "…" : t; }
const when = (utc, long) => new Date(utc * 1000).toLocaleString(undefined, long ? { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
const hhmmss = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

let WEEK = [], PROMO = null, weekKey = "", REC = null;
function upcoming(now) { return GROUPS.filter((g) => g.utc * 1000 > now - 60000); }

function tickNext(now) {
  const list = upcoming(now), card = $("next");
  if (!list.length) { card.hidden = true; return null; }
  card.hidden = false;
  const g = list[0], left = g.utc * 1000 - now, live = left <= 0, armed = left <= 15000, soon = left <= 3600000;
  $("nxTitle").textContent = names(g);
  $("nxWhen").textContent = when(g.utc, true) + ", your time";
  $("nxChipT").textContent = live ? "Out now: the window is open" : armed ? "Armed: both orders are in" : soon ? "Less than an hour to go" : "Next high-impact USD release";
  card.classList.toggle("armed", armed); card.classList.toggle("soon", soon && !armed);
  roll($("nxCount"), live ? [{ v: "+", c: "sep" }, ...tokens(-left)] : tokens(left));
  $("nxBar").style.width = (live ? 100 : Math.max(0, Math.min(1, 1 - left / 86400000)) * 100).toFixed(2) + "%";
  $("nxArm").textContent = live ? "The EA trails whichever side filled. Leftover orders go 60 seconds after the release." : armed ? "Buy stop and sell stop are 60 points either side of price." : `The EA arms at ${hhmmss(g.utc * 1000 - 15000)}, your time.`;
  // same data on the example licence card
  $("licNext").textContent = `${names(g)}, ${when(g.utc, false)}`;
  $("licArm").textContent = `Arms at ${hhmmss(g.utc * 1000 - 15000)}, your time`;
  const first = g.titles[0];
  if (first && evShort !== first) { evShort = first.length > 26 ? first.slice(0, 25) + "…" : first; $("scEv").textContent = evShort; }
  return { g, left };
}

function renderWeek(now) {
  const groups = groupEvents(WEEK), card = $("week");
  if (!groups.length) { card.hidden = true; return; }
  const nextIdx = groups.findIndex((g) => g.utc * 1000 > now - 60000);
  const st = groups.map((g, i) => (g.utc * 1000 <= now - 60000 ? "done" : g.utc * 1000 - 15000 <= now ? "live" : i === nextIdx ? "next" : ""));
  const key = st.join();
  card.hidden = false;
  if (key === weekKey) return;
  weekKey = key;
  const ol = $("wkList"); ol.replaceChildren();
  groups.forEach((g, i) => {
    const li = document.createElement("li"); if (st[i]) li.className = st[i];
    const d = new Date(g.utc * 1000), tm = document.createElement("time"), b = document.createElement("b");
    tm.dateTime = d.toISOString();
    b.textContent = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    tm.append(b, d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
    const ttl = document.createElement("div"); ttl.className = "ttl";
    for (const e of g.items) {
      const row = document.createElement("div"), t = document.createElement("b"); t.textContent = e.title; row.appendChild(t);
      const parts = []; if (e.fc) parts.push("Forecast " + e.fc); if (e.prev) parts.push((e.fc ? "previous " : "Previous ") + e.prev);
      if (parts.length) { const sp = document.createElement("span"); sp.textContent = parts.join(", "); row.appendChild(sp); }
      ttl.appendChild(row);
    }
    li.append(tm, ttl);
    if (st[i]) { const em = document.createElement("em"); em.textContent = st[i] === "done" ? "Done" : st[i] === "live" ? "Live now" : "Next"; li.appendChild(em); }
    ol.appendChild(li);
  });
}

// ================================================================ discount bar
function tickPromo(now, nx) {
  if (!PROMO) return;
  const t = $("pmT");
  if (PROMO.endsAt && PROMO.endsAt > now) {
    t.hidden = false; setLab("Code ends", " in"); $("pmCount").textContent = fmtLeft(PROMO.endsAt - now);
  } else if (nx) {
    const sn = shortName(nx.g);
    t.hidden = false;
    if (nx.left <= 0) setLab(sn, " is out"); else setLab(sn, "", nx.left <= 15000 ? "Armed for " : "Be armed for ");
    $("pmCount").textContent = nx.left <= 0 ? "now" : fmtLeft(nx.left);
  } else t.hidden = true;
}
// the long words hide on narrow phones so the bar stays on one line
function setLab(core, after = "", before = "") {
  const el = $("pmLab"), key = before + core + after; if (el._k === key) return; el._k = key;
  const x = (t) => { const s = document.createElement("span"); s.className = "pm-x"; s.textContent = t; return s; };
  el.replaceChildren(); if (before) el.appendChild(x(before)); el.append(core); if (after) el.appendChild(x(after));
}
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return d ? `${d}d ${pad(h)}:${pad(m)}:${pad(ss)}` : h ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
function applyPromo(pm) {
  PROMO = pm || null;
  const bar = $("promo");
  if (!PROMO) { bar.hidden = true; return; }
  const plan = PROMO.plans.lifetime ? "lifetime" : "monthly", q = PROMO.plans[plan], code = PROMO.code, href = `/checkout?plan=${plan}&code=${encodeURIComponent(code)}`;
  $("pmSave").textContent = `${eur(q.list - q.amount)} off`;
  $("pmWhat").textContent = (plan === "lifetime" ? `Lifetime is ${eur(q.amount)}` : `${q.note === "every month" ? "Monthly" : "Your first month"} is ${eur(q.amount)}`) +
    (PROMO.usesLeft != null ? `, ${PROMO.usesLeft} left at this price,` : "") + " with code";
  $("pmCodeTxt").textContent = code;
  $("pmCode").setAttribute("aria-label", `Copy the code ${code}`);
  const go = $("pmGo"); go.href = href; go.replaceChildren("Claim"); const lg = document.createElement("span"); lg.className = "pm-long"; lg.textContent = ` ${eur(q.amount)} ${plan}`; go.appendChild(lg);
  bar.hidden = false;
  // pricing cards
  const set = (k, was, now, unit, btn, label) => {
    const p = PROMO.plans[k]; if (!p) return;
    $(was).hidden = false; $(was).textContent = eur(p.list); $(now).textContent = eur(p.amount);
    $(unit).textContent = k === "lifetime" ? "once" : p.note === "every month" ? "a month" : "first month";
    const b = $(btn); b.href = `/checkout?plan=${k}&code=${encodeURIComponent(code)}`; b.textContent = `${label} for ${eur(p.amount)}`;
  };
  set("lifetime", "pLifeWas", "pLife", "pLifeU", "buyLife", "Buy lifetime");
  set("monthly", "pMonWas", "pMon", "pMonU", "buyMon", "Start monthly");
  const hb = $("heroBuy"); hb.href = href; hb.textContent = `Get it for ${eur(q.amount)}`;
  $("sheetBuy").href = href; $("sheetBuy").textContent = `Get it for ${eur(q.amount)}`;
  $("mbWas").textContent = eur(q.list); $("mbNow").textContent = eur(q.amount); $("mbU").textContent = plan === "lifetime" ? "lifetime" : "first month"; $("mbGo").href = href;
  if (PROMO.plans.lifetime) { const tg = $("pTag"); tg.textContent = `${eur(PROMO.plans.lifetime.list - PROMO.plans.lifetime.amount)} off with code ${code}`; tg.classList.add("gold"); }
}
$("pmCode").addEventListener("click", async () => {
  if (!PROMO) return;
  const code = PROMO.code, b = $("pmCode");
  try { await navigator.clipboard.writeText(code); }
  catch { const r = document.createRange(); r.selectNodeContents($("pmCodeTxt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  b.classList.add("ok"); setTimeout(() => b.classList.remove("ok"), 2200);
  toast(`Code ${code} copied. It's also filled in for you when you tap Claim.`);
});

// ================================================================ the desk layout follows whichever cards have data
function layoutDesk() {
  const on = (id) => !$(id).hidden, row = (a, b) => { const x = [a, b].filter(on); return x.length === 2 ? `"${x[0]} ${x[1]}"` : x.length ? `"${x[0]} ${x[0]}"` : ""; };
  const ids = { next: "next", gold: "gold", week: "week", acct: "acct" };
  const top = row("next", "gold"), bot = row("week", "acct");
  const desk = $("desk"), any = ["next", "gold", "week", "acct"].some(on);
  desk.hidden = !any;
  desk.style.setProperty("--areas", [top, bot].filter(Boolean).join(" ") || '"next"');
  desk.style.setProperty("--areas-m", ["next", "gold", "acct", "week"].filter(on).map((k) => `"${ids[k]}"`).join(" ") || '"next"');
  // phone tabs: hide tabs for cards without data, and keep a visible card selected
  const tabs = [...desk.querySelectorAll(".desk-tabs [data-tab]")];
  tabs.forEach((b) => (b.hidden = !on(b.dataset.tab)));
  const sel = tabs.find((b) => b.getAttribute("aria-selected") === "true");
  if (!sel || sel.hidden) { const first = tabs.find((b) => !b.hidden); if (first) first.click(); }
}

// ================================================================ live: gold price and our account
let lastPx = 0, sparkDrawn = false, liveFails = 0, acctDone = false;
function drawSpark(sp) {
  const svg = $("gSpark");
  if (!sp || sp.length < 2) { svg.replaceChildren(); return; }
  const t0 = sp[0][0], t1 = sp[sp.length - 1][0], ps = sp.map((x) => x[1]);
  let lo = Math.min(...ps), hi = Math.max(...ps); const padv = Math.max((hi - lo) * 0.12, 0.5); lo -= padv; hi += padv;
  const X = (t) => (t1 > t0 ? (t - t0) / (t1 - t0) : 1) * 300, Y = (v) => 86 - (v - lo) / (hi - lo) * 80;
  let d = ""; sp.forEach((x, i) => (d += (i ? "L" : "M") + X(x[0]).toFixed(1) + " " + Y(x[1]).toFixed(1)));
  const last = sp[sp.length - 1];
  svg.innerHTML = `<defs><linearGradient id="gFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#E6B450" stop-opacity=".22"/><stop offset="1" stop-color="#E6B450" stop-opacity="0"/></linearGradient></defs>` +
    `<path class="ar" d="${d}L300 90L0 90Z"/><path class="ln" pathLength="1" d="${d}"/><circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3.5" fill="#E6B450"/>`;
  if (!sparkDrawn) { sparkDrawn = true; svg.classList.add("draw"); } else svg.classList.remove("draw");
}
function applyLive(j) {
  const g = j.gold, card = $("gold");
  if (g && g.price) {
    card.hidden = false;
    const el = $("gPx");
    el.textContent = usd(g.price);
    if (lastPx && g.price !== lastPx) { el.classList.remove("tu", "td"); void el.offsetWidth; el.classList.add(g.price > lastPx ? "tu" : "td"); }
    lastPx = g.price;
    const sp = g.spark || [], chg = $("gChg");
    let ref = null, lab = "";
    if (g.day) { ref = g.day; lab = "24h"; }
    else if (sp.length > 1 && sp[sp.length - 1][0] - sp[0][0] >= 1200) { ref = sp[0][1]; lab = "since " + new Date(sp[0][0] * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }
    if (ref) { const c = g.price - ref; chg.textContent = `${sg(c, 2)} (${sg(c / ref * 100, 2)}%) ${lab}`; chg.className = "num chg " + (c >= 0 ? "up" : "dn"); } else chg.textContent = "";
    drawSpark(sp.length > 1 ? [...sp.slice(0, -1), [Math.floor((j.serverNow || Date.now()) / 1000), g.price]] : sp);
    const span = sp.length > 1 ? Math.round((sp[sp.length - 1][0] - sp[0][0]) / 3600) : 0;
    $("gNote").textContent = (span >= 2 ? `Last ${span} hours. ` : "") + "Public spot price, refreshed every few seconds. Your broker's quote will differ slightly.";
    $("gLive").lastChild.textContent = "Live";
  } else card.hidden = true;
  const a = j.account, ac = $("acct");
  const pf = $("pfLive");
  if (a) {
    pf.hidden = false;
    pf.querySelector(".live-dot").classList.toggle("off", !a.online);
    const t = $("pfLiveT"); t.replaceChildren(a.online ? "Our own live account is running it right now. " : "Our own live account runs it. ");
    const l = document.createElement("a"); l.href = "#record"; l.textContent = "See the results"; t.appendChild(l);
  }
  if (a) {
    ac.hidden = false;
    const chip = $("acChip");
    chip.className = "chip " + (a.online ? "pulse" : "off");
    $("acChipT").textContent = a.online ? "Online now" : "Offline right now";
    if (!acctDone) {
      acctDone = true;
      const box = $("acNums"); box.replaceChildren();
      const add = (k, v, fmt) => { const d = document.createElement("div"), l = document.createElement("span"), b = document.createElement("b"); l.className = "lab"; l.textContent = k; d.append(l, b); box.appendChild(d); countUp(b, v, fmt); };
      add("Closed trades", a.trades, (v) => Math.round(v).toLocaleString("en-GB"));
      add("Net points", a.points, (v) => sg(Math.round(v)));
      add("Won", a.winRate * 100, (v) => Math.round(v) + "%");
      const c = REC && REC.curve;
      if (c && c.length > 1) {
        const lo = Math.min(0, ...c), hi = Math.max(0, ...c), span = hi - lo || 1, y = (v) => 66 - (v - lo) / span * 60, x = (i) => i / (c.length - 1) * 300;
        let d = ""; c.forEach((v, i) => (d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)));
        const sv = $("acCurve");
        sv.innerHTML = `<line x1="0" x2="300" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#2e3644" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/><path class="ln" pathLength="1" d="${d}"/>`;
        sv.removeAttribute("hidden"); $("acCap").hidden = false;
        if (!reduce) { sv.classList.add("pre"); sv._go = () => sv.classList.add("draw"); seen.observe(sv); }
      }
    }
  } else ac.hidden = true;
  layoutDesk();
}
async function pollLive() {
  if (document.hidden) return;
  try {
    const r = await fetch("/api/live", { cache: "no-store" }); if (!r.ok) throw new Error();
    liveFails = 0; applyLive(await r.json());
  } catch { if (++liveFails > 5 && !$("gold").hidden) $("gLive").lastChild.textContent = "Paused"; }
}

// ================================================================ the one-release timeline lights up step by step
function stepLine() {
  const line = document.querySelector(".line"); if (!line || reduce) return;
  const items = [...line.children]; let i = 0, on = false, t = 0;
  const step = () => {
    if (phone()) return;
    const li = items[i], vertical = getComputedStyle(line).gridTemplateColumns.split(" ").length === 1;
    items.forEach((x, k) => x.classList.toggle("lit", k === i));
    line.style.setProperty("--p", (vertical ? li.offsetTop + 8 : li.offsetLeft + 8) + "px");
    i = (i + 1) % items.length;
  };
  new IntersectionObserver((es) => { on = es[0].isIntersecting; clearInterval(t); if (on) { step(); t = setInterval(step, 1500); } }, { threshold: 0.3 }).observe(line);
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
    $("payLine").innerHTML = (joined ? "Pay " + joined + ". " : "") + (j.promo ? `The code <b>${j.promo.code.replace(/[^A-Z0-9_-]/g, "")}</b> is filled in for you at checkout.` : "Got a discount code? Enter it at checkout.");
  }
  if (j.announcement && !document.querySelector(".hero .annc")) {
    const a = document.createElement("div"); a.className = "wrap annc"; a.style.marginBottom = "28px";
    const n = document.createElement("p"); n.className = "note"; n.textContent = j.announcement; a.appendChild(n);
    document.querySelector(".hero").prepend(a);
  }
  applyPromo(j.promo);
  WEEK = j.week || [];
  if (j.record) REC = j.record;
  if (j.record && j.record.trades && $("record").hidden) record(j.record);
}
function record(r) {
  $("record").hidden = false;
  const since = /^\d{4}\.\d\d\.\d\d/.test(String(r.since)) ? new Date(String(r.since).slice(0, 10).replace(/\./g, "-") + "T12:00:00") : new Date(r.since);
  const sinceT = since.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  $("recLede").textContent = `Streamed straight from our own ${r.demo ? "demo" : "live"} MT5 account since ${sinceT}, every closed trade counted. It's one account on one broker, so your fills will differ.`;
  const stat = (k, v, fmt) => { const d = document.createElement("div"); d.className = "stat"; const s = document.createElement("span"); s.className = "lab"; s.textContent = k; const b = document.createElement("b"); d.append(s, b); if (typeof v === "number") countUp(b, v, fmt); else b.textContent = v; return d; };
  $("recStats").replaceChildren(stat("Closed trades", r.trades, (v) => Math.round(v).toLocaleString("en-GB")), stat("Net points", r.points, (v) => sg(Math.round(v))), stat("Won", r.winRate * 100, (v) => Math.round(v) + "%"),
    r.pf == null ? stat("Profit factor", "—") : stat("Profit factor", r.pf, (v) => v.toFixed(2)), stat("Average per trade", r.avg, (v) => sg(Math.round(v)) + " pts"), stat("Deepest drawdown", r.maxDD, (v) => MINUS + Math.round(v) + " pts"));
  const c = r.curve || [], s = $("recCurve");
  if (c.length > 1) {
    const lo = Math.min(0, ...c), hi = Math.max(0, ...c), span = hi - lo || 1, y = (v) => 210 - (v - lo) / span * 200, x = (i) => i / (c.length - 1) * 600;
    let d = ""; c.forEach((v, i) => (d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)));
    s.innerHTML = `<line x1="0" x2="600" y1="${y(0)}" y2="${y(0)}" stroke="#2e3644" stroke-dasharray="3 5"/><path d="${d}" fill="none" stroke="#3FC4FC" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
}

function tick() {
  const now = Date.now() + skew;
  const nx = tickNext(now);
  renderWeek(now);
  tickPromo(now, nx);
  layoutDesk();
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

// ================================================================ phones: tabs and swipe
const phone = () => matchMedia("(max-width:760px)").matches;
function tabs(list, panels) {
  const btns = [...list.querySelectorAll("[data-tab]")];
  const pick = (b, focus) => {
    btns.forEach((x) => x.setAttribute("aria-selected", x === b ? "true" : "false"));
    panels().forEach((p) => p.classList.toggle("on", p.dataset.panel === b.dataset.tab));
    if (focus) b.focus();
    // keep the chosen tab in view in a scrolling tab row
    const r = b.getBoundingClientRect(), lr = list.getBoundingClientRect();
    if (r.left < lr.left || r.right > lr.right) list.scrollBy({ left: r.left - lr.left - 16, behavior: reduce ? "auto" : "smooth" });
  };
  btns.forEach((b, i) => {
    b.id = b.id || `tab-${Math.random().toString(36).slice(2, 8)}`;
    b.addEventListener("click", () => pick(b));
    b.addEventListener("keydown", (e) => {
      const vis = btns.filter((x) => !x.hidden), k = vis.indexOf(b);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); pick(vis[(k + (e.key === "ArrowRight" ? 1 : vis.length - 1)) % vis.length], true); }
    });
  });
  return { next(d) { const vis = btns.filter((x) => !x.hidden), k = vis.findIndex((x) => x.getAttribute("aria-selected") === "true"); const n = vis[k + d]; if (n) pick(n); } };
}
function swipe(el, ctl) {
  let x0 = 0, y0 = 0, t0 = 0;
  el.addEventListener("touchstart", (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (!phone()) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 700) ctl.next(dx < 0 ? 1 : -1);
  }, { passive: true });
}
function setupTabs() {
  const desk = $("desk"), dt = tabs(desk.querySelector(".desk-tabs"), () => [...desk.querySelectorAll(".dk")]); swipe(desk, dt);
  const rec = $("record"), rt = tabs(rec.querySelector(".rec-tabs"), () => [...rec.querySelectorAll(".rec>[data-panel]")]); swipe(rec.querySelector(".rec"), rt);
  const pr = $("pricing"), pt = tabs(pr.querySelector(".plan-tabs"), () => [...pr.querySelectorAll(".plan")]); swipe(pr.querySelector(".plans"), pt);
  // the five steps become tabs labelled with their times
  const line = document.querySelector(".line"), ht = document.querySelector(".how-tabs");
  [...line.children].forEach((li, i) => {
    li.dataset.panel = "s" + i; if (i === 0) li.classList.add("on");
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "tab"); b.dataset.tab = "s" + i;
    b.setAttribute("aria-selected", i === 0 ? "true" : "false"); b.textContent = li.querySelector(".t").textContent; b.setAttribute("aria-label", li.querySelector(".t").textContent + ", " + li.querySelector("h3").textContent);
    ht.appendChild(b);
  });
  const hc = tabs(ht, () => [...line.children]); swipe(line, hc);
}

// ================================================================ phone menu
function setupMenu() {
  const btn = $("menuBtn"), sheet = $("sheet");
  const set = (open) => {
    document.documentElement.style.setProperty("--hdr", Math.round(top.getBoundingClientRect().bottom) + "px");
    sheet.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false"); btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.classList.toggle("lock", open);
  };
  btn.addEventListener("click", () => set(sheet.hidden));
  sheet.addEventListener("click", (e) => { if (e.target.closest("a,button")) set(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) { set(false); btn.focus(); } });
  addEventListener("resize", () => { if (!phone() && innerWidth > 940 && !sheet.hidden) set(false); });
}

// ================================================================ sticky buy bar on phones
function setupBuyBar() {
  const bar = $("mbuy"), seenNow = new Map();
  const update = () => {
    const show = phone() && !seenNow.get("cta") && !seenNow.get("pricing") && !seenNow.get("foot") && scrollY > 200;
    bar.classList.toggle("show", show); bar.setAttribute("aria-hidden", show ? "false" : "true"); $("mbGo").tabIndex = show ? 0 : -1;
    document.body.classList.toggle("mbuy-on", show);
  };
  const io = new IntersectionObserver((es) => { for (const e of es) seenNow.set(e.target.dataset.k, e.isIntersecting); update(); });
  const watch = (el, k) => { if (el) { el.dataset.k = k; io.observe(el); } };
  watch(document.querySelector(".hero .cta"), "cta"); watch($("pricing"), "pricing"); watch(document.querySelector(".foot"), "foot");
  addEventListener("scroll", update, { passive: true });
}

// ================================================================ lot-size calculator
function setupCalc() {
  const r = $("cLots"), bal = $("cBal");
  const money = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const run = () => {
    const lots = Number(r.value) / 100, pt = lots * 100 * 0.01, sl = pt * 100, b = Number(bal.value);
    $("cLotsV").textContent = lots.toFixed(2);
    $("cPt").textContent = money(pt); $("cSl").textContent = money(sl);
    const has = b > 0; $("cPctRow").hidden = !has;
    if (has) { const pc = sl / b * 100; $("cPct").textContent = (pc < 0.1 ? pc.toFixed(2) : pc.toFixed(1)) + "%"; }
    r.style.setProperty("--fill", ((r.value - r.min) / (r.max - r.min) * 100).toFixed(1) + "%");
  };
  r.addEventListener("input", run); bal.addEventListener("input", run); run();
}

setupTabs();
setupMenu();
setupBuyBar();
setupCalc();
startScope();
stepLine();
load();
pollLive();
setInterval(tick, 1000);
setInterval(pollLive, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLive(); });
setInterval(load, 10 * 60 * 1000);
})();
