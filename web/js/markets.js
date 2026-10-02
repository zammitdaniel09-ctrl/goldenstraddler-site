// Markets: live prices, the desk views (board, signal matrix, positioning, track record), filters, sorting,
// tooltips, local times and countdowns, phone expanders, and copying a brief as a Telegram post.
(() => {
"use strict";
document.documentElement.classList.add("js");
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const toastEl = document.getElementById("toast");
let toastT = 0;
function toast(msg) { if (!toastEl) return; toastEl.textContent = msg; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2600); }

// ---------------------------------------------------------------- times in the visitor's own time zone, and countdowns
const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
$$("time[data-utc]").forEach((t) => { t.textContent = fmt.format(new Date(Number(t.dataset.utc) * 1000)); });
const cds = $$("[data-cd]");
function tick() {
  const n = Date.now() / 1000;
  for (const c of cds) {
    const d = Number(c.dataset.cd) - n;
    c.textContent = d <= -900 ? "Out" : d <= 0 ? "Out now" : d < 3600 ? `in ${Math.ceil(d / 60)} min` : d < 86400 ? `in ${Math.floor(d / 3600)} h ${Math.floor((d % 3600) / 60)} min` : `in ${Math.floor(d / 86400)} d ${Math.floor((d % 86400) / 3600)} h`;
    c.classList.toggle("soon", d > 0 && d < 3600);
  }
}
if (cds.length) { tick(); setInterval(tick, 20000); }

// ---------------------------------------------------------------- tabs: the desk views and the asset class filter
function tabset(btns, onPick) {
  btns.forEach((b, i) => {
    b.addEventListener("click", () => onPick(b));
    b.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
      e.preventDefault(); const n = btns[(i + d + btns.length) % btns.length]; n.focus(); onPick(n);
    });
  });
}
const views = $$(".desk-t [data-desk]");
tabset(views, (b) => {
  views.forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  $$(".mk-desk .dp").forEach((p) => (p.hidden = p.id !== "dp-" + b.dataset.desk));
});
const filters = $$(".mk-tabs [data-f]");
tabset(filters, (b) => {
  const f = b.dataset.f;
  filters.forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  $$(".mk-desk tbody tr[data-cls]").forEach((r) => (r.hidden = f !== "all" && r.dataset.cls !== f));
  $$(".mk-grid, .mk-cls").forEach((g) => (g.hidden = f !== "all" && g.dataset.cls !== f));
});

// ---------------------------------------------------------------- sorting the board
const board = document.getElementById("board");
if (board) {
  const tb = board.tBodies[0], order = [...tb.rows];
  $$(".sort", board).forEach((s) => s.addEventListener("click", () => {
    const k = s.dataset.sort, cur = s.dataset.dir, dir = cur === "desc" ? "asc" : cur === "asc" ? "" : "desc";
    $$(".sort", board).forEach((x) => delete x.dataset.dir);
    if (dir) s.dataset.dir = dir;
    const rows = dir ? [...tb.rows].sort((a, b) => {
      const va = k === "name" ? a.dataset.name : Number(a.dataset[k]), vb = k === "name" ? b.dataset.name : Number(b.dataset[k]);
      const c = k === "name" ? String(va).localeCompare(vb) : va - vb;
      return dir === "asc" ? c : -c;
    }) : order;
    tb.append(...rows);
  }));
  // a whole row opens that market's brief
  tb.addEventListener("click", (e) => { if (e.target.closest("a,button")) return; const r = e.target.closest("tr[data-href]"); if (r) location.hash = r.dataset.href; });
}

// ---------------------------------------------------------------- tooltips for the signal matrix and the driver bars
const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; tip.setAttribute("role", "tooltip"); document.body.append(tip);
function showTip(el) {
  const t = el.dataset.tip || el.getAttribute("title"); if (!t) return;
  if (el.hasAttribute("title")) { el.dataset.tip = t; el.removeAttribute("title"); }
  tip.textContent = t; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = Math.min(320, innerWidth - 24); tip.style.maxWidth = w + "px";
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2; x = Math.max(12, Math.min(innerWidth - tw - 12, x));
  let y = r.top - th - 8; if (y < 8) y = r.bottom + 8;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => (tip.hidden = true);
$$("[data-tip], .drv li[title]").forEach((el) => {
  el.addEventListener("mouseenter", () => showTip(el)); el.addEventListener("mouseleave", hideTip);
  el.addEventListener("focus", () => showTip(el)); el.addEventListener("blur", hideTip);
  el.addEventListener("click", () => (tip.hidden ? showTip(el) : hideTip()));
});
addEventListener("scroll", hideTip, { passive: true });

// ---------------------------------------------------------------- phones: open each brief on demand
$$(".bf").forEach((bf) => {
  const n = $$(".pro li, .con li", bf).length;
  const b = document.createElement("button");
  b.type = "button"; b.className = "btn sm bf-more"; b.setAttribute("aria-expanded", "false");
  const label = () => (bf.classList.contains("open") ? "Hide the data" : `Show the data${n ? ` (${n} points)` : ""}`);
  b.textContent = label();
  b.addEventListener("click", () => { bf.classList.toggle("open"); b.setAttribute("aria-expanded", String(bf.classList.contains("open"))); b.textContent = label(); });
  bf.querySelector(".bf-v").after(b);
});
function openHash() {
  const t = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (t && t.classList.contains("bf")) { t.classList.add("open"); const b = t.querySelector(".bf-more"); if (b) { b.setAttribute("aria-expanded", "true"); b.textContent = "Hide the data"; } }
}
addEventListener("hashchange", openHash); openHash();

// ---------------------------------------------------------------- copy as a Telegram post
$$("[data-copy]").forEach((btn) => btn.addEventListener("click", async () => {
  const t = btn.closest(".bf, .one-brief").querySelector("template.bf-post"), text = t ? t.content.textContent.trim() : "";
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into Telegram."); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.append(ta); ta.select();
    try { document.execCommand("copy"); toast("Copied. Paste it into Telegram."); } catch { toast("Couldn't copy here. Select the text and copy it instead."); }
    ta.remove();
  }
}));

// ---------------------------------------------------------------- candlestick charts: timeframe, a crosshair with the candle's numbers, the live candle
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
$$("[data-pc]").forEach((fig) => {
  const tfs = $$(".pc-tf [data-tf]", fig);
  tabset(tfs, (b) => { tfs.forEach((x) => x.setAttribute("aria-selected", String(x === b))); $$(".pc-v", fig).forEach((v) => (v.hidden = v.dataset.tf !== b.dataset.tf)); });
});
const charts = [];
$$("svg.pc-svg").forEach((svg) => {
  let D; try { D = JSON.parse(svg.dataset.c); } catch { return; }
  const ro = svg.closest(".pc-v").querySelector(".pc-ro"), q = (s) => svg.querySelector(s);
  const xh = q(".xh"), xv = q(".xv"), xz = q(".xz"), xt = q(".xt"), xtt = q(".xtt"), xd = q(".xd"), xdt = q(".xdt");
  const n = D.b.length, step = (D.W - D.L - D.R) / n, bw = Math.max(1.2, Math.min(15, step * 0.66));
  const X = (k) => D.L + step * (k + 0.5), Y = (v) => Math.max(D.T, Math.min(D.H - D.B, D.T + (1 - (v - D.y0) / (D.y1 - D.y0)) * (D.H - D.T - D.B)));
  const V = (y) => D.y0 + (1 - (y - D.T) / (D.H - D.T - D.B)) * (D.y1 - D.y0);
  const nf = (v) => D.pre + v.toLocaleString("en-US", { minimumFractionDigits: D.dp, maximumFractionDigits: D.dp });
  const day = (t) => { const d = new Date(t + "T12:00:00Z"); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };
  const label = (t) => { const d = new Date(t + "T12:00:00Z"); return `${D.tf === "w" ? "Week to " : WD[d.getUTCDay()] + " "}${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const read = (k) => {
    const c = D.b[k], p = D.b[k - 1], ch = p ? c[4] / p[4] - 1 : null;
    return `<b>${label(c[0])}</b><span>O <i>${nf(c[1])}</i></span><span>H <i>${nf(c[2])}</i></span><span>L <i>${nf(c[3])}</i></span><span>C <i>${nf(c[4])}</i></span>` +
      (ch == null ? "" : `<span class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch * 100).toFixed(2)}%</span>`);
  };
  let over = false;
  function show(e) {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (D.W / r.width), y = (e.clientY - r.top) * (D.H / r.height);
    if (x < D.L || x > D.W - D.R || y < D.T || y > D.H - D.B) return hide();
    over = true;
    const k = Math.max(0, Math.min(n - 1, Math.floor((x - D.L) / step))), xx = X(k), tw = D.W < 600 ? 84 : 74, tx = Math.max(D.L, Math.min(D.W - D.R - tw, xx - tw / 2));
    xv.setAttribute("d", `M${xx} ${D.T}V${D.H - D.B}`); xz.setAttribute("d", `M${D.L} ${y}H${D.W - D.R}`);
    const th = +xt.getAttribute("height"); xt.setAttribute("y", y - th / 2); xtt.setAttribute("y", y + th / 2 - 5); xtt.textContent = nf(V(y));
    xd.setAttribute("x", tx); xd.setAttribute("width", tw); xdt.setAttribute("x", tx + tw / 2); xdt.textContent = day(D.b[k][0]);
    xh.setAttribute("visibility", "visible"); ro.innerHTML = read(k);
  }
  function hide() { over = false; xh.setAttribute("visibility", "hidden"); ro.innerHTML = read(n - 1); }
  svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show); svg.addEventListener("pointerleave", hide);
  // the last candle follows the live price while it's still forming
  const lc = q(".lc"), lw = q(".lc .w"), lb = q(".lc .b"), lp = q(".lpx"), lpl = q(".lpl"), lpr = q(".lpx rect"), lpt = q(".lpx text");
  function live(p) {
    const c = D.b[n - 1]; if (!(p > 0) || !lc || Math.abs(p / c[4] - 1) > 0.15) return;
    c[4] = p; c[2] = Math.max(c[2], p); c[3] = Math.min(c[3], p);
    const xx = X(n - 1), up = c[4] >= c[1], ya = Y(Math.max(c[1], c[4])), yb = Math.max(Y(Math.min(c[1], c[4])), ya + 1), yl = Y(p), prev = D.b[n - 2];
    lc.setAttribute("class", "lc " + (up ? "u" : "d"));
    lw.setAttribute("d", `M${xx.toFixed(1)} ${Y(c[2]).toFixed(1)}V${Y(c[3]).toFixed(1)}`);
    lb.setAttribute("d", `M${(xx - bw / 2).toFixed(1)} ${ya.toFixed(1)}h${bw.toFixed(1)}V${yb.toFixed(1)}h${(-bw).toFixed(1)}Z`);
    lp.setAttribute("class", "lpx " + ((prev ? p >= prev[4] : up) ? "u" : "d"));
    const th = +lpr.getAttribute("height"); lpl.setAttribute("d", `M${D.L} ${yl.toFixed(1)}H${D.W - D.R}`); lpr.setAttribute("y", (yl - th / 2).toFixed(1)); lpt.setAttribute("y", (yl + th / 2 - 5).toFixed(1)); lpt.textContent = nf(p);
    if (!over) ro.innerHTML = read(n - 1);
  }
  if (svg.dataset.liveC) charts.push({ id: svg.dataset.liveC, live });
});

// ---------------------------------------------------------------- live prices, once every 20 seconds while the page is visible
const nodes = $$("[data-live]");
const pct = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x * 100).toFixed(2) + "%";
let last = {};
async function poll() {
  if (document.hidden || (!nodes.length && !charts.length)) return;
  try {
    const r = await fetch("/api/markets/live", { cache: "no-store" }); if (!r.ok) return;
    const j = await r.json(); if (!j || !j.q) return;
    for (const el of nodes) {
      const q = j.q[el.dataset.live]; if (!q) continue;
      const px = el.querySelector(".px"), ch = el.querySelector(".ch");
      if (px && px.textContent !== q.txt) {
        const prev = last[el.dataset.live];
        px.textContent = q.txt;
        if (prev && !reduce) { const up = parseFloat(q.txt.replace(/[^\d.]/g, "")) >= parseFloat(prev.replace(/[^\d.]/g, "")); el.classList.remove("flash-up", "flash-dn"); void el.offsetWidth; el.classList.add(up ? "flash-up" : "flash-dn"); }
      }
      if (ch && q.ch != null) { ch.textContent = pct(q.ch); ch.className = ch.className.replace(/\b(up|dn)\b/g, "").trim() + " " + (q.ch >= 0 ? "up" : "dn"); }
    }
    for (const c of charts) { const v = j.q[c.id]; if (v && v.live && v.p) c.live(v.p); }
    for (const [k, v] of Object.entries(j.q)) last[k] = v.txt;
  } catch { /* try again next time */ }
}
$$("[data-live] .px").forEach((p) => { const id = p.closest("[data-live]").dataset.live; last[id] = last[id] || p.textContent; });
if (nodes.length || charts.length) { setInterval(poll, 20000); setTimeout(poll, 3000); document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); }); }
})();
