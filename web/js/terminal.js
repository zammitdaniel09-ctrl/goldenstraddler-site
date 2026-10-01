// Hero terminal: one news release, simulated tick by tick and traded with the EA's real default rules
// (pending stops 60 pts either side, 100-pt stop loss, trailing from +50 at 50 behind, a fresh pair
// straight after every exit while the window is open, everything pending removed at +60 s).
// Prices, fills and slippage are simulated; outcomes rotate and include losing releases.
(() => {
"use strict";
const root = document.getElementById("term");
if (!root) return;
const cv = root.querySelector("canvas"), cx = cv.getContext("2d");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const q = (s) => root.querySelector(s);
const ui = { state: q(".tm-state"), clock: q(".tm-clock"), ev: q(".tm-ev"), speed: q(".tm-speed"), tape: q(".tm-tape"), news: q(".tm-news"), newsT: q(".tm-news span"),
  sum: q(".tm-sum"), n: q('[data-s="n"]'), won: q('[data-s="won"]'), net: q('[data-s="net"]'), best: q('[data-s="best"]'), live: q(".tm-live") };
const MINUS = "−";
const C = { grid: "rgba(255,255,255,.045)", axis: "#6f7787", gold: "#E6B450", ice: "#3FC4FC", white: "#dfe5ee", loss: "#F2616F", win: "#3FC4FC", txt2: "#a3abb9" };
const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';

// EA defaults, in points (1 point = 0.01 on a 2-digit gold quote)
const PEND = 60, SL = 100, TSTART = 50, TDIST = 50, PRE = 15, POST = 60;
const T0 = -20, TMAX = 85, DT = 0.05;

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- the market: a release with a burst of whipsaws
function makeTicks(r, kind) {
  const N = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const U = (a, b) => a + (b - a) * r(), sgn = () => (r() < 0.5 ? -1 : 1);
  const legs = []; let d = sgn();
  if (kind === "whipsaw") {
    const n = 5 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { legs.push([U(0.25, 0.65), d * U(170, 520)]); d = -d; }
    legs.push([U(3, 4.5), d * U(700, 1250)]); legs.push([U(4, 7), -d * U(160, 320)]);
  } else if (kind === "breakout") {
    legs.push([U(0.35, 0.6), d * U(450, 750)]); legs.push([U(0.3, 0.5), -d * U(80, 130)]); legs.push([U(2.5, 4), d * U(700, 1100)]); legs.push([U(4, 7), -d * U(160, 280)]);
  } else if (kind === "fakeout") {
    legs.push([U(0.35, 0.7), d * U(300, 460)]); legs.push([U(0.3, 0.5), -d * U(380, 520)]); legs.push([U(2.5, 4), -d * U(900, 1400)]); legs.push([U(4, 7), d * U(180, 340)]);
  } else {                                                   // chop: lots of small swings, the hard case
    const n = 7 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { legs.push([U(0.4, 1.3), d * U(95, 210)]); d = -d; }
  }
  let used = legs.reduce((a, l) => a + l[0], 0);
  while (used < POST + 30) { const L = [U(2.5, 6), sgn() * U(70, 280)]; legs.push(L); used += L[0]; }
  const ticks = [];
  let mid = 0, li = -1, lt = 0, from = 0, to = 0, dur = 1;
  for (let i = 0; ; i++) {
    const t = Math.round((T0 + i * DT) * 100) / 100;
    if (t > TMAX) break;
    let spread;
    if (t < 0) { mid += N() * 1.5 - mid * 0.025; spread = 16 + (t > -3 ? (t + 3) * 5 : 0) + r() * 2; }
    else {
      if (li < 0 || t - lt >= dur) { li = Math.min(li + 1, legs.length - 1); lt = t; dur = legs[li][0]; from = mid; to = mid + legs[li][1]; }
      const k = Math.min(1, (t - lt) / dur), e = 1 - Math.pow(1 - k, 2.4), burst = Math.max(0, 1 - t / 14);
      mid = from + (to - from) * e + N() * (2.5 + 20 * burst);
      if (r() < 0.05 * burst) mid += sgn() * U(25, 75);   // gaps: prices jump past orders
      spread = 24 + 140 * Math.exp(-t / 2.4) + r() * 8;
    }
    ticks.push({ t, bid: mid - spread / 2, ask: mid + spread / 2, mid });
  }
  return ticks;
}

// ---------------------------------------------------------------- the EA, rule for rule
function trade(ticks, r) {
  const orders = [], trades = [];
  let pend = null, pos = null, armed = false, n = 0, end = TMAX;
  const place = (tk) => { pend = { buy: tk.ask + PEND, sell: tk.bid - PEND, t: tk.t, end: null }; orders.push(pend); };
  for (const tk of ticks) {
    const t = tk.t;
    if (!armed && t >= -PRE) { armed = true; place(tk); }
    if (pend && !pos) {
      const slip = () => (t >= 0 && t < 5 ? r() * 28 : r() * 4);
      if (tk.ask >= pend.buy) { pos = { side: 1, entry: Math.max(pend.buy, tk.ask) + slip(), t, best: -1e9, trail: [], n: ++n }; pos.sl = pos.entry - SL; pend.end = t; pend = null; }
      else if (tk.bid <= pend.sell) { pos = { side: -1, entry: Math.min(pend.sell, tk.bid) - slip(), t, best: -1e9, trail: [], n: ++n }; pos.sl = pos.entry + SL; pend.end = t; pend = null; }
    }
    if (pos && pos.t < t) {
      const px = pos.side > 0 ? tk.bid : tk.ask, prof = (px - pos.entry) * pos.side;
      pos.best = Math.max(pos.best, prof);
      if (pos.best >= TSTART) { const nsl = px - pos.side * TDIST; if ((nsl - pos.sl) * pos.side >= 1) { pos.sl = nsl; pos.trail.push([t, nsl]); } }
      if ((px - pos.sl) * pos.side <= 0) {
        trades.push({ ...pos, exit: px, te: t, res: Math.round((px - pos.entry) * pos.side), how: pos.trail.length ? "trailing stop" : "stop loss" });
        pos = null;
        if (t < POST) place(tk);
      }
    }
    if (t >= POST && pend) { pend.end = t; pend.removed = true; pend = null; }
    if (t >= POST && !pos) { end = t; break; }
  }
  if (pos) { const tk = ticks[ticks.length - 1], px = pos.side > 0 ? tk.bid : tk.ask; trades.push({ ...pos, exit: px, te: tk.t, res: Math.round((px - pos.entry) * pos.side), how: "trailing stop" }); end = tk.t; }
  return { orders, trades, end };
}

// a rotation that shows what really happens: big winners, whipsaws, and releases that lose
const KINDS = ["whipsaw", "breakout", "whipsaw", "chop", "fakeout", "whipsaw"];
function scenario(k) {
  for (let tries = 0; tries < 40; tries++) {
    const seed = (Date.now() + k * 7919 + tries * 104729) | 0, r = rng(seed), kind = KINDS[k % KINDS.length];
    const ticks = makeTicks(r, kind), res = trade(ticks, r);
    const net = res.trades.reduce((a, x) => a + x.res, 0);
    // keep the burst readable (several entries) and the outcome true to the kind of release
    if (res.trades.length < (kind === "breakout" ? 2 : 5) || res.trades.length > 16) continue;
    if (kind === "chop" && net >= 0) continue;
    if (kind !== "chop" && net <= 0 && tries < 30) continue;
    return { kind, ticks, ...res, net };
  }
  const r = rng(7), ticks = makeTicks(r, "whipsaw"), res = trade(ticks, r);
  return { kind: "whipsaw", ticks, ...res, net: res.trades.reduce((a, x) => a + x.res, 0) };
}

// ---------------------------------------------------------------- replay clock: market seconds <-> real seconds
const SEG = [[T0, -PRE, 6], [-PRE, -3, 4], [-3, 0, 1.4], [0, 7, 0.7], [7, 999, 9]];
function speedAt(t) { for (const s of SEG) if (t < s[1]) return s[2]; return 9; }
function speedLabel(t) { const s = speedAt(t); return s < 1 ? "Slow motion" : s <= 1.5 ? "Real time" : `${s}× replay`; }

// ---------------------------------------------------------------- state
let S = null, k = 0, tMkt = 0, base = 4175, W = 22, Wt = 22, yLo = -80, yHi = 80, holdUntil = 0, shown = 0, floaters = [], shake = 0, flash = 0, newsUntil = 0, ending = 0;
let eventName = "US news release";
function start(first) {
  S = scenario(k++);
  base = Math.round((window.GS_GOLD || base) * 10) / 10;
  tMkt = first ? -7 : T0; shown = 0; floaters = []; ending = 0; holdUntil = 0;
  W = Wt = 22; yLo = -90; yHi = 90;
  ui.tape.replaceChildren(); ui.sum.hidden = true; ui.news.hidden = true;
  setStats();
}
const fmtPx = (pts) => (base + pts / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sg = (v) => (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v);
function setStats() {
  const done = S.trades.slice(0, shown), won = done.filter((x) => x.res > 0).length, net = done.reduce((a, x) => a + x.res, 0);
  ui.n.textContent = done.length; ui.won.textContent = done.length ? won : "0";
  ui.net.textContent = done.length ? sg(net) : "0"; ui.net.className = done.length ? (net >= 0 ? "up" : "dn") : "";
  const best = done.length ? Math.max(...done.map((x) => x.res)) : null; ui.best.textContent = best === null ? "—" : sg(best);
}
function addTape(x) {
  const li = document.createElement("li"); li.className = x.res >= 0 ? "w" : "l";
  li.innerHTML = `<b>#${x.n}</b><span class="sd">${x.side > 0 ? "BUY" : "SELL"}</span><span class="rs">${sg(x.res)}</span>`;
  ui.tape.prepend(li);
  while (ui.tape.children.length > 8) ui.tape.lastChild.remove();
}

// ---------------------------------------------------------------- drawing
let Wpx = 600, Hpx = 360, dpr = 1;
function resize() {
  const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
  Wpx = Math.max(280, r.width); Hpx = Math.max(200, r.height);
  cv.width = Math.round(Wpx * dpr); cv.height = Math.round(Hpx * dpr);
}
function niceStep(span, target) {
  const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function draw(now) {
  const small = Wpx < 480, AX = small ? 58 : 70, TOP = 12, BOT = small ? 26 : 30, ACT = small ? 16 : 22;
  const pw = Wpx - AX, ph = Hpx - TOP - BOT - ACT;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, Wpx, Hpx);
  let sx = 0, sy = 0;
  if (shake > 0 && !reduce) { sx = (Math.random() - 0.5) * 6 * shake; sy = (Math.random() - 0.5) * 6 * shake; }
  cx.save(); cx.translate(sx, sy);
  const left = ending ? T0 : tMkt - W * 0.8, right = left + W;
  const X = (t) => ((t - left) / W) * pw, Y = (v) => TOP + (1 - (v - yLo) / (yHi - yLo)) * ph;
  // grid + price axis
  const st = niceStep(yHi - yLo, small ? 4 : 6);
  cx.font = `${small ? 10 : 11}px ${MONO}`; cx.textBaseline = "middle";
  for (let v = Math.ceil(yLo / st) * st; v <= yHi; v += st) {
    const y = Y(v); cx.strokeStyle = C.grid; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(0, y); cx.lineTo(pw, y); cx.stroke();
    cx.fillStyle = C.axis; cx.fillText(fmtPx(v), pw + 8, y);
  }
  // time axis
  const ts = [1, 2, 5, 10, 20, 30].find((v) => (v / W) * pw >= (small ? 48 : 58)) || 30;
  cx.textBaseline = "alphabetic"; cx.textAlign = "center";
  for (let t = Math.ceil(left / ts) * ts; t <= right; t += ts) {
    const x = X(t); if (x < 14 || x > pw - 14) continue;
    cx.strokeStyle = C.grid; cx.beginPath(); cx.moveTo(x, TOP); cx.lineTo(x, TOP + ph + ACT); cx.stroke();
    cx.fillStyle = C.axis; cx.fillText(t === 0 ? "0s" : (t > 0 ? "+" : MINUS) + Math.abs(t) + "s", x, Hpx - 9);
  }
  cx.textAlign = "left";
  const tk = S.ticks, cur = Math.min(tk.length - 1, Math.max(0, Math.floor((tMkt - T0) / DT)));
  const i0 = Math.max(0, Math.floor((left - T0) / DT) - 1);
  // activity bars (how fast price is moving)
  const bw = Math.max(2, pw / (W / 0.5) - 1);
  for (let t = Math.floor(left * 2) / 2; t <= Math.min(tMkt, right); t += 0.5) {
    const a = Math.max(0, Math.floor((t - T0) / DT)), b = Math.min(cur, a + 10);
    let s = 0; for (let i = a + 1; i <= b; i++) s += Math.abs(tk[i].mid - tk[i - 1].mid);
    const h = Math.min(ACT - 2, (s / 120) * ACT);
    cx.fillStyle = t >= 0 && t < 10 ? "rgba(230,180,80,.55)" : "rgba(63,196,252,.28)";
    cx.fillRect(X(t), TOP + ph + ACT - h, bw, h);
  }
  // clip the plot
  cx.save(); cx.beginPath(); cx.rect(0, 0, pw, TOP + ph + 2); cx.clip();
  // release line
  if (left < 0 && right > 0) {
    const x = X(0); cx.strokeStyle = "rgba(230,180,80,.55)"; cx.setLineDash([3, 5]); cx.beginPath(); cx.moveTo(x, TOP); cx.lineTo(x, TOP + ph); cx.stroke(); cx.setLineDash([]);
    cx.fillStyle = C.gold; cx.font = `600 ${small ? 9 : 10}px ${MONO}`;
    if (x > pw - 70) { cx.textAlign = "right"; cx.fillText("RELEASE", x - 5, TOP + 11); cx.textAlign = "left"; } else cx.fillText("RELEASE", x + 5, TOP + 11);
  }
  // spread band
  cx.beginPath();
  for (let i = i0; i <= cur; i++) { const x = X(tk[i].t), y = Y(tk[i].ask); i === i0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
  for (let i = cur; i >= i0; i--) cx.lineTo(X(tk[i].t), Y(tk[i].bid));
  cx.closePath(); cx.fillStyle = "rgba(230,180,80,.10)"; cx.fill();
  // pending orders
  cx.font = `${small ? 9 : 10}px ${MONO}`;
  for (const o of S.orders) {
    if (o.t > tMkt) continue;
    const e = o.end !== null && o.end <= tMkt ? o.end : tMkt;
    if (e < left) continue;
    const live = !(o.end !== null && o.end <= tMkt);
    const xa = Math.max(0, X(o.t)), xb = live ? pw : X(e);
    cx.setLineDash([5, 4]); cx.lineWidth = 1.2;
    cx.strokeStyle = live ? "rgba(63,196,252,.9)" : "rgba(63,196,252,.25)"; cx.beginPath(); cx.moveTo(xa, Y(o.buy)); cx.lineTo(xb, Y(o.buy)); cx.stroke();
    cx.strokeStyle = live ? "rgba(223,229,238,.85)" : "rgba(223,229,238,.2)"; cx.beginPath(); cx.moveTo(xa, Y(o.sell)); cx.lineTo(xb, Y(o.sell)); cx.stroke();
    cx.setLineDash([]);
    if (live) { cx.fillStyle = C.ice; cx.fillText("BUY STOP", Math.max(4, xb - (small ? 58 : 66)), Y(o.buy) - 5); cx.fillStyle = C.white; cx.fillText("SELL STOP", Math.max(4, xb - (small ? 64 : 72)), Y(o.sell) + 13); }
  }
  // positions: entry, stop loss, trailing stop
  for (const x of S.trades) {
    if (x.t > tMkt) continue;
    const closed = x.te <= tMkt, te = closed ? x.te : tMkt;
    if (te < left) continue;
    const col = x.side > 0 ? C.ice : C.white, xa = X(x.t), xb = closed ? X(te) : pw;
    cx.globalAlpha = closed ? 0.5 : 1;
    cx.strokeStyle = col; cx.lineWidth = 1.4; cx.beginPath(); cx.moveTo(xa, Y(x.entry)); cx.lineTo(xb, Y(x.entry)); cx.stroke();
    // stop loss until trailing takes over
    const firstTrail = x.trail.find((p) => p[0] <= te);
    const slEnd = firstTrail ? X(firstTrail[0]) : xb;
    cx.strokeStyle = C.loss; cx.setLineDash([2, 3]); cx.beginPath(); cx.moveTo(xa, Y(x.entry - x.side * SL)); cx.lineTo(slEnd, Y(x.entry - x.side * SL)); cx.stroke(); cx.setLineDash([]);
    // trailing stop, stepped
    let last = null; cx.strokeStyle = C.ice; cx.lineWidth = 1.6; cx.beginPath();
    for (const p of x.trail) { if (p[0] > te) break; const px = X(p[0]), py = Y(p[1]); if (!last) cx.moveTo(px, py); else { cx.lineTo(px, Y(last[1])); cx.lineTo(px, py); } last = p; }
    if (last) cx.lineTo(xb, Y(last[1]));
    cx.stroke();
    if (!closed) {
      cx.fillStyle = C.loss; cx.font = `${small ? 9 : 10}px ${MONO}`;
      if (last) { cx.fillStyle = C.ice; cx.fillText("TRAILING STOP", Math.max(4, pw - (small ? 82 : 92)), Y(last[1]) + (x.side > 0 ? 13 : -5)); }
      else cx.fillText("STOP LOSS", Math.max(4, pw - (small ? 62 : 70)), Y(x.entry - x.side * SL) + (x.side > 0 ? 13 : -5));
    }
    cx.globalAlpha = 1;
  }
  // price
  cx.lineJoin = "round"; cx.lineCap = "round";
  cx.beginPath();
  for (let i = i0; i <= cur; i++) { const x = X(tk[i].t), y = Y(tk[i].bid); i === i0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
  cx.strokeStyle = C.gold; cx.lineWidth = small ? 1.6 : 1.9; cx.shadowColor = "rgba(230,180,80,.55)"; cx.shadowBlur = 8; cx.stroke(); cx.shadowBlur = 0;
  // entries and exits
  for (const x of S.trades) {
    if (x.t > tMkt || x.t < left - 1) continue;
    const ex = X(x.t), ey = Y(x.entry), col = x.side > 0 ? C.ice : C.white, s = small ? 5 : 6;
    cx.fillStyle = col; cx.beginPath();
    if (x.side > 0) { cx.moveTo(ex, ey - s); cx.lineTo(ex - s, ey + s * 0.8); cx.lineTo(ex + s, ey + s * 0.8); }
    else { cx.moveTo(ex, ey + s); cx.lineTo(ex - s, ey - s * 0.8); cx.lineTo(ex + s, ey - s * 0.8); }
    cx.closePath(); cx.fill();
    if (x.te <= tMkt) {
      const xx = X(x.te), yy = Y(x.exit), c2 = x.res >= 0 ? C.win : C.loss;
      cx.strokeStyle = c2; cx.lineWidth = 2; cx.beginPath(); cx.arc(xx, yy, small ? 4 : 5, 0, Math.PI * 2); cx.stroke();
    }
  }
  // floating results
  const realNow = now / 1000;
  floaters = floaters.filter((f) => realNow - f.at < 1.6);
  cx.font = `700 ${small ? 12 : 14}px ${MONO}`; cx.textAlign = "center";
  for (const f of floaters) {
    const a = (realNow - f.at) / 1.6, x = X(f.t), y = Y(f.v) - 14 - a * 34;
    cx.globalAlpha = 1 - a * a; cx.fillStyle = f.res >= 0 ? C.win : C.loss;
    cx.fillText(sg(f.res), Math.min(pw - 24, Math.max(24, x)), y);
    cx.globalAlpha = Math.max(0, 0.5 - a); cx.strokeStyle = cx.fillStyle; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(x, Y(f.v), 6 + a * 22, 0, Math.PI * 2); cx.stroke();
  }
  cx.globalAlpha = 1; cx.textAlign = "left";
  cx.restore(); // plot clip
  // live price tag
  const last = tk[cur], ly = Math.min(TOP + ph - 8, Math.max(TOP + 8, Y(last.bid)));
  cx.fillStyle = C.gold; cx.beginPath(); cx.roundRect ? cx.roundRect(pw + 2, ly - 9, AX - 4, 18, 4) : cx.rect(pw + 2, ly - 9, AX - 4, 18); cx.fill();
  cx.fillStyle = "#1a1205"; cx.font = `600 ${small ? 10 : 11}px ${MONO}`; cx.textBaseline = "middle"; cx.fillText(fmtPx(last.bid), pw + 6, ly + 0.5);
  cx.textBaseline = "alphabetic";
  cx.restore(); // shake
  if (flash > 0) { cx.fillStyle = `rgba(230,180,80,${0.16 * flash})`; cx.fillRect(0, 0, Wpx, Hpx); }
}

// ---------------------------------------------------------------- camera
function camera(dt) {
  const end = S.end;
  if (ending) Wt = end - T0 + 4;
  else if (tMkt < 0) Wt = 22;
  else if (tMkt < 7) Wt = 9;
  else Wt = Math.min(end - T0 + 4, 9 + (tMkt - 7) * 1.6);
  W += (Wt - W) * (1 - Math.exp(-dt * 3.2));
  const left = ending ? T0 : tMkt - W * 0.8, right = ending ? left + W : tMkt;
  const tk = S.ticks, a = Math.max(0, Math.floor((left - T0) / DT)), b = Math.min(tk.length - 1, Math.floor((right - T0) / DT));
  let lo = Infinity, hi = -Infinity;
  for (let i = a; i <= b; i++) { if (tk[i].bid < lo) lo = tk[i].bid; if (tk[i].ask > hi) hi = tk[i].ask; }
  for (const o of S.orders) if (o.t <= tMkt && (o.end === null || o.end > tMkt) && !ending) { lo = Math.min(lo, o.sell); hi = Math.max(hi, o.buy); }
  for (const x of S.trades) if (x.t <= tMkt && x.te > tMkt && !ending) { lo = Math.min(lo, x.entry - SL); hi = Math.max(hi, x.entry + SL); }
  if (!isFinite(lo)) { lo = -80; hi = 80; }
  const span = Math.max(150, hi - lo), pad = span * 0.14;
  const tl = lo - pad, th = hi + pad, f = 1 - Math.exp(-dt * 5);
  yLo = tl < yLo ? yLo + (tl - yLo) * Math.min(1, f * 2.5) : yLo + (tl - yLo) * f;
  yHi = th > yHi ? yHi + (th - yHi) * Math.min(1, f * 2.5) : yHi + (th - yHi) * f;
}

// ---------------------------------------------------------------- the HTML around the chart
let lastState = "", lastClock = "", lastSpeed = "";
function hud(realNow) {
  const t = tMkt, open = S.trades.some((x) => x.t <= t && x.te > t);
  const st = ending ? "done" : t < -PRE ? "wait" : open ? "trade" : t < POST ? "armed" : "done";
  if (st !== lastState) { lastState = st; ui.state.dataset.s = st; ui.state.textContent = { wait: "Waiting", armed: "Armed", trade: "In trade", done: "Disarmed" }[st]; }
  const s = Math.floor(Math.abs(t)), c = (t < 0 ? "T" + MINUS : "T+") + "00:" + String(Math.min(99, s)).padStart(2, "0");
  if (c !== lastClock) { lastClock = c; ui.clock.textContent = ending ? "Replay" : c; }
  const sp = ending ? "" : speedLabel(t);
  if (sp !== lastSpeed) { lastSpeed = sp; ui.speed.textContent = sp; ui.speed.classList.toggle("slow", sp === "Slow motion"); ui.speed.hidden = !sp; }
  if (!ui.news.hidden && realNow > newsUntil) ui.news.hidden = true;
}

// ---------------------------------------------------------------- loop
let raf = 0, prev = 0, visible = true;
function frame(now) {
  raf = 0;
  const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016); prev = now;
  const realNow = now / 1000;
  if (!ending) {
    const before = tMkt;
    tMkt = Math.min(S.end + 1.5, tMkt + dt * speedAt(tMkt));
    if (before < 0 && tMkt >= 0) { shake = 1; flash = 1; ui.newsT.textContent = `${eventName} released`; ui.news.hidden = false; newsUntil = realNow + 2.8; }
    while (shown < S.trades.length && S.trades[shown].te <= tMkt) {
      const x = S.trades[shown++]; addTape(x); setStats();
      floaters.push({ at: realNow, t: x.te, v: x.exit, res: x.res });
    }
    if (tMkt >= S.end + 1.5) { ending = realNow; summary(); }
  } else if (realNow - ending > 4.6) start(false);
  shake = Math.max(0, shake - dt * 2.4); flash = Math.max(0, flash - dt * 3);
  camera(dt); hud(realNow); draw(now);
  go();
}
function summary() {
  const n = S.trades.length, won = S.trades.filter((x) => x.res > 0).length;
  ui.sum.innerHTML = `<b class="${S.net >= 0 ? "up" : "dn"}">${sg(S.net)} pts</b><span>${n} trades, ${won} won, in one simulated release.</span><em>${S.net >= 0 ? "Not every release looks like this." : "Some releases lose. That's news trading."}</em>`;
  ui.sum.hidden = false;
  if (ui.live) ui.live.textContent = `Simulated release: ${n} trades, ${won} won, net ${sg(S.net)} points.`;
}
function go() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); }

// ---------------------------------------------------------------- boot
resize();
new ResizeObserver(() => { resize(); if (reduce || !raf) draw(performance.now()); }).observe(cv);
window.GSTerm = { event(name) { if (name && name !== eventName) { eventName = name.length > 30 ? name.slice(0, 29) + "…" : name; ui.ev.textContent = eventName; } } };
start(true);
if (reduce) {
  // one finished release, no motion
  tMkt = S.end + 1.5; ending = 1; shown = S.trades.length; S.trades.forEach(addTape); setStats(); summary();
  for (let i = 0; i < 60; i++) camera(0.1);
  hud(0); draw(0);
  return;
}
new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) { prev = 0; go(); } }).observe(root);
document.addEventListener("visibilitychange", () => { prev = 0; go(); });
go();
})();
