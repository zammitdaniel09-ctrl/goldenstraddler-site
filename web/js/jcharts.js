// GoldenStraddler Journal: small SVG charts with hover readouts. They read the site's colour tokens when they draw,
// so every theme, light mode and custom colour works, and they redraw at the container's own width.
(() => {
"use strict";
const NS = "http://www.w3.org/2000/svg";
const S = (tag, a = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in a) if (a[k] !== undefined && a[k] !== null) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e; };
const css = (el, n, d) => getComputedStyle(el).getPropertyValue(n).trim() || d;
const pal = (el) => ({ up: css(el, "--up", "#3FC4FC"), dn: css(el, "--loss", "#F2616F"), ice: css(el, "--ice", "#3FC4FC"), gold: css(el, "--gold", "#E6B450"), grid: css(el, "--edge", "#1f252f"),
  axis: css(el, "--muted", "#6f7787"), txt: css(el, "--txt2", "#a3abb9"), ink: css(el, "--white", "#fff"), surf: css(el, "--carbon", "#0E1116"), upRgb: css(el, "--up-rgb", "63,196,252"), dnRgb: css(el, "--loss-rgb", "242,97,111"), iceRgb: css(el, "--ice-rgb", "63,196,252"), fgRgb: css(el, "--fg-rgb", "255,255,255") });

// one tooltip for every chart on the page
let tip = null;
function showTip(x, y, rows, title) {
  if (!tip) { tip = document.createElement("div"); tip.className = "jt-tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
  tip.replaceChildren();
  if (title) { const h = document.createElement("div"); h.className = "h"; h.textContent = title; tip.appendChild(h); }
  for (const r of rows) {
    const d = document.createElement("div"); d.className = "r";
    if (r.color) { const k = document.createElement("i"); k.style.background = r.color; d.appendChild(k); }
    const v = document.createElement("b"); v.textContent = r.value; const l = document.createElement("span"); l.textContent = r.label || "";
    d.append(v, l); tip.appendChild(d);
  }
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let tx = x + 14, ty = y - h - 10; if (tx + w > innerWidth - 8) tx = x - w - 14; if (ty < 8) ty = y + 16;
  tip.style.left = Math.max(8, tx) + "px"; tip.style.top = ty + "px";
}
const hideTip = () => { if (tip) tip.hidden = true; };
addEventListener("scroll", hideTip, { passive: true });

function nice(lo, hi, n = 5) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p, st = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  const a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st, ticks = [];
  for (let v = a; v <= b + st / 2; v += st) ticks.push(+v.toPrecision(12));
  return { lo: a, hi: b, ticks };
}
// redraw on resize and on a theme change
const live = new Set();
const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((es) => { for (const e of es) { const c = e.target.__jc; if (c && Math.abs(e.contentRect.width - c.w) > 2) c.draw(); } }) : null;
document.addEventListener("gs-theme", () => { for (const c of live) if (c.el.isConnected) c.draw(); else live.delete(c); });
function mount(el, draw) {
  const c = { el, w: 0, draw: () => { if (!el.isConnected) { live.delete(c); return; } c.w = el.clientWidth; el.replaceChildren(); draw(el, Math.max(220, c.w)); } };
  el.__jc = c; live.add(c); if (ro) ro.observe(el); c.draw(); return c;
}

// ---------------------------------------------------------------- line / area over time, with a crosshair
// series: [{ name, pts: [[t, v], ...], color: "up" | "ice" | css color, area: bool }], opts: { h, fmt, tfmt, zero, signColor }
function line(el, series, o = {}) {
  return mount(el, (el, W) => {
    const P = pal(el), H = o.h || 240, L = 8, R = o.right || 64, T = 10, B = 26;
    const all = series.flatMap((s) => s.pts); if (all.length < 2) { el.innerHTML = `<p class="jc-empty">${o.empty || "Not enough data yet."}</p>`; return; }
    const t0 = Math.min(...all.map((p) => p[0])), t1 = Math.max(...all.map((p) => p[0])), vs = all.map((p) => p[1]);
    const y = nice(Math.min(o.zero !== false ? 0 : Infinity, ...vs), Math.max(o.zero !== false ? 0 : -Infinity, ...vs), o.ticks || 4);
    const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R), Y = (v) => T + (1 - (v - y.lo) / (y.hi - y.lo || 1)) * (H - T - B);
    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "jc", role: "img", "aria-label": o.label || "Chart" }, el);
    for (const v of y.ticks) { S("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: P.grid, "stroke-width": 1 }, svg); const tx = S("text", { x: W - R + 8, y: Y(v) + 4, class: "ax" }, svg); tx.textContent = (o.fmt || String)(v); }
    if (o.zero !== false && y.lo < 0 && y.hi > 0) S("line", { x1: L, x2: W - R, y1: Y(0), y2: Y(0), stroke: P.axis, "stroke-width": 1, opacity: 0.6 }, svg);
    // time axis: a few dates
    const tf = o.tfmt || ((t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
    const nT = Math.max(2, Math.min(6, Math.floor((W - L - R) / 110)));
    for (let i = 0; i < nT; i++) { const t = t0 + ((t1 - t0) * i) / (nT - 1), tx = S("text", { x: X(t), y: H - 6, class: "ax", "text-anchor": i === 0 ? "start" : i === nT - 1 ? "end" : "middle" }, svg); tx.textContent = tf(t); }
    const colOf = (s) => (s.color === "up" ? P.up : s.color === "dn" ? P.dn : s.color === "gold" ? P.gold : s.color === "ice" || !s.color ? P.ice : s.color);
    for (const s of series) {
      if (s.pts.length < 2) continue;
      const d = s.pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(""), col = colOf(s);
      if (s.area) {
        const base = Y(Math.max(y.lo, Math.min(y.hi, 0)));
        if (o.signColor) {
          // above zero in the up colour, below in the loss colour
          const id = "c" + Math.random().toString(36).slice(2, 8), defs = S("defs", {}, svg), cp1 = S("clipPath", { id: id + "a" }, defs), cp2 = S("clipPath", { id: id + "b" }, defs);
          S("rect", { x: 0, y: 0, width: W, height: base }, cp1); S("rect", { x: 0, y: base, width: W, height: H }, cp2);
          const ar = d + `L${X(s.pts[s.pts.length - 1][0]).toFixed(1)} ${base}L${X(s.pts[0][0]).toFixed(1)} ${base}Z`;
          S("path", { d: ar, fill: P.up, opacity: 0.12, "clip-path": `url(#${id}a)` }, svg); S("path", { d: ar, fill: P.dn, opacity: 0.14, "clip-path": `url(#${id}b)` }, svg);
          S("path", { d, fill: "none", stroke: P.up, "stroke-width": 2, "stroke-linejoin": "round", "clip-path": `url(#${id}a)` }, svg);
          S("path", { d, fill: "none", stroke: P.dn, "stroke-width": 2, "stroke-linejoin": "round", "clip-path": `url(#${id}b)` }, svg);
          continue;
        }
        S("path", { d: d + `L${X(s.pts[s.pts.length - 1][0]).toFixed(1)} ${base}L${X(s.pts[0][0]).toFixed(1)} ${base}Z`, fill: col, opacity: s.opacity || 0.1 }, svg);
      }
      S("path", { d, fill: "none", stroke: col, "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": s.dash || null, opacity: s.faint ? 0.35 : 1 }, svg);
    }
    // the last value, labelled on the right
    if (o.endLabel !== false) { const s0 = series[0], lp = s0.pts[s0.pts.length - 1]; S("circle", { cx: X(lp[0]), cy: Y(lp[1]), r: 4, fill: o.signColor ? (lp[1] >= 0 ? P.up : P.dn) : colOf(s0), stroke: P.surf, "stroke-width": 2 }, svg); }
    // crosshair
    const xh = S("line", { y1: T, y2: H - B, stroke: P.axis, "stroke-width": 1, visibility: "hidden" }, svg), dots = series.map((s) => S("circle", { r: 4, fill: colOf(s), stroke: P.surf, "stroke-width": 2, visibility: "hidden" }, svg));
    const hit = S("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" }, svg);
    const move = (e) => {
      const r = svg.getBoundingClientRect(), mx = ((e.clientX - r.left) / r.width) * W, t = t0 + ((mx - L) / (W - L - R)) * (t1 - t0);
      const rows = []; let xx = null;
      series.forEach((s, i) => {
        let best = null, bd = Infinity; for (const p of s.pts) { const dd = Math.abs(p[0] - t); if (dd < bd) { bd = dd; best = p; } }
        if (!best) return; xx = X(best[0]); dots[i].setAttribute("cx", xx); dots[i].setAttribute("cy", Y(best[1])); dots[i].setAttribute("visibility", "visible");
        rows.push({ value: (o.fmt || String)(best[1]), label: s.name || "", color: colOf(s) });
        if (i === 0 && o.extra) rows.push(...o.extra(best));
      });
      if (xx === null) return;
      xh.setAttribute("x1", xx); xh.setAttribute("x2", xx); xh.setAttribute("visibility", "visible");
      const p0 = series[0].pts.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
      showTip(e.clientX, e.clientY, rows, (o.tipT || ((t) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })))(p0[0]));
    };
    const leave = () => { xh.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(); };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move); hit.addEventListener("pointerleave", leave);
  });
}

// ---------------------------------------------------------------- bars: one value per category, coloured by sign
// rows: [{ label, value, n?, extra?: [{label,value}] }], opts: { h, fmt, horizontal, onClick }
function bars(el, rows, o = {}) {
  return mount(el, (el, W) => {
    const P = pal(el);
    if (!rows.length) { el.innerHTML = `<p class="jc-empty">${o.empty || "No trades here yet."}</p>`; return; }
    if (o.horizontal) {
      // on narrow screens each label sits above its bar instead of beside it
      const stacked = W < 520, rowH = stacked ? 42 : 30, labW = stacked ? 0 : Math.min(170, Math.max(80, W * 0.28)), valW = stacked ? 0 : 84, H = rows.length * rowH + 6;
      const m = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9), anyNeg = rows.some((r) => r.value < 0);
      const x0 = labW + (anyNeg ? (W - labW - valW) / 2 : 0), span = anyNeg ? (W - labW - valW) / 2 : W - labW - valW - 4;
      const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "jc", role: "img", "aria-label": o.label || "Bar chart" }, el);
      if (anyNeg) S("line", { x1: x0, x2: x0, y1: 0, y2: H, stroke: P.grid }, svg);
      rows.forEach((r, i) => {
        const yy = i * rowH + 4, len = (Math.abs(r.value) / m) * span, neg = r.value < 0, bh = stacked ? 10 : Math.min(16, rowH - 10);
        const lt = S("text", { x: 0, y: stacked ? yy + 12 : yy + rowH / 2 + 1, class: "lb" }, svg); lt.textContent = r.label;
        const g = S("g", { class: "bar", tabindex: 0 }, svg);
        S("rect", { x: 0, y: yy, width: W, height: rowH, fill: "transparent" }, g);
        const bx = neg ? x0 - len : x0;
        if (len > 0.5) S("path", { d: roundBar(bx, stacked ? yy + 20 : yy + (rowH - bh) / 2, len, bh, neg ? "l" : "r"), fill: neg ? P.dn : r.color || P.up }, g);
        const vt = S("text", { x: W, y: stacked ? yy + 12 : yy + rowH / 2 + 1, class: "vl", "text-anchor": "end" }, svg); vt.textContent = (o.fmt || String)(r.value);
        const tipRows = [{ value: (o.fmt || String)(r.value), label: o.valueLabel || "" }, ...(r.extra || [])];
        g.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, tipRows, r.label)); g.addEventListener("pointerleave", hideTip);
        g.addEventListener("focus", () => { const b = g.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top, tipRows, r.label); }); g.addEventListener("blur", hideTip);
        if (o.onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => o.onClick(r)); g.addEventListener("keydown", (e) => { if (e.key === "Enter") o.onClick(r); }); }
      });
      return;
    }
    const H = o.h || 200, L = 4, R = 56, T = 10, B = o.labelsBelow === false ? 8 : 26;
    const y = nice(Math.min(0, ...rows.map((r) => r.value)), Math.max(0, ...rows.map((r) => r.value)), 4);
    const Y = (v) => T + (1 - (v - y.lo) / (y.hi - y.lo || 1)) * (H - T - B), band = (W - L - R) / rows.length, bw = Math.max(2, Math.min(24, band - 4));
    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "jc", role: "img", "aria-label": o.label || "Bar chart" }, el);
    for (const v of y.ticks) { S("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: v === 0 ? P.axis : P.grid, "stroke-width": 1, opacity: v === 0 ? 0.7 : 1 }, svg); const tx = S("text", { x: W - R + 8, y: Y(v) + 4, class: "ax" }, svg); tx.textContent = (o.fmt || String)(v); }
    const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor((W - L - R) / 42))));
    rows.forEach((r, i) => {
      const cx = L + band * (i + 0.5), y0 = Y(0), y1 = Y(r.value), neg = r.value < 0;
      const g = S("g", { class: "bar", tabindex: 0 }, svg);
      S("rect", { x: cx - band / 2, y: T, width: band, height: H - T - B, fill: "transparent" }, g);
      if (Math.abs(y1 - y0) > 0.5) S("path", { d: roundBar(cx - bw / 2, Math.min(y0, y1), bw, Math.abs(y1 - y0), neg ? "b" : "t"), fill: r.color || (neg ? P.dn : P.up), opacity: r.faint ? 0.4 : 1 }, g);
      if (B > 10 && i % every === 0) { const lt = S("text", { x: cx, y: H - 8, class: "ax", "text-anchor": "middle" }, svg); lt.textContent = r.short || r.label; }
      const tipRows = [{ value: (o.fmt || String)(r.value), label: o.valueLabel || "" }, ...(r.extra || [])];
      g.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, tipRows, r.label)); g.addEventListener("pointerleave", hideTip);
      g.addEventListener("focus", () => { const b = g.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top, tipRows, r.label); }); g.addEventListener("blur", hideTip);
      if (o.onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => o.onClick(r)); }
    });
  });
}
// a bar with 4px rounded data end and a square base
function roundBar(x, y, w, h, end) {
  const r = Math.min(4, (end === "t" || end === "b" ? w : h) / 2, end === "t" || end === "b" ? h : w);
  if (end === "t") return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
  if (end === "b") return `M${x} ${y}V${y + h - r}Q${x} ${y + h} ${x + r} ${y + h}H${x + w - r}Q${x + w} ${y + h} ${x + w} ${y + h - r}V${y}Z`;
  if (end === "r") return `M${x} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x}Z`;
  return `M${x + w} ${y}H${x + r}Q${x} ${y} ${x} ${y + r}V${y + h - r}Q${x} ${y + h} ${x + r} ${y + h}H${x + w}Z`;
}

// ---------------------------------------------------------------- histogram (counts), with a marker at zero
function hist(el, bins, o = {}) {
  return mount(el, (el, W) => {
    const P = pal(el), H = o.h || 180, L = 4, R = 40, T = 8, B = 24;
    if (!bins.length) { el.innerHTML = `<p class="jc-empty">${o.empty || "Not enough data yet."}</p>`; return; }
    const m = Math.max(...bins.map((b) => b.n), 1), lo = bins[0].from, hi = bins[bins.length - 1].to;
    const X = (v) => L + ((v - lo) / (hi - lo || 1)) * (W - L - R), Y = (n) => T + (1 - n / m) * (H - T - B);
    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "jc", role: "img", "aria-label": o.label || "Histogram" }, el);
    const yt = nice(0, m, 3);
    for (const v of yt.ticks) { if (v > m) continue; S("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: P.grid }, svg); const t = S("text", { x: W - R + 6, y: Y(v) + 4, class: "ax" }, svg); t.textContent = v; }
    for (const b of bins) {
      const x0 = X(b.from) + 1, x1 = X(b.to) - 1, mid = (b.from + b.to) / 2, g = S("g", { class: "bar" }, svg);
      S("rect", { x: x0 - 1, y: T, width: x1 - x0 + 2, height: H - T - B, fill: "transparent" }, g);
      if (b.n) S("path", { d: roundBar(x0, Y(b.n), Math.max(1, x1 - x0), H - B - Y(b.n), "t"), fill: mid < 0 ? P.dn : P.up, opacity: 0.85 }, g);
      g.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, [{ value: b.n + (b.n === 1 ? " trade" : " trades"), label: "" }], `${(o.fmt || String)(b.from)} to ${(o.fmt || String)(b.to)}`)); g.addEventListener("pointerleave", hideTip);
    }
    if (lo < 0 && hi > 0) S("line", { x1: X(0), x2: X(0), y1: T, y2: H - B, stroke: P.ink, "stroke-width": 1, opacity: 0.6 }, svg);
    for (const v of [lo, lo < 0 && hi > 0 ? 0 : null, hi]) { if (v === null) continue; const t = S("text", { x: X(v), y: H - 6, class: "ax", "text-anchor": v === lo ? "start" : v === hi ? "end" : "middle" }, svg); t.textContent = (o.fmt || String)(v); }
  });
}

// ---------------------------------------------------------------- heat grid: rows x columns, diverging by value
function heat(el, grid, o) {
  return mount(el, (el, W) => {
    const P = pal(el), rl = o.rows, cl = o.cols, labW = o.labW || 40, top = 18, gap = 2;
    const cw = Math.max(8, (W - labW) / cl.length - gap), ch = o.cellH || Math.min(30, Math.max(18, cw * 0.9)), H = top + rl.length * (ch + gap);
    const vals = grid.flat().map(o.value).filter((v) => v !== null && v !== undefined), m = Math.max(...vals.map(Math.abs), 1e-9);
    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "jc", role: "img", "aria-label": o.label || "Heat map" }, el);
    const every = Math.max(1, Math.ceil(cl.length / Math.floor((W - labW) / 34)));
    cl.forEach((c, j) => { if (j % every) return; const t = S("text", { x: labW + j * (cw + gap) + cw / 2, y: 12, class: "ax", "text-anchor": "middle" }, svg); t.textContent = c; });
    rl.forEach((r, i) => {
      const t = S("text", { x: 0, y: top + i * (ch + gap) + ch / 2 + 4, class: "lb" }, svg); t.textContent = r;
      cl.forEach((c, j) => {
        const cell = grid[i][j], v = o.value(cell), x = labW + j * (cw + gap), yy = top + i * (ch + gap);
        const a = v === null || v === undefined ? 0 : Math.min(1, Math.sqrt(Math.abs(v) / m));
        const fill = v === null || v === undefined || cell.n === 0 ? `rgba(${P.fgRgb},.04)` : v >= 0 ? `rgba(${P.upRgb},${(0.12 + a * 0.78).toFixed(2)})` : `rgba(${P.dnRgb},${(0.12 + a * 0.78).toFixed(2)})`;
        const g = S("g", { class: "cell", tabindex: cell && cell.n ? 0 : -1 }, svg);
        S("rect", { x, y: yy, width: cw, height: ch, rx: 3, fill }, g);
        if (cell && cell.n) {
          const rows = o.tip(cell);
          g.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, rows, `${r} ${c}`)); g.addEventListener("pointerleave", hideTip);
          g.addEventListener("focus", () => { const b = g.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top, rows, `${r} ${c}`); }); g.addEventListener("blur", hideTip);
          if (o.onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => o.onClick(i, j, cell)); }
        }
      });
    });
  });
}

// ---------------------------------------------------------------- scatter: points with a generous hit area
function scatter(el, pts, o = {}) {
  return mount(el, (el, W) => {
    const P = pal(el), H = o.h || 260, L = 44, R = 12, T = 10, B = 34;
    if (pts.length < 3) { el.innerHTML = `<p class="jc-empty">${o.empty || "Not enough data yet."}</p>`; return; }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const xa = nice(Math.min(...xs, o.x0 ?? Infinity), Math.max(...xs, o.x1 ?? -Infinity), 5), ya = nice(Math.min(...ys, o.y0 ?? Infinity), Math.max(...ys, o.y1 ?? -Infinity), 4);
    const X = (v) => L + ((v - xa.lo) / (xa.hi - xa.lo || 1)) * (W - L - R), Y = (v) => T + (1 - (v - ya.lo) / (ya.hi - ya.lo || 1)) * (H - T - B);
    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "jc", role: "img", "aria-label": o.label || "Scatter chart" }, el);
    for (const v of ya.ticks) { S("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: v === 0 ? P.axis : P.grid, opacity: v === 0 ? 0.7 : 1 }, svg); const t = S("text", { x: L - 6, y: Y(v) + 4, class: "ax", "text-anchor": "end" }, svg); t.textContent = (o.yf || String)(v); }
    for (const v of xa.ticks) { if (v === 0) S("line", { x1: X(0), x2: X(0), y1: T, y2: H - B, stroke: P.axis, opacity: 0.6 }, svg); const t = S("text", { x: X(v), y: H - B + 16, class: "ax", "text-anchor": "middle" }, svg); t.textContent = (o.xf || String)(v); }
    if (o.xl) { const t = S("text", { x: (L + W - R) / 2, y: H - 2, class: "ax", "text-anchor": "middle" }, svg); t.textContent = o.xl; }
    if (o.diag) S("line", { x1: X(Math.max(xa.lo, ya.lo)), y1: Y(Math.max(xa.lo, ya.lo)), x2: X(Math.min(xa.hi, ya.hi)), y2: Y(Math.min(xa.hi, ya.hi)), stroke: P.axis, "stroke-dasharray": "4 4", opacity: 0.5 }, svg);
    for (const p of pts) {
      const g = S("g", { class: "pt" }, svg), cx = X(p.x), cy = Y(p.y);
      S("circle", { cx, cy, r: 12, fill: "transparent" }, g);
      S("circle", { cx, cy, r: 4.5, fill: p.color || (p.good ? P.up : P.dn), stroke: P.surf, "stroke-width": 2, opacity: 0.9 }, g);
      g.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, p.tip || [], p.title || "")); g.addEventListener("pointerleave", hideTip);
      if (o.onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => o.onClick(p)); }
    }
  });
}

// ---------------------------------------------------------------- fan: percentile bands over trade count (Monte Carlo)
function fan(el, paths, o = {}) {
  return mount(el, (el, W) => {
    const P = pal(el), H = o.h || 260, L = 8, R = 70, T = 10, B = 24;
    if (!paths || !paths.length) { el.innerHTML = `<p class="jc-empty">Needs at least 10 trades.</p>`; return; }
    const n = paths[0].length, cols = Array.from({ length: n }, (_, i) => paths.map((p) => p[i]).sort((a, b) => a - b));
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * f)))];
    const bands = [0.05, 0.25, 0.5, 0.75, 0.95].map((f) => cols.map((c) => q(c, f)));
    const all = paths.flat(), y = nice(Math.min(...all), Math.max(...all), 4);
    const X = (i) => L + (i / (n - 1)) * (W - L - R), Y = (v) => T + (1 - (v - y.lo) / (y.hi - y.lo || 1)) * (H - T - B);
    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "jc", role: "img", "aria-label": "Range of outcomes" }, el);
    for (const v of y.ticks) { S("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: P.grid }, svg); const t = S("text", { x: W - R + 8, y: Y(v) + 4, class: "ax" }, svg); t.textContent = (o.fmt || String)(v); }
    for (const p of paths.slice(0, 40)) S("path", { d: p.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(""), fill: "none", stroke: P.ice, "stroke-width": 1, opacity: 0.12 }, svg);
    const area = (a, b, op) => S("path", { d: a.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join("") + b.map((v, i) => "L" + X(b.length - 1 - i).toFixed(1) + " " + Y(b[b.length - 1 - i]).toFixed(1)).join("") + "Z", fill: P.ice, opacity: op }, svg);
    area(bands[0], bands[4], 0.1); area(bands[1], bands[3], 0.16);
    S("path", { d: bands[2].map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(""), fill: "none", stroke: P.ice, "stroke-width": 2 }, svg);
    const lbl = (txt, v) => { const t = S("text", { x: X(n - 1) - 4, y: Y(v) - 6, class: "ax", "text-anchor": "end" }, svg); t.textContent = txt; };
    lbl("best 5%", bands[4][n - 1]); lbl("median", bands[2][n - 1]); lbl("worst 5%", bands[0][n - 1]);
    const t0 = S("text", { x: L, y: H - 6, class: "ax" }, svg); t0.textContent = "Now"; const t1 = S("text", { x: W - R, y: H - 6, class: "ax", "text-anchor": "end" }, svg); t1.textContent = `${o.len || n} trades on`;
  });
}

window.JCharts = { line, bars, hist, heat, scatter, fan, showTip, hideTip, nice };
})();
