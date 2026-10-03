// Hero terminal: plays simulated releases from sim.js (window.GSSim), traded tick by tick with the
// EA's default rules. Only the news window is shown: armed at T−5s, everything closed by T+30s.
// A rotation of five kinds of release, four that win and one that loses, so it never shows only wins.
(() => {
"use strict";
const root = document.getElementById("term");
if (!root || !window.GSSim) return;
const { P, scenario, ROTATION } = window.GSSim;
const $ = (s) => root.querySelector(s);
const cv = $("canvas"), cx = cv.getContext("2d");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MINUS = "−";
const C = { gold: "#E6B450", ice: "#3FC4FC", white: "#dfe5ee", loss: "#F2616F", axis: "#6f7787", txt2: "#a3abb9", ink: "#07090d", g: "230,180,80", i: "63,196,252", l: "242,97,111" };
function palette() {                                   // the chart follows the site's colour theme
  const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
  C.gold = v("--gold", C.gold); C.ice = v("--ice", C.ice); C.loss = v("--loss", C.loss); C.ink = v("--term2", C.ink);
  C.g = v("--gold-rgb", C.g); C.i = v("--ice-rgb", C.i); C.l = v("--loss-rgb", C.l);
}
const rgba = (rgb, a) => `rgba(${rgb},${a})`;
const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';
const DISP = 'Unbounded, "Arial Black", sans-serif';
const V0 = -P.PRE - 1.5, V1 = P.POST + 1, VW = V1 - V0; // the part of the window the chart shows
const HOLD = 6.5;                                       // seconds the result stays up before the next release
const NAMES = { whipsaw: "Whipsaw", breakout: "Breakout", chop: "Choppy", fakeout: "Fake-out", grind: "Slow grind" };

const ui = {
  ev: $(".tm-ev"), speed: $(".tm-speed"), state: $(".tm-state"), clock: $(".tm-clock"),
  news: $(".tm-news"), newsT: $(".tm-news span"),
  sum: $(".tm-sum"), sumN: $(".tm-sum b"), sumD: $(".tm-sum .d"), sumE: $(".tm-sum em"), sumNx: $(".tm-sum .nx"), sumNxT: $(".tm-sum .nx b"), sumBar: $(".tm-sum .nx i i"),
  bid: $('[data-q="bid"]'), ask: $('[data-q="ask"]'), spr: $('[data-q="spr"]'),
  pos: $(".ea-pos"), posT: $(".ea-pos .t"), posK: [...root.querySelectorAll(".ea-pos dt")], posV: [...root.querySelectorAll(".ea-pos dd")], posPL: $(".ea-pos .pl"),
  n: $('[data-s="n"]'), won: $('[data-s="won"]'), lost: $('[data-s="lost"]'), net: $('[data-s="net"]'),
  tape: $(".tm-tape"), empty: $(".tm-empty"),
  play: $(".tm-play"), replay: $(".tm-replay"), slow: $(".tm-slow"),
  line: $(".tm-line"), head: $(".tm-line .hd"), fill: $(".tm-line .fl"), marks: $(".tm-line .mk"),
  chips: [...root.querySelectorAll(".tm-chips button")], live: $(".tm-live"),
};

// ---------------------------------------------------------------- formatting
let base = 4175, eventName = "US news release";
const px = (pts) => (base + pts / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sg = (v) => (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(Math.round(v));
const fmtT = (t, d = 0) => (Math.abs(t) < 0.005 ? "0" : (t > 0 ? "+" : MINUS) + Math.abs(t).toFixed(d)) + "s";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const set = (el, txt) => { if (el && el.textContent !== txt) el.textContent = txt; };

// ---------------------------------------------------------------- state
let S = null, idx = 0, tMkt = V0, playing = !reduce, slow = false, rate = 1, rateT = 1;
let W = 22, Lv = V0, yLo = -90, yHi = 90, ending = false, hold = 0;
let floaters = [], flash = 0, shake = 0, newsUntil = 0, hover = null, shown = -1, openN = -1;
const results = {};

function start(i, from) {
  idx = (i + ROTATION.length) % ROTATION.length;
  S = scenario(ROTATION[idx], (Date.now() ^ Math.imul(idx + 1, 7919)) | 0);
  base = Math.round((window.GS_GOLD || base) * 10) / 10;
  tMkt = from === undefined ? V0 : from;
  ending = false; hold = 0; floaters = []; flash = 0; shake = 0; shown = -1; openN = -1;
  ui.sum.hidden = true; ui.news.hidden = true; root.classList.remove("hit", "won", "lost");
  ui.chips.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === ROTATION[idx])));
  snapCamera(); sync();
}

// ---------------------------------------------------------------- lookups at the current moment
function at(t) {                                   // last tick at or before t
  const tk = S.ticks; let lo = 0, hi = tk.length - 1;
  if (t <= tk[0].t) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tk[m].t <= t) lo = m; else hi = m - 1; }
  return lo;
}
const openAt = (t) => S.trades.find((x) => x.t <= t && x.te > t) || null;
const pendAt = (t) => { for (let i = S.orders.length - 1; i >= 0; i--) { const o = S.orders[i]; if (o.t <= t) return o.end === null || o.end > t ? o : null; } return null; };
const stopOf = (x, t) => { let s = x.sl0, tr = false; for (const p of x.trail) { if (p[0] > t) break; s = p[1]; tr = true; } return { v: s, trail: tr }; };

// ---------------------------------------------------------------- replay speed: fast while waiting, slow motion for the burst
function autoRate(t) {
  if (t < -P.PRE - 0.3) return 1.5;
  if (t < -P.PRE + 1.4) return 1;
  if (t < -1.5) return 2.5;
  if (t < 0) return 1.2;
  if (t < 5) return 0.4;
  if (t < 10) return 0.9;
  return openAt(t) ? 2.5 : 7;
}
function speedText(r) {
  if (Wpx < 420) return (r < 0.85 ? "Slow " : "") + (r < 0.3 ? r.toFixed(2) : Number.isInteger(r) ? r : r.toFixed(1)) + "×";
  return r < 0.85 ? `Slow motion ${r.toFixed(r < 0.3 ? 2 : 1)}×` : r < 1.3 ? "Real time" : `Fast-forward ${Number.isInteger(r) ? r : r.toFixed(1)}×`;
}

// ---------------------------------------------------------------- camera
function wTarget(t) {
  if (ending) return VW;
  if (t < 0) return 9;
  if (t < 6) return 8;
  return Math.min(VW, 8 + (t - 6) * 1.5);
}
function yRange(L, R) {
  const tk = S.ticks, a = at(L), b = at(Math.min(R, tMkt));
  let lo = Infinity, hi = -Infinity;
  for (let i = a; i <= b; i++) { if (tk[i].bid < lo) lo = tk[i].bid; if (tk[i].ask > hi) hi = tk[i].ask; }
  if (!ending) {
    const o = pendAt(tMkt); if (o) { lo = Math.min(lo, o.sell); hi = Math.max(hi, o.buy); }
    const x = openAt(tMkt); if (x) { const s = stopOf(x, tMkt).v; lo = Math.min(lo, s, x.entry); hi = Math.max(hi, s, x.entry); }
  }
  if (!isFinite(lo)) { lo = -80; hi = 80; }
  const span = Math.max(170, hi - lo), pad = span * 0.16, mid = (lo + hi) / 2;
  return [Math.min(lo - pad, mid - span / 2 - pad), Math.max(hi + pad, mid + span / 2 + pad)];
}
const leftFor = (w) => (ending ? V0 : clamp(tMkt - w * 0.8, V0, V1 - w));
function camera(dt) {
  W += (wTarget(tMkt) - W) * (1 - Math.exp(-dt * 3));
  const Lt = leftFor(W); Lv += (Lt - Lv) * (1 - Math.exp(-dt * 8));
  const [tl, th] = yRange(Lv, Lv + W), f = 1 - Math.exp(-dt * 5);
  yLo += (tl - yLo) * (tl < yLo ? Math.min(1, f * 2.5) : f);
  yHi += (th - yHi) * (th > yHi ? Math.min(1, f * 2.5) : f);
}
function snapCamera() { W = wTarget(tMkt); Lv = leftFor(W); [yLo, yHi] = yRange(Lv, Lv + W); }

// ---------------------------------------------------------------- canvas
let Wpx = 800, Hpx = 400, dpr = 1;
function resize() {
  const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
  Wpx = Math.max(260, r.width); Hpx = Math.max(200, r.height);
  cv.width = Math.round(Wpx * dpr); cv.height = Math.round(Hpx * dpr);
}
function niceStep(span, target) { const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
function box(x, y, w, h, r) { cx.beginPath(); if (cx.roundRect) cx.roundRect(x, y, w, h, r); else cx.rect(x, y, w, h); }

function draw(now) {
  const small = Wpx < 560, AX = small ? 60 : 76, TOP = 20, VOL = small ? 18 : 28, BOT = 22;
  const pw = Wpx - AX, ph = Hpx - TOP - VOL - BOT, R = Lv + W;
  const X = (t) => ((t - Lv) / W) * pw, Y = (v) => TOP + (1 - (v - yLo) / (yHi - yLo)) * ph;
  const tk = S.ticks, cur = at(tMkt), i0 = Math.max(0, at(Lv) - 1), fs = small ? 9.5 : 10.5;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, Wpx, Hpx);
  cx.save();
  if (shake > 0 && !reduce) cx.translate((Math.random() - 0.5) * 5 * shake, (Math.random() - 0.5) * 5 * shake);

  // the news window: outside it the chart is dimmed, the first seconds after the number glow a little
  const xa = X(-P.PRE), x0 = X(0), xe = X(P.POST);
  cx.fillStyle = "rgba(0,0,0,.28)";
  if (xa > 0) cx.fillRect(0, TOP, Math.min(pw, xa), ph + VOL);
  if (xe < pw) cx.fillRect(Math.max(0, xe), TOP, pw - Math.max(0, xe), ph + VOL);
  const gb = cx.createLinearGradient(x0, 0, X(10), 0); gb.addColorStop(0, rgba(C.g, 0.06)); gb.addColorStop(1, rgba(C.g, 0));
  if (x0 < pw && X(10) > 0) { cx.fillStyle = gb; cx.fillRect(Math.max(0, x0), TOP, Math.min(pw, X(10)) - Math.max(0, x0), ph + VOL); }

  // watermark
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.fillStyle = "rgba(255,255,255,.035)"; cx.font = `800 ${small ? 30 : 58}px ${DISP}`; cx.fillText("XAUUSD", pw / 2, TOP + ph / 2 - (small ? 6 : 10));
  cx.fillStyle = "rgba(255,255,255,.1)"; cx.font = `${small ? 9 : 11}px ${MONO}`; cx.fillText("simulated ticks, default settings", pw / 2, TOP + ph / 2 + (small ? 16 : 30));

  // price grid and axis
  cx.font = `${fs}px ${MONO}`; cx.textAlign = "left";
  const st = niceStep(yHi - yLo, small ? 4 : 6);
  const b100 = Math.round(base * 100);                 // grid on round prices, not round distances from the base
  for (let v = Math.ceil((yLo + b100) / st) * st - b100; v <= yHi; v += st) {
    const y = Math.round(Y(v)) + 0.5; if (y < TOP + 4 || y > TOP + ph - 4) continue;
    cx.strokeStyle = "rgba(255,255,255,.05)"; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(0, y); cx.lineTo(pw, y); cx.stroke();
    cx.fillStyle = C.axis; cx.fillText(px(v), pw + 8, y);
  }
  // time grid and axis
  const tsStep = [0.5, 1, 2, 5, 10, 15, 30].find((v) => (v / W) * pw >= (small ? 50 : 64)) || 30;
  cx.textAlign = "center"; cx.textBaseline = "alphabetic";
  for (let t = Math.ceil(Lv / tsStep) * tsStep; t <= R; t += tsStep) {
    const x = Math.round(X(t)) + 0.5; if (x < 16 || x > pw - 16) continue;
    cx.strokeStyle = "rgba(255,255,255,.035)"; cx.beginPath(); cx.moveTo(x, TOP); cx.lineTo(x, TOP + ph + VOL); cx.stroke();
    cx.fillStyle = C.axis; cx.fillText(fmtT(t, tsStep < 1 ? 1 : 0), x, Hpx - 7);
  }
  // window marks along the top
  cx.font = `600 ${fs}px ${MONO}`; cx.textBaseline = "middle";
  for (const [t, label, col, dash] of [[-P.PRE, "Armed", rgba(C.i, 0.5), [2, 4]], [0, "News out", rgba(C.g, 0.75), [4, 4]], [P.POST, "Window closes", "rgba(163,171,185,.45)", [2, 4]]]) {
    const x = Math.round(X(t)) + 0.5; if (x < 0 || x > pw) continue;
    cx.strokeStyle = col; cx.setLineDash(dash); cx.beginPath(); cx.moveTo(x, TOP); cx.lineTo(x, TOP + ph + VOL); cx.stroke(); cx.setLineDash([]);
    cx.fillStyle = col.replace(/[\d.]+\)$/, "1)"); const w = cx.measureText(label).width;
    cx.textAlign = "left"; cx.fillText(label, x + 6 + w > pw ? x - 6 - w : x + 6, TOP / 2 + 1);
  }

  // tick volume: how much price moved in each slice of time
  const bucket = Math.max(0.08, W / (pw / 5)), bw = Math.max(1.5, (bucket / W) * pw - 1.2);
  for (let t = Math.floor(Lv / bucket) * bucket; t < Math.min(tMkt, R); t += bucket) {
    const a = at(t), b = at(Math.min(tMkt, t + bucket)); let s = 0;
    for (let i = a + 1; i <= b; i++) s += Math.abs(tk[i].mid - tk[i - 1].mid);
    const h = Math.min(VOL - 3, (s / (bucket * 700)) * (VOL - 3)); if (h < 0.6) continue;
    cx.fillStyle = t >= 0 && t < 10 ? rgba(C.g, 0.55) : rgba(C.i, 0.28);
    cx.fillRect(X(t), TOP + ph + VOL - h, bw, h);
  }

  cx.save(); cx.beginPath(); cx.rect(0, TOP, pw, ph); cx.clip();
  const tags = [];

  // spread band, ask and bid
  cx.beginPath();
  for (let i = i0; i <= cur; i++) { const x = X(tk[i].t), y = Y(tk[i].ask); i === i0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
  for (let i = cur; i >= i0; i--) cx.lineTo(X(tk[i].t), Y(tk[i].bid));
  cx.closePath(); cx.fillStyle = rgba(C.g, 0.09); cx.fill();
  cx.beginPath();
  for (let i = i0; i <= cur; i++) { const x = X(tk[i].t), y = Y(tk[i].ask); i === i0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
  cx.strokeStyle = "rgba(223,229,238,.22)"; cx.lineWidth = 1; cx.stroke();

  // pending orders: live ones run to the right edge, filled or removed ones stop where they ended
  cx.font = `${fs}px ${MONO}`; cx.textBaseline = "alphabetic";
  for (const o of S.orders) {
    if (o.t > tMkt) continue;
    const done = o.end !== null && o.end <= tMkt;
    if (done && o.end < Lv) continue;
    const a = X(o.t), b = done ? X(o.end) : pw;
    for (const [v, col, name] of [[o.buy, C.ice, "Buy stop"], [o.sell, C.white, "Sell stop"]]) {
      const y = Math.round(Y(v)) + 0.5;
      cx.setLineDash([5, 4]); cx.lineWidth = 1.2;
      cx.globalAlpha = done ? 0.22 : 0.9; cx.strokeStyle = col; cx.beginPath(); cx.moveTo(a, y); cx.lineTo(b, y); cx.stroke(); cx.setLineDash([]);
      if (!done) { cx.globalAlpha = 1; cx.fillStyle = col; cx.textAlign = "right"; cx.fillText(name, pw - 8, v === o.buy ? y - 5 : y + 13); tags.push({ y: Y(v), t: px(v), fg: col, line: true }); }
      cx.globalAlpha = 1;
    }
  }

  // closed trades: entry to exit, MT5-style dotted links
  for (const x of S.trades) {
    if (x.t > tMkt || (x.te <= tMkt && x.te < Lv - 1)) continue;
    const closed = x.te <= tMkt, ex = X(x.t), ey = Y(x.entry), col = x.side > 0 ? C.ice : C.white;
    if (closed) {
      const c2 = x.res >= 0 ? C.ice : C.loss;
      cx.strokeStyle = c2; cx.globalAlpha = 0.55; cx.lineWidth = 1.2; cx.setLineDash([2, 3]);
      cx.beginPath(); cx.moveTo(ex, ey); cx.lineTo(X(x.te), Y(x.exit)); cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
    } else {
      // the open position: entry line, stop (fixed, then trailing in steps), and its running result
      cx.strokeStyle = col; cx.lineWidth = 1.4; cx.globalAlpha = 0.25; cx.beginPath(); cx.moveTo(0, ey); cx.lineTo(ex, ey); cx.stroke();
      cx.globalAlpha = 1; cx.beginPath(); cx.moveTo(ex, ey); cx.lineTo(pw, ey); cx.stroke();
      const s = stopOf(x, tMkt), first = x.trail.find((p) => p[0] <= tMkt);
      cx.strokeStyle = C.loss; cx.setLineDash([2, 3]); cx.lineWidth = 1.3;
      cx.beginPath(); cx.moveTo(ex, Y(x.sl0)); cx.lineTo(first ? X(first[0]) : pw, Y(x.sl0)); cx.stroke(); cx.setLineDash([]);
      if (first) {
        cx.strokeStyle = C.ice; cx.lineWidth = 1.8; cx.beginPath(); let last = null;
        for (const p of x.trail) { if (p[0] > tMkt) break; const a = X(p[0]), b = Y(p[1]); if (!last) cx.moveTo(a, b); else { cx.lineTo(a, Y(last[1])); cx.lineTo(a, b); } last = p; }
        cx.lineTo(pw, Y(last[1])); cx.stroke();
      }
      tags.push({ y: Y(s.v), t: px(s.v), bg: s.trail ? C.ice : C.loss, fg: C.ink });
      tags.push({ y: ey, t: px(x.entry), fg: col, line: true });
      if (small) continue;                       // phones: the panel under the chart carries this
      // position label riding the entry line
      const q = tk[cur], pl = ((x.side > 0 ? q.bid : q.ask) - x.entry) * x.side;
      const lab = `${x.side > 0 ? "BUY" : "SELL"} #${x.n}  ${sg(pl)} pts`; cx.font = `600 ${fs}px ${MONO}`;
      const w = cx.measureText(lab).width + 14, lx = pw - w - 8, ly = ey + (x.side > 0 ? 6 : -24);
      box(lx, ly, w, 18, 5); cx.fillStyle = "rgba(9,12,17,.88)"; cx.fill(); cx.strokeStyle = pl >= 0 ? rgba(C.i, 0.6) : rgba(C.l, 0.6); cx.lineWidth = 1; cx.stroke();
      cx.fillStyle = pl >= 0 ? C.ice : C.loss; cx.textAlign = "left"; cx.textBaseline = "middle"; cx.fillText(lab, lx + 7, ly + 9.5); cx.textBaseline = "alphabetic";
      if (s.trail) { cx.font = `${fs}px ${MONO}`; cx.fillStyle = C.ice; cx.textAlign = "right"; cx.fillText("Trailing stop", lx - 10, Y(s.v) + (x.side > 0 ? 13 : -5)); }
      else { cx.font = `${fs}px ${MONO}`; cx.fillStyle = C.loss; cx.textAlign = "right"; cx.fillText("Stop loss", pw - 8, Y(x.sl0) + (x.side > 0 ? 13 : -5)); }
    }
  }

  // price
  cx.lineJoin = "round"; cx.lineCap = "round"; cx.beginPath();
  for (let i = i0; i <= cur; i++) { const x = X(tk[i].t), y = Y(tk[i].bid); i === i0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
  cx.strokeStyle = rgba(C.g, 0.16); cx.lineWidth = small ? 6 : 7; cx.stroke();          // glow, without the cost of shadowBlur
  cx.strokeStyle = C.gold; cx.lineWidth = small ? 1.6 : 1.9; cx.stroke();
  const lastX = X(tk[cur].t), lastY = Y(tk[cur].bid);
  if (!ending) { cx.fillStyle = C.gold; cx.beginPath(); cx.arc(lastX, lastY, 3, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = 0.25 + 0.2 * Math.sin(now / 160); cx.beginPath(); cx.arc(lastX, lastY, 7, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = 1; }

  // entries and exits
  for (const x of S.trades) {
    if (x.t > tMkt || (x.te <= tMkt && x.te < Lv - 1)) continue;
    const ex = X(x.t), ey = Y(x.entry), s = small ? 4.5 : 5.5;
    cx.fillStyle = x.side > 0 ? C.ice : C.white; cx.beginPath();
    if (x.side > 0) { cx.moveTo(ex, ey - s); cx.lineTo(ex - s, ey + s * 0.85); cx.lineTo(ex + s, ey + s * 0.85); }
    else { cx.moveTo(ex, ey + s); cx.lineTo(ex - s, ey - s * 0.85); cx.lineTo(ex + s, ey - s * 0.85); }
    cx.closePath(); cx.fill();
    if (x.te <= tMkt) {
      const c2 = x.res >= 0 ? C.ice : C.loss, xx = X(x.te), yy = Y(x.exit);
      cx.fillStyle = C.ink; cx.strokeStyle = c2; cx.lineWidth = 2; cx.beginPath(); cx.arc(xx, yy, small ? 3.5 : 4.5, 0, Math.PI * 2); cx.fill(); cx.stroke();
    }
  }

  // results floating up from each exit
  const rn = now / 1000;
  floaters = floaters.filter((f) => rn - f.at < 1.7);
  cx.textAlign = "center"; cx.textBaseline = "alphabetic";
  for (const f of floaters) {
    const a = (rn - f.at) / 1.7, x = clamp(X(f.t), 26, pw - 26), y0 = Y(f.v), up = f.res >= 0 ? -1 : 1;
    const col = f.res >= 0 ? C.ice : C.loss;
    cx.globalAlpha = Math.max(0, 0.55 - a); cx.strokeStyle = col; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(X(f.t), y0, 6 + a * 24, 0, Math.PI * 2); cx.stroke();
    cx.globalAlpha = 1 - a * a; cx.fillStyle = col; cx.font = `700 ${small ? 12 : 14}px ${MONO}`;
    cx.fillText(sg(f.res), x, y0 + up * (16 + a * 30) + (up > 0 ? 8 : 0));
  }
  cx.globalAlpha = 1;
  cx.restore(); // plot clip

  // price tags on the axis, pushed apart so none overlap; the live price is drawn last, on top
  const q = tk[cur];
  const all = tags.concat([{ y: Y(q.bid), t: px(q.bid), bg: C.gold, fg: C.ink, main: true }]);
  all.forEach((g) => (g.yy = clamp(g.y, TOP + 8, TOP + ph - 8)));
  all.sort((a, b) => a.yy - b.yy);
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < all.length; i++) if (all[i].yy - all[i - 1].yy < 17) all[i].yy = all[i - 1].yy + 17;
  for (let i = all.length - 1; i > 0; i--) if (all[i].yy > TOP + ph - 8) { all[i].yy = TOP + ph - 8; if (all[i].yy - all[i - 1].yy < 17) all[i - 1].yy = all[i].yy - 17; }
  cx.font = `600 ${fs}px ${MONO}`; cx.textBaseline = "middle"; cx.textAlign = "left";
  for (const g of all.sort((a, b) => (a.main ? 1 : 0) - (b.main ? 1 : 0))) {
    if (Math.abs(g.yy - g.y) > 1 && g.y > TOP && g.y < TOP + ph) { cx.strokeStyle = g.bg || g.fg; cx.globalAlpha = 0.5; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(pw - 4, g.y); cx.lineTo(pw + 2, g.yy); cx.stroke(); cx.globalAlpha = 1; }
    box(pw + 2, g.yy - 8.5, AX - 5, 17, 4);
    if (g.bg) { cx.fillStyle = g.bg; cx.fill(); } else { cx.fillStyle = C.ink; cx.fill(); cx.strokeStyle = g.fg; cx.lineWidth = 1; cx.stroke(); }
    cx.fillStyle = g.bg ? C.ink : g.fg; cx.fillText(g.t, pw + 7, g.yy + 0.5);
  }

  // crosshair
  if (hover && hover.x < pw && hover.y > TOP && hover.y < TOP + ph) {
    const t = Lv + (hover.x / pw) * W, v = yLo + (1 - (hover.y - TOP) / ph) * (yHi - yLo);
    cx.strokeStyle = "rgba(223,229,238,.35)"; cx.setLineDash([3, 3]); cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(hover.x + 0.5, TOP); cx.lineTo(hover.x + 0.5, TOP + ph + VOL); cx.moveTo(0, hover.y + 0.5); cx.lineTo(pw, hover.y + 0.5); cx.stroke(); cx.setLineDash([]);
    cx.font = `600 ${fs}px ${MONO}`; cx.textBaseline = "middle";
    box(pw + 2, hover.y - 8.5, AX - 5, 17, 4); cx.fillStyle = "#2e3644"; cx.fill(); cx.fillStyle = "#fff"; cx.textAlign = "left"; cx.fillText(px(v), pw + 7, hover.y + 0.5);
    const tl = "T" + fmtT(t, 2).replace(/^0s$/, "+0s"), tw = cx.measureText(tl).width + 12, tx = clamp(hover.x - tw / 2, 0, pw - tw);
    box(tx, Hpx - BOT + 2, tw, 17, 4); cx.fillStyle = "#2e3644"; cx.fill(); cx.fillStyle = "#fff"; cx.textAlign = "center"; cx.fillText(tl, tx + tw / 2, Hpx - BOT + 10.5);
  }
  cx.restore(); // shake
  if (flash > 0) { cx.fillStyle = rgba(C.g, 0.14 * flash); cx.fillRect(0, 0, Wpx, Hpx); }
}

// ---------------------------------------------------------------- everything around the chart
let lastState = "";
function sync() {
  const t = tMkt, q = S.ticks[at(t)], open = openAt(t), pend = pendAt(t);
  const st = ending || t >= P.POST ? "done" : t < -P.PRE ? "wait" : open ? "trade" : "armed";
  if (st !== lastState) { lastState = st; ui.state.dataset.s = st; ui.state.textContent = { wait: "Waiting", armed: "Armed", trade: "In a trade", done: "Window closed" }[st]; }
  const a = Math.abs(t), m = Math.floor(a / 60);
  set(ui.clock, ending ? "Replay done" : "T" + (t < 0 ? MINUS : "+") + String(m).padStart(2, "0") + ":" + (a - m * 60).toFixed(1).padStart(4, "0"));
  const sp = ending ? "" : speedText(rateT * (slow ? 0.5 : 1));
  set(ui.speed, sp); ui.speed.hidden = !sp; ui.speed.classList.toggle("slow", sp.startsWith("Slow"));
  // quote
  set(ui.bid, px(q.bid)); set(ui.ask, px(q.ask)); set(ui.spr, String(Math.round(q.ask - q.bid)));
  ui.spr.classList.toggle("wide", q.ask - q.bid > 30);
  // what the EA is doing
  let title, rows, pl = "", plc = "";
  if (st === "wait") { title = "Waiting for the release"; rows = [["Arms at", "T" + MINUS + P.PRE + "s"], ["Orders", "60+ pts either side"]]; }
  else if (open) {
    const s = stopOf(open, t), now = ((open.side > 0 ? q.bid : q.ask) - open.entry) * open.side;
    title = `${open.side > 0 ? "Buy" : "Sell"} #${open.n} open`; rows = [["Entry", px(open.entry)], [s.trail ? "Trailing stop" : "Stop loss", px(s.v)]];
    pl = sg(now) + " pts"; plc = now >= 0 ? "up" : "dn";
  } else if (st === "done") { title = "Window closed"; rows = [["Pending", "removed at T+" + P.POST + "s"], ["Positions", "all closed"]]; }
  else if (pend) { title = "Pending pair placed"; rows = [["Buy stop", px(pend.buy)], ["Sell stop", px(pend.sell)]]; }
  else { title = "Armed"; rows = [["Orders", "60+ pts either side"], ["Stop loss", "100+ pts"]]; }
  set(ui.posT, title); ui.pos.dataset.s = open ? (open.side > 0 ? "buy" : "sell") : st;
  rows.forEach((r, i) => { set(ui.posK[i], r[0]); set(ui.posV[i], r[1]); });
  set(ui.posPL, pl); ui.posPL.className = "pl num " + plc; ui.posPL.hidden = !pl;
  // closed trades: stats, blotter, markers on the timeline
  const n = S.trades.filter((x) => x.te <= t).length, on = open ? open.n : 0;
  if (n !== shown || on !== openN) { shown = n; openN = on; blotter(n, open); }
  if (open) { const r = ui.tape.querySelector("li.open .rs"); if (r) { const v = ((open.side > 0 ? q.bid : q.ask) - open.entry) * open.side; set(r, sg(v)); r.className = "rs " + (v >= 0 ? "up" : "dn"); } }
  // timeline
  const f = clamp((t - V0) / VW, 0, 1) * 100;
  ui.head.style.left = f + "%"; ui.fill.style.width = f + "%";
  ui.line.setAttribute("aria-valuenow", t.toFixed(1)); ui.line.setAttribute("aria-valuetext", "T" + fmtT(t, 1));
  if (!ui.news.hidden && performance.now() / 1000 > newsUntil) ui.news.hidden = true;
}
function blotter(n, open) {
  const done = S.trades.slice(0, n), won = done.filter((x) => x.res > 0).length, net = done.reduce((a, x) => a + x.res, 0);
  set(ui.n, String(n)); set(ui.won, String(won)); set(ui.lost, String(n - won));
  set(ui.net, n ? sg(net) : "0"); ui.net.className = n ? (net >= 0 ? "up" : "dn") : "";
  const rows = (open ? [open] : []).concat(done.slice().reverse()).slice(0, 14);
  ui.tape.replaceChildren(...rows.map((x) => {
    const li = document.createElement("li"), isOpen = x === open;
    li.className = isOpen ? "open" : x.res >= 0 ? "w" : "l";
    li.innerHTML = `<b>#${x.n}</b><span class="sd ${x.side > 0 ? "b" : "s"}">${x.side > 0 ? "Buy" : "Sell"}</span><span class="tt">T${fmtT(x.t, 2)}</span><span class="rs ${isOpen ? "" : x.res >= 0 ? "up" : "dn"}">${isOpen ? "" : sg(x.res)}</span><span class="hw">${isOpen ? "open" : x.how === "stop loss" ? "SL" : "TS"}</span>`;
    return li;
  }));
  ui.empty.hidden = rows.length > 0;
  ui.marks.replaceChildren(...done.map((x) => { const i = document.createElement("i"); i.className = x.res >= 0 ? "w" : "l"; i.style.left = clamp((x.te - V0) / VW, 0, 1) * 100 + "%"; return i; }));
}

const NOTES = {
  whipsaw: "Price whipped both ways first. A few small stops, then the trailing stop rode the run.",
  breakout: "One clean move after the number. The trailing stop followed it.",
  fakeout: "The first move faked out and got stopped. The real move paid for it.",
  grind: "A slower release. Smaller moves, a smaller gain.",
  chop: "No direction, only chop. The stops add up and this release loses.",
};
function finish() {
  ending = true; hold = HOLD; tMkt = V1;
  const n = S.trades.length, won = S.trades.filter((x) => x.res > 0).length, k = ROTATION[(idx + 1) % ROTATION.length];
  results[S.kind] = S.net;
  set(ui.sumN, sg(S.net) + " pts"); ui.sumN.className = S.net >= 0 ? "up" : "dn";
  set(ui.sumD, `${n} trade${n === 1 ? "" : "s"}, ${won} won, ${n - won} lost`);
  set(ui.sumE, NOTES[S.kind]); set(ui.sumNxT, NAMES[k]);
  ui.sumNx.hidden = reduce; ui.sumBar.style.width = "0%";
  ui.sum.hidden = false; root.classList.add(S.net >= 0 ? "won" : "lost");
  if (reduce) { playing = false; ui.play.dataset.s = "play"; ui.play.setAttribute("aria-label", "Play"); }
  const chip = ui.chips.find((b) => b.dataset.k === S.kind); if (chip) { const b = chip.querySelector("span"); b.textContent = sg(S.net); b.className = S.net >= 0 ? "up" : "dn"; }
  if (ui.live) ui.live.textContent = `Simulated ${NAMES[S.kind].toLowerCase()} release: ${n} trades, ${won} won, net ${sg(S.net)} points.`;
}

// ---------------------------------------------------------------- loop
let raf = 0, prev = 0, visible = true;
function frame(now) {
  raf = 0;
  const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016); prev = now;
  if (playing && !ending) {
    rateT = autoRate(tMkt); rate += (rateT - rate) * (1 - Math.exp(-dt * 5));
    const before = tMkt; tMkt = Math.min(V1, tMkt + dt * rate * (slow ? 0.5 : 1));
    if (before < 0 && tMkt >= 0) {
      shake = 1; flash = 1; root.classList.add("hit"); setTimeout(() => root.classList.remove("hit"), 1400);
      set(ui.newsT, `${eventName} is out`); ui.news.hidden = false; newsUntil = now / 1000 + 2.6;
    }
    for (const x of S.trades) if (x.te > before && x.te <= tMkt) floaters.push({ at: now / 1000, t: x.te, v: x.exit, res: x.res });
    if (tMkt >= V1) finish();
  } else if (playing && ending && !reduce) {
    hold -= dt; ui.sumBar.style.width = clamp(1 - hold / HOLD, 0, 1) * 100 + "%";
    if (hold <= 0) start(idx + 1);
  }
  shake = Math.max(0, shake - dt * 2.6); flash = Math.max(0, flash - dt * 3);
  camera(dt); sync(); draw(now);
  go();
}
function go() { if (!raf && visible && !document.hidden && (playing || shake || flash || floaters.length)) raf = requestAnimationFrame(frame); }
function paint() { if (!raf) { sync(); draw(performance.now()); } }

// ---------------------------------------------------------------- controls
function setPlaying(p) {
  playing = p; prev = 0;
  ui.play.dataset.s = p ? "pause" : "play"; ui.play.setAttribute("aria-label", p ? "Pause" : "Play");
  go(); paint();
}
function seek(t) {
  if (ending) { ending = false; ui.sum.hidden = true; root.classList.remove("won", "lost"); }
  tMkt = clamp(t, V0, V1); floaters = []; flash = 0; shake = 0; rate = rateT = autoRate(tMkt);
  if (tMkt >= V1) finish();
  snapCamera(); paint();
}
ui.play.addEventListener("click", () => {
  if (ending && reduce) { start(idx); setPlaying(true); return; }
  setPlaying(!playing);
});
ui.replay.addEventListener("click", () => { start(idx); setPlaying(true); });
ui.slow.addEventListener("click", () => { slow = !slow; ui.slow.setAttribute("aria-pressed", String(slow)); paint(); });
ui.chips.forEach((b) => b.addEventListener("click", () => { start(ROTATION.indexOf(b.dataset.k)); if (reduce && !playing) seek(V1); else setPlaying(true); }));
root.querySelectorAll(".tm-sum [data-act]").forEach((b) => b.addEventListener("click", () => {
  start(b.dataset.act === "next" ? idx + 1 : idx); if (reduce && b.dataset.act === "next") { playing = false; seek(V1); } else setPlaying(true);
}));
// timeline: click or drag to scrub, arrow keys step a second
const fromX = (e) => { const r = ui.line.getBoundingClientRect(); return V0 + clamp((e.clientX - r.left) / r.width, 0, 1) * VW; };
let drag = false;
ui.line.addEventListener("pointerdown", (e) => { drag = true; ui.line.setPointerCapture(e.pointerId); seek(fromX(e)); });
ui.line.addEventListener("pointermove", (e) => { if (drag) seek(fromX(e)); });
ui.line.addEventListener("pointerup", () => { drag = false; });
ui.line.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 5 : 1, m = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
  if (m) { e.preventDefault(); seek((ending ? V1 : tMkt) + m); }
  else if (e.key === "Home") { e.preventDefault(); seek(V0); }
  else if (e.key === "End") { e.preventDefault(); seek(V1); }
});
// crosshair
const stage = $(".tm-stage");
stage.addEventListener("pointermove", (e) => { if (e.pointerType !== "mouse") return; const r = cv.getBoundingClientRect(); hover = { x: e.clientX - r.left, y: e.clientY - r.top }; paint(); });
stage.addEventListener("pointerleave", () => { hover = null; paint(); });

// ---------------------------------------------------------------- boot
palette();
document.addEventListener("gs-theme", () => { palette(); paint(); });
const pct = (t) => ((t - V0) / VW) * 100 + "%";
root.querySelectorAll(".tm-line .lb").forEach((l) => (l.style.left = pct(+l.dataset.t)));
const wd = $(".tm-line .wd"); wd.style.left = pct(-P.PRE); wd.style.width = (P.POST + P.PRE) / VW * 100 + "%";
resize();
new ResizeObserver(() => { resize(); paint(); }).observe(cv);
window.GSTerm = { event(name) { if (name && name !== eventName) { eventName = name.length > 32 ? name.slice(0, 31) + "…" : name; set(ui.ev, eventName); } } };
if (reduce) {
  // no motion until asked: one finished release, every control still works
  start(0); playing = false; ui.play.dataset.s = "play"; ui.play.setAttribute("aria-label", "Play"); seek(V1);
} else {
  start(0, -9.5);                                  // first visit: orders already armed, the number is seconds away
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; prev = 0; go(); }).observe(root);
  document.addEventListener("visibilitychange", () => { prev = 0; go(); });
  go();
}
})();
