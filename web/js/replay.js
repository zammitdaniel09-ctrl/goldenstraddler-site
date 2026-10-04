// "Watch it trade a real release": our own screen recording of the 2 October 2026 US jobs report,
// rebuilt as a phone-screen candlestick replay. Prices come from window.GS_REPLAY (replay-data.js),
// read off every frame of the recording; orders, fills and stops sit where the recording shows them.
(() => {
"use strict";
const root = document.getElementById("rp");
const D = window.GS_REPLAY;
if (!root || !D) return;
const $ = (s, el = root) => el.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- data
const T = [], B = [], A = [];
{ let t = 0, b = 0; for (let i = 0; i < D.ticks.length; i += 3) { t += D.ticks[i]; b += D.ticks[i + 1]; T.push(t); B.push(b); A.push(b + D.ticks[i + 2]); } }
const N = T.length, CP = D.candle, USD = D.usdPerPoint;
const K0 = Math.floor(T[0] / CP), K1 = Math.floor(D.end / CP), SLOTS = K1 - K0 + 3;
const trades = D.trades, orders = D.orders;
const notes = D.notes.map(([t, x]) => [t, x.replace(/([−+])\$/g, "$1\u2060$$")]);   // keep the sign with the amount when a line wraps
const lastAt = (t) => { let lo = 0, hi = N - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const plOf = (tr, bid, ask) => ((tr.s === "b" ? bid - tr.en : tr.en - ask) * USD) / 100;
const slOf = (tr, t) => { let v = tr.sl[0][1]; for (const [a, p] of tr.sl) if (a <= t) v = p; return v; };
const clock = (ms, sec = true) => { const s = 14 * 3600 + 29 * 60 + ms / 1000, h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = Math.floor(s) % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + (sec ? ":" + String(x).padStart(2, "0") : ""); };
const px = (c) => (c / 100).toFixed(2);
const money = (v, ascii) => (v < 0 ? (ascii ? "-" : "−") : "+") + (ascii ? "" : "$") + Math.abs(v).toFixed(2);
const RELEASE = trades.reduce((m, tr) => (tr.pl > m.pl ? tr : m), trades[0]);
const NET = Math.round(trades.reduce((s, tr) => s + tr.pl, 0) * 100) / 100;
const WON = trades.filter((tr) => tr.pl > 0).length;

// ---------------------------------------------------------------- dom
const ui = {
  phone: $(".rp-phone"), chart: $(".ph-chart"), cv: $(".ph-chart canvas"), time: $(".ph-time"), ff: $(".ph-ff"), cap: $(".rp-cap"), capT: $(".rp-cap span"),
  sell: $(".q.sell"), buy: $(".q.buy"), sellP: $(".q.sell .num"), buyP: $(".q.buy .num"),
  end: $(".rp-end"), play: $(".rp-play"), again: $(".rp-again"), restart: $(".rp-restart"), bar: $(".rp-bar"), fill: $(".rp-bar .fl"), head: $(".rp-bar .hd"), marks: $(".rp-bar .mk"),
  clk: $(".rp-clk"), speeds: [...root.querySelectorAll(".rp-speed button")],
  closed: $('[data-l="closed"]'), open: $('[data-l="open"]'), count: $('[data-l="n"]'),
  notes: $(".rp-notes"), res: $(".rp-res"),
};
const cx = ui.cv.getContext("2d");

// result line and the end card come from the data, so they always match the replay
const after = trades.filter((tr) => tr.at > D.release + 4000), afterSum = after.reduce((s, tr) => s + tr.pl, 0);
if (ui.res) ui.res.innerHTML = `On the release: <b class="up">${money(RELEASE.pl)}</b>. The whole session: about <b class="${NET >= 0 ? "up" : "dn"}">${money(Math.round(NET)).replace(".00", "")}</b> over ${trades.length} trades, ${WON} of them winners.`;
$(".rp-end .e-rel").textContent = money(RELEASE.pl);
$(".rp-end .e-net").innerHTML = "<small>about</small> " + money(Math.round(NET)).replace(".00", "");
$(".rp-end .e-n").textContent = `${trades.length} trades, ${WON} won, ${trades.length - WON} lost. The minute after the release gave back about ${money(Math.round(afterSum)).replace(".00", "").replace("−", "")}.`;

// play-by-play list (also the text version of the replay)
ui.notes.innerHTML = notes.map(([t, x], i) => `<li data-i="${i}"><button type="button" class="num" data-t="${t}" aria-label="Jump to ${clock(t)}">${clock(t)}</button><span>${x}</span></li>`).join("");
const noteEls = [...ui.notes.children];

// timeline markers: the release and every closed trade
{
  const span = D.end - D.start, at = (t) => ((t - D.start) / span) * 100;
  let h = `<i class="rel" style="left:${at(D.release)}%" title="14:30:00 release"></i>`;
  for (const tr of trades) h += `<i class="${tr.pl >= 0 ? "w" : "l"}" style="left:${at(tr.out)}%"></i>`;
  ui.marks.innerHTML = h;
}

// ---------------------------------------------------------------- canvas
const C = { bg: "#000", grid: "rgba(255,255,255,.055)", axis: "#8b919c", up: "#26B48C", dn: "#EF5350", buy: "#4C8DFF", sell: "#FF5C61",
  bidTag: "#178571", askTag: "#D23A3F", rel: "#E6B450" };
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
let W = 0, H = 0, dpr = 1;
function size() {
  const r = ui.chart.getBoundingClientRect();
  dpr = Math.min(2.5, window.devicePixelRatio || 1); W = Math.max(200, r.width); H = Math.max(200, r.height);
  ui.cv.width = Math.round(W * dpr); ui.cv.height = Math.round(H * dpr);
  ui.cv.style.width = W + "px"; ui.cv.style.height = H + "px";
}
const AX = 60, TOP = 40, BOT = 22, CAPZ = 66;   // CAPZ: room under the chart for the commentary, so it never covers candles
let lo = 0, hi = 0, snap = true;
function niceStep(range) { const raw = range / 6, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * p; }

let tNow = D.start;
function draw(dt) {
  const t = tNow, i = lastAt(t), bid = i >= 0 ? B[i] : B[0], ask = i >= 0 ? A[i] : A[0];
  // candles up to t
  const cs = [];
  for (let j = 0; j <= i; j++) {
    const k = Math.floor(T[j] / CP), b = B[j];
    let c = cs[cs.length - 1];
    if (!c || c.k !== k) { c = { k, o: b, h: b, l: b, c: b }; cs.push(c); }
    if (b > c.h) c.h = b; if (b < c.l) c.l = b; c.c = b;
  }
  const openT = trades.filter((tr) => tr.at <= t && t < tr.out), doneT = trades.filter((tr) => tr.out <= t), liveO = orders.filter((o) => o.from <= t && t < o.to);
  // y range
  let yl = Infinity, yh = -Infinity;
  const inc = (v) => { if (v < yl) yl = v; if (v > yh) yh = v; };
  for (const c of cs) { inc(c.l); inc(c.h); }
  inc(bid); inc(ask);
  for (const o of liveO) { inc(o.p); inc(o.sl); }
  for (const tr of openT) { inc(tr.en); inc(slOf(tr, t)); }
  const pad = Math.max(40, (yh - yl) * 0.1); yl -= pad; yh += pad;
  if (snap || !hi) { lo = yl; hi = yh; snap = false; }
  else { const k = 1 - Math.exp(-(dt || 16) / 110); lo += (yl - lo) * k; hi += (yh - hi) * k; }

  const pl = 0, pr = W - AX, pt = TOP, pb = H - BOT - CAPZ, slotW = (pr - pl) / SLOTS;
  const Y = (c) => pb - ((c - lo) / (hi - lo)) * (pb - pt);
  const X = (ms) => pl + (ms / CP - K0) * slotW;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.fillStyle = C.bg; cx.fillRect(0, 0, W, H);

  // grid and price axis
  const step = niceStep((hi - lo) / 100) * 100;
  cx.font = `11px ${FONT}`; cx.textBaseline = "middle"; cx.textAlign = "left";
  cx.strokeStyle = C.grid; cx.lineWidth = 1; cx.fillStyle = C.axis;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = Math.round(Y(v)) + 0.5; if (y < pt - 4 || y > pb) continue;
    cx.beginPath(); cx.moveTo(pl, y); cx.lineTo(pr, y); cx.stroke();
    cx.fillText(px(v), pr + 6, y);
  }
  // time axis every 20 seconds
  cx.textAlign = "center";
  const every = 20000 * Math.max(1, Math.ceil(60 / (slotW * 4)));
  for (let k = K0; k <= K0 + SLOTS; k++) {
    const ms = k * CP; if (ms % 20000) continue;
    const x = Math.round(X(ms)) + 0.5; if (x < pl + 24 || x > pr - 24) continue;
    cx.beginPath(); cx.moveTo(x, pt - 6); cx.lineTo(x, pb); cx.stroke();
    if (ms % every === 0) cx.fillText(clock(ms), x, pb + 11);
  }
  cx.strokeStyle = "rgba(255,255,255,.18)"; cx.beginPath(); cx.moveTo(pr + 0.5, pt - 8); cx.lineTo(pr + 0.5, pb); cx.lineTo(pl, pb + 0.5); cx.stroke();

  // the release
  { const x = Math.round(X(D.release)) + 0.5;
    cx.save(); cx.strokeStyle = C.rel; cx.globalAlpha = 0.55; cx.setLineDash([3, 4]); cx.beginPath(); cx.moveTo(x, pt - 6); cx.lineTo(x, pb); cx.stroke(); cx.restore();
    cx.fillStyle = C.rel; cx.font = `600 10px ${FONT}`; cx.textAlign = "left"; cx.fillText("NFP 14:30", x + 4, pt - 2); }

  // candles
  const bw = Math.max(1, Math.min(14, slotW * 0.64));
  for (const c of cs) {
    const x = pl + (c.k - K0 + 0.5) * slotW, up = c.c >= c.o, col = up ? C.up : C.dn;
    cx.strokeStyle = col; cx.fillStyle = col; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(Math.round(x) + 0.5, Y(c.h)); cx.lineTo(Math.round(x) + 0.5, Y(c.l)); cx.stroke();
    const y0 = Y(Math.max(c.o, c.c)), y1 = Y(Math.min(c.o, c.c));
    cx.fillRect(Math.round(x - bw / 2), y0, Math.round(bw), Math.max(1, y1 - y0));
  }

  // closed trades: entry and exit markers joined by a dashed line
  const arrow = (x, y, upw, col) => { cx.fillStyle = col; cx.beginPath();
    if (upw) { cx.moveTo(x, y + 2); cx.lineTo(x - 4.5, y + 9); cx.lineTo(x + 4.5, y + 9); } else { cx.moveTo(x, y - 2); cx.lineTo(x - 4.5, y - 9); cx.lineTo(x + 4.5, y - 9); }
    cx.closePath(); cx.fill(); };
  for (const tr of doneT) {
    const x0 = X(tr.at), x1 = X(tr.out), y0 = Y(tr.en), y1 = Y(tr.ex), col = tr.s === "b" ? C.buy : C.sell;
    cx.save(); cx.strokeStyle = col; cx.globalAlpha = 0.7; cx.setLineDash([2, 3]); cx.beginPath(); cx.moveTo(x0, y0); cx.lineTo(x1, y1); cx.stroke(); cx.restore();
    arrow(x0, y0, tr.s === "b", tr.s === "b" ? C.buy : C.sell); arrow(x1, y1, tr.s !== "b", tr.s === "b" ? C.sell : C.buy);
  }
  for (const tr of openT) arrow(X(tr.at), Y(tr.en), tr.s === "b", tr.s === "b" ? C.buy : C.sell);

  // level lines, left labels and right tags
  const left = [], tags = [];
  const hline = (c, col, dash, alpha) => { const y = Math.round(Y(c)) + 0.5; cx.save(); cx.strokeStyle = col; cx.globalAlpha = alpha; cx.setLineDash(dash); cx.beginPath(); cx.moveTo(pl, y); cx.lineTo(pr, y); cx.stroke(); cx.restore(); return y; };
  for (const o of liveO) {
    const col = o.s === "b" ? C.buy : C.sell;
    left.push({ y: hline(o.p, col, [6, 4], 0.9), parts: [[(o.s === "b" ? "BUY" : "SELL") + " STOP 0.1", col]] });
    tags.push({ y: Y(o.p), text: px(o.p), col, box: "line" });
    left.push({ y: hline(o.sl, C.sell, [4, 4], 0.5), parts: [["SL", C.sell]] });
    tags.push({ y: Y(o.sl), text: px(o.sl), col: C.sell, box: "none" });
  }
  for (const tr of openT) {
    const col = tr.s === "b" ? C.buy : C.sell, v = Math.round(plOf(tr, bid, ask) * 100) / 100, sl = slOf(tr, t);
    left.push({ y: hline(tr.en, col, [8, 3], 1), parts: [[(tr.s === "b" ? "BUY" : "SELL") + " 0.1, ", col], [money(v, true) + " USD", v >= 0 ? C.buy : C.sell]] });
    tags.push({ y: Y(tr.en), text: px(tr.en), col, box: "line" });
    left.push({ y: hline(sl, C.sell, [4, 4], 0.6), parts: [["SL", C.sell]] });
    tags.push({ y: Y(sl), text: px(sl), col: C.sell, box: "none" });
  }
  // bid and ask
  const yb = hline(bid, C.bidTag, [2, 2], 0.95), ya = hline(ask, C.askTag, [2, 2], 0.85);
  cx.font = `500 11px ${FONT}`; cx.textAlign = "left"; cx.textBaseline = "alphabetic";
  // left labels, pushed apart so they stay readable
  left.sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  for (const L of left) { let y = Math.max(L.y - 3, prev + 12); y = Math.max(pt + 8, Math.min(pb - 2, y)); prev = y; let x = 6;
    for (const [s, col] of L.parts) { cx.fillStyle = col; cx.fillText(s, x, y); x += cx.measureText(s).width; } }
  // right tags: bid (with the countdown to the next minute) wins, the others step out of its way
  const cd = 60 - (Math.floor(t / 1000) % 60), cdTxt = cd === 60 ? "01:00" : "00:" + String(cd).padStart(2, "0");
  const bidBox = { y0: yb - 9, y1: yb + 21 }, askBox = { y0: ya - 8, y1: ya + 8 };
  const placed = [bidBox];
  if (askBox.y1 > bidBox.y0 && askBox.y0 < bidBox.y1) { askBox.y0 = bidBox.y0 - 17; askBox.y1 = bidBox.y0 - 1; }
  placed.push(askBox);
  tags.sort((a, b) => Math.abs(a.y - yb) - Math.abs(b.y - yb));
  for (const g of tags) { let y0 = g.y - 8, y1 = g.y + 8, guard = 0;
    for (let moved = true; moved && guard < 12; guard++) { moved = false;
      for (const p of placed) if (y1 > p.y0 && y0 < p.y1) { if (g.y < (p.y0 + p.y1) / 2) { y1 = p.y0 - 1; y0 = y1 - 16; } else { y0 = p.y1 + 1; y1 = y0 + 16; } moved = true; } }
    if (y0 < pt - 10 || y1 > pb + 6) continue;
    placed.push({ y0, y1 }); g.y0 = y0; }
  cx.textBaseline = "middle"; cx.font = `500 11px ${FONT}`;
  for (const g of tags) { if (g.y0 === undefined) continue;
    if (g.box === "line") { cx.fillStyle = "#000"; cx.fillRect(pr + 1, g.y0, AX - 2, 16); cx.strokeStyle = g.col; cx.lineWidth = 1; cx.strokeRect(pr + 1.5, g.y0 + 0.5, AX - 3, 15); }
    else { cx.fillStyle = "#000"; cx.fillRect(pr + 1, g.y0, AX - 2, 16); }
    cx.fillStyle = g.col; cx.fillText(g.text, pr + 5, g.y0 + 8.5); }
  cx.fillStyle = C.askTag; cx.fillRect(pr + 1, askBox.y0, AX - 2, 16); cx.fillStyle = "#fff"; cx.fillText(px(ask), pr + 5, askBox.y0 + 8.5);
  cx.fillStyle = C.bidTag; cx.fillRect(pr + 1, bidBox.y0, AX - 2, 30); cx.fillStyle = "#fff"; cx.fillText(px(bid), pr + 5, bidBox.y0 + 8.5);
  cx.fillStyle = "rgba(255,255,255,.78)"; cx.fillText(cdTxt, pr + 5, bidBox.y0 + 22);

  return { i, bid, ask, openT, doneT };
}

// ---------------------------------------------------------------- phone chrome and side panel
let dir = "up", noteI = -2, lastPanel = 0;
function chrome(st, force) {
  const { i, bid, ask, openT, doneT } = st;
  ui.time.textContent = clock(tNow, false);
  if (i > 0) { let j = i; while (j > 0 && B[j - 1] === B[j]) j--; dir = j > 0 && B[j] < B[j - 1] ? "dn" : "up"; }   // colour of the last price change, as the app shows it
  const split = (c) => { const s = px(c); return `${s.slice(0, -2)}<b>${s.slice(-2)}</b>`; };
  ui.sellP.innerHTML = split(bid); ui.buyP.innerHTML = split(ask);
  ui.sell.dataset.d = dir; ui.buy.dataset.d = dir;
  ui.ff.hidden = !(tNow < D.ff && playing);
  // caption: the newest note, shown for a few seconds
  let ni = -1; for (let k = 0; k < notes.length; k++) if (notes[k][0] <= tNow) ni = k;
  const showCap = ni >= 0 && tNow - notes[ni][0] < Math.max(3800, (notes[ni + 1] ? Math.min(notes[ni + 1][0] - notes[ni][0], 6000) : 6000)) && tNow < D.end;
  if (ni !== noteI) {
    noteI = ni;
    if (ni >= 0) ui.capT.textContent = notes[ni][1];
    noteEls.forEach((el, k) => { el.classList.toggle("now", k === ni); el.classList.toggle("past", k < ni); });
    const el = noteEls[ni];
    if (el) { const box = ui.notes, top = el.offsetTop - box.offsetTop, want = top - box.clientHeight / 2 + el.clientHeight / 2; box.scrollTo({ top: Math.max(0, want), behavior: reduce || force ? "auto" : "smooth" }); }
  }
  ui.cap.classList.toggle("on", showCap);
  // live numbers, about ten times a second
  const now = performance.now();
  if (force || now - lastPanel > 100) {
    lastPanel = now;
    const closed = doneT.reduce((s, tr) => s + tr.pl, 0), open = openT.reduce((s, tr) => s + plOf(tr, bid, ask), 0), w = doneT.filter((tr) => tr.pl > 0).length;
    ui.closed.textContent = doneT.length ? money(closed) : "$0.00"; ui.closed.className = "num " + (doneT.length ? (closed >= 0 ? "up" : "dn") : "");
    ui.open.textContent = openT.length ? money(open) : "No trade"; ui.open.className = "num " + (openT.length ? (open >= 0 ? "up" : "dn") : "mu");
    ui.count.textContent = doneT.length ? `${doneT.length} (${w} won)` : "0";
  }
  // timeline
  const f = (tNow - D.start) / (D.end - D.start) * 100;
  ui.fill.style.width = f + "%"; ui.head.style.left = f + "%";
  ui.bar.setAttribute("aria-valuenow", String(Math.round((tNow - D.release) / 1000)));
  ui.bar.setAttribute("aria-valuetext", clock(tNow) + (tNow < D.release ? `, ${Math.ceil((D.release - tNow) / 1000)} seconds before the release` : ""));
  ui.clk.textContent = clock(tNow);
  ui.end.hidden = tNow < D.end;
}

// ---------------------------------------------------------------- playback
let playing = false, speed = 1, raf = 0, lastFrame = 0, autoStarted = false, autoPaused = false, visible = false;
function render(dt, force) { const st = draw(dt); chrome(st, force); }
function setPlaying(on) {
  if (on && tNow >= D.end) { tNow = D.start; snap = true; }
  playing = on; ui.play.dataset.s = on ? "play" : "pause"; ui.play.setAttribute("aria-label", on ? "Pause" : "Play");
  cancelAnimationFrame(raf);
  if (on) { lastFrame = performance.now(); raf = requestAnimationFrame(loop); }
  render(16, true);
}
function loop(now) {
  if (!playing) return;
  const dt = Math.min(80, now - lastFrame); lastFrame = now;
  tNow += dt * speed * (tNow < D.ff ? D.ffRate : 1);
  if (tNow >= D.end) { tNow = D.end; playing = false; ui.play.dataset.s = "pause"; ui.play.setAttribute("aria-label", "Play again"); render(dt, true); return; }
  render(dt);
  raf = requestAnimationFrame(loop);
}
function seek(t, keepSnap) { tNow = Math.max(D.start, Math.min(D.end, t)); if (!keepSnap) snap = true; noteI = -2; render(16, true); }

ui.play.addEventListener("click", () => { autoPaused = false; autoStarted = true; setPlaying(!playing); });
ui.restart.addEventListener("click", () => { autoStarted = true; seek(D.start); setPlaying(true); });
ui.again.addEventListener("click", () => { autoStarted = true; seek(D.start); setPlaying(true); });
$(".rp-jump").addEventListener("click", () => { autoStarted = true; seek(D.release - 16000); setPlaying(true); });
ui.speeds.forEach((b) => b.addEventListener("click", () => { speed = Number(b.dataset.v); ui.speeds.forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
ui.notes.addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (!b) return; autoStarted = true; seek(Number(b.dataset.t) - 1500); setPlaying(true); });

// scrubbing
{
  const tAt = (e) => { const r = ui.bar.getBoundingClientRect(); return D.start + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (D.end - D.start); };
  let drag = false, was = false;
  ui.bar.addEventListener("pointerdown", (e) => { drag = true; was = playing; autoStarted = true; playing = false; cancelAnimationFrame(raf); ui.bar.setPointerCapture(e.pointerId); seek(tAt(e)); });
  ui.bar.addEventListener("pointermove", (e) => { if (drag) seek(tAt(e), true); });
  const up = () => { if (!drag) return; drag = false; if (was) setPlaying(true); else render(16, true); };
  ui.bar.addEventListener("pointerup", up); ui.bar.addEventListener("pointercancel", up);
  ui.bar.addEventListener("keydown", (e) => {
    const k = e.key, big = e.shiftKey || k === "PageUp" || k === "PageDown" ? 5000 : 1000;
    let t = null;
    if (k === "ArrowRight" || k === "ArrowUp" || k === "PageUp") t = tNow + big;
    else if (k === "ArrowLeft" || k === "ArrowDown" || k === "PageDown") t = tNow - big;
    else if (k === "Home") t = D.start; else if (k === "End") t = D.end;
    if (t === null) return;
    e.preventDefault(); autoStarted = true; seek(t);
  });
}

// size, start when it scrolls into view, pause when it leaves
const ro = new ResizeObserver(() => { size(); snap = true; render(16, true); });
ro.observe(ui.chart);
size();
if (reduce) tNow = D.end;     // no autoplay: show the finished session, ready to play
render(16, true);
new IntersectionObserver((es) => {
  for (const e of es) {
    visible = e.isIntersecting;
    if (visible && !autoStarted && !reduce) { autoStarted = true; setPlaying(true); }
    else if (visible && autoPaused) { autoPaused = false; setPlaying(true); }
    else if (!visible && playing) { autoPaused = true; setPlaying(false); }
  }
}, { threshold: 0.45 }).observe(ui.phone);
document.addEventListener("visibilitychange", () => { if (document.hidden && playing) { autoPaused = true; setPlaying(false); } });
root.seekTo = (ms) => { autoStarted = true; if (playing) setPlaying(false); seek(ms); };   // used by the page checks

})();
