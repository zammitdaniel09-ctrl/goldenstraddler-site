/*
 * GoldenStraddler Journal: the statistics engine.
 * One file used by the browser (window.JStats) and the server (require), so the numbers on screen and the numbers
 * the AI coach reads are always the same.
 *
 * A trade: { id, a (account), s (symbol), d (1 buy, -1 sell), v (lots), ot, ct (open/close, ms UTC), op, cp (prices),
 *   sl, tp (initial stop and target, or null), net, gross, comm, swap, fee, mae, mfe (worst and best price while open, or null),
 *   tags [ids], pb (playbook id or null), rt (rating 1-5 or null), risk (money risked, set by hand, or null) }
 */
(function (root) {
"use strict";

const DAY = 86400000;
const nz = (x) => typeof x === "number" && Number.isFinite(x);
const sum = (xs) => { let s = 0; for (const x of xs) s += x; return s; };
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const sd = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1)); };
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const quantile = (xs, q) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo); };
const round = (x, dp = 2) => (nz(x) ? Math.round(x * 10 ** dp) / 10 ** dp : null);

// ---------------------------------------------------------------- time zones: hour, weekday and date in the trader's zone
const fmtCache = new Map(), partCache = new Map();
function parts(ms, tz) {
  const key = tz + "|" + Math.floor(ms / 900000);                 // quarter-hour buckets: zone offsets only change on the quarter hour
  let p = partCache.get(key);
  if (!p) {
    let f = fmtCache.get(tz);
    if (!f) { try { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }); } catch { f = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }); } fmtCache.set(tz, f); }
    const o = {}; for (const x of f.formatToParts(new Date(Math.floor(ms / 900000) * 900000))) o[x.type] = x.value;
    p = { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(o.weekday), date: `${o.year}-${o.month}-${o.day}` };
    if (partCache.size > 200000) partCache.clear();
    partCache.set(key, p);
  }
  return p;
}
// the trading day a moment belongs to; dayStart moves the boundary (17 = days roll at 17:00 like forex)
function dayOf(ms, tz, dayStart = 0) { return parts(ms - dayStart * 3600000, tz).date; }
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SESS = [["Sydney", "Australia/Sydney", 7, 16], ["Tokyo", "Asia/Tokyo", 9, 18], ["London", "Europe/London", 8, 17], ["New York", "America/New_York", 8, 17]];
function session(ms) {
  const on = SESS.filter(([, tz, a, b]) => { const p = parts(ms, tz); return p.wd < 5 && p.h >= a && p.h < b; }).map((s) => s[0]);
  if (on.includes("London") && on.includes("New York")) return "London + New York";
  if (on.includes("Tokyo") && on.includes("London")) return "Tokyo + London";
  return on.length ? on[on.length - 1] : "Off hours";
}

// ---------------------------------------------------------------- news: which releases a symbol reacts to
const CCY = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"];
const IDX = [[/^(XAU|XAG|GOLD|SILVER|XPT|XPD|WTI|BRENT|USOIL|UKOIL|OIL|XTI|XBR|NAS|US100|USTEC|NDX|US30|DJ|DOW|WS30|US500|SPX|SP500|US2000|RUSS|BTC|ETH|DXY|USDX)/, ["USD"]],
  [/^(GER|DE30|DE40|DAX|EU50|STOXX|FRA40|CAC|ESP35|IBEX|ITA40)/, ["EUR"]], [/^(UK100|FTSE)/, ["GBP"]], [/^(JP225|JPN225|NIK|NI225)/, ["JPY"]], [/^(AUS200|ASX)/, ["AUD"]], [/^(HK50|CHINA50|CN50)/, ["CNY", "USD"]]];
const ccyCache = new Map();
function symbolCcys(sym) {
  const s = String(sym || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (ccyCache.has(s)) return ccyCache.get(s);
  let out = null;
  for (const [re, c] of IDX) if (re.test(s)) { out = c; break; }
  if (!out) { const a = s.slice(0, 3), b = s.slice(3, 6); out = [a, b].filter((x) => CCY.includes(x)); if (!out.length) out = ["USD"]; }
  ccyCache.set(s, out); return out;
}
// events: [{ t (ms UTC), c (currency), n (title) }], high impact only, sorted by t
const NEWS_BEFORE = 15 * 60000, NEWS_AFTER = 30 * 60000;
function newsFor(t, events, cover) {
  if (!events || !events.length || !cover || t.ot < cover[0] - NEWS_AFTER || t.ot > cover[1] + NEWS_BEFORE) return { news: null, ev: null };
  const cs = symbolCcys(t.s);
  let lo = 0, hi = events.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].t < t.ot - NEWS_AFTER) lo = m + 1; else hi = m; }
  let best = null;
  for (let i = lo; i < events.length && events[i].t <= t.ot + NEWS_BEFORE; i++) {
    const e = events[i]; if (!cs.includes(e.c)) continue;
    if (!best || Math.abs(e.t - t.ot) < Math.abs(best.t - t.ot)) best = e;
  }
  return best ? { news: true, ev: { n: best.n, c: best.c, t: best.t, min: Math.round((t.ot - best.t) / 60000) } } : { news: false, ev: null };
}

// ---------------------------------------------------------------- per-trade numbers
// money per 1.0 price unit per lot, learned from trades that moved; lets a stop distance become money at risk
function valueModel(trades) {
  const by = new Map();
  for (const t of trades) {
    const mv = (t.cp - t.op) * t.d;
    if (!nz(mv) || Math.abs(mv) < 1e-12 || !nz(t.gross) || !(t.v > 0)) continue;
    const k = t.gross / (mv * t.v);
    if (!(k > 0) || !Number.isFinite(k)) continue;
    (by.get(t.s) || by.set(t.s, []).get(t.s)).push(k);
  }
  const out = new Map(); for (const [s, ks] of by) out.set(s, median(ks));
  return out;
}
function enrich(trades, opts = {}) {
  const tz = opts.tz || "UTC", ds = opts.dayStart || 0, vm = valueModel(trades);
  const evs = opts.events && opts.events.length ? opts.events : null, cover = evs ? [evs[0].t, evs[evs.length - 1].t] : null;
  const out = trades.map((t) => {
    const k = vm.get(t.s), risk = nz(t.risk) && t.risk > 0 ? t.risk : nz(t.sl) && t.sl > 0 && k ? Math.abs(t.op - t.sl) * k * t.v : null;
    const r = risk ? t.net / risk : null, cost = -((t.comm || 0) + (t.swap || 0) + (t.fee || 0));   // positive = paid
    const kv = k && t.v ? k * t.v : null;                       // money per 1.0 price unit for this trade
    const maeM = nz(t.mae) && kv ? -Math.abs(t.op - t.mae) * kv : null, mfeM = nz(t.mfe) && kv ? Math.abs(t.mfe - t.op) * kv : null;
    const p = parts(t.ot, tz), nw = evs ? newsFor(t, evs, cover) : { news: null, ev: null };
    return { ...t, news: nw.news, ev: nw.ev, dur: Math.max(0, t.ct - t.ot), day: dayOf(t.ct, tz, ds), oday: dayOf(t.ot, tz, ds), hour: p.h, wd: p.wd, month: `${p.y}-${String(p.m).padStart(2, "0")}`,
      riskM: risk, r, cost, maeM, mfeM, maeR: maeM != null && risk ? maeM / risk : null, mfeR: mfeM != null && risk ? mfeM / risk : null,
      win: t.net > (opts.be || 0), loss: t.net < -(opts.be || 0) };
  }).sort((a, b) => a.ct - b.ct || (a.id < b.id ? -1 : 1));
  // sequence context: the result of the trade before, the streak going in, and the trade number in its day
  let streak = 0, prev = null, dayN = new Map();
  for (const t of out) {
    t.prevRes = prev ? (prev.win ? "win" : prev.loss ? "loss" : "be") : null;
    t.streakIn = streak;
    t.gapMin = prev ? Math.max(0, (t.ot - prev.ct) / 60000) : null;
    t.sizeUp = prev && prev.v > 0 ? t.v / prev.v : null;
    const n = (dayN.get(t.oday) || 0) + 1; dayN.set(t.oday, n); t.nInDay = n;
    streak = t.win ? (streak > 0 ? streak + 1 : 1) : t.loss ? (streak < 0 ? streak - 1 : -1) : streak;
    prev = t;
  }
  return out;
}

// ---------------------------------------------------------------- the summary every view starts from
function equity(trades, start = 0) {
  let eq = start, peak = start, maxDD = 0, maxDDpct = 0, ddStart = null, longest = 0, curStart = null;
  const pts = [];
  for (const t of trades) {
    eq += t.net;
    if (eq > peak) { peak = eq; if (curStart != null) longest = Math.max(longest, t.ct - curStart); curStart = null; }
    else if (curStart == null && eq < peak) curStart = t.ct;
    const dd = peak - eq; if (dd > maxDD) { maxDD = dd; ddStart = t.ct; }
    if (peak > 0) maxDDpct = Math.max(maxDDpct, dd / peak);
    pts.push({ t: t.ct, eq, dd: -dd });
  }
  if (curStart != null && trades.length) longest = Math.max(longest, trades[trades.length - 1].ct - curStart);
  return { pts, end: eq, peak, maxDD, maxDDpct: start > 0 ? maxDDpct : null, longestDD: longest };
}
function days(trades) {
  const m = new Map();
  for (const t of trades) { const d = m.get(t.day) || { day: t.day, net: 0, n: 0, wins: 0, losses: 0, gross: 0, cost: 0, r: 0, rn: 0 }; d.net += t.net; d.n++; d.gross += t.gross || 0; d.cost += t.cost || 0; if (t.win) d.wins++; if (t.loss) d.losses++; if (t.r != null) { d.r += t.r; d.rn++; } m.set(t.day, d); }
  return [...m.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}
function streaks(trades) {
  let w = 0, l = 0, mw = 0, ml = 0, mwNet = 0, mlNet = 0, cw = 0, cl = 0;
  for (const t of trades) {
    if (t.win) { w++; cw += t.net; l = 0; cl = 0; if (w > mw) { mw = w; } mwNet = Math.max(mwNet, cw); }
    else if (t.loss) { l++; cl += t.net; w = 0; cw = 0; if (l > ml) { ml = l; } mlNet = Math.min(mlNet, cl); }
  }
  const last = trades[trades.length - 1], cur = last ? (last.win ? w : last.loss ? -l : 0) : 0;
  return { maxWin: mw, maxLoss: ml, current: cur, bestRun: mwNet, worstRun: mlNet };
}
// runs test: do wins and losses cluster (negative Z) or alternate (positive Z) more than chance?
function zScore(trades) {
  const xs = trades.filter((t) => t.win || t.loss); const n = xs.length; if (n < 20) return null;
  const W = xs.filter((t) => t.win).length, L = n - W; if (!W || !L) return null;
  let R = 1; for (let i = 1; i < n; i++) if (xs[i].win !== xs[i - 1].win) R++;
  const P = 2 * W * L, den = Math.sqrt((P * (P - n)) / (n - 1));
  return den ? (n * (R - 0.5) - P) / den : null;
}
function summary(trades, opts = {}) {
  const n = trades.length, start = opts.start || 0;
  const wins = trades.filter((t) => t.win), losses = trades.filter((t) => t.loss), be = n - wins.length - losses.length;
  const gp = sum(wins.map((t) => t.net)), gl = -sum(losses.map((t) => t.net)), net = sum(trades.map((t) => t.net));
  const avgW = wins.length ? gp / wins.length : 0, avgL = losses.length ? gl / losses.length : 0;
  const rs = trades.filter((t) => t.r != null).map((t) => t.r), eq = equity(trades, start), dl = days(trades);
  const dnet = dl.map((d) => d.net), costs = sum(trades.map((t) => t.cost || 0)), grossAbs = sum(trades.map((t) => Math.abs(t.gross || 0)));
  const wr = n ? wins.length / (wins.length + losses.length || 1) : 0, payoff = avgL ? avgW / avgL : null;
  const kelly = payoff ? wr - (1 - wr) / payoff : null;
  const sqnR = rs.length >= 10 ? (Math.sqrt(Math.min(100, rs.length)) * mean(rs)) / (sd(rs) || Infinity) : null;
  const span = n ? Math.max(1, (trades[n - 1].ct - trades[0].ot) / DAY) : 0;
  const dailySd = sd(dnet), downside = Math.sqrt(mean(dnet.map((x) => Math.min(0, x) ** 2)));
  const bestDay = dl.length ? dl.reduce((a, b) => (b.net > a.net ? b : a)) : null, worstDay = dl.length ? dl.reduce((a, b) => (b.net < a.net ? b : a)) : null;
  const posDays = dl.filter((d) => d.net > 0), profitDays = sum(posDays.map((d) => d.net));
  const holdW = wins.length ? mean(wins.map((t) => t.dur)) : null, holdL = losses.length ? mean(losses.map((t) => t.dur)) : null;
  const mfeT = wins.filter((t) => t.mfeM != null && t.mfeM > 0);                      // winners: how much of the best open profit was kept
  return {
    n, wins: wins.length, losses: losses.length, be, winRate: wr, net, grossProfit: gp, grossLoss: gl, pf: gl ? gp / gl : gp ? Infinity : null,
    avgWin: avgW, avgLoss: avgL, payoff, expectancy: n ? net / n : 0, expR: rs.length ? mean(rs) : null, rN: rs.length, sdR: rs.length > 1 ? sd(rs) : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.net)) : 0, largestLoss: losses.length ? Math.min(...losses.map((t) => t.net)) : 0,
    avgHold: n ? mean(trades.map((t) => t.dur)) : 0, holdWin: holdW, holdLoss: holdL,
    maxDD: eq.maxDD, maxDDpct: eq.maxDDpct, longestDD: eq.longestDD, recovery: eq.maxDD ? net / eq.maxDD : null,
    streak: streaks(trades), z: zScore(trades), kelly, sqn: sqnR,
    days: dl.length, greenDays: posDays.length, dayWinRate: dl.length ? posDays.length / dl.length : 0, avgDay: dl.length ? mean(dnet) : 0, sdDay: dailySd,
    bestDay, worstDay, sharpe: dailySd ? (mean(dnet) / dailySd) * Math.sqrt(252) : null, sortino: downside ? (mean(dnet) / downside) * Math.sqrt(252) : null,
    consistency: profitDays > 0 && bestDay && bestDay.net > 0 ? bestDay.net / profitDays : null,           // share of all green-day profit made on the best day
    tradesPerDay: dl.length ? n / dl.length : 0, perWeek: span ? (n / span) * 7 : 0,
    costs, costShare: grossAbs ? costs / grossAbs : 0, volume: sum(trades.map((t) => t.v || 0)),
    captured: mfeT.length ? mean(mfeT.map((t) => Math.max(0, Math.min(1, t.net / t.mfeM)))) : null, mfeN: mfeT.length,
    from: n ? trades[0].ot : null, to: n ? trades[n - 1].ct : null, end: start + net, start,
    returnPct: start > 0 ? net / start : null,
  };
}

// ---------------------------------------------------------------- breakdowns by any dimension
const DUR = [[0, "Under 1 min"], [60e3, "1 to 5 min"], [300e3, "5 to 15 min"], [900e3, "15 to 60 min"], [3600e3, "1 to 4 hours"], [14400e3, "4 to 24 hours"], [DAY, "1 to 7 days"], [7 * DAY, "Over a week"]];
const durLabel = (ms) => { let l = DUR[0][1]; for (const [m, n] of DUR) if (ms >= m) l = n; return l; };
const R_B = [[-Infinity, "Below −2R"], [-2, "−2R to −1R"], [-1, "−1R to 0"], [0, "0 to 1R"], [1, "1R to 2R"], [2, "2R to 3R"], [3, "Over 3R"]];
const rLabel = (r) => { let l = R_B[0][1]; for (const [m, n] of R_B) if (r >= m) l = n; return l; };
const DIMS = {
  symbol: { label: "Symbol", key: (t) => t.s },
  side: { label: "Direction", key: (t) => (t.d > 0 ? "Long" : "Short") },
  weekday: { label: "Weekday", key: (t) => WD[t.wd], order: WD },
  hour: { label: "Hour opened", key: (t) => String(t.hour).padStart(2, "0") + ":00", order: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00") },
  session: { label: "Session", key: (t) => session(t.ot), order: ["Sydney", "Tokyo", "Tokyo + London", "London", "London + New York", "New York", "Off hours"] },
  month: { label: "Month", key: (t) => t.month },
  duration: { label: "Time in trade", key: (t) => durLabel(t.dur), order: DUR.map((x) => x[1]) },
  rbucket: { label: "Result in R", key: (t) => (t.r == null ? null : rLabel(t.r)), order: R_B.map((x) => x[1]) },
  account: { label: "Account", key: (t) => t.a },
  playbook: { label: "Setup", key: (t) => t.pb || "No setup" },
  tag: { label: "Tag", multi: (t) => (t.tags && t.tags.length ? t.tags : ["Untagged"]) },
  rating: { label: "Your rating", key: (t) => (t.rt ? "★".repeat(t.rt) : "Not rated"), order: ["★", "★★", "★★★", "★★★★", "★★★★★", "Not rated"] },
  after: { label: "After the previous trade", key: (t) => (t.prevRes === "win" ? "After a win" : t.prevRes === "loss" ? "After a loss" : t.prevRes === "be" ? "After breakeven" : "First trade"), order: ["After a win", "After a loss", "After breakeven", "First trade"] },
  streakIn: { label: "Losing streak going in", key: (t) => (t.streakIn >= 0 ? "No losing streak" : t.streakIn === -1 ? "After 1 loss" : t.streakIn === -2 ? "After 2 losses" : "After 3+ losses"), order: ["No losing streak", "After 1 loss", "After 2 losses", "After 3+ losses"] },
  nInDay: { label: "Trade number in the day", key: (t) => (t.nInDay >= 5 ? "5th or later" : ["", "1st", "2nd", "3rd", "4th"][t.nInDay]), order: ["1st", "2nd", "3rd", "4th", "5th or later"] },
  size: { label: "Position size", key: (t) => sizeLabel(t.v) },
  news: { label: "High-impact news", key: (t) => (t.news === true ? "Around news" : t.news === false ? "Away from news" : "No news data"), order: ["Around news", "Away from news", "No news data"] },
  event: { label: "Release", key: (t) => (t.ev ? eventName(t.ev.n, t.ev.c) : null) },
};
// short names for the releases traders know by name
const EVN = [[/non-?farm|nfp/i, "Non-Farm Payrolls"], [/^core cpi/i, "Core CPI"], [/^cpi|consumer price/i, "CPI"], [/fomc|federal funds|rate decision|interest rate|cash rate|bank rate|refinancing|policy rate/i, "Rate decision"], [/press conference/i, "Press conference"],
  [/core pce/i, "Core PCE"], [/gdp/i, "GDP"], [/ppi|producer price/i, "PPI"], [/retail sales/i, "Retail Sales"], [/ism.*services|services pmi/i, "Services PMI"], [/ism.*manufactur|manufacturing pmi/i, "Manufacturing PMI"],
  [/unemployment claims|jobless/i, "Jobless Claims"], [/unemployment rate/i, "Unemployment Rate"], [/employment change/i, "Employment Change"], [/jolts/i, "JOLTS"], [/minutes/i, "Minutes"], [/speaks|testif/i, "Speech"]];
function eventName(n, c) { for (const [re, v] of EVN) if (re.test(n)) return (c && c !== "USD" ? c + " " : "") + v; return (c && c !== "USD" ? c + " " : "") + String(n || "Release").slice(0, 40); }
const SIZES = [[0, "Under 0.05 lots"], [0.05, "0.05 to 0.2"], [0.2, "0.2 to 0.5"], [0.5, "0.5 to 1"], [1, "1 to 3"], [3, "3 lots or more"]];
const sizeLabel = (v) => { let l = SIZES[0][1]; for (const [m, n] of SIZES) if (v >= m) l = n; return l; };
function group(trades, dim, opts = {}) {
  const D = DIMS[dim]; if (!D) throw new Error("unknown dimension " + dim);
  const m = new Map();
  for (const t of trades) {
    const ks = D.multi ? D.multi(t) : [D.key(t)];
    for (const k of ks) { if (k == null) continue; (m.get(k) || m.set(k, []).get(k)).push(t); }
  }
  let rows = [...m.entries()].map(([k, ts]) => ({ key: k, ...lite(ts) }));
  if (D.order) rows.sort((a, b) => D.order.indexOf(a.key) - D.order.indexOf(b.key));
  else if (dim === "month") rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  else rows.sort((a, b) => b.n - a.n);
  return { dim, label: D.label, rows };
}
// the compact numbers each breakdown row needs
function lite(ts) {
  const w = ts.filter((t) => t.win), l = ts.filter((t) => t.loss), gp = sum(w.map((t) => t.net)), gl = -sum(l.map((t) => t.net)), rs = ts.filter((t) => t.r != null).map((t) => t.r);
  return { n: ts.length, wins: w.length, losses: l.length, winRate: w.length + l.length ? w.length / (w.length + l.length) : 0, net: sum(ts.map((t) => t.net)), pf: gl ? gp / gl : gp ? Infinity : null,
    expectancy: ts.length ? sum(ts.map((t) => t.net)) / ts.length : 0, expR: rs.length ? mean(rs) : null, avgWin: w.length ? gp / w.length : 0, avgLoss: l.length ? gl / l.length : 0 };
}
// hour x weekday grid for the heatmap
function heat(trades) {
  const g = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, net: 0, wins: 0, losses: 0 })));
  for (const t of trades) { const c = g[t.wd][t.hour]; c.n++; c.net += t.net; if (t.win) c.wins++; if (t.loss) c.losses++; }
  return g;
}
function histogram(values, bins = 20) {
  const xs = values.filter(nz); if (!xs.length) return [];
  let lo = quantile(xs, 0.01), hi = quantile(xs, 0.99); if (lo === hi) { lo -= 1; hi += 1; }
  const w = (hi - lo) / bins, out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, n: 0 }));
  for (const x of xs) { const i = Math.max(0, Math.min(bins - 1, Math.floor((x - lo) / w))); out[i].n++; }
  return out;
}

// ---------------------------------------------------------------- risk: stops, excursions and what a different stop would have done
function excursions(trades) {
  const ts = trades.filter((t) => t.maeR != null && t.mfeR != null);
  if (ts.length < 5) return null;
  const winners = ts.filter((t) => t.win), losers = ts.filter((t) => t.loss);
  // how many winners went against you by more than x R before working out
  const deep = [0.25, 0.5, 0.75, 1].map((x) => ({ x, winners: winners.length ? winners.filter((t) => -t.maeR >= x).length / winners.length : 0 }));
  // losers that were in profit by at least 1R at some point
  const gaveBack = losers.filter((t) => t.mfeR >= 1).length;
  return { n: ts.length, maeWinMedian: winners.length ? median(winners.map((t) => -t.maeR)) : null, mfeLossMedian: losers.length ? median(losers.map((t) => t.mfeR)) : null,
    deep, gaveBack, gaveBackShare: losers.length ? gaveBack / losers.length : 0, efficiency: winners.length ? median(winners.map((t) => (t.mfeR > 0 ? t.r / t.mfeR : 0))) : null,
    points: ts.map((t) => ({ id: t.id, mae: t.maeR, mfe: t.mfeR, r: t.r, win: t.win })) };
}

// ---------------------------------------------------------------- the future, resampled: Monte Carlo on your own trades
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function monteCarlo(trades, opts = {}) {
  const nets = trades.map((t) => t.net); if (nets.length < 10) return null;
  const runs = opts.runs || 1000, len = opts.len || Math.min(500, Math.max(50, nets.length)), start = opts.start || 0, rand = rng(opts.seed || 7);
  const ruinAt = opts.ruin != null ? opts.ruin : start > 0 ? start * 0.5 : null;
  const finals = [], dds = [], paths = []; let ruined = 0;
  for (let r = 0; r < runs; r++) {
    let eq = start, peak = start, dd = 0, hit = false; const keep = r < 60, path = keep ? [eq] : null;
    for (let i = 0; i < len; i++) {
      eq += nets[Math.floor(rand() * nets.length)];
      if (eq > peak) peak = eq; dd = Math.max(dd, peak - eq);
      if (ruinAt != null && !hit && start - eq >= ruinAt) hit = true;
      if (keep && (i % Math.ceil(len / 100) === 0 || i === len - 1)) path.push(eq);
    }
    if (hit) ruined++;
    finals.push(eq - start); dds.push(dd); if (keep) paths.push(path);
  }
  const q = (xs, p) => quantile(xs, p);
  return { runs, len, start, final: { p5: q(finals, 0.05), p25: q(finals, 0.25), p50: q(finals, 0.5), p75: q(finals, 0.75), p95: q(finals, 0.95) }, lossChance: finals.filter((x) => x < 0).length / runs,
    dd: { p50: q(dds, 0.5), p95: q(dds, 0.95), worst: Math.max(...dds) }, ruin: ruinAt != null ? { at: ruinAt, chance: ruined / runs } : null, paths };
}

// ---------------------------------------------------------------- discipline: your own rules, checked against what you did
function rules(trades, R = {}) {
  const out = [], dl = days(trades), byDay = new Map();
  for (const t of trades) (byDay.get(t.oday) || byDay.set(t.oday, []).get(t.oday)).push(t);
  if (nz(R.maxDailyLoss) && R.maxDailyLoss > 0) for (const d of dl) if (d.net <= -R.maxDailyLoss) out.push({ rule: "maxDailyLoss", day: d.day, value: d.net, text: `Lost ${Math.abs(d.net).toFixed(2)} in the day, over your daily limit of ${R.maxDailyLoss}.` });
  if (nz(R.maxTrades) && R.maxTrades > 0) for (const [day, ts] of byDay) if (ts.length > R.maxTrades) out.push({ rule: "maxTrades", day, value: ts.length, text: `${ts.length} trades in the day, over your limit of ${R.maxTrades}.`, ids: ts.slice(R.maxTrades).map((t) => t.id) });
  if (nz(R.maxRisk) && R.maxRisk > 0) for (const t of trades) if (t.riskM != null && t.riskM > R.maxRisk * 1.0001) out.push({ rule: "maxRisk", day: t.oday, value: t.riskM, text: `Risked ${t.riskM.toFixed(2)} on ${t.s}, over your limit of ${R.maxRisk}.`, ids: [t.id] });
  if (R.requireStop) for (const t of trades) if (!(t.sl > 0) && !(t.risk > 0)) out.push({ rule: "requireStop", day: t.oday, text: `${t.s} opened without a stop loss.`, ids: [t.id] });
  if (nz(R.stopAfterLosses) && R.stopAfterLosses > 0) for (const [day, ts] of byDay) {
    let run = 0, flagged = false;
    for (const t of ts.sort((a, b) => a.ot - b.ot)) { if (run >= R.stopAfterLosses && !flagged) { out.push({ rule: "stopAfterLosses", day, text: `Kept trading after ${run} losses in a row.`, ids: [t.id] }); flagged = true; } run = t.loss ? run + 1 : 0; }
  }
  if (R.hours && /^\d\d:\d\d-\d\d:\d\d$/.test(R.hours)) {
    const [a, b] = R.hours.split("-").map((x) => +x.slice(0, 2) * 60 + +x.slice(3)), inside = (m) => (a <= b ? m >= a && m < b : m >= a || m < b);
    for (const t of trades) { const p = parts(t.ot, R.tz || "UTC"), m = p.h * 60 + (new Date(t.ot).getUTCMinutes()); if (!inside(m)) out.push({ rule: "hours", day: t.oday, text: `${t.s} opened outside your hours (${R.hours}).`, ids: [t.id] }); }
  }
  if (nz(R.revengeMin) && R.revengeMin > 0) for (const t of trades) if (t.prevRes === "loss" && t.gapMin != null && t.gapMin < R.revengeMin && t.sizeUp != null && t.sizeUp > 1.01) out.push({ rule: "revenge", day: t.oday, text: `Bigger ${t.s} trade ${t.gapMin < 1 ? "under a minute" : Math.round(t.gapMin) + " min"} after a loss.`, ids: [t.id] });
  const broken = new Set(out.flatMap((v) => v.ids || [])), dayBad = new Set(out.map((v) => v.day));
  const cleanDays = dl.filter((d) => !dayBad.has(d.day)).length;
  return { list: out.sort((x, y) => (x.day < y.day ? 1 : -1)), score: dl.length ? Math.round((cleanDays / dl.length) * 100) : null, cleanDays, days: dl.length, brokenTrades: broken.size,
    cost: sum(trades.filter((t) => broken.has(t.id)).map((t) => t.net)) };
}

// ---------------------------------------------------------------- filters, shared by the screen and the AI coach
function filter(trades, f = {}) {
  const tags = f.tags && f.tags.length ? new Set(f.tags) : null, syms = f.symbols && f.symbols.length ? new Set(f.symbols.map((s) => String(s).toUpperCase())) : null;
  return trades.filter((t) => {
    if (f.account && t.a !== f.account) return false;
    if (f.from && t.ct < f.from) return false;
    if (f.to && t.ct >= f.to) return false;
    if (syms && !syms.has(String(t.s).toUpperCase())) return false;
    if (f.side === "long" && t.d < 0) return false;
    if (f.side === "short" && t.d > 0) return false;
    if (f.outcome === "win" && !t.win) return false;
    if (f.outcome === "loss" && !t.loss) return false;
    if (tags && !(t.tags || []).some((x) => tags.has(x))) return false;
    if (f.playbook && t.pb !== f.playbook) return false;
    if (f.weekday != null && f.weekday !== "" && t.wd !== +f.weekday) return false;
    if (f.hourFrom != null && t.hour < f.hourFrom) return false;
    if (f.hourTo != null && t.hour > f.hourTo) return false;
    if (f.minR != null && (t.r == null || t.r < f.minR)) return false;
    if (f.maxR != null && (t.r == null || t.r > f.maxR)) return false;
    if (f.news === "yes" && t.news !== true) return false;
    if (f.news === "no" && t.news !== false) return false;
    if (f.q) { const q = String(f.q).toLowerCase(); if (!(String(t.s).toLowerCase().includes(q) || String(t.note || "").toLowerCase().includes(q) || String(t.id).includes(q))) return false; }
    return true;
  });
}

const RULE_NAMES = { maxDailyLoss: "Daily loss limit", maxTrades: "Max trades a day", maxRisk: "Max risk per trade", requireStop: "Stop loss on every trade", stopAfterLosses: "Stop after losses in a row", hours: "Trading hours", revenge: "Revenge trades" };
// prop-firm style limits for one account, checked on closed trades: daily loss, max drawdown, profit target, trading days, best-day share
function limits(trades, L = {}, start = 0, tz = "UTC") {
  if (!L || !Object.values(L).some((v) => v)) return null;
  const amt = (v, pct) => (v == null || v === "" ? null : pct ? (start * Number(v)) / 100 : Number(v));
  const dl = days(trades), eq = equity(trades, start), today = dayOf(Date.now(), tz), td = dl.find((d) => d.day === today);
  const out = [];
  const dailyCap = amt(L.dailyLoss, L.dailyLossPct);
  if (dailyCap > 0) { const worst = dl.reduce((m, d) => Math.min(m, d.net), 0); out.push({ k: "daily", label: "Daily loss limit", cap: dailyCap, today: td ? Math.min(0, td.net) : 0, worst, breached: dl.some((d) => d.net <= -dailyCap), used: td ? Math.max(0, -td.net) / dailyCap : 0 }); }
  const ddCap = amt(L.maxDD, L.maxDDPct);
  if (ddCap > 0) {
    // static: measured from the starting balance; trailing: from the highest closed balance
    let peak = start, bal = start, worstStatic = 0, worstTrail = 0;
    for (const t of trades) { bal += t.net; peak = Math.max(peak, bal); worstStatic = Math.max(worstStatic, start - bal); worstTrail = Math.max(worstTrail, peak - bal); }
    const trailing = !!L.trailing, nowDD = trailing ? peak - bal : Math.max(0, start - bal), worst = trailing ? worstTrail : worstStatic;
    out.push({ k: "dd", label: trailing ? "Max drawdown (trailing)" : "Max drawdown", cap: ddCap, now: nowDD, worst, breached: worst >= ddCap, used: nowDD / ddCap, room: ddCap - nowDD });
  }
  const target = amt(L.target, L.targetPct);
  if (target > 0) out.push({ k: "target", label: "Profit target", cap: target, now: eq.end - start, used: Math.max(0, eq.end - start) / target, done: eq.end - start >= target });
  if (L.minDays > 0) out.push({ k: "days", label: "Trading days", cap: Number(L.minDays), now: dl.length, used: dl.length / L.minDays, done: dl.length >= L.minDays });
  if (L.consistency > 0) { const pos = dl.filter((d) => d.net > 0), tot = sum(pos.map((d) => d.net)), best = pos.reduce((m, d) => Math.max(m, d.net), 0), share = tot > 0 ? best / tot : 0;
    out.push({ k: "cons", label: "Best day's share of profit", cap: L.consistency / 100, now: share, used: share / (L.consistency / 100), breached: share > L.consistency / 100 && tot > 0 }); }
  return out;
}
const API = { DAY, DIMS, WD, RULE_NAMES, nz, sum, mean, sd, median, quantile, round, parts, dayOf, session, symbolCcys, eventName, enrich, summary, equity, days, streaks, group, lite, heat, histogram, excursions, monteCarlo, rules, limits, filter, valueModel };
if (typeof module !== "undefined" && module.exports) module.exports = API; else root.JStats = API;
})(typeof window !== "undefined" ? window : globalThis);
