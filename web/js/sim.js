// Release simulator shared by the hero terminal (and testable in Node).
// Market: tick-by-tick gold around a high-impact release, in points (1 pt = 0.01).
// EA: GoldenStraddler's default rules, applied tick by tick.
(function (G) {
"use strict";
const P = { PEND: 60, SL: 100, TSTART: 50, TDIST: 50, PRE: 15, POST: 60, T0: -18, TMAX: 61, DT: 0.04 };

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// legs after the release: [seconds, move in points]; each kind is one way a release can play out
function legsFor(kind, r) {
  const U = (a, b) => a + (b - a) * r(), sgn = () => (r() < 0.5 ? -1 : 1), L = [];
  let d = sgn();
  if (kind === "whipsaw") {
    const n = 6 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { L.push([U(0.22, 0.55), d * U(150, 430)]); d = -d; }
    L.push([U(2.8, 4.2), d * U(650, 1100)]); L.push([U(3, 5), -d * U(120, 260)]);
  } else if (kind === "breakout") {
    L.push([U(0.35, 0.6), d * U(480, 820)]); L.push([U(0.4, 0.7), -d * U(60, 110)]); L.push([U(2.5, 4), d * U(450, 800)]); L.push([U(3, 5), -d * U(140, 240)]);
  } else if (kind === "fakeout") {
    L.push([U(0.25, 0.45), d * U(105, 150)]); L.push([U(0.4, 0.7), -d * U(320, 460)]); L.push([U(2.2, 3.6), -d * U(600, 1000)]); L.push([U(3, 5), d * U(150, 280)]);
  } else if (kind === "grind") {
    L.push([U(0.4, 0.7), d * U(220, 340)]); for (let i = 0; i < 5; i++) L.push([U(1.2, 2.4), d * U(80, 180) * (i % 2 ? -0.55 : 1)]);
  } else {                                   // chop: the release that loses
    const n = 6 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) { L.push([U(0.45, 1.1), d * U(110, 175)]); d = -d; }
  }
  // then the market calms down for the rest of the minute
  let used = L.reduce((a, l) => a + l[0], 0);
  while (used < P.TMAX + 2) { const l = [U(3, 7), sgn() * U(20, used > 20 ? 55 : 85)]; L.push(l); used += l[0]; }
  return L;
}

function makeTicks(r, kind) {
  const N = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const legs = legsFor(kind, r), ticks = [];
  // before the release: thin, mean-reverting ticks
  let mid = 0;
  const pre = Math.round((0 - P.T0) / P.DT);
  for (let i = 0; i < pre; i++) {
    const t = Math.round((P.T0 + i * P.DT) * 1000) / 1000;
    if (r() < 0.3) mid += N() * 2.2 - mid * 0.04;
    const spread = 14 + (t > -2 ? (t + 2) * 5 : 0) + r() * 3;
    ticks.push({ t, bid: mid - spread / 2, ask: mid + spread / 2, mid });
  }
  // after: each leg is a Brownian bridge from where price is to its target, so it's jagged but lands
  let t = 0;
  for (const [dur, mv] of legs) {
    const n = Math.max(2, Math.round(dur / P.DT)), from = mid, to = mid + mv;
    const burst = Math.max(0, 1 - t / 12), sig = 1.6 + Math.abs(mv) * 0.012 + 5 * burst;
    const W = [0]; for (let k = 1; k <= n; k++) W.push(W[k - 1] + N() * sig);
    for (let k = 1; k <= n; k++) {
      const x = k / n, e = x < 1 ? 1 - Math.pow(1 - x, 1.8) : 1;
      const bt = Math.max(0, 1 - (t + k * P.DT) / 14);
      if (k < n && r() < 0.14 + 0.16 * bt) continue;                                // ticks arrive unevenly, and gap in the burst
      let m = from + mv * e + (W[k] - x * W[n]) + N() * (1 + 5 * bt);              // the path, plus tick-to-tick zigzag
      if (r() < 0.01 * bt) m += (r() < 0.5 ? -1 : 1) * (20 + r() * 45);           // a stray print
      const tt = Math.round((t + k * P.DT) * 1000) / 1000;
      const spread = 18 + 42 * Math.exp(-tt / 1.6) + r() * 5 * (1 + bt);
      ticks.push({ t: tt, bid: m - spread / 2, ask: m + spread / 2, mid: m });
      if (tt >= P.TMAX) return ticks;
    }
    mid = to; t += n * P.DT;
  }
  return ticks;
}

function trade(ticks, r) {
  const orders = [], trades = [];
  let pend = null, pos = null, armed = false, n = 0, end = P.TMAX;
  const place = (tk) => { pend = { buy: tk.ask + P.PEND, sell: tk.bid - P.PEND, t: tk.t, end: null }; orders.push(pend); };
  for (const tk of ticks) {
    const t = tk.t, burst = t >= 0 && t < 6;
    if (!armed && t >= -P.PRE) { armed = true; place(tk); }
    if (pend && !pos) {
      const slip = burst ? r() * 10 : r() * 2;
      if (tk.ask >= pend.buy) { pos = { side: 1, level: pend.buy, entry: Math.max(pend.buy, tk.ask) + slip, t, best: -1e9, trail: [], n: ++n }; pos.sl0 = pos.sl = pos.entry - P.SL; pend.end = t; pend.fill = "buy"; pend = null; }
      else if (tk.bid <= pend.sell) { pos = { side: -1, level: pend.sell, entry: Math.min(pend.sell, tk.bid) - slip, t, best: -1e9, trail: [], n: ++n }; pos.sl0 = pos.sl = pos.entry + P.SL; pend.end = t; pend.fill = "sell"; pend = null; }
    }
    if (pos && pos.t < t) {
      const px = pos.side > 0 ? tk.bid : tk.ask;
      pos.best = Math.max(pos.best, (px - pos.entry) * pos.side);
      if (pos.best >= P.TSTART) { const nsl = px - pos.side * P.TDIST; if ((nsl - pos.sl) * pos.side >= 1) { pos.sl = nsl; pos.trail.push([t, nsl]); } }
      if ((px - pos.sl) * pos.side <= 0) {
        const exit = px - pos.side * (burst ? r() * 5 : 0);
        trades.push({ ...pos, exit, te: t, res: Math.round((exit - pos.entry) * pos.side), how: pos.trail.length ? "trailing stop" : "stop loss" });
        pos = null;
        if (t < P.POST) place(tk);
      }
    }
    if (t >= P.POST && pend) { pend.end = t; pend.removed = true; pend = null; }
    if (t >= P.POST && !pos) { end = t; break; }
  }
  if (pos) { const tk = ticks[ticks.length - 1], px = pos.side > 0 ? tk.bid : tk.ask; trades.push({ ...pos, exit: px, te: tk.t, res: Math.round((px - pos.entry) * pos.side), how: "trailing stop" }); end = tk.t; }
  return { orders, trades, end, net: trades.reduce((a, x) => a + x.res, 0) };
}

// what each kind of release has to look like to be shown (keeps the rotation honest and readable)
const KINDS = {
  whipsaw: { label: "Whipsaw", win: true, ok: (s) => s.trades.length >= 6 && s.trades.length <= 15 && s.net >= 200 && s.net <= 1200 && s.trades.slice(0, 4).some((x) => x.res < 0) },
  breakout: { label: "Breakout", win: true, ok: (s) => s.trades.length >= 1 && s.trades.length <= 5 && s.net >= 350 && s.net <= 1300 },
  fakeout: { label: "Fake-out", win: true, ok: (s) => s.trades.length >= 2 && s.trades.length <= 8 && s.trades.slice(0, 2).some((x) => x.res < 0) && s.net >= 250 && s.net <= 1100 },
  grind: { label: "Slow grind", win: true, ok: (s) => s.trades.length >= 2 && s.trades.length <= 9 && s.net >= 60 && s.net <= 450 },
  chop: { label: "Choppy, a loss", win: false, ok: (s) => s.trades.length >= 4 && s.trades.length <= 10 && s.net <= -180 && s.net >= -560 },
};
const ROTATION = ["whipsaw", "breakout", "chop", "fakeout", "grind"];

function scenario(kind, seed) {
  const spec = KINDS[kind];
  for (let i = 0; i < 400; i++) {
    const r = rng((seed + i * 2654435761) | 0), ticks = makeTicks(r, kind), s = trade(ticks, r);
    if (s.end <= P.POST + 0.05 && spec.ok(s)) return { kind, label: spec.label, ticks: ticks.filter((x) => x.t <= P.TMAX), ...s };
  }
  const r = rng(seed | 0), ticks = makeTicks(r, kind).filter((x) => x.t <= P.TMAX);
  return { kind, label: spec.label, ticks, ...trade(ticks, r) };
}

G.GSSim = { P, rng, makeTicks, trade, scenario, KINDS, ROTATION };
})(typeof window !== "undefined" ? window : globalThis);
