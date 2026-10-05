// Markets: live prices, the desk views (board, signal matrix, positioning, track record), filters, sorting,
// tooltips, local times and countdowns, phone expanders, and copying a brief as a Telegram post.
(() => {
"use strict";
document.documentElement.classList.add("js");
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const escH = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const toastEl = document.getElementById("toast");
let toastT = 0;
function toast(msg) { if (!toastEl) return; toastEl.textContent = msg; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2600); }

// ---------------------------------------------------------------- times in the visitor's own time zone, and countdowns
const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hm = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
$$("time[data-utc]").forEach((t) => { t.textContent = (t.dataset.fmt === "t" ? hm : fmt).format(new Date(Number(t.dataset.utc) * 1000)); });
const cds = $$("[data-cd]");
function tick() {
  const n = Date.now() / 1000;
  $$(".cal-i").forEach((li) => li.classList.toggle("past", Number(li.dataset.utc) < n - 900));
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
function bindTip(el) {
  el.addEventListener("mouseenter", () => showTip(el)); el.addEventListener("mouseleave", hideTip);
  el.addEventListener("focus", () => showTip(el)); el.addEventListener("blur", hideTip);
  el.addEventListener("click", () => (tip.hidden ? showTip(el) : hideTip()));
}
$$("[data-tip], .drv li[title]").forEach(bindTip);
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
  if (document.hidden) return;
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
    if (window.gsCalcPrices) window.gsCalcPrices(j.q);
    for (const [k, v] of Object.entries(j.q)) last[k] = v.txt;
  } catch { /* try again next time */ }
}
$$("[data-live] .px").forEach((p) => { const id = p.closest("[data-live]").dataset.live; last[id] = last[id] || p.textContent; });
if (nodes.length || charts.length || document.querySelector("[data-calc]")) { setInterval(poll, 20000); setTimeout(poll, 3000); document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); }); }
// ---------------------------------------------------------------- the header and the in-page navigation stay out of each other's way
const sub = document.querySelector(".mk-sub");   // the shared header script keeps --top-h up to date
if (sub && "IntersectionObserver" in window) {
  const links = $$("a", sub), secs = links.map((a) => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean), seen = new Map();
  const io = new IntersectionObserver((es) => {
    for (const e of es) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
    const on = secs.find((x) => (seen.get(x.id) || 0) > 0);
    links.forEach((a) => { const hit = on && a.getAttribute("href") === "#" + on.id; a.classList.toggle("on", !!hit); const row = sub.firstElementChild; if (hit && row.scrollWidth > row.clientWidth) row.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" }); });
  }, { rootMargin: "-130px 0px -55% 0px", threshold: [0, 0.01] });
  secs.forEach((x) => io.observe(x));
}

// ---------------------------------------------------------------- market hours: the sessions drawn in the visitor's own day
const ck = document.querySelector("[data-ck]");
if (ck) {
  let D; try { D = JSON.parse(ck.dataset.ck); } catch { D = { s: [], e: [] }; }
  const rail = ck.querySelector("[data-ck-rail]"), FMT = {};
  const memo = new Map();
  const parts = (tz, ms) => {
    const key = tz + ms, hit = memo.get(key); if (hit) return hit;
    const f = FMT[tz] || (FMT[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
    const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    const r = { wd: o.weekday, m: (Number(o.hour) % 24) * 60 + Number(o.minute) };
    if (memo.size > 20000) memo.clear();
    memo.set(key, r); return r;
  };
  // forex and gold close from Friday 17:00 to Sunday 17:00, New York time
  const weekend = (ms) => { const p = parts("America/New_York", ms); return p.wd === "Sat" || (p.wd === "Fri" && p.m >= 1020) || (p.wd === "Sun" && p.m < 1020); };
  const open = (s, ms) => { if (weekend(ms)) return false; const p = parts(s[1], ms); return p.wd !== "Sat" && p.wd !== "Sun" && p.m >= s[2] * 60 && p.m < s[3] * 60; };
  const STEP = 5 * 60000, dur = (ms) => { const m = Math.max(1, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; return d ? `${d} d ${h} h` : h ? `${h} h ${mm} min` : `${mm} min`; };
  const nextChange = (test, from, max = 3 * 86400000) => { const now = test(from); for (let t = from + STEP - (from % STEP); t < from + max; t += STEP) if (test(t) !== now) return t; return null; };
  const runs = (test, a, b) => { const out = []; let st = null; for (let t = a; t <= b; t += STEP) { const on = t < b && test(t); if (on && st === null) st = t; if (!on && st !== null) { out.push([st, t]); st = null; } } return out; };
  const tzName = (() => { try { return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value; } catch { return ""; } })();
  let built = "";
  function draw() {
    const now = Date.now(), bounds = (o) => { const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + o); const y = new Date(x); y.setDate(y.getDate() + 1); return [x, x.getTime(), y.getTime()]; };
    // a day with little or no trading (the weekend) shows the next trading day instead, unless the market is open right now
    let off = 0;
    while (off < 3) {
      if (off === 0 && !weekend(now)) break;
      const [, p, q] = bounds(off), openMin = runs((t) => !weekend(t), off === 0 ? Math.max(p, now - (now % STEP)) : p, q).reduce((n, [x, y]) => n + (y - x) / 60000, 0);   // today: only what's still ahead
      if (openMin >= 360) break; off++;
    }
    const [d0, a, b] = bounds(off);
    const X = (t) => (((t - a) / (b - a)) * 100).toFixed(3) + "%";
    const narrow = rail.clientWidth < 520;
    if (built !== a + ":" + narrow + ":" + off) {
      built = a + ":" + narrow + ":" + off;
      let h = `<div class="ck-row" style="top:0"><span class="ck-evl">Releases</span></div>`;
      D.s.forEach((s, k) => {
        h += `<div class="ck-row" style="top:${30 + k * 30}px"><span class="nm">${s[0]}</span><span class="tr"></span>${runs((t) => open(s, t), a, b).map(([x, y]) => `<span class="ck-bar" data-s="${k}" data-a="${x}" data-b="${y}" style="left:${X(x)};width:${(((y - x) / (b - a)) * 100).toFixed(3)}%"></span>`).join("")}</div>`;
      });
      const lon = D.s.find((s) => s[0] === "London"), ny = D.s.find((s) => s[0] === "New York");
      if (lon && ny) h += runs((t) => open(lon, t) && open(ny, t), a, b).map(([x, y]) => `<div class="ck-ov" style="left:${X(x)};width:${(((y - x) / (b - a)) * 100).toFixed(3)}%"><span>${narrow ? "Overlap" : "London and New York"}</span></div>`).join("");
      h += runs(weekend, a, b).map(([x, y]) => `<div class="ck-we" style="left:${X(x)};width:${(((y - x) / (b - a)) * 100).toFixed(3)}%"><span>Closed for the weekend</span></div>`).join("");
      for (const [u, c, t] of D.e) { const ms = u * 1000; if (ms >= a && ms < b) { const lab = escH(`${hm.format(new Date(ms))} ${c} ${t}`); h += `<button type="button" class="ck-ev" data-utc="${Number(u)}" style="left:${X(ms)}" data-tip="${lab}" aria-label="${lab}"></button>`; } }
      const step = narrow ? 6 : 3; let ax = ""; for (let hh = 0; hh < 24; hh += step) { const t = new Date(d0); t.setHours(hh); ax += `<span style="left:${X(t.getTime())}">${String(hh).padStart(2, "0")}:00</span>`; }
      h += `<div class="ck-ax">${ax}</div>${off ? `<span class="ck-day">${off === 1 ? "Tomorrow" : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(d0)}, the next trading day</span>` : `<div class="ck-nowl"></div>`}`;
      rail.innerHTML = h; $$(".ck-ev", rail).forEach(bindTip);
    }
    const nl = rail.querySelector(".ck-nowl"); if (nl) nl.style.left = X(now);
    $$(".ck-bar", rail).forEach((e) => e.classList.toggle("on", now >= Number(e.dataset.a) && now < Number(e.dataset.b)));
    $$(".ck-ev", rail).forEach((e) => e.classList.toggle("past", Number(e.dataset.utc) * 1000 < now));
    ck.querySelector("[data-ck-time]").textContent = hm.format(new Date(now));
    ck.querySelector("[data-ck-tz]").textContent = "Your time" + (tzName ? ", " + tzName : "");
    // each session's state and its next open or close, in the visitor's own time
    const isOpen = D.s.map((s) => open(s, now));
    D.s.forEach((s, k) => {
      const li = ck.querySelector(`[data-ck-s="${s[0]}"]`); if (!li) return;
      const nx = nextChange((t) => open(s, t), now);
      let st = nx ? (isOpen[k] ? `Open, closes in ${dur(nx - now)}` : `Opens in ${dur(nx - now)}`) : "";
      if (!isOpen[k] && weekend(now)) st = nx ? `Weekend, opens in ${dur(nx - now)}` : "Closed for the weekend";
      li.classList.toggle("on", isOpen[k]); li.querySelector("[data-ck-c]").textContent = st;
      // the session's hours in the visitor's time: this one if it's open, otherwise the next
      const o0 = isOpen[k] ? now : nx, c0 = o0 ? nextChange((t) => open(s, t), o0 + STEP) : null;
      let oA = o0; if (isOpen[k]) { oA = now; for (let t = now - (now % STEP); t > now - 86400000; t -= STEP) { if (!open(s, t)) { oA = t + STEP; break; } } }
      if (oA && c0) li.querySelector("[data-ck-h]").textContent = `${hm.format(new Date(oA))} to ${hm.format(new Date(c0))} your time`;
    });
    const on = D.s.filter((s, k) => isOpen[k]).map((s) => s[0]), stEl = ck.querySelector("[data-ck-st]");
    let txt;
    if (weekend(now)) { const nx = nextChange((t) => !weekend(t), now, 3 * 86400000); txt = `Forex and gold are closed for the weekend${nx ? `, and open again in <b>${dur(nx - now)}</b> (${fmt.format(new Date(nx))} your time)` : ""}.`; }
    else if (on.includes("London") && on.includes("New York")) txt = `<b>London and New York</b> are both open: usually the busiest hours for gold and the dollar.`;
    else if (on.length) { const nextS = D.s.filter((s, k) => !isOpen[k]).map((s) => ({ n: s[0], t: nextChange((t) => open(s, t), now) })).filter((x) => x.t).sort((x, y) => x.t - y.t)[0];
      txt = `<b>${on.join(" and ")}</b> ${on.length > 1 ? "are" : "is"} open.${nextS ? ` ${nextS.n} opens in ${dur(nextS.t - now)}.` : ""}`; }
    else txt = "Between sessions: forex is quiet until the next one opens.";
    const ev = D.e.find(([u]) => u * 1000 > now), usd = D.e.find(([u, c]) => c === "USD" && u * 1000 > now);
    if (ev) txt += ` Next high-impact release: <b>${escH(ev[1] + " " + ev[2])}</b> in ${dur(ev[0] * 1000 - now)}.`;
    if (usd) txt += ` <a href="/#how">GoldenStraddler</a> arms five seconds before ${usd === ev ? "it" : "the next USD one, " + escH(usd[2])}.`;
    stEl.innerHTML = txt;
  }
  draw(); setInterval(draw, 30000); addEventListener("resize", () => { built = ""; draw(); });
}

// ---------------------------------------------------------------- how markets moved: the period
const hmBox = document.querySelector(".hm"), hmTabs = $$(".hm-t [data-hm]");
if (hmBox) tabset(hmTabs, (b) => { hmTabs.forEach((x) => x.setAttribute("aria-selected", String(x === b))); hmBox.dataset.p = b.dataset.hm; });

// ---------------------------------------------------------------- releases: next up or the full week, grouped by the visitor's own days
const nvs = $$("[data-nv]");
tabset(nvs, (b) => { nvs.forEach((x) => x.setAttribute("aria-selected", String(x === b))); $$("[data-nv-p]").forEach((p) => (p.hidden = p.dataset.nvP !== b.dataset.nv)); });
const cal = document.querySelector("[data-cal]");
if (cal) {
  const list = cal.querySelector(".cal-l"), items = $$(".cal-i", list), dfmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
  const today = new Date(); today.setHours(0, 0, 0, 0); const tom = new Date(today); tom.setDate(tom.getDate() + 1);
  let prev = "";
  for (const li of items) {
    const d = new Date(Number(li.dataset.utc) * 1000), key = d.toDateString(); li.dataset.day = key;
    if (key !== prev) {
      const h = document.createElement("li"); h.className = "cal-d"; h.dataset.day = key;
      const lab = key === today.toDateString() ? "Today" : key === tom.toDateString() ? "Tomorrow" : "";
      h.innerHTML = (lab ? `<b>${lab}</b>` : "") + dfmt.format(d); list.insertBefore(h, li); prev = key;
    }
  }
  let ccy = "all";
  const med = cal.querySelector("[data-med]"), cbs = $$("button[data-ccy]", cal);
  const apply = () => {
    for (const li of items) li.hidden = (ccy !== "all" && li.dataset.ccy !== ccy) || (!med.checked && li.dataset.imp === "M");
    $$(".cal-d", list).forEach((h) => (h.hidden = !items.some((li) => li.dataset.day === h.dataset.day && !li.hidden)));
  };
  cbs.forEach((b) => b.addEventListener("click", () => { ccy = b.dataset.ccy; cbs.forEach((x) => x.setAttribute("aria-pressed", String(x === b))); apply(); }));
  med.addEventListener("change", apply); apply();
}

// ---------------------------------------------------------------- correlation: the look-back
const cws = $$("[data-cw]");
tabset(cws, (b) => { cws.forEach((x) => x.setAttribute("aria-selected", String(x === b))); $$("table.cor").forEach((t) => (t.hidden = t.dataset.w !== b.dataset.cw)); });

// ---------------------------------------------------------------- the position size calculator
const calc = document.querySelector("[data-calc]");
if (calc) {
  let M; try { M = JSON.parse(calc.dataset.calc); } catch { M = []; }
  const by = Object.fromEntries(M.map((m) => [m.id, m])), f = calc.elements, out = (k) => calc.querySelector(`[data-o="${k}"]`);
  const px = (id) => (by[id] && by[id].p > 0 ? by[id].p : null);
  const usdPer = (c) => ({ USD: 1, EUR: px("eurusd"), GBP: px("gbpusd"), AUD: px("audusd"), NZD: px("nzdusd"), JPY: px("usdjpy") && 1 / px("usdjpy"), CAD: px("usdcad") && 1 / px("usdcad"), CHF: px("usdchf") && 1 / px("usdchf") })[c] || null;
  const money = (v, c) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: c === "JPY" ? 0 : 2 }).format(v); } catch { return v.toFixed(2) + " " + c; } };
  const price = (m, v) => m.pre + v.toLocaleString("en-US", { minimumFractionDigits: m.dp, maximumFractionDigits: m.dp });
  let cur = null;
  function pick() {
    cur = by[f.m.value]; if (!cur) return;
    f.stop.value = cur.stop; f.size.value = cur.size;
    calc.querySelector("[data-stop-lab]").textContent = cur.fx ? "Stop loss, in pips" : "Stop loss, as a price move";
    calc.querySelector("[data-stop-u]").textContent = cur.fx ? "pips" : cur.pre || "price";
    calc.querySelector("[data-size-u]").textContent = cur.unit;
    out("perlab").textContent = cur.fx ? "One pip, per lot" : `A ${cur.pre || ""}1 move, per lot`;
    run();
  }
  function run() {
    const m = cur; if (!m) return;
    const A = f.ccy.value, bal = Number(f.bal.value), risk = Number(f.risk.value) / 100, stop = Number(f.stop.value), size = Number(f.size.value), lev = Number(f.lev.value);
    const kA = usdPer(A), kQ = usdPer(m.quote), kB = m.fx ? usdPer(m.s.slice(0, 3)) : 1, p = px(m.id);
    const dash = () => ["lots", "risk", "per", "margin"].forEach((k) => (out(k).textContent = "–"));
    out("px").textContent = p ? price(m, p) : "No price yet";
    if (!(bal > 0 && risk > 0 && stop > 0 && size > 0) || !kA || !kQ) return dash();
    const unitUsd = m.fx ? m.pip * size * kQ : size;               // a pip, or a 1.00 price move, on one lot, in dollars
    const perLot = stop * unitUsd, lots = Math.floor(((bal * risk * kA) / perLot) * 100 + 1e-9) / 100;
    out("lots").textContent = lots.toFixed(2);
    out("risk").textContent = money((lots * perLot) / kA, A) + (lots ? "" : "");
    out("per").textContent = money(unitUsd / kA, A);
    const notional = m.fx ? size * (kB || 0) : p ? size * p : 0;   // one lot's value in dollars
    out("margin").textContent = notional ? money((lots * notional) / lev / kA, A) : "–";
    if (!lots) out("risk").textContent = "Too small for 0.01 lots";
  }
  f.m.addEventListener("change", pick);
  ["ccy", "bal", "risk", "stop", "size", "lev"].forEach((k) => f[k].addEventListener("input", run));
  window.gsCalcPrices = (q) => { for (const [id, v] of Object.entries(q)) if (by[id] && v && v.p > 0) by[id].p = v.p; run(); };
  pick();
}
})();
