// "Watch it trade a release": phone-screen replays. Our real 2 October recording, the same prices traded
// with today's rules, and simulated releases traded by the same rules (window.GS_REPLAYS, replay-data.js).
(() => {
"use strict";
const root = document.getElementById("rp");
const DATA = window.GS_REPLAYS;
if (!root || !DATA || !DATA.list || !DATA.list.length) return;
const $ = (s, el = root) => el.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SLOTS = 24, MARGIN = 3;
const LIST = DATA.list;
let CP = DATA.candle, USD = DATA.usdPerPoint, T0 = 14 * 3600 + 29 * 60, LOTS = "0.1";   // set per scenario in setupScenario()

// ---------------------------------------------------------------- helpers
const clock = (ms, sec = true) => { const s = T0 + ms / 1000, h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = Math.floor(s) % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + (sec ? ":" + String(x).padStart(2, "0") : ""); };
const px = (c) => (c / 100).toFixed(2);
const money = (v, ascii) => (v < 0 ? (ascii ? "-" : "−") : "+") + (ascii ? "" : "$") + Math.abs(v).toFixed(2);
const whole = (v) => (v < 0 ? "−" : "+") + "$" + Math.round(Math.abs(v)).toLocaleString("en-US");
const glue = (x) => x.replace(/([−+])\$/g, "$1⁠$$");   // keep the sign with the amount when a line wraps
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const KIND = {
  recorded: { badge: "Screen recording, 2 Oct", tag: "Screen recording", cls: "k-rec" },
  simreal: { badge: "Real prices, today's settings, simulated trades", tag: "Simulated on real prices", cls: "k-simreal" },
  simrec: { badge: "Real prices from our screen recording, today's rules, simulated trades", tag: "Simulated on real prices", cls: "k-simreal" },
  sim: { badge: "Simulated release", tag: "Simulated release", cls: "k-sim" },
};

// decoded scenario (built when it's first shown)
const cache = new Map();
function scenario(i) {
  if (cache.has(i)) return cache.get(i);
  const D = LIST[i], T = [], B = [], A = [];
  let t = 0, b = 0;
  for (let k = 0; k < D.ticks.length; k += 3) { t += D.ticks[k]; b += D.ticks[k + 1]; T.push(t); B.push(b); A.push(b + D.ticks[k + 2]); }
  const sc = { D, T, B, A, N: T.length, notes: D.notes.map(([t2, x]) => [t2, glue(x)]),
    net: Math.round(D.trades.reduce((s, tr) => s + tr.pl, 0) * 100) / 100, won: D.trades.filter((tr) => tr.pl > 0).length };
  cache.set(i, sc);
  return sc;
}
let S = scenario(0), cur = 0;
const lastAt = (t) => { const T = S.T; let lo = 0, hi = S.N - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const plOf = (tr, bid, ask) => ((tr.s === "b" ? bid - tr.en : tr.en - ask) * USD) / 100;
const slOf = (tr, t) => { let v = tr.sl[0][1]; for (const [a, p] of tr.sl) if (a <= t) v = p; return v; };

// ---------------------------------------------------------------- dom
const ui = {
  phone: $(".rp-phone"), chart: $(".ph-chart"), cv: $(".ph-chart canvas"), time: $(".ph-time"), rec: $(".ph-rec"), tag: $(".ph-tag"), cap: $(".rp-cap"), capT: $(".rp-cap span"),
  note: $(".ph-note"), noteT: $(".ph-note b"), noteD: $(".ph-note span"),
  sell: $(".q.sell"), buy: $(".q.buy"), sellP: $(".q.sell .num"), buyP: $(".q.buy .num"),
  end: $(".rp-end"), endH: $(".rp-end .e-h"), endNet: $(".rp-end .e-net"), endN: $(".rp-end .e-n"), again: $(".rp-again"), next: $(".rp-next"),
  play: $(".rp-play"), restart: $(".rp-restart"), bar: $(".rp-bar"), fill: $(".rp-bar .fl"), head: $(".rp-bar .hd"), marks: $(".rp-bar .mk"),
  clk: $(".rp-clk"), speeds: [...root.querySelectorAll(".rp-speed button")], picks: $(".rp-picks"),
  title: $(".rp-title"), badge: $(".rp-badge"), desc: $(".rp-desc"), fine: $(".rp-fine"),
  closed: $('[data-l="closed"]'), open: $('[data-l="open"]'), count: $('[data-l="n"]'), notes: $(".rp-notes"),
};
const cx = ui.cv.getContext("2d");

// scenario picker
const IDX = LIST.map((d, i) => [d, i]);
ui.picks.innerHTML = [["2 Oct payrolls", IDX.filter(([d]) => d.kind === "recorded" || d.kind === "simreal")], ["Our other recordings", IDX.filter(([d]) => d.kind === "simrec")], ["Simulated releases", IDX.filter(([d]) => d.kind === "sim")]]
  .filter(([, items]) => items.length)
  .map(([h, items]) => `<div class="rp-grp" role="group" aria-label="${h}"><span class="rp-gh">${h}</span>${items.map(([d, i]) => {
    const net = Math.round(d.trades.reduce((s, tr) => s + tr.pl, 0));
    return `<button type="button" data-i="${i}" aria-pressed="${i === 0}">${esc(d.chip)} <span class="${net >= 0 ? "up" : "dn"}">${whole(net)}</span></button>`; }).join("")}</div>`).join("");
const pickBtns = [...ui.picks.querySelectorAll("button")];

let noteEls = [];
function setupScenario(i) {
  cur = i; S = scenario(i);
  const D = S.D, k = KIND[D.kind];
  CP = D.candle || DATA.candle; USD = D.usd || DATA.usdPerPoint; T0 = D.t0 != null ? D.t0 : 14 * 3600 + 29 * 60; LOTS = String(D.lots || DATA.lots);
  root.querySelectorAll(".ph-tf").forEach((el) => { el.textContent = CP / 1000 + "s"; });
  speed = D.speed || 1; ui.speeds.forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.v) === speed)));
  pickBtns.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.i) === i)));
  ui.title.textContent = D.title; ui.badge.textContent = k.badge; ui.badge.className = "rp-badge " + k.cls; ui.desc.textContent = D.desc; ui.fine.textContent = D.fine;
  ui.tag.textContent = k.tag; ui.tag.className = "ph-tag " + k.cls; ui.rec.hidden = D.kind !== "recorded";
  ui.notes.innerHTML = S.notes.map(([t, x], n) => `<li data-i="${n}"><button type="button" class="num" data-t="${t}" aria-label="Jump to ${clock(t)}">${clock(t)}</button><span>${x}</span></li>`).join("");
  noteEls = [...ui.notes.children];
  const span = D.end - D.start, at = (t) => Math.max(0, Math.min(100, ((t - D.start) / span) * 100));
  let h = D.release != null ? `<i class="rel" style="left:${at(D.release)}%" title="${clock(D.release)} release"></i>` : "";
  for (const tr of D.trades) h += `<i class="${tr.pl >= 0 ? "w" : "l"}" style="left:${at(tr.out)}%"></i>`;
  ui.marks.innerHTML = h;
  const ref = D.release != null ? D.release : D.start;
  ui.bar.setAttribute("aria-label", D.release != null ? "Replay position, seconds from the release" : "Replay position, seconds from the start");
  ui.bar.setAttribute("aria-valuemin", String(Math.round((D.start - ref) / 1000)));
  ui.bar.setAttribute("aria-valuemax", String(Math.round((D.end - ref) / 1000)));
  const nx = LIST[(i + 1) % LIST.length];
  ui.endH.textContent = D.endText || (D.kind === "recorded" ? "Window closed at 14:31:00" : "Window closed at 14:30:30");
  ui.endNet.textContent = money(S.net); ui.endNet.className = "e-net num " + (S.net >= 0 ? "up" : "dn");
  ui.endN.textContent = `${D.trades.length} trades on ${LOTS} lots, ${S.won} won and ${D.trades.length - S.won} lost.` + (D.kind === "recorded" ? " The smaller trades are read off the chart and may be a few dollars out." : D.kind === "sim" ? " A simulated release." : " Simulated trades on the real prices.");
  ui.next.textContent = "Next: " + nx.chip;
  tNow = D.start; noteI = -2; lastShown = -1; snap = true; hideNote(true);
}

// ---------------------------------------------------------------- canvas
const C = { bg: "#000", grid: "rgba(255,255,255,.055)", axis: "#8b919c", up: "#26B48C", dn: "#EF5350", buy: "#4C8DFF", sell: "#FF5C61", bidTag: "#178571", askTag: "#D23A3F", rel: "#E6B450" };
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
let W = 0, H = 0, dpr = 1;
function size() {
  const r = ui.chart.getBoundingClientRect();
  dpr = Math.min(2.5, window.devicePixelRatio || 1); W = Math.max(200, r.width); H = Math.max(200, r.height);
  ui.cv.width = Math.round(W * dpr); ui.cv.height = Math.round(H * dpr); ui.cv.style.width = W + "px"; ui.cv.style.height = H + "px";
}
const AX = 60, TOP = 40, BOT = 22, CAPZ = 66;   // CAPZ: room under the chart for the commentary, so it never covers candles
let lo = 0, hi = 0, snap = true, tNow = 0;
function niceStep(range) { const raw = range / 6, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * p; }

function draw(dt) {
  const D = S.D, t = tNow, i = lastAt(t), bid = i >= 0 ? S.B[i] : S.B[0], ask = i >= 0 ? S.A[i] : S.A[0];
  const pl = 0, pr = W - AX, pt = TOP, pb = H - BOT - CAPZ, slotW = (pr - pl) / SLOTS;
  const vEnd = t + MARGIN * CP, vStart = vEnd - SLOTS * CP;
  const X = (ms) => pl + ((ms - vStart) / CP) * slotW;
  // candles in view
  const cs = [];
  let j0 = lastAt(vStart - CP); if (j0 < 0) j0 = 0;
  for (let j = j0; j <= i; j++) {
    const k = Math.floor(S.T[j] / CP), b = S.B[j];
    if ((k + 1) * CP < vStart) continue;
    let c = cs[cs.length - 1];
    if (!c || c.k !== k) { c = { k, o: b, h: b, l: b, c: b }; cs.push(c); }
    if (b > c.h) c.h = b; if (b < c.l) c.l = b; c.c = b;
  }
  const openT = D.trades.filter((tr) => tr.at <= t && t < tr.out), doneT = D.trades.filter((tr) => tr.out <= t), liveO = D.orders.filter((o) => o.from <= t && t < o.to);
  let yl = Infinity, yh = -Infinity;
  const inc = (v) => { if (v < yl) yl = v; if (v > yh) yh = v; };
  for (const c of cs) { inc(c.l); inc(c.h); }
  inc(bid); inc(ask);
  for (const o of liveO) { inc(o.p); inc(o.sl); }
  for (const tr of openT) { inc(tr.en); inc(slOf(tr, t)); }
  const pad = Math.max(30, (yh - yl) * 0.1); yl -= pad; yh += pad;
  if (snap || !hi) { lo = yl; hi = yh; snap = false; }
  else { const k = 1 - Math.exp(-(dt || 16) / 140); lo += (yl - lo) * k; hi += (yh - hi) * k; }
  const Y = (c) => pb - ((c - lo) / (hi - lo)) * (pb - pt);

  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.fillStyle = C.bg; cx.fillRect(0, 0, W, H);
  // price grid and axis
  const step = niceStep((hi - lo) / 100) * 100;
  cx.font = `11px ${FONT}`; cx.textBaseline = "middle"; cx.textAlign = "left"; cx.strokeStyle = C.grid; cx.lineWidth = 1; cx.fillStyle = C.axis;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = Math.round(Y(v)) + 0.5; if (y < pt - 4 || y > pb) continue;
    cx.beginPath(); cx.moveTo(pl, y); cx.lineTo(pr, y); cx.stroke(); cx.fillText(px(v), pr + 6, y);
  }
  // time grid, scrolling with the chart: the shortest step that leaves room for a label
  cx.textAlign = "center";
  const tStep = [10000, 15000, 20000, 30000, 60000].find((g) => (g / CP) * slotW >= 74) || 60000, toff = (T0 % 60) * 1000;
  for (let ms = Math.ceil((vStart + toff) / tStep) * tStep - toff; ms <= vEnd; ms += tStep) {
    const x = Math.round(X(ms)) + 0.5; if (x < pl + 2 || x > pr - 2) continue;
    cx.beginPath(); cx.moveTo(x, pt - 6); cx.lineTo(x, pb); cx.stroke();
    if (x > pl + 26 && x < pr - 26) cx.fillText(clock(ms), x, pb + 11);
  }
  cx.strokeStyle = "rgba(255,255,255,.18)"; cx.beginPath(); cx.moveTo(pr + 0.5, pt - 8); cx.lineTo(pr + 0.5, pb); cx.lineTo(pl, pb + 0.5); cx.stroke();

  cx.save(); cx.beginPath(); cx.rect(pl, pt - 10, pr - pl, pb - pt + 10); cx.clip();
  // the release
  if (D.release != null) { const x = Math.round(X(D.release)) + 0.5;
    if (x > pl && x < pr) { cx.save(); cx.strokeStyle = C.rel; cx.globalAlpha = 0.55; cx.setLineDash([3, 4]); cx.beginPath(); cx.moveTo(x, pt - 6); cx.lineTo(x, pb); cx.stroke(); cx.restore();
      // the event flag sits at the foot of the line, like the app's calendar marks, and stays inside the chart
      const lab = D.relLabel || (D.kind === "sim" ? "News 14:30" : "NFP 14:30"); cx.font = `600 10px ${FONT}`; const w = cx.measureText(lab).width + 10, bx = x + 4 + w > pr ? x - 4 - w : x + 4;
      cx.fillStyle = "rgba(0,0,0,.75)"; cx.fillRect(bx, pb - 19, w, 15); cx.fillStyle = C.rel; cx.textAlign = "left"; cx.textBaseline = "middle"; cx.fillText(lab, bx + 5, pb - 11.5); } }
  // candles
  const bw = Math.max(1, Math.min(16, slotW * 0.64));
  for (const c of cs) {
    const x = X(c.k * CP + CP / 2), col = c.c >= c.o ? C.up : C.dn;
    cx.strokeStyle = col; cx.fillStyle = col; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(Math.round(x) + 0.5, Y(c.h)); cx.lineTo(Math.round(x) + 0.5, Y(c.l)); cx.stroke();
    const y0 = Y(Math.max(c.o, c.c)), y1 = Y(Math.min(c.o, c.c));
    cx.fillRect(Math.round(x - bw / 2), y0, Math.round(bw), Math.max(1, y1 - y0));
  }
  // trade markers: entry and exit joined by a dashed line
  const arrow = (x, y, upw, col) => { cx.fillStyle = col; cx.beginPath();
    if (upw) { cx.moveTo(x, y + 2); cx.lineTo(x - 4.5, y + 9); cx.lineTo(x + 4.5, y + 9); } else { cx.moveTo(x, y - 2); cx.lineTo(x - 4.5, y - 9); cx.lineTo(x + 4.5, y - 9); }
    cx.closePath(); cx.fill(); };
  for (const tr of doneT) {
    if (tr.out < vStart - CP) continue;
    const x0 = X(tr.at), x1 = X(tr.out), y0 = Y(tr.en), y1 = Y(tr.ex), col = tr.s === "b" ? C.buy : C.sell;
    cx.save(); cx.strokeStyle = col; cx.globalAlpha = 0.7; cx.setLineDash([2, 3]); cx.beginPath(); cx.moveTo(x0, y0); cx.lineTo(x1, y1); cx.stroke(); cx.restore();
    arrow(x0, y0, tr.s === "b", col); arrow(x1, y1, tr.s !== "b", tr.s === "b" ? C.sell : C.buy);
  }
  for (const tr of openT) arrow(X(tr.at), Y(tr.en), tr.s === "b", tr.s === "b" ? C.buy : C.sell);
  cx.restore();

  // level lines, left labels and right tags
  const left = [], tags = [];
  const hline = (c, col, dash, alpha) => { const y = Math.round(Y(c)) + 0.5; cx.save(); cx.strokeStyle = col; cx.globalAlpha = alpha; cx.setLineDash(dash); cx.beginPath(); cx.moveTo(pl, y); cx.lineTo(pr, y); cx.stroke(); cx.restore(); return y; };
  for (const o of liveO) {
    const col = o.s === "b" ? C.buy : C.sell;
    left.push({ y: hline(o.p, col, [6, 4], 0.9), parts: [[(o.s === "b" ? "BUY" : "SELL") + " STOP " + LOTS, col]] });
    tags.push({ y: Y(o.p), text: px(o.p), col, box: true });
    left.push({ y: hline(o.sl, C.sell, [4, 4], 0.5), parts: [["SL", C.sell]] });
    tags.push({ y: Y(o.sl), text: px(o.sl), col: C.sell, box: false });
  }
  for (const tr of openT) {
    const col = tr.s === "b" ? C.buy : C.sell, v = Math.round(plOf(tr, bid, ask) * 100) / 100, sl = slOf(tr, t);
    left.push({ y: hline(tr.en, col, [8, 3], 1), parts: [[(tr.s === "b" ? "BUY" : "SELL") + " " + LOTS + ", ", col], [money(v, true) + " USD", v >= 0 ? C.buy : C.sell]] });
    tags.push({ y: Y(tr.en), text: px(tr.en), col, box: true });
    left.push({ y: hline(sl, C.sell, [4, 4], 0.6), parts: [["SL", C.sell]] });
    tags.push({ y: Y(sl), text: px(sl), col: C.sell, box: false });
  }
  const yb = hline(bid, C.bidTag, [2, 2], 0.95), ya = hline(ask, C.askTag, [2, 2], 0.85);
  cx.font = `500 11px ${FONT}`; cx.textAlign = "left"; cx.textBaseline = "alphabetic";
  left.sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  for (const L of left) { let y = Math.max(L.y - 3, prev + 12); y = Math.max(pt + 8, Math.min(pb - 2, y)); prev = y; let x = 6;
    for (const [s, col] of L.parts) { cx.fillStyle = col; cx.fillText(s, x, y); x += cx.measureText(s).width; } }
  const cd = 60 - (Math.floor(T0 + t / 1000) % 60), cdTxt = cd === 60 ? "01:00" : "00:" + String(cd).padStart(2, "0");
  const bidBox = { y0: yb - 9, y1: yb + 21 }, askBox = { y0: ya - 8, y1: ya + 8 };
  if (askBox.y1 > bidBox.y0 && askBox.y0 < bidBox.y1) { askBox.y0 = bidBox.y0 - 17; askBox.y1 = bidBox.y0 - 1; }
  const placed = [bidBox, askBox];
  tags.sort((a, b) => Math.abs(a.y - yb) - Math.abs(b.y - yb));
  for (const g of tags) { let y0 = g.y - 8, y1 = g.y + 8, guard = 0;
    for (let moved = true; moved && guard < 12; guard++) { moved = false;
      for (const p of placed) if (y1 > p.y0 && y0 < p.y1) { if (g.y < (p.y0 + p.y1) / 2) { y1 = p.y0 - 1; y0 = y1 - 16; } else { y0 = p.y1 + 1; y1 = y0 + 16; } moved = true; } }
    if (y0 < pt - 10 || y1 > pb + 6) continue;
    placed.push({ y0, y1 }); g.y0 = y0; }
  cx.textBaseline = "middle"; cx.font = `500 11px ${FONT}`;
  for (const g of tags) { if (g.y0 === undefined) continue;
    cx.fillStyle = "#000"; cx.fillRect(pr + 1, g.y0, AX - 2, 16);
    if (g.box) { cx.strokeStyle = g.col; cx.lineWidth = 1; cx.strokeRect(pr + 1.5, g.y0 + 0.5, AX - 3, 15); }
    cx.fillStyle = g.col; cx.fillText(g.text, pr + 5, g.y0 + 8.5); }
  cx.fillStyle = C.askTag; cx.fillRect(pr + 1, askBox.y0, AX - 2, 16); cx.fillStyle = "#fff"; cx.fillText(px(ask), pr + 5, askBox.y0 + 8.5);
  cx.fillStyle = C.bidTag; cx.fillRect(pr + 1, bidBox.y0, AX - 2, 30); cx.fillStyle = "#fff"; cx.fillText(px(bid), pr + 5, bidBox.y0 + 8.5);
  cx.fillStyle = "rgba(255,255,255,.78)"; cx.fillText(cdTxt, pr + 5, bidBox.y0 + 22);
  return { i, bid, ask, openT, doneT };
}

// ---------------------------------------------------------------- phone chrome, notifications and the side panel
let dir = "up", noteI = -2, lastPanel = 0, lastShown = -1, noteTimer = 0;
function hideNote(now) { clearTimeout(noteTimer); ui.note.classList.remove("on"); if (now) ui.note.hidden = true; }
let noteShown = null;
function notify(tr) {
  if (reduce) return;
  // a smaller close straight after a bigger one doesn't push the bigger one off the screen
  if (noteShown && performance.now() - noteShown.at < 1800 && Math.abs(tr.pl) < Math.abs(noteShown.pl)) return;
  noteShown = { at: performance.now(), pl: tr.pl };
  ui.noteT.textContent = `Position closed ${money(tr.pl)}`;
  ui.noteD.textContent = `${tr.s === "b" ? "Buy" : "Sell"} ${LOTS} XAUUSD, ${px(tr.en)} to ${px(tr.ex)}`;
  ui.note.classList.toggle("dn", tr.pl < 0);
  ui.note.hidden = false; void ui.note.offsetWidth; ui.note.classList.add("on");
  clearTimeout(noteTimer); noteTimer = setTimeout(() => ui.note.classList.remove("on"), 2600);
}
function chrome(st, force) {
  const { i, bid, ask, openT, doneT } = st, D = S.D;
  ui.time.textContent = clock(tNow, false);
  if (i > 0) { let j = i; while (j > 0 && S.B[j - 1] === S.B[j]) j--; dir = j > 0 && S.B[j] < S.B[j - 1] ? "dn" : "up"; }
  const split = (c) => { const s = px(c); return `${s.slice(0, -2)}<b>${s.slice(-2)}</b>`; };
  ui.sellP.innerHTML = split(bid); ui.buyP.innerHTML = split(ask);
  ui.sell.dataset.d = dir; ui.buy.dataset.d = dir;
  // a trade that closed since the last frame gets a notification (only while playing, not while scrubbing)
  if (playing && doneT.length > lastShown && lastShown >= 0) notify(doneT[doneT.length - 1]);
  lastShown = doneT.length;
  // caption: the newest note, shown for a few seconds
  const notes = S.notes;
  let ni = -1; for (let k = 0; k < notes.length; k++) if (notes[k][0] <= tNow) ni = k;
  const showCap = ni >= 0 && tNow - notes[ni][0] < Math.max(3800, notes[ni + 1] ? Math.min(notes[ni + 1][0] - notes[ni][0], 6000) : 6000) && tNow < D.end;
  if (ni !== noteI) {
    noteI = ni;
    if (ni >= 0) ui.capT.textContent = notes[ni][1];
    noteEls.forEach((el, k) => { el.classList.toggle("now", k === ni); el.classList.toggle("past", k < ni); });
    const el = noteEls[ni], box = ui.notes;
    if (el) { const want = el.offsetTop - box.offsetTop - box.clientHeight / 2 + el.clientHeight / 2; box.scrollTo({ top: Math.max(0, want), behavior: reduce || force ? "auto" : "smooth" }); }
    else box.scrollTo({ top: 0 });
  }
  ui.cap.classList.toggle("on", showCap);
  const now = performance.now();
  if (force || now - lastPanel > 100) {
    lastPanel = now;
    const closed = doneT.reduce((s, tr) => s + tr.pl, 0), open = openT.reduce((s, tr) => s + plOf(tr, bid, ask), 0), w = doneT.filter((tr) => tr.pl > 0).length;
    ui.closed.textContent = doneT.length ? money(closed) : "$0.00"; ui.closed.className = "num " + (doneT.length ? (closed >= 0 ? "up" : "dn") : "");
    ui.open.textContent = openT.length ? money(open) : "No trade"; ui.open.className = "num " + (openT.length ? (open >= 0 ? "up" : "dn") : "mu");
    ui.count.textContent = doneT.length ? `${doneT.length} (${w} won)` : "0";
  }
  const f = ((tNow - D.start) / (D.end - D.start)) * 100;
  ui.fill.style.width = f + "%"; ui.head.style.left = f + "%";
  const ref = D.release != null ? D.release : D.start;
  ui.bar.setAttribute("aria-valuenow", String(Math.round((tNow - ref) / 1000)));
  ui.bar.setAttribute("aria-valuetext", clock(tNow) + (D.release != null && tNow < D.release ? `, ${Math.ceil((D.release - tNow) / 1000)} seconds before the release` : ""));
  ui.clk.textContent = clock(tNow);
  ui.end.hidden = tNow < D.end;
}

// ---------------------------------------------------------------- playback
let playing = false, speed = 1, raf = 0, lastFrame = 0, autoStarted = false, autoPaused = false, userDriven = false, advTimer = 0;
function render(dt, force) { chrome(draw(dt), force); }
function setPlaying(on) {
  clearTimeout(advTimer);
  if (on && tNow >= S.D.end) { tNow = S.D.start; snap = true; noteI = -2; lastShown = -1; }
  playing = on; ui.play.dataset.s = on ? "play" : "pause"; ui.play.setAttribute("aria-label", on ? "Pause" : "Play");
  cancelAnimationFrame(raf);
  if (on) { lastFrame = performance.now(); if (lastShown < 0) lastShown = S.D.trades.filter((tr) => tr.out <= tNow).length; raf = requestAnimationFrame(loop); }
  render(16, true);
}
function loop(now) {
  if (!playing) return;
  const dt = Math.min(80, now - lastFrame); lastFrame = now;
  tNow += dt * speed;
  if (tNow >= S.D.end) {
    tNow = S.D.end; playing = false; ui.play.dataset.s = "pause"; ui.play.setAttribute("aria-label", "Play again"); render(dt, true);
    if (!userDriven) advTimer = setTimeout(() => { if (visible && !playing) { show((cur + 1) % LIST.length); setPlaying(true); } }, 7000);   // passive viewers get the next one
    return;
  }
  render(dt);
  raf = requestAnimationFrame(loop);
}
function seek(t, keepSnap) { tNow = Math.max(S.D.start, Math.min(S.D.end, t)); if (!keepSnap) snap = true; noteI = -2; lastShown = -1; hideNote(); render(16, true); }
function show(i) { setupScenario(i); render(16, true); }
const takeOver = () => { autoStarted = true; userDriven = true; clearTimeout(advTimer); };

ui.play.addEventListener("click", () => { takeOver(); autoPaused = false; setPlaying(!playing); });
ui.restart.addEventListener("click", () => { takeOver(); seek(S.D.start); setPlaying(true); });
ui.again.addEventListener("click", () => { takeOver(); seek(S.D.start); setPlaying(true); });
ui.next.addEventListener("click", () => { takeOver(); show((cur + 1) % LIST.length); setPlaying(true); });
ui.picks.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (!b) return; takeOver(); show(Number(b.dataset.i)); setPlaying(true); });
ui.speeds.forEach((b) => b.addEventListener("click", () => { speed = Number(b.dataset.v); ui.speeds.forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
ui.notes.addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (!b) return; takeOver(); seek(Number(b.dataset.t) - 1500); setPlaying(true); });
{
  const tAt = (e) => { const r = ui.bar.getBoundingClientRect(); return S.D.start + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (S.D.end - S.D.start); };
  let drag = false, was = false;
  ui.bar.addEventListener("pointerdown", (e) => { drag = true; was = playing; takeOver(); playing = false; cancelAnimationFrame(raf); ui.bar.setPointerCapture(e.pointerId); seek(tAt(e)); });
  ui.bar.addEventListener("pointermove", (e) => { if (drag) seek(tAt(e), true); });
  const up = () => { if (!drag) return; drag = false; if (was) setPlaying(true); else render(16, true); };
  ui.bar.addEventListener("pointerup", up); ui.bar.addEventListener("pointercancel", up);
  ui.bar.addEventListener("keydown", (e) => {
    const k = e.key, big = e.shiftKey || k === "PageUp" || k === "PageDown" ? 5000 : 1000;
    let t = null;
    if (k === "ArrowRight" || k === "ArrowUp" || k === "PageUp") t = tNow + big;
    else if (k === "ArrowLeft" || k === "ArrowDown" || k === "PageDown") t = tNow - big;
    else if (k === "Home") t = S.D.start; else if (k === "End") t = S.D.end;
    if (t === null) return;
    e.preventDefault(); takeOver(); seek(t);
  });
}

let visible = false;
new ResizeObserver(() => { size(); snap = true; render(16, true); }).observe(ui.chart);
setupScenario(0); size();
if (reduce) tNow = S.D.end;     // no autoplay: show the finished session, ready to play
render(16, true);
new IntersectionObserver((es) => {
  for (const e of es) {
    visible = e.isIntersecting;
    if (visible && !autoStarted && !reduce) { autoStarted = true; setPlaying(true); }
    else if (visible && autoPaused) { autoPaused = false; if (tNow < S.D.end) setPlaying(true); }   // never restart a finished replay on scroll
    else if (!visible && playing) { autoPaused = true; setPlaying(false); }
  }
}, { threshold: 0.45 }).observe(ui.phone);
document.addEventListener("visibilitychange", () => { if (document.hidden && playing) { autoPaused = true; setPlaying(false); } });
root.seekTo = (ms, i) => { autoStarted = true; userDriven = true; if (playing) setPlaying(false); if (i !== undefined && i !== cur) setupScenario(i); seek(ms); };   // used by the page checks
})();
