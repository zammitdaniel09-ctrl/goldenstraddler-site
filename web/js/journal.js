// GoldenStraddler Journal: the app. Hash routes, one global filter row, and views built with DOM calls (no HTML from data).
(() => {
"use strict";
const JS = window.JStats, JC = window.JCharts;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DEMO = new URLSearchParams(location.search).has("demo");
const MINUS = "−";

// ---------------------------------------------------------------- tiny DOM builder: strings become text, never HTML
function h(sel, attrs, kids) {
  if (Array.isArray(attrs) || typeof attrs === "string" || typeof attrs === "number" || attrs instanceof Node) { kids = attrs; attrs = {}; }
  sel = sel.replace(/\.(?=\.|$)/g, "");                         // "td.n." when an optional class is empty
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [], el = document.createElement(m[1] || "div");
  for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) part[0] === "." ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "style" && typeof v === "object") for (const [sk, sv] of Object.entries(v)) sk.startsWith("--") ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) { if (kids === undefined || kids === null || kids === false) return; for (const k of Array.isArray(kids) ? kids : [kids]) { if (k === null || k === undefined || k === false) continue; el.appendChild(k instanceof Node ? k : document.createTextNode(String(k))); } }
const icon = (id, cls) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("aria-hidden", "true"); if (cls) s.setAttribute("class", cls); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.appendChild(u); return s; };
const toastEl = $("#toast"); let toastT = 0;
function toast(msg, bad) { toastEl.textContent = msg; toastEl.classList.toggle("bad", !!bad); toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), Math.max(3200, String(msg).length * 60)); }

// ---------------------------------------------------------------- formatting
const ST = { data: null, trades: [], view: "overview", sub: "", f: { acc: "", range: "90", from: "", to: "", symbols: [], side: "", outcome: "", tags: [], pb: "", weekday: "", news: "", q: "" }, sel: new Set(), sort: { k: "ct", d: -1 }, shown: 150 };
const cur = () => { const a = ST.data && ST.f.acc && ST.data.accounts.find((x) => x.id === ST.f.acc); return (a && a.currency) || (ST.data && ST.data.prefs.currency) || "USD"; };
function money(v, o = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v), c = cur(), compact = o.compact && a >= 10000;
  let s; try { s = new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: compact ? 1 : a >= 1000 ? 0 : 2, minimumFractionDigits: compact ? 0 : a >= 1000 ? 0 : 2, notation: compact ? "compact" : "standard" }).format(a); } catch { s = a.toFixed(2) + " " + c; }
  return (v < -0.0049 ? MINUS : o.sign && v > 0.0049 ? "+" : "") + s;
}
const pct = (v, dp = 1, sign) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : (v < 0 ? MINUS : sign && v > 0 ? "+" : "") + Math.abs(v * 100).toFixed(dp) + "%");
const fx = (v, dp = 2, sign) => (v === null || v === undefined || !Number.isFinite(v) ? (v === Infinity ? "∞" : "–") : (v < 0 ? MINUS : sign && v > 0 ? "+" : "") + Math.abs(v).toFixed(dp));
const rr = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : fx(v, 2, true) + "R");
const dur = (ms) => { if (!Number.isFinite(ms)) return "–"; const m = Math.round(ms / 60000); if (m < 1) return Math.max(1, Math.round(ms / 1000)) + "s"; if (m < 60) return m + "m"; const hh = Math.floor(m / 60); if (hh < 48) return hh + "h " + (m % 60) + "m"; return Math.round(hh / 24) + "d"; };
const tz = () => (ST.data && ST.data.prefs.tz) || "UTC";
const dt = (ms, o = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) => { try { return new Date(ms).toLocaleString(undefined, { ...o, timeZone: tz() }); } catch { return new Date(ms).toLocaleString(); } };
const dayName = (d, o = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { ...o, timeZone: "UTC" });
const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
const tagOf = (id) => ST.data.tags.find((t) => t.id === id), pbOf = (id) => ST.data.playbooks.find((p) => p.id === id), accOf = (id) => ST.data.accounts.find((a) => a.id === id);
const priceFmt = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : Math.abs(v) >= 1000 ? v.toFixed(2) : Math.abs(v) >= 10 ? v.toFixed(3).replace(/0$/, "") : v.toFixed(5).replace(/0+$/, "").replace(/\.$/, ""));

// ---------------------------------------------------------------- server calls
async function api(path, body, method) {
  if (DEMO && (body !== undefined || method)) { toast("This is sample data, so changes aren't saved."); throw Object.assign(new Error("demo"), { demo: true }); }
  const r = await fetch("/api/journal/" + path, { method: method || (body !== undefined ? "POST" : "GET"), headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { gate("signin"); throw new Error("Sign in first."); }
  if (!r.ok || j.ok === false) throw Object.assign(new Error(j.error || "Something went wrong. Try again."), { status: r.status, why: j.why });
  return j;
}
const save = async (path, body, method) => { try { return await api(path, body, method); } catch (e) { if (!e.demo) toast(e.message, true); throw e; } };

// ---------------------------------------------------------------- data in, enriched once
function load(d) {
  ST.data = d;
  const pbName = new Map(d.playbooks.map((p) => [p.id, p.id]));
  d.events = (d.events || []).slice().sort((a, b) => a.t - b.t);
  ST.trades = JS.enrich(d.trades.map((t) => ({ ...t, pb: t.pb && pbName.has(t.pb) ? t.pb : t.pb ? t.pb : null })), { tz: d.prefs.tz, dayStart: d.prefs.dayStart, be: d.prefs.be, events: d.events || [] });
  ST.newsFrom = d.events && d.events.length ? d.events[0].t : null;
  ST.byId = new Map(ST.trades.map((t) => [t.id, t]));
  ST.charts = new Set(d.charts || []); ST.barCache = ST.barCache || new Map();
  ST.memo = null;
  $("#whoEmail").textContent = DEMO ? "Sample journal" : d.email;
  const toReview = ST.trades.filter((t) => !t.reviewed).length, nr = $("#navReview");
  nr.hidden = !toReview; nr.textContent = toReview > 99 ? "99+" : toReview;
  buildFilters();
}
function patchTrade(t) {
  const raw = ST.data.trades.findIndex((x) => x.id === t.id);
  if (raw >= 0) ST.data.trades[raw] = { ...ST.data.trades[raw], ...t };
  load(ST.data);
}
function startBalance() { const accs = ST.f.acc ? ST.data.accounts.filter((a) => a.id === ST.f.acc) : ST.data.accounts.filter((a) => !a.archived); return accs.reduce((s, a) => s + (a.balance_start || 0), 0); }

// ---------------------------------------------------------------- the global filter row
const RANGES = [["7", "7D", "Last 7 days"], ["30", "30D", "Last 30 days"], ["90", "90D", "Last 90 days"], ["ytd", "YTD", "This year"], ["365", "1Y", "Last 12 months"], ["all", "All", "All time"]];
function rangeBounds() {
  const r = ST.f.range, now = Date.now();
  if (r === "custom") { const p = (s, e) => (/^\d{4}-\d\d-\d\d$/.test(s) ? Date.parse(s + "T00:00:00Z") + (e ? 86400000 : 0) : undefined); return { from: p(ST.f.from), to: p(ST.f.to, true) }; }
  if (r === "all") return {};
  if (r === "ytd") return { from: Date.UTC(new Date().getUTCFullYear(), 0, 1) };
  return { from: now - Number(r) * 86400000 };
}
function filtered(extra = {}) {
  const key = JSON.stringify([ST.f, extra, ST.trades.length, ST.data && ST.data.prefs]);
  if (ST.memo && ST.memo.key === key) return ST.memo.v;
  const b = rangeBounds();
  const v = JS.filter(ST.trades, { account: ST.f.acc || undefined, from: b.from, to: b.to, symbols: ST.f.symbols, side: ST.f.side, outcome: ST.f.outcome, tags: ST.f.tags, playbook: ST.f.pb || undefined, weekday: ST.f.weekday, news: ST.f.news, q: ST.f.q, ...extra });
  ST.memo = { key, v };
  return v;
}
function buildFilters() {
  const acc = $("#fAcc"); acc.replaceChildren(h("option", { value: "" }, "All accounts"), ...ST.data.accounts.filter((a) => !a.archived).map((a) => h("option", { value: a.id }, a.name)));
  acc.value = ST.f.acc; acc.onchange = () => { ST.f.acc = acc.value; persistF(); render(); };
  const seg = $("#fRange"); seg.replaceChildren(...RANGES.map(([v, l, long]) => h("button", { type: "button", role: "radio", "aria-checked": String(ST.f.range === v), title: long, on: { click: () => { ST.f.range = v; persistF(); render(); } } }, l)),
    h("button", { type: "button", role: "radio", "aria-checked": String(ST.f.range === "custom"), on: { click: () => { ST.f.range = "custom"; openPanel(true); persistF(); render(); } } }, "Custom"));
  renderChips();
}
function persistF() { try { if (!DEMO) localStorage.setItem("gsj-f", JSON.stringify(ST.f)); } catch {} }
function activeExtra() { const f = ST.f; return (f.symbols.length ? 1 : 0) + (f.side ? 1 : 0) + (f.outcome ? 1 : 0) + (f.tags.length ? 1 : 0) + (f.pb ? 1 : 0) + (f.weekday !== "" ? 1 : 0) + (f.news ? 1 : 0) + (f.q ? 1 : 0) + (f.range === "custom" ? 1 : 0); }
function renderChips() {
  const n = activeExtra(), b = $("#fCount"); b.hidden = !n; b.textContent = n;
  const box = $("#fChips"), f = ST.f, chips = [];
  const chip = (label, clear) => chips.push(h("button.chip.dim", { type: "button", on: { click: () => { clear(); persistF(); render(); } }, "aria-label": "Remove filter " + label }, [label, icon("j-x", "cx")]));
  if (f.range === "custom") chip(`${f.from || "start"} to ${f.to || "today"}`, () => { f.range = "90"; });
  for (const s of f.symbols) chip(s, () => { f.symbols = f.symbols.filter((x) => x !== s); });
  if (f.side) chip(f.side === "long" ? "Longs" : "Shorts", () => { f.side = ""; });
  if (f.outcome) chip(f.outcome === "win" ? "Winners" : "Losers", () => { f.outcome = ""; });
  for (const t of f.tags) chip("#" + (tagOf(t)?.name || t), () => { f.tags = f.tags.filter((x) => x !== t); });
  if (f.pb) chip("Setup: " + (pbOf(f.pb)?.name || f.pb), () => { f.pb = ""; });
  if (f.weekday !== "") chip(JS.WD[+f.weekday], () => { f.weekday = ""; });
  if (f.news) chip(f.news === "yes" ? "Around news" : "Away from news", () => { f.news = ""; });
  if (f.q) chip(`“${f.q}”`, () => { f.q = ""; });
  box.replaceChildren(...chips, chips.length > 1 ? h("button.btn.xs.ghost", { type: "button", on: { click: () => { Object.assign(f, { symbols: [], side: "", outcome: "", tags: [], pb: "", weekday: "", news: "", q: "" }); if (f.range === "custom") f.range = "90"; persistF(); render(); } } }, "Clear all") : null);
  box.hidden = !chips.length;
}
function openPanel(force) {
  const p = $("#fPanel"), b = $("#fMore"), open = force === true ? true : p.hidden;
  p.hidden = !open; b.setAttribute("aria-expanded", String(open));
  if (!open) return;
  const f = ST.f, syms = [...new Set(ST.trades.map((t) => t.s))].sort();
  const sel = (label, value, opts, on) => h("label", [h("span", label), h("select.field", { on: { change: (e) => { on(e.target.value); persistF(); render(); } } }, opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l)))]);
  p.replaceChildren(h("div.j-fgrid", [
    h("label", [h("span", "From"), h("input.field", { type: "date", value: f.from, on: { change: (e) => { f.from = e.target.value; f.range = "custom"; persistF(); render(); } } })]),
    h("label", [h("span", "To"), h("input.field", { type: "date", value: f.to, on: { change: (e) => { f.to = e.target.value; f.range = "custom"; persistF(); render(); } } })]),
    sel("Symbol", "", [["", syms.length ? "Add a symbol" : "No symbols yet"], ...syms.filter((s) => !f.symbols.includes(s)).map((s) => [s, s])], (v) => { if (v) f.symbols = [...f.symbols, v]; }),
    sel("Direction", f.side, [["", "Both"], ["long", "Longs"], ["short", "Shorts"]], (v) => { f.side = v; }),
    sel("Result", f.outcome, [["", "All trades"], ["win", "Winners"], ["loss", "Losers"]], (v) => { f.outcome = v; }),
    sel("Setup", f.pb, [["", "Any setup"], ...ST.data.playbooks.map((p) => [p.id, p.name])], (v) => { f.pb = v; }),
    sel("Tag", "", [["", "Add a tag"], ...ST.data.tags.filter((t) => !f.tags.includes(t.id)).map((t) => [t.id, t.name])], (v) => { if (v) f.tags = [...f.tags, v]; }),
    sel("Weekday", f.weekday, [["", "Any day"], ...JS.WD.map((d, i) => [String(i), d])], (v) => { f.weekday = v; }),
    sel("High-impact news", f.news, [["", "All trades"], ["yes", "Around news"], ["no", "Away from news"]], (v) => { f.news = v; }),
    h("label.full", [h("span", "Search notes and symbols"), h("input.field", { type: "search", value: f.q, placeholder: "e.g. FOMC, early exit", on: { change: (e) => { f.q = e.target.value.trim(); persistF(); render(); } } })]),
  ]), h("div.j-fpanel-f", [h("button.btn.sm", { type: "button", on: { click: () => openPanel(false) } }, "Done")]));
}
$("#fMore").addEventListener("click", () => openPanel());

// ---------------------------------------------------------------- routing
const TITLES = { overview: "Overview", trades: "Trades", days: "Daily journal", analytics: "Analytics", playbooks: "Setups", discipline: "Discipline", coach: "AI coach", accounts: "Accounts and import", settings: "Settings" };
const VIEWS = {};
function route() {
  const m = /^#\/([a-z]+)(?:\/([\w-]+))?/.exec(location.hash) || [];
  ST.view = TITLES[m[1]] ? m[1] : "overview"; ST.sub = m[2] || "";
  $$(".j-nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.v === ST.view));
  if (a11yMenu.open) a11yMenu.set(false);
  render(true);
}
function render(scrollTop) {
  if (!ST.data) return;
  ST.memo = null;
  renderChips(); buildRangeState();
  $("#title").textContent = TITLES[ST.view];
  document.title = TITLES[ST.view] + " | GoldenStraddler Journal";
  const filt = !["accounts", "settings", "coach", "playbooks"].includes(ST.view);
  $("#filters").hidden = !filt; if (!filt) { $("#fPanel").hidden = true; $("#fChips").hidden = true; }
  const main = $("#main"), y = scrollTop ? 0 : scrollY;
  main.replaceChildren();
  try { VIEWS[ST.view](main); } catch (e) { console.error(e); main.replaceChildren(h("div.j-card", [h("h2", "Something went wrong drawing this page"), h("p.fine", String(e.message || e))])); }
  if (!scrollTop) scrollTo(0, y); else scrollTo(0, 0);
}
function buildRangeState() { $$("#fRange button").forEach((b, i) => b.setAttribute("aria-checked", String((RANGES[i] ? RANGES[i][0] : "custom") === ST.f.range))); }
addEventListener("hashchange", route);
const a11yMenu = { open: false, set(o) { this.open = o; $("#side").classList.toggle("open", o); $("#scrim").hidden = !o; $("#menuBtn").setAttribute("aria-expanded", String(o)); } };
$("#menuBtn").addEventListener("click", () => a11yMenu.set(!a11yMenu.open)); $("#scrim").addEventListener("click", () => a11yMenu.set(false));

// ---------------------------------------------------------------- shared pieces
const card = (title, kids, o = {}) => h("section.j-card" + (o.cls ? "." + o.cls : ""), [title ? h("div.j-ch", [h("h2", title), o.right || null]) : null, ...(Array.isArray(kids) ? kids : [kids])]);
const tile = (label, value, sub, o = {}) => h("div.j-tile" + (o.hero ? ".hero" : ""), [h("span.lab", label), h("b.v" + (o.k ? "." + o.k : ""), value), sub ? h("span.s", sub) : null]);
function empty(msg, action) { return h("div.j-empty", [h("p", msg), action || null]); }
function noTrades(main) {
  const has = ST.trades.length;
  main.appendChild(card(null, h("div.j-onb", has ? [h("h2", "No trades match these filters"), h("p", "Widen the period or clear a filter to see them."), h("button.btn.pri", { type: "button", on: { click: () => { Object.assign(ST.f, { range: "all", symbols: [], side: "", outcome: "", tags: [], pb: "", weekday: "", news: "", q: "" }); persistF(); render(); } } }, "Show everything")]
    : [h("h2", "Bring your trades in"), h("p", "Connect your MetaTrader 5 account so every closed trade arrives on its own, or import a report from MT4, MT5 or any platform that exports CSV."),
      h("div.j-onb-a", [h("a.btn.pri", { href: "#/accounts" }, "Connect or import"), DEMO ? null : h("a.btn", { href: "/journal/app?demo=1" }, "Explore sample data")])])));
}
const tagChip = (id) => { const t = tagOf(id); return t ? h("span.j-tag." + t.kind, t.name) : null; };
function stars(n, onSet) {
  const box = h("div.j-stars", { role: onSet ? "radiogroup" : null, "aria-label": "Rating" });
  for (let i = 1; i <= 5; i++) {
    const b = h(onSet ? "button" : "span", { type: onSet ? "button" : null, class: i <= (n || 0) ? "on" : "", role: onSet ? "radio" : null, "aria-checked": onSet ? String(i === n) : null, "aria-label": onSet ? i + " of 5" : null, on: onSet ? { click: () => onSet(i === n ? null : i) } : null }, icon("j-star"));
    box.appendChild(b);
  }
  return box;
}
function navTo(view, f) { if (f) { Object.assign(ST.f, f); persistF(); } location.hash = "#/" + view; if (("#/" + view) === location.hash) render(true); }

// ---------------------------------------------------------------- insights: plain sentences from the numbers, each with its sample
function insights(ts, s) {
  const out = [], MIN = 8;
  if (ts.length < 12) return out;
  const exp = s.expectancy;
  const pick = (dim, label) => {
    const rows = JS.group(ts, dim).rows.filter((r) => r.n >= MIN && r.key !== "Untagged" && r.key !== "No setup" && r.key !== "First trade");
    if (rows.length < 2) return;
    const best = rows.reduce((a, b) => (b.expectancy > a.expectancy ? b : a)), worst = rows.reduce((a, b) => (b.expectancy < a.expectancy ? b : a));
    if (worst.expectancy < 0 && worst.expectancy < exp - Math.abs(exp) * 0.5) out.push({ k: "bad", t: `${label(worst.key)} cost you ${money(Math.abs(worst.net))} over ${worst.n} trades, ${money(worst.expectancy)} a trade against ${money(exp, { sign: true })} overall.`, go: ["analytics", dim] });
    if (best.expectancy > 0 && best.expectancy > exp * 1.5 && best.key !== worst.key) out.push({ k: "good", t: `${label(best.key)} is your strongest: ${money(best.expectancy)} a trade over ${best.n} trades, win rate ${pct(best.winRate, 0)}.`, go: ["analytics", dim] });
  };
  const LONG = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
  pick("weekday", (k) => (LONG[k] || k) + "s"); pick("session", (k) => `The ${k} session`); pick("symbol", (k) => k); pick("playbook", (k) => `The ${pbOf(k)?.name || k} setup`);
  const st = JS.group(ts, "streakIn").rows, after2 = st.filter((r) => r.key === "After 2 losses" || r.key === "After 3+ losses"), n2 = after2.reduce((a, r) => a + r.n, 0);
  if (n2 >= MIN) { const net2 = after2.reduce((a, r) => a + r.net, 0), e2 = net2 / n2; if (e2 < exp) out.push({ k: "bad", t: `After two or more losses in a row you average ${money(e2)} a trade (${n2} trades) against ${money(exp)} otherwise. A pause rule could pay.`, go: ["analytics", "behaviour"] }); }
  const tg = JS.group(ts, "tag").rows.filter((r) => r.key !== "Untagged" && r.n >= 3 && tagOf(r.key)?.kind === "mistake").sort((a, b) => a.net - b.net)[0];
  if (tg && tg.net < 0) out.push({ k: "bad", t: `Trades tagged “${tagOf(tg.key).name}” lost ${money(Math.abs(tg.net))} across ${tg.n} trades. That's your most expensive mistake.`, go: ["analytics", "tags"] });
  if (s.holdLoss && s.holdWin && s.holdLoss > s.holdWin * 1.5 && s.losses >= MIN) out.push({ k: "bad", t: `You hold losers ${dur(s.holdLoss)} on average and winners ${dur(s.holdWin)}. Losers getting more time than winners is a classic leak.`, go: ["analytics", "time"] });
  const rs = ts.filter((t) => t.r !== null && t.loss), big = rs.filter((t) => t.r < -1.1);
  if (rs.length >= MIN && big.length / rs.length > 0.15) out.push({ k: "bad", t: `${pct(big.length / rs.length, 0)} of your losers lost more than 1R (${big.length} of ${rs.length}). Your stops aren't always holding.`, go: ["analytics", "risk"] });
  const ls = JS.group(ts, "side").rows;
  if (ls.length === 2 && ls.every((r) => r.n >= MIN)) { const [a, b] = ls[0].expectancy > ls[1].expectancy ? ls : [ls[1], ls[0]]; if (a.expectancy > 0 && b.expectancy < 0) out.push({ k: "info", t: `${a.key}s make money (${money(a.expectancy)} a trade over ${a.n}) and ${b.key.toLowerCase()}s lose (${money(b.expectancy)} over ${b.n}).`, go: ["analytics", "instruments"] }); }
  const nw = JS.group(ts, "news").rows, an = nw.find((r) => r.key === "Around news"), aw = nw.find((r) => r.key === "Away from news");
  if (an && aw && an.n >= MIN && aw.n >= MIN && Math.abs(an.expectancy - aw.expectancy) > Math.abs(exp) * 0.4)
    out.push({ k: an.expectancy > aw.expectancy ? "good" : "bad", t: `Around high-impact news you average ${money(an.expectancy, { sign: true })} a trade (${an.n} trades), against ${money(aw.expectancy, { sign: true })} away from it (${aw.n} trades).`, go: ["analytics", "news"] });
  return out.slice(0, 6);
}

// ================================================================ OVERVIEW
VIEWS.overview = (main) => {
  const ts = filtered();
  if (!ts.length) return noTrades(main);
  const s = JS.summary(ts, { start: startBalance() }), eq = JS.equity(ts, 0);
  main.appendChild(h("div.j-tiles", [
    tile("Net profit", money(s.net, { sign: true }), `${s.n} trades${s.returnPct != null ? `, ${pct(s.returnPct, 1, true)} on the starting balance` : ""}`, { hero: true, k: cls(s.net) }),
    tile("Win rate", pct(s.winRate, 0), `${s.wins} won, ${s.losses} lost`),
    tile("Profit factor", fx(s.pf), s.pf === null ? "" : s.pf >= 1 ? "won for every 1 lost" : "lost more than won"),
    tile("Expectancy", money(s.expectancy, { sign: true }), s.expR != null ? `${rr(s.expR)} a trade` : "per trade"),
    tile("Max drawdown", money(-s.maxDD), s.maxDDpct != null ? pct(-s.maxDDpct) + " from the peak" : "peak to trough"),
    tile("Avg win / loss", fx(s.payoff), `${money(s.avgWin)} vs ${money(-s.avgLoss)}`),
  ]));
  const lim = limitsCard(); if (lim) main.appendChild(lim);
  const curve = h("div.j-chart"), under = h("div.j-chart.sm");
  main.appendChild(card("Equity", [curve, h("p.j-sub", "Drawdown from the running peak"), under], { right: h("span.fine", `${s.days} trading days, ${dt(s.from, { day: "numeric", month: "short", year: "numeric" })} to ${dt(s.to, { day: "numeric", month: "short", year: "numeric" })}`) }));
  JC.line(curve, [{ name: "Net", pts: eq.pts.map((p) => [p.t, p.eq]), area: true }], { h: 250, fmt: (v) => money(v, { compact: true }), signColor: true, label: "Cumulative net profit", tfmt: (t) => dt(t, { day: "numeric", month: "short" }), tipT: (t) => dt(t, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) });
  JC.line(under, [{ name: "Drawdown", pts: eq.pts.map((p) => [p.t, p.dd]), area: true, color: "dn" }], { h: 110, fmt: (v) => money(v, { compact: true }), label: "Drawdown", ticks: 2 });
  const row = h("div.j-grid2"); main.appendChild(row);
  const left = h("div.j-stack"), side = h("div.j-stack"); row.append(left, side);
  left.appendChild(calendarCard(ts));
  const ins = insights(ts, s);
  side.appendChild(card("What stands out", ins.length ? h("ul.j-ins", ins.map((i) => h("li." + i.k, [h("i"), h("span", i.t), h("a", { href: "#/analytics/" + (["behaviour", "risk", "time", "tags", "instruments", "news"].includes(i.go[1]) ? i.go[1] : i.go[1] === "weekday" || i.go[1] === "session" ? "time" : i.go[1] === "symbol" ? "instruments" : i.go[1] === "playbook" ? "tags" : "overview") }, "See why")]))) : empty("Insights appear once there are about a dozen trades in the period."),
    { right: h("a.btn.xs", { href: "#/coach" }, [icon("j-spark"), "Ask the coach"]) }));
  const ru = JS.rules(ts, { ...ST.data.prefs.rules, tz: tz() }), rulesSet = Object.values(ST.data.prefs.rules).some((v) => v && v !== 15);
  left.appendChild(card("Discipline", rulesSet ? h("div.j-disc", [h("b.big." + (ru.score >= 80 ? "up" : ru.score >= 50 ? "" : "dn"), ru.score === null ? "–" : ru.score + "%"), h("p", [`${ru.cleanDays} of ${ru.days} days without breaking a rule. `, ru.brokenTrades ? `Trades that broke a rule made ${money(ru.cost, { sign: true })}.` : ""]), h("a", { href: "#/discipline" }, "See the rules")])
    : h("div.j-disc", [h("p", "Set your own rules (daily loss limit, max trades, stop loss on every trade) and the journal checks every day against them."), h("a.btn.sm", { href: "#/discipline" }, "Set your rules")])));
  main.appendChild(card("Recent trades", tradeTable(ts.slice(-8).reverse(), { compact: true }), { right: h("a.btn.xs", { href: "#/trades" }, "All trades") }));
};
// prop-firm style limits, checked on each account's closed trades from its first trade
function limitRows(a) {
  const ts = ST.trades.filter((t) => t.a === a.id), L = JS.limits(ts, a.limits, a.balance_start || 0, tz());
  if (!L || !L.length) return null;
  const c = a.currency || cur(), m = (v) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(Math.abs(v)); } catch { return Math.round(Math.abs(v)) + " " + c; } };
  const row = (label, val, used, state, note) => h("div.j-limr" + (state ? "." + state : ""), [h("div.t", [h("span", label), h("b", val)]), h("div.bar", h("i", { style: { width: Math.max(2, Math.min(100, used * 100)).toFixed(1) + "%" } })), note ? h("span.fine", note) : null]);
  return L.map((x) => {
    if (x.k === "daily") return row("Daily loss limit", `today ${x.today < 0 ? MINUS : ""}${m(x.today)} of ${m(x.cap)}`, x.used, x.used >= 1 ? "bad" : x.used >= 0.7 ? "warn" : "", x.breached ? `Broken before: worst day ${MINUS}${m(x.worst)}` : `Worst day so far ${x.worst < 0 ? MINUS : ""}${m(x.worst)}`);
    if (x.k === "dd") return row(x.label, `${m(x.now)} of ${m(x.cap)}`, x.used, x.breached ? "bad" : x.used >= 0.7 ? "warn" : "", x.breached ? `Broken: the worst drawdown reached ${m(x.worst)}` : `${m(Math.max(0, x.room))} of room left. Worst so far ${m(x.worst)}`);
    if (x.k === "target") return row("Profit target", `${x.now < 0 ? MINUS : ""}${m(x.now)} of ${m(x.cap)}`, x.used, x.done ? "done" : "", x.done ? "Target reached" : `${m(Math.max(0, x.cap - x.now))} to go`);
    if (x.k === "days") return row("Trading days", `${x.now} of ${x.cap}`, x.used, x.done ? "done" : "", x.done ? "Minimum reached" : `${x.cap - x.now} more to go`);
    return row("Best day's share of profit", `${pct(x.now, 0)}, limit ${pct(x.cap, 0)}`, x.used, x.breached ? "bad" : x.used >= 0.85 ? "warn" : "", x.breached ? "Over the limit: spread profit over more days" : "Within the limit");
  });
}
function limitsCard() {
  const accs = (ST.f.acc ? ST.data.accounts.filter((a) => a.id === ST.f.acc) : ST.data.accounts.filter((a) => !a.archived)).filter((a) => a.limits && Object.keys(a.limits).some((k) => k !== "firm"));
  const blocks = accs.map((a) => { const r = limitRows(a); return r ? h("div.j-lim", [h("h3", [a.name, a.limits.firm ? h("span.fine", " · " + a.limits.firm) : null]), h("div.j-limg", r)]) : null; }).filter(Boolean);
  if (!blocks.length) return null;
  return card("Account limits", [...blocks, h("p.fine", "Checked on closed trades from the account's first trade. Your firm also counts open positions and its own day boundary, so treat this as a guide.")], { right: h("a.btn.xs", { href: "#/accounts" }, "Edit limits") });
}

function calendarCard(ts) {
  const days = new Map(JS.days(ts).map((d) => [d.day, d])), notes = new Map(ST.data.days.map((d) => [d.day, d]));
  const last = ts.length ? ts[ts.length - 1].day : new Date().toISOString().slice(0, 10);
  if (!ST.calMonth) { ST.calMonth = last.slice(0, 7); if ([...days.keys()].filter((d) => d.startsWith(ST.calMonth)).length < 3 && days.size > 3) ST.calMonth = shiftMonth(ST.calMonth, -1); }
  const box = h("div");
  const draw = () => {
    const [y, m] = ST.calMonth.split("-").map(Number), first = new Date(Date.UTC(y, m - 1, 1)), startWd = (first.getUTCDay() + 6) % 7, nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthDays = [...days.values()].filter((d) => d.day.startsWith(ST.calMonth)), mx = Math.max(1e-9, ...monthDays.map((d) => Math.abs(d.net))), net = monthDays.reduce((a, d) => a + d.net, 0);
    const grid = h("div.j-cal", { role: "grid", "aria-label": "Daily results" }, JS.WD.map((d) => h("span.wd", d.slice(0, 2))));
    for (let i = 0; i < startWd; i++) grid.appendChild(h("span.pad"));
    for (let d = 1; d <= nDays; d++) {
      const key = `${ST.calMonth}-${String(d).padStart(2, "0")}`, x = days.get(key), nt = notes.get(key);
      const a = x ? Math.min(1, Math.sqrt(Math.abs(x.net) / mx)) : 0;
      const c = h("a.day" + (x ? (x.net >= 0 ? ".pos" : ".neg") : "") + (nt && nt.notes ? ".note" : ""), { href: "#/days/" + key, style: x ? { "--a": (0.14 + a * 0.7).toFixed(2) } : null, "aria-label": `${dayName(key)}${x ? `: ${money(x.net, { sign: true })}, ${x.n} trades` : ""}` },
        [h("span.n", d), x ? h("b", [h("span.lg", money(x.net, { compact: true, sign: true })), h("span.sm", shortMoney(x.net))]) : null, x ? h("span.c", x.n + (x.n === 1 ? " trade" : " trades")) : null]);
      grid.appendChild(c);
    }
    box.replaceChildren(h("div.j-calh", [h("button.btn.xs.ghost", { type: "button", "aria-label": "Previous month", on: { click: () => { ST.calMonth = shiftMonth(ST.calMonth, -1); draw(); } } }, icon("j-left")),
      h("b", new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })), h("span." + cls(net), money(net, { sign: true })),
      h("button.btn.xs.ghost", { type: "button", "aria-label": "Next month", on: { click: () => { ST.calMonth = shiftMonth(ST.calMonth, 1); draw(); } } }, icon("j-right"))]), grid);
  };
  draw();
  return card("Calendar", box);
}
const shortMoney = (v) => (v < 0 ? MINUS : "+") + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1) + "k" : Math.round(Math.abs(v)));
const shiftMonth = (ym, d) => { const [y, m] = ym.split("-").map(Number), t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };

// ================================================================ TRADES
const COLS = [["ct", "Closed"], ["s", "Symbol"], ["d", "Side"], ["v", "Lots"], ["op", "Entry"], ["cp", "Exit"], ["dur", "Held"], ["r", "R"], ["net", "Net"], ["pb", "Setup"], ["tags", "Tags"], ["rt", "Rating"]];
const HM = new Set(["v", "op", "cp", "dur", "pb", "rt", "tags"]);   // columns that step aside on phones
function tradeTable(ts, o = {}) {
  const cols = o.compact ? COLS.filter(([k]) => ["ct", "s", "d", "v", "r", "net", "tags"].includes(k)) : COLS;
  const t = h("table.j-t", [h("thead", h("tr", [o.select ? h("th.ck", h("input", { type: "checkbox", "aria-label": "Select all", checked: ts.length && ts.every((x) => ST.sel.has(x.id)), on: { change: (e) => { for (const x of ts) e.target.checked ? ST.sel.add(x.id) : ST.sel.delete(x.id); render(); } } })) : null,
    ...cols.map(([k, l]) => h("th" + (["v", "op", "cp", "dur", "r", "net"].includes(k) ? ".r" : "") + (HM.has(k) ? ".hm" : ""), o.sortable ? h("button.sort", { type: "button", "aria-sort": ST.sort.k === k ? (ST.sort.d > 0 ? "ascending" : "descending") : null, on: { click: () => { ST.sort = { k, d: ST.sort.k === k ? -ST.sort.d : -1 }; render(); } } }, [l, ST.sort.k === k ? (ST.sort.d > 0 ? " ↑" : " ↓") : ""]) : l)), h("th", "")]))]);
  const tb = h("tbody");
  for (const x of ts) {
    const tr = h("tr.click" + (ST.sel.has(x.id) ? ".sel" : ""), { tabindex: 0, on: { click: (e) => { if (e.target.closest("input,button,a")) return; openTrade(x.id, ts); }, keydown: (e) => { if (e.key === "Enter") openTrade(x.id, ts); } } }, [
      o.select ? h("td.ck", h("input", { type: "checkbox", "aria-label": "Select trade", checked: ST.sel.has(x.id), on: { change: (e) => { e.target.checked ? ST.sel.add(x.id) : ST.sel.delete(x.id); renderBulk(); tr.classList.toggle("sel", e.target.checked); } } })) : null,
      ...cols.map(([k]) => {
        if (k === "ct") return h("td.n.dim", dt(x.ct));
        if (k === "s") return h("td", h("b", x.s));
        if (k === "d") return h("td", h("span.j-dir." + (x.d > 0 ? "l" : "s"), x.d > 0 ? "Long" : "Short"));
        if (k === "v") return h("td.n.r.hm", fx(x.v, 2));
        if (k === "op") return h("td.n.r.dim.hm", priceFmt(x.op));
        if (k === "cp") return h("td.n.r.dim.hm", priceFmt(x.cp));
        if (k === "dur") return h("td.n.r.dim.hm", dur(x.dur));
        if (k === "r") return h("td.n.r." + cls(x.r), rr(x.r));
        if (k === "net") return h("td.n.r." + cls(x.net), money(x.net, { sign: true }));
        if (k === "pb") return h("td.hm", x.pb && pbOf(x.pb) ? h("span.j-pbc", pbOf(x.pb).name) : "");
        if (k === "tags") return h("td.tg.hm", (x.tags || []).slice(0, 3).map(tagChip));
        if (k === "rt") return h("td.hm", x.rt ? stars(x.rt) : "");
        return h("td");
      }),
      h("td.ic", [x.note ? icon("j-note", "has") : null, x.media && x.media.length ? icon("j-img", "has") : null, !x.reviewed ? h("i.unrev", { title: "Not reviewed yet" }) : null]),
    ]);
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  return h("div.j-tw", t);
}
function renderBulk() {
  const bar = $("#bulk"); if (!bar) return;
  const n = ST.sel.size; bar.hidden = !n; if (!n) return;
  bar.replaceChildren(h("b", `${n} selected`),
    h("select.field", { "aria-label": "Add a tag", on: { change: async (e) => { if (!e.target.value) return; const j = await save("trades/bulk", { ids: [...ST.sel], addTags: [e.target.value] }); ST.data.trades = j.trades; load(ST.data); render(); toast("Tagged."); } } }, [h("option", { value: "" }, "Add tag"), ...ST.data.tags.map((t) => h("option", { value: t.id }, t.name))]),
    h("select.field", { "aria-label": "Set setup", on: { change: async (e) => { if (e.target.value === "-") return; const j = await save("trades/bulk", { ids: [...ST.sel], playbook: e.target.value || null }); ST.data.trades = j.trades; load(ST.data); render(); toast("Setup set."); } } }, [h("option", { value: "-" }, "Set setup"), h("option", { value: "" }, "No setup"), ...ST.data.playbooks.map((p) => h("option", { value: p.id }, p.name))]),
    h("button.btn.sm", { type: "button", on: { click: async () => { const j = await save("trades/bulk", { ids: [...ST.sel], reviewed: true }); ST.data.trades = j.trades; load(ST.data); render(); toast("Marked as reviewed."); } } }, "Mark reviewed"),
    h("button.btn.sm.danger", { type: "button", on: { click: async () => { if (!confirm(`Delete ${n} trades from the journal? Their notes and screenshots go too.`)) return; const j = await save("trades/bulk", { ids: [...ST.sel], delete: true }); ST.sel.clear(); ST.data.trades = j.trades; load(ST.data); render(); toast("Deleted."); } } }, "Delete"),
    h("button.btn.sm.ghost", { type: "button", on: { click: () => { ST.sel.clear(); render(); } } }, "Clear"));
}
VIEWS.trades = (main) => {
  const ts = filtered();
  if (!ST.trades.length) return noTrades(main);
  const s = JS.summary(ts), k = ST.sort.k, d = ST.sort.d;
  const val = (t) => (k === "pb" ? (pbOf(t.pb)?.name || "") : k === "tags" ? (t.tags || []).length : t[k] ?? -Infinity);
  const sorted = [...ts].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * d; });
  main.appendChild(h("div.j-tbar", [
    h("div.j-tsum", [h("b", `${ts.length} trades`), h("span." + cls(s.net), money(s.net, { sign: true })), h("span", `win rate ${pct(s.winRate, 0)}`), h("span", `PF ${fx(s.pf)}`), s.expR != null ? h("span", `${rr(s.expR)} avg`) : null]),
    h("div.j-tacts", [h("label.j-search", [icon("j-search"), h("input", { type: "search", placeholder: "Search", value: ST.f.q, "aria-label": "Search trades", on: { change: (e) => { ST.f.q = e.target.value.trim(); persistF(); render(); } } })]),
      h("button.btn.sm", { type: "button", on: { click: () => manualTrade() } }, [icon("j-plus"), "Add trade"]), DEMO ? null : h("a.btn.sm", { href: "/api/journal/export.csv" }, [icon("j-dl"), "Export CSV"])]),
  ]));
  main.appendChild(h("div.j-bulk#bulk", { hidden: true }));
  if (!ts.length) { main.appendChild(empty("No trades match these filters.")); return; }
  const view = sorted.slice(0, ST.shown);
  main.appendChild(card(null, tradeTable(view, { select: true, sortable: true }), { cls: "flush" }));
  if (sorted.length > ST.shown) main.appendChild(h("div.j-showmore", h("button.btn", { type: "button", on: { click: () => { ST.shown += 300; render(); } } }, `Show ${Math.min(300, sorted.length - ST.shown)} more of ${sorted.length - ST.shown}`)));
  renderBulk();
};

// ---------------------------------------------------------------- one trade, in the drawer
const drawer = $("#drawer");
let dList = [], dIdx = -1, dTimer = 0;
function openTrade(id, list) {
  dList = list || filtered(); dIdx = dList.findIndex((t) => t.id === id);
  const t = ST.byId.get(id); if (!t) return;
  drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); document.body.classList.add("lock");
  drawTrade(t);
  // the coach's saved reviews, fetched once so the drawer can show them
  if (!ST.reviews && !DEMO) { ST.reviews = []; api("ai/list").then((j) => { ST.reviews = j.reviews || []; const cur = dList[dIdx]; if (drawer.classList.contains("open") && cur && ST.reviews.some((r) => r.trade === cur.id)) drawTrade(ST.byId.get(cur.id)); }).catch(() => { ST.reviews = null; }); }
}
function closeDrawer() { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); document.body.classList.remove("lock"); clearTimeout(dTimer); }
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (!$("#light").hidden) { $("#light").hidden = true; return; } if (!$("#modal").hidden) { closeModal(); return; } if (drawer.classList.contains("open")) closeDrawer(); }
  if (drawer.classList.contains("open") && !e.target.closest("textarea,input,select") && (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); step(e.key === "j" || e.key === "ArrowDown" ? 1 : -1); }
});
function step(d) { const n = dIdx + d; if (n < 0 || n >= dList.length) return; dIdx = n; drawTrade(ST.byId.get(dList[n].id) || dList[n]); }
async function upd(t, body) { if (DEMO) { Object.assign(ST.data.trades.find((x) => x.id === t.id) || {}, body); patchTrade({ id: t.id, ...body }); return; } const j = await save("trades/" + t.id, body); patchTrade(j.trade); return j.trade; }
function tradeMap(t) {
  // entry, exit, stop, target and how far the trade went each way, on one price line
  const pts = [["Stop", t.sl], ["Target", t.tp], ["Entry", t.op], ["Exit", t.cp], ["Worst", t.mae], ["Best", t.mfe]].filter(([, v]) => Number.isFinite(v) && v > 0);
  if (pts.length < 2) return null;
  const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1, P = (v) => ((v - lo) / span) * 100;
  const box = h("div.j-map", { role: "img", "aria-label": "Where the trade went" });
  const bar = h("div.track");
  if (Number.isFinite(t.mae) && Number.isFinite(t.mfe)) bar.appendChild(h("i.exc", { style: { left: P(Math.min(t.mae, t.mfe)) + "%", width: Math.abs(P(t.mfe) - P(t.mae)) + "%" } }));
  bar.appendChild(h("i.run." + (t.net >= 0 ? "pos" : "neg"), { style: { left: Math.min(P(t.op), P(t.cp)) + "%", width: Math.abs(P(t.cp) - P(t.op)) + "%" } }));
  // labels above (entry, stop, worst) and below (exit, target, best), each row on a near and a far line.
  // The important ones are placed first; worst and best give way when both lines are crowded (their numbers stay in Details)
  const UP = new Set(["Entry", "Stop", "Worst"]), ORDER = ["Entry", "Exit", "Stop", "Target", "Worst", "Best"], lines = { up: [[], []], dn: [[], []] };
  const gap = (arr, x) => arr.reduce((m, y) => Math.min(m, Math.abs(x - y)), 99);
  for (const [l, v] of [...pts].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))) {
    const row = UP.has(l) ? "up" : "dn", x = P(v), gN = gap(lines[row][0], x), gF = gap(lines[row][1], x);
    let far = gN < 13 && gF > gN;
    if (gN < 13 && gF < 13 && (l === "Worst" || l === "Best")) { bar.appendChild(h("span.m." + l.toLowerCase(), { style: { left: x + "%" }, title: `${l} ${priceFmt(v)}` })); continue; }
    lines[row][far ? 1 : 0].push(x);
    if (far) box.classList.add(row === "up" ? "fu" : "fd");
    const edge = x < 8 ? ".l" : x > 92 ? ".r" : "";
    bar.appendChild(h("span.m." + l.toLowerCase() + (far ? ".far" : "") + edge, { style: { left: x + "%" }, title: `${l} ${priceFmt(v)}` }, h("em", [l, h("b", priceFmt(v))])));
  }
  box.appendChild(bar);
  return box;
}
// ---------------------------------------------------------------- the price around a trade (from the MT5 connector), with a replay
const TF_NAME = { 60: "1-minute", 300: "5-minute", 900: "15-minute", 1800: "30-minute", 3600: "1-hour", 14400: "4-hour", 86400: "Daily" };
const barsFrom = (raw) => raw && Array.isArray(raw.b) && raw.b.length >= 2 ? { tf: raw.tf, bars: raw.b.map(([d, o, hh, l, c]) => ({ t: raw.t0 + d * raw.tf * 1000, o: raw.base + o * raw.pt, h: raw.base + hh * raw.pt, l: raw.base + l * raw.pt, c: raw.base + c * raw.pt })) } : null;
function tradeChart(t) {
  if (!DEMO && !ST.charts.has(t.id)) return null;
  const box = h("div.j-chart.j-tc"), head = h("div.j-tch", h("h3", "Price around the trade")), wrap = h("section.j-tcs", [head, box]);
  const show = (got) => {
    if (!got) { wrap.remove(); return; }
    const { tf, bars } = got, tfMs = tf * 1000, ccys = JS.symbolCcys(t.s);
    const evs = (ST.data.events || []).filter((e) => e.t >= bars[0].t && e.t <= bars[bars.length - 1].t + tfMs && ccys.includes(e.c)).map((e) => ({ t: e.t, label: JS.eventName(e.n, e.c) }));
    const o = { side: t.d, entry: { t: t.ot, p: t.op }, exit: { t: t.ct, p: t.cp }, sl: t.sl, tp: t.tp, events: evs, tf: tfMs, fmt: priceFmt, label: `${t.s} price around the trade` };
    const chart = JC.candles(box, bars, o);
    let timer = 0;
    const slider = h("input.j-tcs-r", { type: "range", min: 0, max: bars.length - 1, value: bars.length - 1, step: 1, "aria-label": "Replay position", on: { input: () => { stop(); o.upto = +slider.value; chart.draw(); } } });
    const btn = h("button.btn.xs", { type: "button", on: { click: () => (timer ? stop() : play()) } });
    const stop = () => { clearInterval(timer); timer = 0; btn.replaceChildren(icon("j-play"), "Replay"); };
    const play = () => {
      let i = +slider.value >= bars.length - 1 ? 0 : +slider.value;
      const by = Math.max(1, Math.round(bars.length / 250));
      btn.replaceChildren(icon("j-pause"), "Pause");
      timer = setInterval(() => { if (!box.isConnected) return stop(); i = Math.min(bars.length - 1, i + by); o.upto = i; slider.value = i; chart.draw(); if (i >= bars.length - 1) stop(); }, 40);
    };
    stop();
    head.replaceChildren(h("div", [h("h3", "Price around the trade"), h("span.fine", `${TF_NAME[tf] || ""} candles${DEMO ? ", simulated for the sample" : " from your broker"}${evs.length ? ". Gold lines mark high-impact releases" : ""}.`)]), h("div.j-tcr", [btn, slider]));
  };
  if (DEMO) show(synthBars(t));
  else if (ST.barCache.has(t.id)) show(ST.barCache.get(t.id));
  else { box.appendChild(h("p.jc-empty", "Loading the chart…")); api(`trades/${t.id}/bars`).then((j) => { const g = barsFrom(j.bars); ST.barCache.set(t.id, g); if (wrap.isConnected) show(g); }).catch(() => wrap.remove()); }
  return wrap;
}
// the sample journal has no broker data, so its charts are drawn to fit each made-up trade
function synthBars(t) {
  const dur = Math.max(60000, t.ct - t.ot);
  let tf = 60; for (const s of [60, 300, 900, 3600, 14400]) { tf = s; if ((dur + 60 * s * 1000) / (s * 1000) <= 260) break; }
  const tfMs = tf * 1000, start = Math.floor((t.ot - 30 * tfMs) / tfMs) * tfMs, end = t.ct + 30 * tfMs;
  let seed = [...t.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
  const long = t.d > 0, worst = Number.isFinite(t.mae) ? t.mae : t.op - (long ? 1 : -1) * Math.abs(t.cp - t.op) * 0.4, best = Number.isFinite(t.mfe) ? t.mfe : Math.max(t.op, t.cp);
  const span = Math.max(Math.abs(best - worst), Math.abs(t.cp - t.op), t.op * 0.0004);
  const win = t.net >= 0, a = t.ot + dur * (0.2 + rnd() * 0.2), b = t.ot + dur * (0.55 + rnd() * 0.3);
  const pts = [[start, t.op + gauss() * span * 0.6], [t.ot, t.op], ...(win ? [[a, worst], [b, best]] : [[a, best], [b, worst]]), [t.ct, t.cp], [end, t.cp + gauss() * span * 0.5]];
  const n = Math.ceil((end - start) / tfMs), sig = span / Math.sqrt(Math.max(4, dur / tfMs)) * 0.55, out = [];
  // a bridge between each pair of points, so the path passes through entry, the extremes and exit
  const path = []; for (let k = 0; k < pts.length - 1; k++) {
    const [ta, pa] = pts[k], [tb, pb] = pts[k + 1], m = Math.max(1, Math.round((tb - ta) / tfMs)); let w = 0; const ws = [0];
    for (let i = 1; i <= m; i++) ws.push(w += gauss() * sig);
    for (let i = k ? 1 : 0; i <= m; i++) path.push(pa + (pb - pa) * (i / m) + ws[i] - ws[m] * (i / m));
  }
  const lo = Math.min(worst, best), hi = Math.max(worst, best);
  let prev = path[0];
  for (let i = 0; i < Math.min(n, path.length - 1); i++) {
    const bt = start + i * tfMs, inTrade = bt + tfMs > t.ot && bt < t.ct;
    let o = prev, c = path[i + 1], hh = Math.max(o, c) + Math.abs(gauss()) * sig * 0.5, l = Math.min(o, c) - Math.abs(gauss()) * sig * 0.5;
    if (inTrade) { hh = Math.min(hh, hi); l = Math.max(l, lo); c = Math.min(hi, Math.max(lo, c)); o = Math.min(hi, Math.max(lo, o)); }
    out.push({ t: bt, o, h: Math.max(hh, o, c), l: Math.min(l, o, c), c }); prev = c;
  }
  return { tf, bars: out };
}
function drawTrade(t) {
  clearTimeout(dTimer);
  const acc = accOf(t.a), pb = t.pb && pbOf(t.pb);
  const facts = [["Account", acc ? acc.name : "–"], ["Opened", dt(t.ot, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })], ["Closed", dt(t.ct, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })], ["Held", dur(t.dur)],
    ["Lots", fx(t.v)], ["Entry", priceFmt(t.op)], ["Exit", priceFmt(t.cp)], ["Stop loss", priceFmt(t.sl)], ["Take profit", priceFmt(t.tp)], ["Risked", t.riskM != null ? money(t.riskM) : "–"],
    ["Gross", money(t.gross, { sign: true })], ["Costs", money(-t.cost)], ["Worst point (MAE)", t.maeM != null ? `${money(t.maeM)}${t.maeR != null ? " · " + rr(t.maeR) : ""}` : "–"], ["Best point (MFE)", t.mfeM != null ? `${money(t.mfeM, { sign: true })}${t.mfeR != null ? " · " + rr(t.mfeR) : ""}` : "–"],
    ["Captured of the best", t.mfeM > 0 ? pct(t.net / t.mfeM, 0) : "–"], ["Session", JS.session(t.ot)],
    ["High-impact news", t.ev ? `${JS.eventName(t.ev.n, t.ev.c)}, opened ${t.ev.min === 0 ? "at the release" : Math.abs(t.ev.min) + " min " + (t.ev.min > 0 ? "after" : "before")}` : t.news === false ? "None nearby" : "No news data"], ["Trade of the day", "#" + t.nInDay], ["Comment", t.comment || "–"]];
  const note = h("textarea.field.j-note", { rows: 6, placeholder: "Why you took it, how you managed it, what you'd do differently…", value: t.note || "", on: { input: () => { clearTimeout(dTimer); dTimer = setTimeout(() => upd(t, { note: note.value }).then(() => { stat.textContent = "Saved"; }).catch(() => {}), 900); stat.textContent = "Saving…"; } } });
  const stat = h("span.fine.j-saved", "");
  const tags = ST.data.tags;
  const tagBox = h("div.j-tagsel", ["mistake", "emotion", "custom"].map((kind) => h("div.grp", [h("span.lab", { mistake: "Mistakes", emotion: "Emotions", custom: "Other tags" }[kind]),
    h("div", [...tags.filter((g) => g.kind === kind).map((g) => h("button.j-tag." + g.kind + ((t.tags || []).includes(g.id) ? ".on" : ""), { type: "button", "aria-pressed": String((t.tags || []).includes(g.id)), on: { click: () => { const set = new Set(t.tags || []); set.has(g.id) ? set.delete(g.id) : set.add(g.id); upd(t, { tags: [...set] }).then(() => drawTrade(ST.byId.get(t.id))); } } }, g.name)),
      h("button.j-tag.add", { type: "button", on: { click: async () => { const name = prompt(`New ${kind === "custom" ? "tag" : kind} name`); if (!name) return; const j = await save("tags", { name, kind }); ST.data.tags.push(j.tag); await upd(t, { tags: [...(t.tags || []), j.tag.id] }); drawTrade(ST.byId.get(t.id)); } } }, "+ New")])])));
  const pbSel = h("select.field", { "aria-label": "Setup", on: { change: () => upd(t, { playbook: pbSel.value || null, checks: [] }).then(() => drawTrade(ST.byId.get(t.id))) } }, [h("option", { value: "" }, "No setup"), ...ST.data.playbooks.filter((p) => !p.archived || p.id === t.pb).map((p) => h("option", { value: p.id, selected: p.id === t.pb }, p.name))]);
  const checks = pb && pb.rules.length ? h("ul.j-checks", pb.rules.map((r, i) => h("li", h("label.check", [h("input", { type: "checkbox", checked: (t.checks || []).includes(i), on: { change: (e) => { const s = new Set(t.checks || []); e.target.checked ? s.add(i) : s.delete(i); upd(t, { checks: [...s] }); } } }), h("span", r)])))) : null;
  const shots = h("div.j-shots");
  const drawShots = () => { const tt = ST.byId.get(t.id) || t; shots.replaceChildren(...(tt.media || []).map((id) => h("figure", [h("img", { src: DEMO ? "" : "/api/journal/media/" + id, alt: "Screenshot", loading: "lazy", on: { click: (e) => lightbox(e.target.src) } }), h("button.j-x", { type: "button", "aria-label": "Remove screenshot", on: { click: async () => { await upd(tt, { media: (tt.media || []).filter((m) => m !== id) }); drawShots(); } } }, icon("j-x"))])),
    h("label.j-addshot", [icon("j-img"), h("span", "Add a screenshot"), h("span.fine", "or paste one"), h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, on: { change: async (e) => { for (const f of e.target.files) await uploadShot(f, (id) => upd(ST.byId.get(t.id), { media: [...(ST.byId.get(t.id).media || []), id] })); drawShots(); } } })])); };
  drawShots();
  drawer.onpaste = async (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); if (!f) return; e.preventDefault(); await uploadShot(f, (id) => upd(ST.byId.get(t.id), { media: [...(ST.byId.get(t.id).media || []), id] })); drawShots(); };
  const aiBox = h("div.j-aibox");
  const review = (ST.reviews || []).find((r) => r.trade === t.id);
  if (review) aiBox.appendChild(md(review.content));
  const fixRisk = !(t.sl > 0) ? h("details.j-fix", [h("summary", "No stop loss recorded. Add one to see this trade in R"), h("div.j-fixf", [
    h("input.field", { type: "number", step: "any", placeholder: "Stop loss price", "aria-label": "Stop loss price", on: { change: (e) => upd(t, { sl: e.target.value }).then(() => drawTrade(ST.byId.get(t.id))) } }),
    h("span.fine", "or"), h("input.field", { type: "number", step: "any", placeholder: `Amount risked (${cur()})`, "aria-label": "Amount risked", on: { change: (e) => upd(t, { risk: e.target.value }).then(() => drawTrade(ST.byId.get(t.id))) } })])]) : null;
  drawer.replaceChildren(
    h("div.j-dh", [
      h("div", [h("p.fine", [acc ? acc.name : "", " · ", dt(t.ct, { weekday: "long", day: "numeric", month: "long", year: "numeric" })]), h("h2#dTitle", [t.s, " ", h("span.j-dir." + (t.d > 0 ? "l" : "s"), t.d > 0 ? "Long" : "Short")])]),
      h("div.j-dnav", [h("button.btn.xs.ghost", { type: "button", "aria-label": "Previous trade", disabled: dIdx <= 0, on: { click: () => step(-1) } }, icon("j-up")), h("button.btn.xs.ghost", { type: "button", "aria-label": "Next trade", disabled: dIdx >= dList.length - 1, on: { click: () => step(1) } }, icon("j-down")),
        h("button.btn.xs.ghost", { type: "button", "aria-label": "Close", on: { click: closeDrawer } }, icon("j-x"))]),
    ]),
    h("div.j-dres", [h("b." + cls(t.net), money(t.net, { sign: true })), t.r != null ? h("span." + cls(t.r), rr(t.r)) : null, h("span.fine", `${fx(t.v)} lots, held ${dur(t.dur)}`)]),
    tradeChart(t),
    tradeMap(t),
    h("section", [h("h3", "Your review"), h("div.j-dgrid", [h("label", [h("span.lab", "Setup"), pbSel]), h("div", [h("span.lab", "Rating"), stars(t.rt, (n) => upd(t, { rating: n }).then(() => drawTrade(ST.byId.get(t.id))))])]), checks,
      h("div.j-notehd", [h("span.lab", "Notes"), stat]), note, tagBox,
      h("label.check.j-rev", [h("input", { type: "checkbox", checked: !!t.reviewed, on: { change: (e) => upd(t, { reviewed: e.target.checked }) } }), h("span", "Reviewed")])]),
    h("section", [h("h3", "Screenshots"), shots]),
    h("section", [h("div.j-aih", [h("h3", "AI review"), DEMO ? null : h("button.btn.sm", { type: "button", on: { click: async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = "Reviewing…"; try { const j = await save("ai/review", { trade: t.id }); ST.reviews = (ST.reviews || []).filter((r) => r.trade !== t.id).concat({ trade: t.id, content: j.content }); aiBox.replaceChildren(md(j.content)); ST.data.ai = j.usage; } catch {} b.disabled = false; b.replaceChildren(icon("j-spark"), review ? "Review again" : "Review this trade"); } } }, [icon("j-spark"), review ? "Review again" : "Review this trade"])]),
      DEMO ? h("p.fine", "The coach reviews each trade against your own history. It's switched off on sample data.") : !review ? h("p.fine", "The coach compares this trade with your own history on the same symbol and setup, and says what to keep and what to change. Uses 1 AI credit.") : null, aiBox]),
    fixRisk,
    h("section", [h("h3", "Details"), h("dl.j-facts", facts.map(([k, v]) => h("div", [h("dt", k), h("dd", v)])))]),
    h("div.j-dfoot", [DEMO ? null : h("button.btn.sm.danger", { type: "button", on: { click: async () => { if (!confirm("Delete this trade from the journal? Its notes and screenshots go too.")) return; await save("trades/" + t.id, undefined, "DELETE"); ST.data.trades = ST.data.trades.filter((x) => x.id !== t.id); load(ST.data); closeDrawer(); render(); toast("Trade deleted."); } } }, [icon("j-trash"), "Delete trade"]), h("span.fine", "J and K move between trades.")]),
  );
  drawer.scrollTop = 0;
}
async function uploadShot(file, attach) {
  if (DEMO) { toast("Screenshots are saved once you have the journal."); return; }
  try {
    const { data, mime } = await shrink(file);
    const j = await save("media", { mime, data, name: file.name });
    await attach(j.id);
    toast("Screenshot added.");
  } catch (e) { if (e && e.message) toast(e.message, true); }
}
// big screenshots are scaled down to 2400 px wide before they're sent
function shrink(file) {
  return new Promise((res, rej) => {
    if (file.size > 20 << 20) return rej(new Error("That image is over 20 MB."));
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 2400 / img.width), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const webp = c.toDataURL("image/webp", 0.86), useWebp = webp.startsWith("data:image/webp");
      res({ data: useWebp ? webp : c.toDataURL("image/jpeg", 0.86), mime: useWebp ? "image/webp" : "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That file isn't an image this browser can read.")); };
    img.src = url;
  });
}
function lightbox(src) { const l = $("#light"); l.querySelector("img").src = src; l.hidden = false; }
$("#light").addEventListener("click", () => ($("#light").hidden = true));
drawer.addEventListener("click", (e) => { if (e.target === drawer) closeDrawer(); });

// ---------------------------------------------------------------- modal
const modal = $("#modal");
function openModal(title, body, foot) {
  modal.replaceChildren(h("div.j-mbox", [h("div.j-mh", [h("h2", title), h("button.btn.xs.ghost", { type: "button", "aria-label": "Close", on: { click: closeModal } }, icon("j-x"))]), h("div.j-mb", body), foot ? h("div.j-mf", foot) : null]));
  modal.hidden = false; document.body.classList.add("lock");
  const f = modal.querySelector("input,select,textarea"); if (f) setTimeout(() => f.focus(), 30);
}
function closeModal() { modal.hidden = true; document.body.classList.remove("lock"); }
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
function manualTrade() {
  if (!ST.data.accounts.length) { toast("Add an account first."); location.hash = "#/accounts"; return; }
  const f = {};
  const inp = (k, label, type = "text", extra = {}) => h("label", [h("span", label), (f[k] = h("input.field", { type, step: type === "number" ? "any" : null, ...extra }))]);
  const now = new Date(), local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal("Add a trade", h("div.formgrid", [
    h("label", [h("span", "Account"), (f.account = h("select.field", ST.data.accounts.filter((a) => !a.archived).map((a) => h("option", { value: a.id }, a.name))))]),
    inp("symbol", "Symbol", "text", { placeholder: "XAUUSD" }),
    h("label", [h("span", "Direction"), (f.side = h("select.field", [h("option", { value: "buy" }, "Long"), h("option", { value: "sell" }, "Short")]))]),
    inp("volume", "Lots", "number"), inp("ot", "Opened (your computer's time)", "datetime-local", { value: local }), inp("ct", "Closed", "datetime-local", { value: local }),
    inp("op", "Entry price", "number"), inp("cp", "Exit price", "number"), inp("sl", "Stop loss", "number"), inp("net", "Net result (" + cur() + ")", "number"),
  ]), [h("button.btn.pri", { type: "button", on: { click: async () => {
    const body = { account: f.account.value, symbol: f.symbol.value, side: f.side.value, volume: f.volume.value, ot: Date.parse(f.ot.value), ct: Date.parse(f.ct.value), op: f.op.value, cp: f.cp.value, sl: f.sl.value, net: f.net.value };
    const j = await save("trades", body); ST.data.trades = j.trades; load(ST.data); closeModal(); render(); toast("Trade added.");
  } } }, "Add trade")]);
}

// ---------------------------------------------------------------- a little markdown for the coach: bold, lists, headings
function md(text) {
  const box = h("div.j-md");
  const inline = (line, el) => { const parts = String(line).split(/(\*\*[^*]+\*\*)/g); for (const p of parts) { if (/^\*\*[^*]+\*\*$/.test(p)) el.appendChild(h("b", p.slice(2, -2))); else if (p) el.appendChild(document.createTextNode(p)); } return el; };
  let list = null;
  for (const raw of String(text || "").split(/\n/)) {
    const line = raw.trimEnd();
    if (/^#{1,4}\s/.test(line)) { list = null; box.appendChild(inline(line.replace(/^#{1,4}\s+/, ""), h("h4"))); continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) { if (!list) { list = h(/^\s*\d/.test(line) ? "ol" : "ul"); box.appendChild(list); } list.appendChild(inline(line.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), h("li"))); continue; }
    list = null;
    if (line.trim()) box.appendChild(inline(line, h("p")));
  }
  return box;
}

// ================================================================ DAILY JOURNAL
VIEWS.days = (main) => {
  const day = /^\d{4}-\d\d-\d\d$/.test(ST.sub) ? ST.sub : null;
  if (day) return dayPage(main, day);
  const ts = filtered({ from: undefined, to: undefined });
  if (!ST.trades.length && !ST.data.days.length) return noTrades(main);
  const all = JS.days(ts), notes = new Map(ST.data.days.map((d) => [d.day, d]));
  const today = new Date(); const todayKey = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  main.appendChild(h("div.j-tbar", [h("p.fine", "Each day gets a plan before the session, a review after, and your trades in between."), h("a.btn.sm.pri", { href: "#/days/" + todayKey }, "Write today's entry")]));
  main.appendChild(calendarCard(ts));
  const list = [...new Set([...all.map((d) => d.day), ...ST.data.days.map((d) => d.day)])].sort().reverse().slice(0, 60);
  main.appendChild(card("Recent days", list.length ? h("div.j-daylist", list.map((k) => { const d = all.find((x) => x.day === k), n = notes.get(k); return h("a.j-dayrow", { href: "#/days/" + k }, [h("span.d", dayName(k, { weekday: "short", day: "numeric", month: "short" })),
    h("span." + cls(d ? d.net : 0), d ? money(d.net, { sign: true }) : "No trades"), h("span.fine", d ? `${d.n} trades, ${d.wins} won` : ""), h("span.fl", [n && n.notes ? h("span.chip.dim", "Notes") : null, n && n.mood ? h("span.chip.dim", "Mood " + n.mood + "/5") : null, n && n.grade ? h("span.chip.dim", "Grade " + n.grade + "/5") : null])]); })) : empty("No days yet.")));
};
async function dayPage(main, day) {
  const ts = ST.trades.filter((t) => t.day === day && (!ST.f.acc || t.a === ST.f.acc)), s = JS.summary(ts);
  const prev = shiftDay(day, -1), next = shiftDay(day, 1);
  main.appendChild(h("div.j-dayhd", [h("a.btn.xs.ghost", { href: "#/days/" + prev, "aria-label": "Previous day" }, icon("j-left")), h("h2", dayName(day)), h("a.btn.xs.ghost", { href: "#/days/" + next, "aria-label": "Next day" }, icon("j-right")), h("a.btn.xs", { href: "#/days" }, "All days")]));
  if (ts.length) main.appendChild(h("div.j-tiles.sm", [tile("Net", money(s.net, { sign: true }), `${s.n} trades`, { k: cls(s.net) }), tile("Win rate", pct(s.winRate, 0), `${s.wins} won, ${s.losses} lost`), tile("Best trade", money(s.largestWin, { sign: true }), ""), tile("Worst trade", money(s.largestLoss), ""), tile("Costs", money(-s.costs), "")]));
  const holder = h("div.j-grid2"); main.appendChild(holder);
  const left = h("div.j-stack"), right = h("div.j-stack"); holder.append(left, right);
  left.appendChild(card("Trades", ts.length ? tradeTable(ts, { compact: true }) : empty("No trades this day.")));
  if (ts.length >= 2) { const c = h("div.j-chart.sm"); left.appendChild(card("Through the day", c)); let run = 0; JC.line(c, [{ name: "Net", pts: [[ts[0].ot, 0], ...ts.map((t) => [t.ct, (run += t.net)])], area: true }], { h: 150, fmt: (v) => money(v, { compact: true }), signColor: true, tfmt: (t) => dt(t, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) }); }
  const form = h("div.j-dayform", h("p.fine", "Loading…")); right.appendChild(card("Journal", form));
  let d = { plan: "", review: "", lessons: "", mood: null, focus: null, grade: null, media: [] };
  if (!DEMO) { try { d = (await api("days/" + day)).day; } catch {} } else d = (ST.demoDays || {})[day] || d;
  let timer = 0; const stat = h("span.fine.j-saved", "");
  const put = (patch) => { Object.assign(d, patch); clearTimeout(timer); stat.textContent = "Saving…"; timer = setTimeout(async () => { if (DEMO) { stat.textContent = "Not saved on sample data"; return; } try { await api("days/" + day, patch); stat.textContent = "Saved"; const idx = ST.data.days.findIndex((x) => x.day === day); const row = { day, notes: !!(d.plan || d.review || d.lessons), mood: d.mood, grade: d.grade, shots: d.media.length }; idx >= 0 ? (ST.data.days[idx] = row) : ST.data.days.push(row); } catch (e) { stat.textContent = e.message; } }, 700); };
  const area = (k, label, ph) => h("label.j-tf", [h("span.lab", label), h("textarea.field", { rows: 4, placeholder: ph, value: d[k] || "", on: { input: (e) => put({ [k]: e.target.value }) } })]);
  const scale = (k, label, words) => h("div.j-scale", [h("span.lab", label), h("div", { role: "radiogroup", "aria-label": label }, [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", role: "radio", "aria-checked": String(d[k] === n), title: words[n - 1], on: { click: (e) => { put({ [k]: d[k] === n ? null : n }); e.currentTarget.parentNode.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-checked", String(d[k] === i + 1))); } } }, String(n))))]);
  const shots = h("div.j-shots");
  const drawShots = () => shots.replaceChildren(...d.media.map((id) => h("figure", [h("img", { src: "/api/journal/media/" + id, alt: "Screenshot", loading: "lazy", on: { click: (e) => lightbox(e.target.src) } }), h("button.j-x", { type: "button", "aria-label": "Remove", on: { click: () => { put({ media: d.media.filter((m) => m !== id) }); drawShots(); } } }, icon("j-x"))])),
    h("label.j-addshot", [icon("j-img"), h("span", "Add a screenshot"), h("input", { type: "file", accept: "image/*", multiple: true, on: { change: async (e) => { for (const f of e.target.files) await uploadShot(f, async (id) => { put({ media: [...d.media, id] }); }); drawShots(); } } })]));
  drawShots();
  form.replaceChildren(h("div.j-notehd", [h("span"), stat]),
    area("plan", "Plan before the session", "Bias, levels, news to watch, what you will and won't trade, your max loss today…"),
    area("review", "Review after the session", "What happened, did you follow the plan, how you felt…"),
    area("lessons", "Lessons", "One thing to keep, one thing to change tomorrow"),
    h("div.j-scales", [scale("mood", "Mood", ["Awful", "Low", "Okay", "Good", "Great"]), scale("focus", "Focus", ["Scattered", "Distracted", "Okay", "Focused", "In the zone"]), scale("grade", "How well you traded your plan", ["Not at all", "Poorly", "Partly", "Mostly", "Fully"])]),
    h("span.lab", "Screenshots"), shots);
}
const shiftDay = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ================================================================ ANALYTICS
const ATABS = [["overview", "Overview"], ["time", "Time"], ["news", "News"], ["instruments", "Symbols"], ["tags", "Setups and tags"], ["risk", "Risk and R"], ["behaviour", "Behaviour"], ["whatif", "What if"], ["simulate", "Simulator"]];
VIEWS.analytics = (main) => {
  const ts = filtered();
  const tab = ATABS.some(([k]) => k === ST.sub) ? ST.sub : "overview";
  main.appendChild(h("div.j-atabs", { role: "tablist", "aria-label": "Analytics" }, ATABS.map(([k, l]) => h("a", { href: "#/analytics/" + k, role: "tab", "aria-selected": String(k === tab) }, l))));
  if (!ts.length) return noTrades(main);
  A[tab](main, ts);
};
const grpTable = (g, o = {}) => h("div.j-tw", h("table.j-t.grp", [h("thead", h("tr", [h("th", g.label), h("th.r", "Trades"), h("th.r", "Win rate"), h("th.r", "Net"), h("th.r", "Per trade"), h("th.r", "R per trade"), h("th.r", "Profit factor"), h("th.r", "Avg win"), h("th.r", "Avg loss")])),
  h("tbody", g.rows.map((r) => h("tr" + (o.onClick ? ".click" : ""), { on: o.onClick ? { click: () => o.onClick(r) } : null }, [h("td", h("b", o.name ? o.name(r.key) : r.key)), h("td.n.r", r.n), h("td.n.r", pct(r.winRate, 0)), h("td.n.r." + cls(r.net), money(r.net, { sign: true })), h("td.n.r." + cls(r.expectancy), money(r.expectancy, { sign: true })),
    h("td.n.r." + cls(r.expR), rr(r.expR)), h("td.n.r", fx(r.pf)), h("td.n.r", money(r.avgWin)), h("td.n.r", money(-r.avgLoss))])))]));
const barsOf = (g, o = {}) => g.rows.map((r) => ({ label: o.name ? o.name(r.key) : r.key, short: o.short ? o.short(r.key) : null, value: o.metric ? o.metric(r) : r.net, extra: [{ value: String(r.n), label: "trades" }, { value: pct(r.winRate, 0), label: "win rate" }, { value: money(r.expectancy, { sign: true }), label: "per trade" }] }));
const A = {};
A.overview = (main, ts) => {
  const s = JS.summary(ts, { start: startBalance() }), eq = JS.equity(ts, 0);
  const row = (k, v, hint) => h("div", [h("dt", [k, hint ? h("span.hint", { title: hint, tabindex: 0, "aria-label": hint }, "?") : null]), h("dd", v)]);
  const groups = [
    ["Results", [["Net profit", money(s.net, { sign: true })], ["Gross profit", money(s.grossProfit)], ["Gross loss", money(-s.grossLoss)], ["Profit factor", fx(s.pf), "Gross profit divided by gross loss."], ["Expectancy", money(s.expectancy, { sign: true }), "Average net result per trade."], ["Expectancy in R", rr(s.expR), "Average result per trade in units of the amount risked. Needs stop losses."], ["Return on starting balance", pct(s.returnPct, 1, true)]]],
    ["Wins and losses", [["Win rate", pct(s.winRate, 1)], ["Winners / losers / breakeven", `${s.wins} / ${s.losses} / ${s.be}`], ["Average win", money(s.avgWin)], ["Average loss", money(-s.avgLoss)], ["Payoff ratio", fx(s.payoff), "Average win divided by average loss."], ["Largest win", money(s.largestWin, { sign: true })], ["Largest loss", money(s.largestLoss)]]],
    ["Risk", [["Max drawdown", money(-s.maxDD)], ["Max drawdown %", s.maxDDpct != null ? pct(-s.maxDDpct) : "Set a starting balance"], ["Longest drawdown", dur(s.longestDD)], ["Recovery factor", fx(s.recovery), "Net profit divided by max drawdown."], ["SQN", fx(s.sqn), "Van Tharp's System Quality Number: √N × mean R ÷ SD of R (N up to 100). 2 to 2.5 is average, 2.5 to 3 good, above 3 excellent. Needs stop losses."], ["Kelly fraction", s.kelly != null ? pct(s.kelly, 1) : "–", "The bet size that maximises growth on these odds. Most traders use a quarter of it or less."], ["SD of R", fx(s.sdR)]]],
    ["Consistency", [["Trading days", `${s.days} (${s.greenDays} green)`], ["Green days", pct(s.dayWinRate, 0)], ["Average day", money(s.avgDay, { sign: true })], ["Best day", s.bestDay ? `${money(s.bestDay.net, { sign: true })} on ${dayName(s.bestDay.day, { day: "numeric", month: "short" })}` : "–"], ["Worst day", s.worstDay ? `${money(s.worstDay.net)} on ${dayName(s.worstDay.day, { day: "numeric", month: "short" })}` : "–"], ["Best day's share of profit", pct(s.consistency, 0), "How much of your green-day profit came from the single best day. Many prop firms cap this at 30 to 50%."], ["Sharpe (daily)", fx(s.sharpe), "Annualised from daily results."], ["Sortino (daily)", fx(s.sortino)]]],
    ["Habits and costs", [["Trades per day", fx(s.tradesPerDay, 1)], ["Trades per week", fx(s.perWeek, 1)], ["Average hold", dur(s.avgHold)], ["Hold, winners / losers", `${dur(s.holdWin)} / ${dur(s.holdLoss)}`], ["Longest winning streak", String(s.streak.maxWin)], ["Longest losing streak", String(s.streak.maxLoss)], ["Streak dependency (Z)", fx(s.z), "Below −1.96: wins and losses cluster. Above +1.96: they alternate. In between: no pattern."], ["Costs (commission, swap, fees)", `${money(-s.costs)} (${pct(s.costShare, 1)} of gross)`], ["Kept of the best price", pct(s.captured, 0), "On winning trades with excursion data: how much of the best open profit you kept, on average."]]],
  ];
  main.appendChild(h("div.j-metrics", groups.map(([g, rows]) => card(g, h("dl.j-dl", rows.map((r) => row(...r)))))));
  const d = JS.days(ts), c1 = h("div.j-chart"), c2 = h("div.j-chart");
  main.appendChild(h("div.j-grid2", [card("Daily results", c1), card("How your days are spread", c2)]));
  JC.bars(c1, d.slice(-90).map((x) => ({ label: dayName(x.day, { weekday: "short", day: "numeric", month: "short" }), short: "", value: x.net, extra: [{ value: String(x.n), label: "trades" }] })), { h: 220, fmt: (v) => money(v, { compact: true }), labelsBelow: false });
  JC.hist(c2, JS.histogram(d.map((x) => x.net), 16), { h: 220, fmt: (v) => money(v, { compact: true }) });
  main.appendChild(card("Month by month", monthGrid(ts)));
};
function monthGrid(ts) {
  const byM = new Map(); for (const t of ts) byM.set(t.month, (byM.get(t.month) || 0) + t.net);
  const years = [...new Set([...byM.keys()].map((k) => k.slice(0, 4)))].sort().reverse(), MS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mx = Math.max(1e-9, ...[...byM.values()].map(Math.abs));
  return h("div.j-tw", h("table.j-t.mgrid", [h("thead", h("tr", [h("th", "Year"), ...MS.map((m) => h("th.r", m)), h("th.r", "Year")])), h("tbody", years.map((y) => {
    let tot = 0; const cells = MS.map((_, i) => { const k = `${y}-${String(i + 1).padStart(2, "0")}`, v = byM.get(k); if (v === undefined) return h("td.n.r.dim", ""); tot += v; return h("td.n.r.hc." + (v >= 0 ? "pos" : "neg"), { style: { "--a": (0.12 + Math.min(1, Math.sqrt(Math.abs(v) / mx)) * 0.6).toFixed(2) } }, money(v, { compact: true, sign: true })); });
    return h("tr", [h("td", h("b", y)), ...cells, h("td.n.r." + cls(tot), h("b", money(tot, { compact: true, sign: true })))]);
  }))]));
}
A.time = (main, ts) => {
  const hm = h("div.j-chart");
  main.appendChild(card("Hour and weekday", [hm, h("p.fine", `Hour the trade opened, in ${tz()}. Colour shows net result; tap a cell to see its trades.`)]));
  JC.heat(hm, JS.heat(ts), { rows: JS.WD, cols: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")), value: (c) => (c.n ? c.net : null),
    tip: (c) => [{ value: money(c.net, { sign: true }), label: "net" }, { value: String(c.n), label: "trades" }, { value: pct(c.wins / Math.max(1, c.wins + c.losses), 0), label: "win rate" }], onClick: (i) => navTo("trades", { weekday: String(i) }) });
  const monthName = (k) => new Date(k + "-15T12:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const dims = [["weekday", "By weekday", false], ["session", "By session", true], ["hour", "By hour opened", false], ["duration", "By time in trade", true]];
  const grid = h("div.j-grid2.even"); main.appendChild(grid);
  const one = (d, t, horiz, holder) => { const g = JS.group(ts, d), c = h("div.j-chart"); holder.appendChild(card(t, [c, h("details.j-tbl", [h("summary", "Table"), grpTable(g, d === "month" ? { name: monthName } : {})])]));
    JC.bars(c, barsOf(g, d === "month" ? { name: monthName, short: (k) => new Date(k + "-15T12:00:00Z").toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) } : d === "hour" ? { short: (k) => k.slice(0, 2) } : {}), horiz ? { horizontal: true, fmt: (v) => money(v, { compact: true, sign: true }) } : { h: 200, fmt: (v) => money(v, { compact: true }) }); };
  for (const [d, t, horiz] of dims) one(d, t, horiz, grid);
  one("month", "By month", false, main);
};
A.news = (main, ts) => {
  const from = ST.newsFrom, covered = ts.filter((t) => t.news !== null);
  if (!from || !covered.length) {
    main.appendChild(card("Trading around the news", empty("Each trade is matched to the high-impact releases around it. The release calendar fills in as the journal records it, and the MT5 connector adds older releases from MT5's own calendar. There's no release data for these trades yet.")));
    return;
  }
  const g = JS.group(ts, "news"), an = g.rows.find((r) => r.key === "Around news") || JS.lite([]), aw = g.rows.find((r) => r.key === "Away from news") || JS.lite([]);
  main.appendChild(h("div.j-tiles", [
    tile("Around news", money(an.net, { sign: true }), `${an.n} trades, ${money(an.expectancy, { sign: true })} a trade`, { k: cls(an.net), hero: true }),
    tile("Win rate around news", pct(an.winRate, 0), an.expR != null ? `${rr(an.expR)} a trade` : ""),
    tile("Away from news", money(aw.net, { sign: true }), `${aw.n} trades, ${money(aw.expectancy, { sign: true })} a trade`, { k: cls(aw.net) }),
    tile("Win rate away", pct(aw.winRate, 0), aw.expR != null ? `${rr(aw.expR)} a trade` : ""),
  ]));
  const nearN = covered.filter((t) => t.news).length;
  main.appendChild(card("Around news or away from it", [grpTable(g), h("p.fine", `A trade counts as around news when it opened from 15 minutes before to 30 minutes after a high-impact release for one of its currencies. Release data starts ${dayName(new Date(from).toISOString().slice(0, 10), { day: "numeric", month: "long", year: "numeric" })}; ${ts.length - covered.length} trades before that show as no news data.`)]));
  if (nearN) {
    const ev = JS.group(ts.filter((t) => t.news), "event"), c = h("div.j-chart");
    main.appendChild(card("By release", [c, h("details.j-tbl", [h("summary", "Table"), grpTable(ev)])]));
    JC.bars(c, barsOf({ rows: ev.rows.slice(0, 14) }), { horizontal: true, fmt: (v) => money(v, { compact: true, sign: true }) });
    const B = [[-15, -5, "15 to 5 min before"], [-5, 0, "5 min before to the release"], [0, 2, "First 2 minutes after"], [2, 10, "2 to 10 min after"], [10, 31, "10 to 30 min after"]];
    const rows = B.map(([a, b, label]) => { const xs = ts.filter((t) => t.ev && t.ev.min >= a && t.ev.min < b); return { key: label, ...JS.lite(xs) }; }).filter((r) => r.n);
    const c2 = h("div.j-chart");
    main.appendChild(card("When you got in", [c2, grpTable({ label: "Opened", rows }), h("p.fine", "Minutes between the release and your entry.")]));
    JC.bars(c2, barsOf({ rows }, { metric: (r) => r.expectancy }), { horizontal: true, fmt: (v) => money(v, { sign: true }), valueLabel: "per trade" });
  }
};
A.instruments = (main, ts) => {
  const g = JS.group(ts, "symbol"), c = h("div.j-chart");
  main.appendChild(card("By symbol", [c, grpTable(g, { onClick: (r) => navTo("trades", { symbols: [r.key] }) })]));
  JC.bars(c, barsOf({ rows: g.rows.slice(0, 20) }), { horizontal: true, fmt: (v) => money(v, { compact: true, sign: true }) });
  const sd = JS.group(ts, "side"), c2 = h("div.j-chart"), sz = JS.group(ts, "size"), c3 = h("div.j-chart");
  main.appendChild(h("div.j-grid2", [card("Long and short", [c2, grpTable(sd)]), card("By position size", [c3, grpTable(sz)])]));
  JC.bars(c2, barsOf(sd), { horizontal: true, fmt: (v) => money(v, { compact: true, sign: true }) });
  JC.bars(c3, barsOf(sz), { horizontal: true, fmt: (v) => money(v, { compact: true, sign: true }) });
};
A.tags = (main, ts) => {
  const pb = JS.group(ts, "playbook"), c = h("div.j-chart");
  main.appendChild(card("By setup", [c, grpTable(pb, { name: (k) => pbOf(k)?.name || k, onClick: (r) => r.key !== "No setup" && navTo("trades", { pb: r.key }) })]));
  JC.bars(c, barsOf(pb, { name: (k) => pbOf(k)?.name || k }), { horizontal: true, fmt: (v) => money(v, { compact: true, sign: true }) });
  const tg = JS.group(ts, "tag"), byKind = (k) => ({ ...tg, rows: tg.rows.filter((r) => tagOf(r.key)?.kind === k) });
  const mk = byKind("mistake"), totalMist = mk.rows.reduce((a, r) => a + Math.min(0, r.net), 0), c2 = h("div.j-chart");
  main.appendChild(card("What your mistakes cost", [mk.rows.length ? h("p.j-lead", [`Trades tagged as mistakes lost `, h("b.dn", money(totalMist)), ` in this period.`]) : h("p.fine", "Tag trades with mistakes like “Moved my stop” and the journal adds up what each one costs."), c2, mk.rows.length ? grpTable(mk, { name: (k) => tagOf(k)?.name || k, onClick: (r) => navTo("trades", { tags: [r.key] }) }) : null]));
  if (mk.rows.length) JC.bars(c2, barsOf({ rows: [...mk.rows].sort((a, b) => a.net - b.net) }, { name: (k) => tagOf(k)?.name || k }), { horizontal: true, fmt: (v) => money(v, { compact: true, sign: true }) });
  const em = byKind("emotion"), ot = byKind("custom");
  main.appendChild(h("div.j-grid2", [card("By emotion", em.rows.length ? grpTable(em, { name: (k) => tagOf(k)?.name || k }) : empty("No emotion tags yet.")), card("Other tags", ot.rows.length ? grpTable(ot, { name: (k) => tagOf(k)?.name || k }) : empty("No other tags yet."))]));
  const rt = JS.group(ts, "rating");
  main.appendChild(card("Your rating against the result", grpTable(rt)));
};
A.risk = (main, ts) => {
  const withR = ts.filter((t) => t.r !== null), s = JS.summary(ts);
  main.appendChild(h("div.j-tiles", [tile("Trades with a stop", pct(withR.length / ts.length, 0), `${withR.length} of ${ts.length}`), tile("Expectancy", rr(s.expR), "per trade"), tile("SQN", fx(s.sqn), s.sqn == null ? "needs 10+ trades in R" : s.sqn >= 5 ? "superb" : s.sqn >= 3 ? "excellent" : s.sqn >= 2.5 ? "good" : s.sqn >= 2 ? "average" : s.sqn >= 1.6 ? "below average" : "poor"),
    tile("Losers beyond 1R", withR.filter((t) => t.loss).length ? pct(withR.filter((t) => t.r < -1.1).length / withR.filter((t) => t.loss).length, 0) : "–", "stops slipping or moved"), tile("Kelly fraction", s.kelly != null ? pct(s.kelly, 1) : "–", "full Kelly, most use ¼ or less")]));
  const c1 = h("div.j-chart"), rb = JS.group(withR, "rbucket"), c2 = h("div.j-chart");
  main.appendChild(h("div.j-grid2", [card("Results in R", withR.length ? [c1] : empty("Add stop losses (the MT5 connector does it for you) to see results in R.")), card("Count by R bucket", withR.length ? [c2, h("details.j-tbl", [h("summary", "Table"), grpTable(rb)])] : empty(""))]));
  if (withR.length) { JC.hist(c1, JS.histogram(withR.map((t) => t.r), 18), { h: 220, fmt: (v) => fx(v, 1) + "R" }); JC.bars(c2, rb.rows.map((r) => ({ label: r.key, short: r.key.replace("R to ", "–").replace("Below ", "<").replace("Over ", ">"), value: r.n, color: /^(−|Below)/.test(r.key) ? getComputedStyle(c2).getPropertyValue("--loss") : null, extra: [{ value: money(r.net, { sign: true }), label: "net" }] })), { h: 220, fmt: (v) => String(Math.round(v)), valueLabel: "trades" }); }
  const ex = JS.excursions(ts), c3 = h("div.j-chart");
  main.appendChild(card("How far trades went for and against you", ex ? [
    h("div.j-tiles.sm", [tile("Winners that went −0.5R first", pct(ex.deep[1].winners, 0), "before working out"), tile("Losers that were +1R up", pct(ex.gaveBackShare, 0), `${ex.gaveBack} trades given back`), tile("Kept of the best price", pct(ex.efficiency, 0), "median, on winners")]),
    c3, h("p.fine", "Each dot is a trade: how far it went against you (MAE, across) and for you (MFE, up), in R. Red dots high up were well in profit before they ended as losses.")] : empty("Excursion data (MAE and MFE) arrives with the MT5 connector, for trades with a stop loss.")));
  if (ex) JC.scatter(c3, ex.points.map((p) => ({ x: Math.max(-3, p.mae), y: Math.min(8, p.mfe), good: p.win, title: ST.byId.get(p.id)?.s || "", tip: [{ value: rr(p.r), label: "result" }, { value: rr(p.mae), label: "worst" }, { value: rr(p.mfe), label: "best" }], id: p.id })), { xl: "Worst point (MAE, R)", xf: (v) => fx(v, 1), yf: (v) => fx(v, 1), onClick: (p) => openTrade(p.id) });
  const c4 = h("div.j-chart"), risks = withR.filter((t) => t.riskM != null);
  if (risks.length >= 3) { main.appendChild(card("Money risked per trade", [c4, h("p.fine", "Steady risk is the base of every edge. Spikes are worth a look.")])); JC.bars(c4, risks.slice(-120).map((t) => ({ label: `${t.s} ${dt(t.ct)}`, short: "", value: t.riskM, color: getComputedStyle(c4).getPropertyValue("--ice"), extra: [{ value: rr(t.r), label: "result" }] })), { h: 200, fmt: (v) => money(v, { compact: true }), labelsBelow: false }); }
};
A.behaviour = (main, ts) => {
  const dims = [["after", "After a win or a loss"], ["streakIn", "Going in on a losing streak"], ["nInDay", "First trade of the day or later"]];
  const grid = h("div.j-grid2"); main.appendChild(grid);
  for (const [d, t] of dims) { const g = JS.group(ts, d), c = h("div.j-chart"); grid.appendChild(card(t, [c, grpTable(g)])); JC.bars(c, barsOf(g, { metric: (r) => r.expectancy }), { horizontal: true, fmt: (v) => money(v, { sign: true }), valueLabel: "per trade" }); }
  // trades per day against the day's result
  const d = JS.days(ts), c = h("div.j-chart");
  grid.appendChild(card("Trades per day against the result", [c, h("p.fine", "If the red dots sit on the right, busy days are costing you: a sign of overtrading.")]));
  JC.scatter(c, d.map((x) => ({ x: x.n, y: x.net, good: x.net >= 0, title: dayName(x.day, { weekday: "short", day: "numeric", month: "short" }), tip: [{ value: money(x.net, { sign: true }), label: "net" }, { value: String(x.n), label: "trades" }], day: x.day })), { xl: "Trades that day", xf: (v) => String(Math.round(v)), yf: (v) => money(v, { compact: true }), onClick: (p) => (location.hash = "#/days/" + p.day) });
  // revenge trades: bigger size soon after a loss
  const R = ST.data.prefs.rules.revengeMin || 15, rev = ts.filter((t) => t.prevRes === "loss" && t.gapMin != null && t.gapMin < R && t.sizeUp > 1.01), quick = ts.filter((t) => t.prevRes === "loss" && t.gapMin != null && t.gapMin < R);
  const L = (x) => JS.lite(x);
  main.appendChild(card("Revenge and tilt", h("div.j-tiles.sm", [
    tile(`Re-entries within ${R} min of a loss`, String(quick.length), quick.length ? `${money(L(quick).expectancy, { sign: true })} a trade, win rate ${pct(L(quick).winRate, 0)}` : ""),
    tile("…and with a bigger size", String(rev.length), rev.length ? `${money(L(rev).net, { sign: true })} in total` : "none found"),
    tile("Everything else", money(L(ts.filter((t) => !quick.includes(t))).expectancy, { sign: true }), "a trade, for comparison")]), { right: h("a.btn.xs", { href: "#/discipline" }, "Change the window") }));
  // mood from the daily journal against the day's result
  const notes = new Map(ST.data.days.filter((x) => x.mood).map((x) => [x.day, x])), md2 = d.filter((x) => notes.has(x.day));
  if (md2.length >= 3) {
    const byMood = [1, 2, 3, 4, 5].map((m) => { const xs = md2.filter((x) => notes.get(x.day).mood === m); return { label: "Mood " + m, value: xs.length ? xs.reduce((a, x) => a + x.net, 0) / xs.length : 0, extra: [{ value: String(xs.length), label: "days" }] }; }).filter((r, i) => md2.some((x) => notes.get(x.day).mood === i + 1));
    const c5 = h("div.j-chart"); main.appendChild(card("Mood against the day's result", [c5, h("p.fine", "From the mood you log in the daily journal. Average net per day.")])); JC.bars(c5, byMood, { h: 200, fmt: (v) => money(v, { compact: true }) });
  }
};
A.whatif = (main, ts) => {
  const base = JS.summary(ts, { start: startBalance() });
  const scen = [];
  const add = (label, keep, why) => { const k = ts.filter(keep); if (k.length === ts.length || !k.length) return; const s = JS.summary(k, { start: startBalance() }); scen.push({ label, why, s, removed: ts.length - k.length }); };
  for (const g of ST.data.tags.filter((t) => t.kind === "mistake")) add(`Without “${g.name}” trades`, (t) => !(t.tags || []).includes(g.id), "Trades you tagged with this mistake.");
  add("Without any mistake-tagged trades", (t) => !(t.tags || []).some((g) => tagOf(g)?.kind === "mistake"), "Every trade tagged with a mistake.");
  add("Stop after 2 losses in a row each day", (() => { const byDay = new Map(); return (t) => { const st = byDay.get(t.oday) || { run: 0, stop: false }; byDay.set(t.oday, st); if (st.stop) return false; st.run = t.loss ? st.run + 1 : 0; if (st.run >= 2) st.stop = true; return true; }; })(), "Each day, no more trades after the second loss in a row.");
  const rl = ST.data.prefs.rules.maxTrades || 3; add(`Only the first ${rl} trades each day`, (t) => t.nInDay <= rl, "Ignore every trade after that in a day.");
  const wd = JS.group(ts, "weekday").rows.filter((r) => r.n >= 5).sort((a, b) => a.net - b.net)[0]; if (wd && wd.net < 0) add(`Skip ${wd.key}s`, (t) => JS.WD[t.wd] !== wd.key, `Your weakest weekday in this period.`);
  const ss = JS.group(ts, "session").rows.filter((r) => r.n >= 5).sort((a, b) => a.net - b.net)[0]; if (ss && ss.net < 0) add(`Skip the ${ss.key} session`, (t) => JS.session(t.ot) !== ss.key, "Your weakest session in this period.");
  const sy = JS.group(ts, "symbol").rows.filter((r) => r.n >= 5).sort((a, b) => a.net - b.net)[0]; if (sy && sy.net < 0) add(`Drop ${sy.key}`, (t) => t.s !== sy.key, "Your weakest symbol in this period.");
  const capped = ts.map((t) => (t.r != null && t.r < -1 && t.riskM ? { ...t, net: -t.riskM } : t)); const capS = JS.summary(capped, { start: startBalance() });
  if (capped.some((t, i) => t.net !== ts[i].net)) scen.push({ label: "Every loss capped at −1R", why: "As if every stop had held exactly. Needs stop losses.", s: capS, removed: 0, changed: true });
  main.appendChild(card("What if", [h("p.j-lead", ["Your period as it happened: ", h("b." + cls(base.net), money(base.net, { sign: true })), ` over ${base.n} trades, profit factor ${fx(base.pf)}, max drawdown ${money(-base.maxDD)}. Each line below replays the same trades with one habit changed.`]),
    scen.length ? h("div.j-tw", h("table.j-t.grp", [h("thead", h("tr", [h("th", "Change"), h("th.r", "Trades left"), h("th.r", "Net"), h("th.r", "Difference"), h("th.r", "Profit factor"), h("th.r", "Max drawdown"), h("th.r", "Win rate")])),
      h("tbody", scen.sort((a, b) => b.s.net - a.s.net).map((x) => h("tr", [h("td", [h("b", x.label), x.why ? h("span.fine.blk", x.why) : null]), h("td.n.r", x.s.n), h("td.n.r." + cls(x.s.net), money(x.s.net, { sign: true })), h("td.n.r." + cls(x.s.net - base.net), money(x.s.net - base.net, { sign: true })), h("td.n.r", fx(x.s.pf)), h("td.n.r", money(-x.s.maxDD)), h("td.n.r", pct(x.s.winRate, 0))])))])) : empty("Tag a few mistakes or trade a little longer, and the scenarios appear here."),
    h("p.fine", "These replay your own past trades with one rule applied. They show what a habit has cost, not what will happen next.")]));
};
A.simulate = (main, ts) => {
  const box = h("div"), ctl = {};
  const run = () => {
    const len = Math.max(20, Math.min(1000, Number(ctl.len.value) || 200)), start = Math.max(0, Number(ctl.start.value) || 0), ruin = Number(ctl.ruin.value) || null;
    const m = JS.monteCarlo(ts, { len, start, ruin: start > 0 && ruin ? start * ruin / 100 : null, runs: 1000, seed: 11 });
    if (!m) { box.replaceChildren(empty("The simulator needs at least 10 trades.")); return; }
    const c = h("div.j-chart");
    box.replaceChildren(h("div.j-tiles", [tile("Median outcome", money(m.final.p50, { sign: true }), `after ${len} trades`, { k: cls(m.final.p50) }), tile("Bad case (worst 5%)", money(m.final.p5, { sign: true }), "1 in 20 runs did worse", { k: cls(m.final.p5) }), tile("Good case (best 5%)", money(m.final.p95, { sign: true }), "1 in 20 did better"),
      tile("Chance of being down", pct(m.lossChance, 1), `after ${len} trades`), tile("Typical worst drawdown", money(-m.dd.p50), `1 in 20: ${money(-m.dd.p95)}`), m.ruin ? tile(`Chance of losing ${ctl.ruin.value}%`, pct(m.ruin.chance, 1), "of the starting balance, at some point") : null]),
      card("1,000 possible futures from your own trades", [c, h("p.fine", "Each line redraws your trades in a random order (with repeats). The band covers the middle 50% and 90% of outcomes. It assumes your future trades look like these ones.")]));
    JC.fan(c, m.paths, { fmt: (v) => money(v, { compact: true }), len });
  };
  const inp = (k, label, val, extra = {}) => h("label", [h("span", label), (ctl[k] = h("input.field", { type: "number", value: val, on: { change: run }, ...extra }))]);
  main.appendChild(card("Monte Carlo simulator", h("div.j-simctl", [inp("len", "Trades ahead", 200, { min: 20, max: 1000, step: 10 }), inp("start", "Starting balance", startBalance() || 10000, { min: 0, step: 100 }), inp("ruin", "Count as ruin at a loss of (%)", 50, { min: 5, max: 100, step: 5 })])));
  main.appendChild(box); run();
};

// ================================================================ SETUPS (PLAYBOOKS)
VIEWS.playbooks = (main) => {
  const ts = filtered();
  main.appendChild(h("div.j-tbar", [h("p.fine", "Write down each setup you trade with its rules, tag trades with it, and see which setups actually pay."), h("button.btn.sm.pri", { type: "button", on: { click: () => editPlaybook() } }, [icon("j-plus"), "New setup"])]));
  const pbs = ST.data.playbooks.filter((p) => !p.archived);
  if (!pbs.length) { main.appendChild(card(null, empty("No setups yet. Add the two or three setups you trade most, with the rules that make each one valid.", h("button.btn.pri", { type: "button", on: { click: () => editPlaybook() } }, "Add your first setup")))); return; }
  main.appendChild(h("div.j-pbgrid", pbs.map((p) => {
    const xs = ts.filter((t) => t.pb === p.id), s = JS.lite(xs), rules = p.rules || [];
    const comp = xs.length && rules.length ? xs.reduce((a, t) => a + (t.checks || []).length / rules.length, 0) / xs.length : null;
    return h("article.j-pb", [h("div.j-pbh", [h("h3", p.name), h("button.btn.xs.ghost", { type: "button", on: { click: () => editPlaybook(p) } }, "Edit")]), p.description ? h("p.fine", p.description) : null,
      h("dl.j-pbs", [h("div", [h("dt", "Trades"), h("dd", String(s.n))]), h("div", [h("dt", "Win rate"), h("dd", pct(s.winRate, 0))]), h("div", [h("dt", "Net"), h("dd." + cls(s.net), money(s.net, { sign: true, compact: Math.abs(s.net) >= 10000 }))]), h("div", [h("dt", "Per trade"), h("dd." + cls(s.expR ?? s.expectancy), s.expR != null ? rr(s.expR) : money(s.expectancy, { sign: true }))]), h("div", [h("dt", "Rules followed"), h("dd", comp == null ? "–" : pct(comp, 0))])]),
      rules.length ? h("ol.j-rules", rules.map((r) => h("li", r))) : null, h("a.btn.xs", { href: "#/trades", on: { click: () => { ST.f.pb = p.id; persistF(); } } }, "See its trades")]);
  })));
};
function editPlaybook(p) {
  const name = h("input.field", { value: p ? p.name : "", placeholder: "e.g. London breakout" }), desc = h("textarea.field", { rows: 3, value: p ? p.description : "", placeholder: "What it is and when it works" });
  const rules = h("textarea.field", { rows: 6, value: p ? (p.rules || []).join("\n") : "", placeholder: "One rule per line, e.g.\nPrice above the 50 EMA on H1\nBreak of the Asian range high\nStop below the last swing low" });
  openModal(p ? "Edit setup" : "New setup", h("div.formgrid", [h("label.full", [h("span", "Name"), name]), h("label.full", [h("span", "Description"), desc]), h("label.full", [h("span", "Rules, one per line (they become a checklist on each trade)"), rules])]),
    [p ? h("button.btn.danger", { type: "button", on: { click: async () => { if (!confirm(`Delete the setup “${p.name}”? Trades keep their other notes.`)) return; await save("playbooks/" + p.id, undefined, "DELETE"); ST.data.playbooks = ST.data.playbooks.filter((x) => x.id !== p.id); closeModal(); render(); } } }, "Delete") : null,
      h("button.btn.pri", { type: "button", on: { click: async () => {
        const body = { name: name.value, description: desc.value, rules: rules.value.split("\n").map((r) => r.trim()).filter(Boolean) };
        if (p) { await save("playbooks/" + p.id, body); Object.assign(p, body); } else { const j = await save("playbooks", body); ST.data.playbooks.push({ id: j.id, ...body, archived: false }); }
        closeModal(); render(); toast("Saved.");
      } } }, "Save")]);
}

// ================================================================ DISCIPLINE
VIEWS.discipline = (main) => {
  const ts = filtered(), R = { ...ST.data.prefs.rules };
  const f = {};
  const num = (k, label, hint, unit) => h("label", [h("span", label), h("span.j-unit", [(f[k] = h("input.field", { type: "number", step: "any", min: 0, value: R[k] ?? "", placeholder: "Off" })), unit ? h("em", unit) : null]), hint ? h("span.fine", hint) : null]);
  const form = h("div.formgrid", [num("maxDailyLoss", "Daily loss limit", "Stop for the day after losing this much.", cur()), num("maxTrades", "Max trades a day", "", "trades"), num("maxRisk", "Max risk per trade", "Needs a stop loss on the trade.", cur()), num("stopAfterLosses", "Stop after this many losses in a row", "", "losses"),
    h("label", [h("span", "Trading hours"), (f.hours = h("input.field", { value: R.hours || "", placeholder: "08:00-17:00" })), h("span.fine", "In " + tz() + ". Trades outside count as a break.")]), num("revengeMin", "A revenge trade is a bigger trade within", "", "minutes of a loss"),
    h("label.check.full", [(f.requireStop = h("input", { type: "checkbox", checked: !!R.requireStop })), h("span", "Every trade needs a stop loss")])]);
  main.appendChild(card("Your rules", [form, h("div.j-mf", [h("button.btn.pri", { type: "button", on: { click: async () => {
    const rules = { maxDailyLoss: f.maxDailyLoss.value, maxTrades: f.maxTrades.value, maxRisk: f.maxRisk.value, stopAfterLosses: f.stopAfterLosses.value, hours: f.hours.value.replace(/\s/g, ""), revengeMin: f.revengeMin.value, requireStop: f.requireStop.checked };
    if (DEMO) { ST.data.prefs.rules = { ...R, ...Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, typeof v === "boolean" ? v : v === "" ? null : k === "hours" ? v : Number(v)])) }; render(); return; }
    const j = await save("prefs", { rules }); ST.data.prefs = j.prefs; load(ST.data); render(); toast("Rules saved.");
  } } }, "Save rules")])]));
  if (!ts.length) return;
  const ru = JS.rules(ts, { ...ST.data.prefs.rules, tz: tz() });
  main.appendChild(h("div.j-tiles", [tile("Discipline score", ru.score === null ? "–" : ru.score + "%", `${ru.cleanDays} of ${ru.days} days clean`, { hero: true, k: ru.score >= 80 ? "up" : ru.score >= 50 ? "" : "dn" }), tile("Rule breaks", String(ru.list.length), `on ${new Set(ru.list.map((v) => v.day)).size} days`), tile("Trades that broke a rule", String(ru.brokenTrades), ru.brokenTrades ? `net ${money(ru.cost, { sign: true })}` : ""),
    tile("Trades that kept the rules", String(ts.length - ru.brokenTrades), money(JS.lite(ts.filter((t) => !new Set(ru.list.flatMap((v) => v.ids || [])).has(t.id))).expectancy, { sign: true }) + " a trade")]));
  // weekly score
  const byWeek = new Map(); for (const d of JS.days(ts)) { const t = new Date(d.day + "T12:00:00Z"), wk = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); (byWeek.get(wk) || byWeek.set(wk, []).get(wk)).push(d.day); }
  const bad = new Set(ru.list.map((v) => v.day)), c = h("div.j-chart");
  main.appendChild(card("Clean days by week", [c]));
  JC.bars(c, [...byWeek.entries()].slice(-26).map(([wk, ds]) => ({ label: "Week of " + dayName(wk, { day: "numeric", month: "short" }), short: dayName(wk, { day: "numeric", month: "short" }), value: ds.filter((d) => !bad.has(d)).length / ds.length * 100, color: getComputedStyle(c).getPropertyValue("--ice"), extra: [{ value: `${ds.filter((d) => !bad.has(d)).length} of ${ds.length}`, label: "days clean" }] })), { h: 180, fmt: (v) => Math.round(v) + "%" });
  if (ru.list.length) {
    const by = new Map();
    for (const v of ru.list) { const r = by.get(v.rule) || { rule: v.rule, n: 0, days: new Set(), ids: new Set() }; r.n++; r.days.add(v.day); for (const id of v.ids || []) r.ids.add(id); by.set(v.rule, r); }
    const rows = [...by.values()].sort((a, b) => b.n - a.n).map((r) => { const xs = ts.filter((t) => r.ids.has(t.id)); return { ...r, net: JS.sum(xs.map((t) => t.net)), tn: xs.length, exp: xs.length ? JS.sum(xs.map((t) => t.net)) / xs.length : null }; });
    main.appendChild(card("Which rules you break", h("div.j-tw", h("table.j-t.grp", [h("thead", h("tr", [h("th", "Rule"), h("th.r", "Times"), h("th.r", "Days"), h("th.r", "Trades"), h("th.r", "Net of those trades"), h("th.r", "Per trade")])),
      h("tbody", rows.map((r) => h("tr", [h("td", h("b", JS.RULE_NAMES[r.rule] || r.rule)), h("td.n.r", r.n), h("td.n.r", r.days.size), h("td.n.r", r.tn || "–"), h("td.n.r." + cls(r.net), r.tn ? money(r.net, { sign: true }) : "–"), h("td.n.r." + cls(r.exp), r.exp != null ? money(r.exp, { sign: true }) : "–")])))]))));
  }
  const list = h("ul.j-viol"), LIM = 25;
  const drawList = (all) => list.replaceChildren(...(all ? ru.list : ru.list.slice(0, LIM)).map((v) => h("li", [h("a", { href: "#/days/" + v.day }, dayName(v.day, { day: "numeric", month: "short" })), h("span", [h("b", (JS.RULE_NAMES[v.rule] || v.rule) + ". "), v.text]), v.ids && v.ids.length ? h("button.btn.xs.ghost", { type: "button", on: { click: () => openTrade(v.ids[0], ts) } }, "Open trade") : null])));
  drawList(false);
  main.appendChild(card("Rule breaks", ru.list.length ? [list, ru.list.length > LIM ? h("div.j-showmore", h("button.btn.sm", { type: "button", on: { click: (e) => { drawList(true); e.currentTarget.remove(); } } }, `Show all ${ru.list.length}`)) : null] : empty("No rule breaks in this period. Nicely done.")));
};

// ================================================================ AI COACH
VIEWS.coach = async (main) => {
  const ai = ST.data.ai || { used: 0, cap: 0, left: 0 };
  const head = h("div.j-coachh", [h("div", [h("h2", "Your AI coach"), h("p.fine", "It reads your trades, notes and rules through the same numbers you see here, and answers with specifics: what's working, where it leaks, and what to do about it.")]),
    h("div.j-credits", [h("b", DEMO ? "Sample" : `${ai.left} of ${ai.cap}`), h("span", DEMO ? "switched off on sample data" : "AI credits left this month"), DEMO ? null : h("div.meter", h("i", { style: { width: (ai.cap ? (ai.left / ai.cap) * 100 : 0) + "%" } }))])]);
  main.appendChild(head);
  const wrap = h("div.j-coach"), list = h("div.j-threads"), pane = h("div.j-chat");
  wrap.append(list, pane); main.appendChild(wrap);
  if (DEMO) { demoCoach(list, pane); return; }
  let L; try { L = await api("ai/list"); ST.reviews = L.reviews; } catch (e) { pane.appendChild(empty(e.message)); return; }
  if (!L.connected) { pane.appendChild(empty("The AI coach isn't switched on yet. Everything else in the journal works.")); }
  let thread = ST.sub && ST.sub.startsWith("t_") ? ST.sub : "";
  const repBtns = h("div.j-reps", [["week", "Weekly review"], ["month", "Monthly review"], ["quarter", "Last 90 days"], ["all", "Full history"]].map(([k, l]) => h("button.btn.sm", { type: "button", on: { click: (e) => report(k, e.currentTarget) } }, [icon("j-spark"), l])));
  list.replaceChildren(h("button.btn.sm.pri.full", { type: "button", on: { click: () => { thread = ""; location.hash = "#/coach"; } } }, [icon("j-plus"), "New question"]), h("p.lab", "Reviews (4 credits)"), repBtns,
    L.reports.length ? h("p.lab", "Your reviews") : null, ...L.reports.map((r) => h("a.j-th" + (ST.sub === r.id ? ".on" : ""), { href: "#/coach/" + r.id }, [h("b", r.title), h("span.fine", new Date(r.created_at).toLocaleDateString())])),
    L.threads.length ? h("p.lab", "Questions") : null, ...L.threads.map((t) => h("a.j-th" + (thread === t.thread ? ".on" : ""), { href: "#/coach/" + t.thread }, [h("b", t.title || "Question"), h("span.fine", new Date(t.last).toLocaleDateString())])));
  const log = h("div.j-log", { "aria-live": "polite" }), input = h("textarea.field", { rows: 2, placeholder: "Ask about your trading…", "aria-label": "Your question" });
  const send = h("button.btn.pri", { type: "button", "aria-label": "Send" }, [icon("j-send"), "Ask"]);
  const bubble = (role, text) => h("div.j-msg." + role, role === "assistant" ? md(text) : h("p", text));
  const ask = async (q) => {
    q = (q || input.value).trim(); if (!q) return;
    input.value = ""; log.appendChild(bubble("user", q)); const wait = h("div.j-msg.assistant.wait", h("p", "Looking through your trades…")); log.appendChild(wait); log.scrollTop = log.scrollHeight; send.disabled = true;
    try {
      const b = rangeBounds(), filters = { from: b.from ? new Date(b.from).toISOString().slice(0, 10) : undefined, account: ST.f.acc ? accOf(ST.f.acc)?.name : undefined };
      const j = await api("ai/ask", { message: q, thread, filters }); thread = j.thread; ST.data.ai = j.usage; wait.replaceWith(bubble("assistant", j.answer));
      if (!ST.sub) history.replaceState(null, "", "#/coach/" + thread);
    } catch (e) { wait.replaceWith(h("div.j-msg.assistant.err", h("p", e.message))); }
    send.disabled = false; log.scrollTop = log.scrollHeight;
  };
  send.addEventListener("click", () => ask()); input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
  async function report(period, btn) {
    btn.disabled = true; const t = btn.textContent; btn.replaceChildren("Writing…");
    pane.replaceChildren(h("div.j-msg.assistant.wait", h("p", "Writing your review from the numbers. This takes about half a minute.")));
    try { const j = await api("ai/report", { period, account: ST.f.acc ? accOf(ST.f.acc)?.name : undefined }); ST.data.ai = j.usage; location.hash = "#/coach/" + j.id; }
    catch (e) { pane.replaceChildren(h("div.j-msg.assistant.err", h("p", e.message))); btn.disabled = false; btn.replaceChildren(icon("j-spark"), t); }
  }
  if (ST.sub && ST.sub.startsWith("jx_")) {
    try { const j = await api("ai/item/" + ST.sub); pane.replaceChildren(h("div.j-report", [h("div.j-reph", [h("h3", j.item.title), h("button.btn.xs.ghost", { type: "button", on: { click: async () => { await api("ai/delete/" + j.item.id, {}); location.hash = "#/coach"; } } }, "Delete")]), md(j.item.content)])); } catch (e) { pane.replaceChildren(empty(e.message)); }
    return;
  }
  if (thread) { try { const j = await api("ai/thread/" + thread); for (const m of j.messages) log.appendChild(bubble(m.role, m.content)); } catch {} }
  const SUG = ["What's my biggest leak in this period?", "Which setup should I trade more, and which less?", "How do I trade after two losses in a row?", "Am I cutting winners short?", "What time of day should I stop trading?", "Do I size up after losses?"];
  pane.replaceChildren(log, !thread ? h("div.j-sug", SUG.map((q) => h("button.chip.dim", { type: "button", on: { click: () => ask(q) } }, q))) : null, h("div.j-ask", [input, send]), h("p.fine", "1 credit per question. The coach coaches your process. It doesn't predict markets or give financial advice."));
  setTimeout(() => (log.scrollTop = log.scrollHeight), 0);
};

// on sample data the coach is off; show the kind of answer it gives, built from the sample numbers and labelled as an example
function demoCoach(list, pane) {
  const ts = filtered(), s = JS.summary(ts), lines = [];
  const mist = JS.group(ts, "tag").rows.filter((r) => tagOf(r.key)?.kind === "mistake" && r.n >= 3).sort((a, b) => a.net - b.net)[0];
  const st = JS.group(ts, "streakIn").rows, aft = st.filter((r) => /2 losses|3\+/.test(r.key)), n2 = aft.reduce((a, r) => a + r.n, 0), e2 = n2 ? aft.reduce((a, r) => a + r.net, 0) / n2 : null;
  const pb = JS.group(ts, "playbook").rows.filter((r) => r.n >= 8 && r.key !== "No setup"), best = pb.length ? pb.reduce((a, b) => (b.expectancy > a.expectancy ? b : a)) : null, worst = pb.length ? pb.reduce((a, b) => (b.expectancy < a.expectancy ? b : a)) : null;
  lines.push("### The short version", `Over **${s.n} trades** you made **${money(s.net, { sign: true })}**, ${money(s.expectancy, { sign: true })} a trade, with a profit factor of **${fx(s.pf)}**. The edge is there, but a few habits give a lot of it back.`, "### Where it leaks");
  if (mist) lines.push(`- Trades you tagged **${tagOf(mist.key).name}** lost **${money(Math.abs(mist.net))}** over ${mist.n} trades. That's your most expensive mistake.`);
  if (e2 != null && n2 >= 5) lines.push(`- After two or more losses in a row you average **${money(e2, { sign: true })}** a trade (${n2} trades), against ${money(s.expectancy, { sign: true })} overall.`);
  if (worst && best && worst.key !== best.key) lines.push(`- **${pbOf(worst.key)?.name}** is your weakest setup at ${money(worst.expectancy, { sign: true })} a trade over ${worst.n} trades. **${pbOf(best.key)?.name}** is your best at ${money(best.expectancy, { sign: true })} over ${best.n}.`);
  lines.push("### One thing to do this week", "Stop for the day after the second loss in a row. Check the What if tab: it replays your own trades with that rule so you can see what it would have changed.");
  list.replaceChildren(h("p.lab", "Example"), h("a.j-th.on", { href: "#/coach" }, [h("b", "What's my biggest leak?"), h("span.fine", "Sample data")]));
  pane.replaceChildren(h("div.j-log", [h("div.j-msg.user", h("p", "What's my biggest leak in this period?")), h("div.j-msg.assistant", md(lines.join("\n")))]),
    h("div.j-demonote", [h("p", [h("b", "This is an example answer, written from the sample trades."), " With your own journal the coach answers anything you ask, writes weekly and monthly reviews, and reviews single trades, all from your numbers."]), h("a.btn.pri", { href: "/journal#pricing" }, "Get the journal")]));
}

// ================================================================ ACCOUNTS AND IMPORT
VIEWS.accounts = (main) => {
  main.appendChild(h("div.j-tbar", [h("p.fine", "Each trading account keeps its own trades. Connect MT5 once and every closed trade arrives on its own, with stop loss and excursions."), h("button.btn.sm.pri", { type: "button", on: { click: () => editAccount() } }, [icon("j-plus"), "Add an account"])]));
  const accs = ST.data.accounts.filter((a) => !a.archived);
  if (!accs.length) main.appendChild(card(null, h("div.j-onb", [h("h2", "Add your first account"), h("p", "Name it after the broker and account type. Then connect it to MT5 or import a history file."), h("button.btn.pri", { type: "button", on: { click: () => editAccount() } }, "Add an account")])));
  for (const a of accs) {
    const ts = ST.trades.filter((t) => t.a === a.id), s = JS.lite(ts);
    main.appendChild(h("article.j-acc", [
      h("div.j-acch", [h("div", [h("h3", a.name), h("p.fine", [a.broker || a.platform.toUpperCase(), a.login ? " · " + a.login : "", a.demo ? " · demo" : "", a.ea ? " · from your GoldenStraddler EA" : ""])]),
        h("div.j-accs", [h("span", [h("b", String(ts.length)), " trades"]), h("span." + cls(s.net), money(s.net, { sign: true })), a.last_sync ? h("span.fine", "Updated " + ago(a.last_sync)) : null]), h("div.j-accbtn", [h("button.btn.xs.ghost" + (a.share ? ".on" : ""), { type: "button", on: { click: () => shareAccount(a) } }, [icon("j-link"), a.share ? "Shared" : "Share"]), h("button.btn.xs.ghost", { type: "button", on: { click: () => editAccount(a) } }, "Edit")])]),
      (() => { const r = a.limits && Object.keys(a.limits).some((k) => k !== "firm") ? limitRows(a) : null; return r ? h("div.j-lim", [h("p.lab", ["Limits", a.limits.firm ? " · " + a.limits.firm : ""]), h("div.j-limg", r)]) : null; })(),
      a.ea ? h("p.fine", "Trades from GoldenStraddler on this account appear here by themselves.") : h("div.j-accb", [
        h("div.j-way", [h("h4", [icon("j-link"), "Connect MT5"]), h("p.fine", a.source === "connector" && a.last_sync ? `Connected. Last trade data ${ago(a.last_sync)}.` : "A small connector EA sends every closed trade, with its stop loss and how far it went for and against you."),
          h("button.btn.sm" + (a.token_hint ? "" : ".pri"), { type: "button", on: { click: () => connector(a) } }, a.token_hint ? "Connector set-up" : "Set up the connector")]),
        h("div.j-way", [h("h4", [icon("j-upload"), "Import a file"]), h("p.fine", "MT5 or MT4 history report (HTML), or a CSV from any platform."), h("button.btn.sm", { type: "button", on: { click: () => importFile(a) } }, "Import trades")])]),
    ]));
  }
  const arch = ST.data.accounts.filter((a) => a.archived);
  if (arch.length) main.appendChild(card("Archived", h("ul.j-plain", arch.map((a) => h("li", [a.name, h("button.btn.xs.ghost", { type: "button", on: { click: async () => { await save("accounts/" + a.id, { archived: false }); a.archived = false; load(ST.data); render(); } } }, "Restore")])))));
};
const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 90 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : (Math.round(s / 86400) === 1 ? "1 day ago" : Math.round(s / 86400) + " days ago"); };
const TIME_MODES = [["mt4ny", "Broker server time (GMT+2, GMT+3 in summer)"], ["utc", "UTC"], ["fixed:0", "GMT+0 all year"], ["fixed:60", "GMT+1 all year"], ["fixed:120", "GMT+2 all year"], ["fixed:180", "GMT+3 all year"], ["fixed:-300", "GMT−5 all year"], ["fixed:-240", "GMT−4 all year"]];
function editAccount(a) {
  const f = {};
  openModal(a ? "Edit account" : "Add an account", h("div.formgrid", [
    h("label.full", [h("span", "Name"), (f.name = h("input.field", { value: a ? a.name : "", placeholder: "e.g. Fortune Prime ECN" }))]),
    h("label", [h("span", "Broker"), (f.broker = h("input.field", { value: a ? a.broker : "" }))]),
    h("label", [h("span", "Platform"), (f.platform = h("select.field", [["mt5", "MetaTrader 5"], ["mt4", "MetaTrader 4"], ["ctrader", "cTrader"], ["other", "Other"]].map(([v, l]) => h("option", { value: v, selected: a ? a.platform === v : v === "mt5" }, l))))]),
    h("label", [h("span", "Account currency"), (f.currency = h("input.field", { value: a ? a.currency : "USD", maxlength: 3 }))]),
    h("label", [h("span", "Starting balance"), (f.balance_start = h("input.field", { type: "number", step: "any", value: a ? a.balance_start || "" : "" })), h("span.fine", "For returns and drawdown in %.")]),
    h("label.full", [h("span", "Times in imported files are in"), (f.time_mode = h("select.field", TIME_MODES.map(([v, l]) => h("option", { value: v, selected: a ? a.time_mode === v : v === "mt4ny" }, l)))), h("span.fine", "Most MT4 and MT5 brokers use GMT+2, or GMT+3 while US daylight saving is on. The connector works this out by itself.")]),
    h("label.check.full", [(f.demo = h("input", { type: "checkbox", checked: a ? a.demo : false })), h("span", "Demo account")]),
    limitFields(a ? a.limits || {} : {}, f),
  ]), [a ? h("button.btn.danger", { type: "button", on: { click: async () => { if (!confirm(`Delete “${a.name}” and all its trades, notes and screenshots? This can't be undone.`)) return; await save("accounts/" + a.id, undefined, "DELETE"); closeModal(); const j = await api("state"); load(j); render(); toast("Account deleted."); } } }, "Delete account") : null,
    h("button.btn.pri", { type: "button", on: { click: async () => {
      const body = { name: f.name.value, broker: f.broker.value, platform: f.platform.value, currency: f.currency.value.toUpperCase(), balance_start: f.balance_start.value, time_mode: f.time_mode.value, demo: f.demo.checked, limits: f.readLimits() };
      if (DEMO) { if (a) Object.assign(a, body, { balance_start: Number(body.balance_start) || 0 }); load(ST.data); closeModal(); render(); return; }
      const j = await save(a ? "accounts/" + a.id : "accounts", body);
      if (a) Object.assign(a, j.account); else ST.data.accounts.push(j.account);
      load(ST.data); closeModal(); render(); toast("Saved.");
      if (!a) setTimeout(() => connector(j.account), 200);
    } } }, a ? "Save" : "Add account")]);
}
// prop-firm or personal limits for one account: amounts or % of the starting balance
function limitFields(L, f) {
  const unit = (k, pk) => { const sel = h("select.field.j-u", { "aria-label": "Unit" }, [h("option", { value: "amt", selected: !L[pk] }, cur()), h("option", { value: "pct", selected: !!L[pk] }, "% of start")]); f[k + "U"] = sel; return sel; };
  const num = (k, label, pk, hint) => h("label", [h("span", label), h("span.j-pair", [(f["L" + k] = h("input.field", { type: "number", step: "any", min: 0, value: L[k] ?? "", placeholder: "Off" })), pk ? unit(k, pk) : null]), hint ? h("span.fine", hint) : null]);
  f.readLimits = () => ({ firm: f.Lfirm.value, dailyLoss: f.LdailyLoss.value, dailyLossPct: f.dailyLossU.value === "pct", maxDD: f.LmaxDD.value, maxDDPct: f.maxDDU.value === "pct", trailing: f.Ltrailing.checked,
    target: f.Ltarget.value, targetPct: f.targetU.value === "pct", minDays: f.LminDays.value, consistency: f.Lconsistency.value });
  return h("details.j-limf.full", { open: Object.keys(L).length > 0 }, [h("summary", "Account limits (prop firm or your own)"),
    h("p.fine", "The journal tracks these on the account's closed trades and warns as you get close. Percentages are of the starting balance."),
    h("div.formgrid", [
      h("label.full", [h("span", "Firm or programme"), (f.Lfirm = h("input.field", { value: L.firm || "", placeholder: "e.g. 2-step challenge, phase 1" }))]),
      num("dailyLoss", "Daily loss limit", "dailyLossPct"), num("maxDD", "Maximum drawdown", "maxDDPct"),
      h("label.check.full", [(f.Ltrailing = h("input", { type: "checkbox", checked: !!L.trailing })), h("span", "Drawdown trails the highest balance (otherwise it's measured from the starting balance)")]),
      num("target", "Profit target", "targetPct"), num("minDays", "Minimum trading days"), num("consistency", "Best day can be at most (% of total profit)", null, "Many firms use 30 to 50%."),
    ])]);
}
function connector(a) {
  const tokBox = h("div.j-tok", a.token_hint ? [h("p", ["A token ending in ", h("b", a.token_hint), " is active. Make a new one if you lost it; the old one stops working."])] : []);
  const make = h("button.btn.sm" + (a.token_hint ? "" : ".pri"), { type: "button", on: { click: async () => {
    if (a.token_hint && !confirm("Make a new token? The connector using the old one will stop until you paste the new one.")) return;
    const j = await save("accounts/" + a.id + "/token", {}); a.token_hint = j.token.slice(-4);
    tokBox.replaceChildren(h("p", "Copy your token now. For your security it's only shown once."), h("div.j-copy", [h("code", j.token), h("button.btn.sm", { type: "button", on: { click: async (e) => { try { await navigator.clipboard.writeText(j.token); e.currentTarget.textContent = "Copied"; } catch { } } } }, "Copy")]));
  } } }, a.token_hint ? "Make a new token" : "Make my token");
  openModal("Connect " + a.name + " to MT5", h("ol.j-steps", [
    h("li", [h("b", "Download the connector. "), "It's a small Expert Advisor that only reads your history. It never places, changes or closes trades. ", h("a.btn.sm", { href: "/dl/GoldenStraddler-Journal.ex5" }, [icon("j-dl"), "GoldenStraddler Journal Connector"]), " ", h("a.fine", { href: "/dl/GoldenStraddler-Journal.mq5" }, "or its source code")]),
    h("li", [h("b", "Put it in MT5. "), "File → Open Data Folder → MQL5 → Experts, copy the file in, then right-click Expert Advisors in the Navigator and choose Refresh."]),
    h("li", [h("b", "Allow its web address. "), "Tools → Options → Expert Advisors: tick Allow WebRequest for listed URL and add ", h("code", location.origin), "."]),
    h("li", [h("b", "Paste your token. "), "Drag the connector onto any chart, paste the token on the Inputs tab and press OK. It sends your whole history once, then each trade as it closes."]),
    h("li", [h("b", "Your token"), tokBox, make]),
  ]), [h("button.btn", { type: "button", on: { click: closeModal } }, "Done")]);
}
// a read-only results page anyone with the link can open
function shareAccount(a) {
  if (DEMO) { toast("Sharing works once you have the journal."); return; }
  const money = h("input", { type: "checkbox", checked: !!(a.share_opts && a.share_opts.money) }), trades = h("input", { type: "checkbox", checked: !!(a.share_opts && a.share_opts.trades) });
  const linkBox = h("div");
  const url = () => location.origin + a.share;
  const drawLink = () => linkBox.replaceChildren(...(a.share ? [h("div.j-copy", [h("code", url()), h("button.btn.sm", { type: "button", on: { click: async (e) => { try { await navigator.clipboard.writeText(url()); e.currentTarget.textContent = "Copied"; } catch { } } } }, "Copy")]),
    h("p.fine", [h("a", { href: a.share, target: "_blank", rel: "noopener" }, "Open the page"), " · anyone with this link can see it."])] : [h("p.fine", "Not shared. Nothing about this account is public.")]));
  const apply = async (on) => { const j = await save("accounts/" + a.id + "/share", { on, money: money.checked, trades: trades.checked }); Object.assign(a, j.account); const raw = ST.data.accounts.find((x) => x.id === a.id); if (raw) Object.assign(raw, j.account); drawLink(); draw(); render(); };
  const foot = h("div.j-mfr");
  const draw = () => foot.replaceChildren(a.share ? h("button.btn.danger", { type: "button", on: { click: () => apply(false).then(() => toast("This account is no longer shared.")) } }, "Stop sharing") : null,
    h("button.btn.pri", { type: "button", on: { click: () => apply(true).then(() => toast(a.share ? "Sharing settings saved." : "Shared.")) } }, a.share ? "Save" : "Share this account"));
  drawLink(); draw();
  openModal("Share " + a.name, [
    h("p", "Make a read-only page with this account's results: the main statistics, the curve and a month-by-month table. It's handy for a mentor, a prop-firm application or your own site."),
    h("label.check", [money, h("span", "Show money amounts. Off: results show as a share of the starting balance, or in R.")]),
    h("label.check", [trades, h("span", "Show the latest 25 trades (date, symbol, side and result)")]),
    h("p.fine", "Never shown: your account number, notes, tags, screenshots, AI reviews or other accounts. A badge says whether every trade came straight from MT5 or some were imported or typed in."),
    linkBox,
  ], [foot]);
}
function importFile(a) {
  const f = {};
  let text = "", name = "";
  const status = h("div.j-imp", h("p.fine", "Choose a file to see what's in it before anything is saved."));
  const drop = h("label.j-drop", [icon("j-upload"), h("b", "Choose a file"), h("span.fine", "or drop it here: MT5 report (HTML), MT4 statement (HTML) or CSV"),
    (f.file = h("input", { type: "file", accept: ".htm,.html,.csv,.txt,text/csv,text/html", on: { change: (e) => read(e.target.files[0]) } }))]);
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); if (ev === "drop" && e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); }));
  async function read(file) {
    if (!file) return; name = file.name;
    const buf = await file.arrayBuffer(), b = new Uint8Array(buf);
    // MT5 saves its HTML reports as UTF-16
    text = b[0] === 0xff && b[1] === 0xfe ? new TextDecoder("utf-16le").decode(buf) : b[0] === 0xfe && b[1] === 0xff ? new TextDecoder("utf-16be").decode(buf) : new TextDecoder("utf-8").decode(buf);
    preview();
  }
  async function preview() {
    status.replaceChildren(h("p.fine", "Reading…"));
    try {
      const j = await api("import", { account: a.id, text, name, time_mode: f.mode.value, dayFirst: f.dayFirst.value === "1" });
      if (!j.count) { status.replaceChildren(h("p.err", j.errors[0] || "No trades found in that file.")); go.disabled = true; return; }
      status.replaceChildren(h("p", [h("b", `${j.count} closed trades`), ` found in this ${j.format}, from ${new Date(j.range[0]).toLocaleDateString()} to ${new Date(j.range[1]).toLocaleDateString()}, net `, h("b." + cls(j.net), money(j.net, { sign: true })), "."]),
        j.errors.length ? h("p.fine", "Skipped: " + j.errors.slice(0, 3).join(" ")) : null,
        h("div.j-tw", h("table.j-t", [h("thead", h("tr", ["Symbol", "Side", "Lots", "Opened (UTC)", "Net"].map((x) => h("th", x)))), h("tbody", j.sample.map((t) => h("tr", [h("td", t.symbol), h("td", t.side > 0 ? "Long" : "Short"), h("td.n", t.volume ?? "–"), h("td.n", new Date(t.ot).toISOString().slice(0, 16).replace("T", " ")), h("td.n." + cls(t.net), money(t.net, { sign: true }))])))])),
        h("p.fine", "Trades already in the journal are updated, not doubled."));
      go.disabled = false;
    } catch (e) { status.replaceChildren(h("p.err", e.message)); go.disabled = true; }
  }
  const go = h("button.btn.pri", { type: "button", disabled: true, on: { click: async () => {
    go.disabled = true; go.textContent = "Importing…";
    try { const j = await save("import", { account: a.id, text, name, time_mode: f.mode.value, dayFirst: f.dayFirst.value === "1", commit: true }); closeModal(); const s = await api("state"); load(s); render(); toast(`${j.added} new trades imported${j.updated ? `, ${j.updated} updated` : ""}.`); }
    catch { go.disabled = false; go.textContent = "Import"; }
  } } }, "Import");
  openModal("Import trades into " + a.name, [drop, h("div.formgrid", [h("label", [h("span", "Times in the file are in"), (f.mode = h("select.field", { on: { change: () => text && preview() } }, TIME_MODES.map(([v, l]) => h("option", { value: v, selected: a.time_mode === v }, l))))]),
    h("label", [h("span", "Dates like 03/04/2026 mean"), (f.dayFirst = h("select.field", { on: { change: () => text && preview() } }, [h("option", { value: "1" }, "3 April (day first)"), h("option", { value: "0" }, "March 4 (month first)")]))])]), status,
    h("details.j-help", [h("summary", "How to get the file"), h("ul", [h("li", "MT5: open the History tab, right-click, choose Report and save it as HTML."), h("li", "MT4: open Account History, right-click, choose Save as Detailed Report."), h("li", "Other platforms: export closed trades as CSV with columns for symbol, side, size, open and close time and prices, and profit.")])])], [go]);
}

// forex days usually roll at 17:00 New York time; say what hour that is for this trader today
function nyHint(zone) {
  const d = new Date();
  for (let hr = 0; hr < 24; hr++) { const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hr); if (JS.parts(t, "America/New_York").h === 17) return `Forex days usually roll at 17:00 New York time, which is ${String(JS.parts(t, zone).h).padStart(2, "0")}:00 in your time zone today.`; }
  return "Forex days usually roll at 17:00 New York time.";
}
// ================================================================ SETTINGS
VIEWS.settings = (main) => {
  const p = ST.data.prefs, f = {};
  let zones = []; try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = ["UTC", "Europe/London", "Europe/Malta", "America/New_York", "Asia/Tokyo"]; }
  main.appendChild(card("Journal settings", [h("div.formgrid", [
    h("label", [h("span", "Your time zone"), (f.tz = h("select.field", zones.map((z) => h("option", { value: z, selected: z === p.tz }, z.replace(/_/g, " "))))), h("span.fine", "Days, hours and sessions are counted in this zone.")]),
    h("label", [h("span", "A trading day starts at"), (f.dayStart = h("select.field", Array.from({ length: 24 }, (_, i) => h("option", { value: i, selected: i === p.dayStart }, String(i).padStart(2, "0") + ":00")))), h("span.fine", nyHint(p.tz))]),
    h("label", [h("span", "Count as breakeven within"), h("span.j-unit", [(f.be = h("input.field", { type: "number", step: "any", min: 0, value: p.be || 0 })), h("em", cur())]), h("span.fine", "Results this close to zero aren't wins or losses.")]),
    h("label", [h("span", "Currency for totals"), (f.currency = h("input.field", { value: p.currency, maxlength: 3 }))]),
  ]), h("label.check.j-alerts", [(f.alerts = h("input", { type: "checkbox", checked: p.alerts !== false })), h("span", ["Email me when an account's daily loss or drawdown limit is 80% used or reached, and when its profit target is reached. ", h("span.fine", "Checked each time the MT5 connector sends a trade. Set the limits on each account.")])]),
  h("div.j-mf", [h("button.btn.pri", { type: "button", on: { click: async () => {
    const body = { tz: f.tz.value, dayStart: Number(f.dayStart.value), be: f.be.value, currency: f.currency.value.toUpperCase(), alerts: f.alerts.checked };
    if (DEMO) { Object.assign(ST.data.prefs, body); load(ST.data); render(); return; }
    const j = await save("prefs", body); ST.data.prefs = j.prefs; load(ST.data); render(); toast("Settings saved.");
  } } }, "Save settings")])]));
  main.appendChild(card("Tags", h("div.j-tagadmin", ["mistake", "emotion", "custom"].map((k) => h("div", [h("h4", { mistake: "Mistakes", emotion: "Emotions", custom: "Other" }[k]), h("div.j-tagsel", h("div", [...ST.data.tags.filter((t) => t.kind === k).map((t) => h("span.j-tag." + k, [t.name, DEMO ? null : h("button.j-x", { type: "button", "aria-label": "Delete tag " + t.name, on: { click: async () => { if (!confirm(`Delete the tag “${t.name}” from every trade?`)) return; await save("tags/" + t.id, undefined, "DELETE"); ST.data.tags = ST.data.tags.filter((x) => x.id !== t.id); const s = await api("state"); load(s); render(); } } }, icon("j-x"))])),
    h("button.j-tag.add", { type: "button", on: { click: async () => { const name = prompt("Tag name"); if (!name) return; const j = await save("tags", { name, kind: k }); ST.data.tags.push(j.tag); render(); } } }, "+ New")]))])))));
  main.appendChild(card("Your data", h("div.j-data", [h("p.fine", "Download every trade with your notes, tags and setups as a CSV. Your journal is private to your account."), DEMO ? null : h("a.btn.sm", { href: "/api/journal/export.csv" }, [icon("j-dl"), "Export CSV"])])));
};

// ================================================================ sign-in and access
function gate(why) {
  const g = $("#gate"); $("#shell").hidden = true; g.hidden = false;
  const msg = { signin: ["Sign in to your journal", "Use the email you bought with. You'll get a 6-digit code.", h("a.btn.pri", { href: "/account?next=/journal/app" }, "Sign in")],
    none: ["The journal isn't on your account yet", "It comes included with GoldenStraddler, or on its own with the Journal plan.", h("a.btn.pri", { href: "/journal#pricing" }, "See the plans")],
    expired: ["Your plan has ended", "Renew it and your journal opens again with everything you saved.", h("a.btn.pri", { href: "/account" }, "Renew from your account")] }[why] || ["Something went wrong", "Try again in a minute.", null];
  g.replaceChildren(h("div.j-gate", [h("a.mark", { href: "/journal" }, [icon("gs"), "GoldenStraddler Journal"]), h("h1", msg[0]), h("p", msg[1]), msg[2], h("a.back", { href: "/journal/app?demo=1" }, "Or explore the journal with sample data")]));
}

// ================================================================ sample data, for the demo
function demoData() {
  let seed = 20261004; const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const tags = [["dg1", "FOMO entry", "mistake"], ["dg2", "Moved my stop", "mistake"], ["dg3", "Chased price", "mistake"], ["dg4", "Exited too early", "mistake"], ["dg5", "Revenge trade", "mistake"], ["dg6", "Calm", "emotion"], ["dg7", "Anxious", "emotion"], ["dg8", "Frustrated", "emotion"], ["dg9", "News", "custom"], ["dg10", "A+ setup", "custom"]].map(([id, name, kind]) => ({ id, name, kind, color: "" }));
  const pbs = [{ id: "dp1", name: "London breakout", description: "Break of the Asian range in the first two hours of London.", rules: ["Asian range under 1.2× its 20-day average", "Break and close outside the range on M15", "Stop on the other side of the range midpoint", "No high-impact news in the next hour"], color: "", archived: false },
    { id: "dp2", name: "Trend pullback", description: "Pullback to the 20 EMA in an H1 trend.", rules: ["H1 above the 50 EMA for longs (below for shorts)", "Pullback to the 20 EMA with a rejection candle", "Stop beyond the rejection wick", "Target at least 2R"], color: "", archived: false },
    { id: "dp3", name: "News straddle", description: "Both sides armed before a red-folder USD release.", rules: ["Red-folder USD event", "Orders placed 5 seconds before", "Trailing stop from +50 points"], color: "", archived: false },
    { id: "dp4", name: "Range fade", description: "Fading the edges of a clear intraday range.", rules: ["At least two touches on each side", "Fade at the edge with a rejection", "Out if it closes beyond the range"], color: "", archived: false }];
  const syms = [["XAUUSD", 2350, 100, 3.2], ["EURUSD", 1.085, 100000, 0.0012], ["NAS100", 18200, 1, 45], ["GBPJPY", 191.5, 667, 0.35]];
  const notes = ["Clean break, held to target.", "Entered early before the candle closed. Should have waited.", "Moved stop to breakeven too soon and got wicked out.", "News spike, filled with slippage.", "Followed the plan to the letter.", "Felt rushed after the last loss.", "Took profit early because I was nervous.", "Perfect pullback into the 20 EMA.", ""];
  const trades = []; let t = Date.UTC(2026, 4, 4, 6, 0), lossRun = 0;
  while (trades.length < 420 && t < Date.UTC(2026, 9, 2)) {
    t += (0.6 + r() * 7) * 3600000;
    const d0 = new Date(t), wd = (d0.getUTCDay() + 6) % 7; if (wd >= 5) { t += 2 * 86400000; continue; }
    const hr = d0.getUTCHours(); if (hr < 6 || hr > 20) { t += 6 * 3600000; continue; }
    const pb = pick([...pbs, null]), [s, px, k, vol] = pb && pb.id === "dp3" ? syms[0] : pick(syms), side = r() > 0.48 ? 1 : -1;
    // the sample has habits worth finding: worse after two losses, worse late on Fridays, the FOMO tag is costly, the pullback setup pays
    let p = 0.5 + (pb && pb.id === "dp2" ? 0.08 : 0) - (pb && pb.id === "dp4" ? 0.06 : 0) - (lossRun >= 2 ? 0.14 : 0) - (wd === 4 && hr >= 15 ? 0.12 : 0);
    const fomo = r() < (lossRun >= 2 ? 0.45 : 0.12); if (fomo) p -= 0.15;
    const risk = vol * (0.8 + r() * 0.8), op = px * (1 + (r() - 0.5) * 0.03), sl = op - side * risk, win = r() < p;
    const R = win ? 0.4 + r() * (pb && pb.id === "dp2" ? 3.4 : 2.4) : -(0.75 + r() * (fomo ? 0.9 : 0.35));
    const cp = op + side * R * risk, lots = s === "NAS100" ? pick([1, 2, 3]) : pick([0.1, 0.2, 0.3, 0.5]) * (lossRun >= 2 && r() < 0.3 ? 2 : 1);
    const gross = (cp - op) * side * k * lots, comm = s === "NAS100" ? 0 : -7 * lots;
    const mfeR = win ? R * (1 + r() * 0.5) : r() < 0.25 ? 0.6 + r() * 1.2 : r() * 0.5, maeR = win ? (r() < 0.35 ? 0.3 + r() * 0.6 : r() * 0.3) : -R + r() * 0.03;
    const mfe = op + side * mfeR * risk, mae = op - side * maeR * risk;
    const dur = (win ? 20 + r() * 220 : 15 + r() * 400) * 60000;
    const tg = []; if (fomo) tg.push("dg1"); if (!win && r() < 0.18) tg.push("dg2"); if (win && R < 0.9 && r() < 0.5) tg.push("dg4"); if (lossRun >= 2 && r() < 0.4) tg.push("dg5"); tg.push(lossRun >= 2 ? pick(["dg7", "dg8"]) : pick(["dg6", "dg6", "dg7"]));
    if (pb && pb.id === "dp3") tg.push("dg9"); if (win && R > 2.5) tg.push("dg10");
    const id = "demo" + trades.length;
    trades.push({ id, a: s === "NAS100" ? "da2" : "da1", s, d: side, v: lots, ot: t, ct: t + dur, op, cp, sl, tp: op + side * risk * 2.5, net: gross + comm, gross, comm, swap: dur > 6e6 ? -0.4 * lots : 0, fee: 0, mae, mfe, tags: [...new Set(tg)], pb: pb ? pb.id : null, rt: Math.max(1, Math.min(5, Math.round(3 + R * 0.8 + (r() - 0.5)))), risk: null, note: r() < 0.35 ? pick(notes) : "", media: [], checks: pb ? pb.rules.map((_, i) => i).filter(() => r() < (win ? 0.9 : 0.6)) : [], reviewed: r() < 0.7 });
    lossRun = win ? 0 : lossRun + 1; t += dur;
  }
  // a realistic release calendar for the sample period, and the news-straddle trades placed on it
  const events = [], D = 86400000;
  for (let w = Date.UTC(2026, 4, 4); w < Date.UTC(2026, 9, 3); w += 7 * D) {
    const thu = w + 3 * D, fri = w + 4 * D, mon = new Date(w).getUTCDate();
    events.push({ t: thu + 12.5 * 3600000, c: "USD", n: "Unemployment Claims" });
    if (new Date(fri).getUTCDate() <= 7) { events.push({ t: fri + 12.5 * 3600000, c: "USD", n: "Non-Farm Employment Change" }, { t: fri + 12.5 * 3600000, c: "USD", n: "Unemployment Rate" }); events.push({ t: w + 2 * D + 14 * 3600000, c: "USD", n: "ISM Services PMI" }); }
    if (mon >= 8 && mon <= 14) { events.push({ t: w + 2 * D + 12.5 * 3600000, c: "USD", n: "CPI m/m" }, { t: w + 2 * D + 12.5 * 3600000, c: "USD", n: "Core CPI m/m" }, { t: w + 3 * D + 12.5 * 3600000, c: "USD", n: "PPI m/m" }, { t: w + 2 * D + 6 * 3600000, c: "GBP", n: "CPI y/y" }); }
    if (mon >= 15 && mon <= 21) { events.push({ t: w + 4 * D + 12.5 * 3600000, c: "USD", n: "Retail Sales m/m" }, { t: w + 3 * D + 12.25 * 3600000, c: "EUR", n: "Main Refinancing Rate" }); }
    if ([Date.UTC(2026, 5, 15), Date.UTC(2026, 6, 27), Date.UTC(2026, 8, 14)].includes(w)) events.push({ t: w + 2 * D + 18 * 3600000, c: "USD", n: "Federal Funds Rate" }, { t: w + 2 * D + 18.5 * 3600000, c: "USD", n: "FOMC Press Conference" });
  }
  events.sort((a, b) => a.t - b.t);
  const usd = events.filter((e) => e.c === "USD");
  for (const t of trades) {
    if (t.pb !== "dp3") continue;
    const e = usd.find((x) => x.t >= t.ot - 3 * D && x.t <= t.ot + 4 * D) || usd[Math.floor(r() * usd.length)];
    const len = (40 + r() * 600) * 1000; t.ot = e.t + Math.round(r() * 8000); t.ct = t.ot + len; t.a = "da1";
  }
  const days = []; const seen = new Set(trades.map((x) => new Date(x.ct).toISOString().slice(0, 10)));
  for (const d of seen) if (r() < 0.4) days.push({ day: d, notes: true, mood: 1 + Math.floor(r() * 5), grade: 1 + Math.floor(r() * 5), shots: 0 });
  return { ok: true, email: "", access: { ok: true }, prefs: { tz: "Europe/London", dayStart: 0, currency: "USD", be: 0, rules: { maxDailyLoss: 400, maxTrades: 4, maxRisk: 300, requireStop: true, stopAfterLosses: 2, hours: "07:00-21:00", revengeMin: 15 }, goals: {} },
    ai: { used: 0, cap: 0, left: 0 }, accounts: [{ id: "da1", name: "Sample ECN account", broker: "Sample broker", platform: "mt5", currency: "USD", demo: true, source: "connector", balance_start: 25000, last_sync: Date.now() - 600000, archived: false, limits: { firm: "Sample 2-step challenge", dailyLoss: 5, dailyLossPct: true, maxDD: 10, maxDDPct: true, target: 8, targetPct: true, minDays: 4, consistency: 40 } }, { id: "da2", name: "Sample index account", broker: "Sample broker", platform: "mt5", currency: "USD", demo: true, source: "import", balance_start: 10000, last_sync: Date.now() - 86400000, archived: false, limits: {} }],
    tags, playbooks: pbs, trades, days, events };
}

// ================================================================ start
(async () => {
  try { const saved = JSON.parse(localStorage.getItem("gsj-f") || "null"); if (saved && !DEMO) Object.assign(ST.f, saved, { q: "" }); } catch {}
  if (DEMO) { $("#demoBar").hidden = false; document.body.classList.add("demo"); load(demoData()); ST.f.range = "all"; route(); return; }
  try {
    const d = await api("state"); load(d); route();
    if (new URLSearchParams(location.search).get("soon") === "connector") { history.replaceState(null, "", location.pathname + location.hash); toast("The MT5 connector download is almost ready. Import your MT5 history report for now.", true); }
  }
  catch (e) { if (e.status === 403) gate(e.why || "none"); else if (e.status !== 401) { $("#main").replaceChildren(h("div.j-card", [h("h2", "The journal couldn't load"), h("p", e.message)])); } }
})();
document.addEventListener("gs-theme", () => { if (ST.data) render(); });
})();
