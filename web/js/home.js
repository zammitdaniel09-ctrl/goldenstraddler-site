(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MINUS = "−";
const eur = (c) => "€" + (c / 100).toLocaleString("en-IE", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, "0");

const top = $("top");
const onScroll = () => top.classList.toggle("scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true }); onScroll();

let skew = 0, GROUPS = [];

// ================================================================ small helpers
const toastEl = $("toast");
let toastT = 0;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2600); }
const usd = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sg = (v, d = 0) => (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
// count a number up the first time it scrolls into view
const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { seen.unobserve(e.target); e.target._go && e.target._go(); } }, { threshold: 0.4 });
function countUp(el, to, fmt, ms = 1100) {
  el.textContent = fmt(reduce ? to : 0);
  if (reduce) return;
  el._go = () => { const t0 = performance.now(); const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(k < 1 ? to * e : to); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
  seen.observe(el);
}
// countdown digits that roll when they change
function roll(el, tokens) {
  if (el._n !== tokens.length) { el.replaceChildren(); el._n = tokens.length; el._s = tokens.map(() => { const s = document.createElement("span"); el.appendChild(s); return s; }); }
  tokens.forEach((t, i) => {
    const sp = el._s[i];
    if (sp.textContent === t.v && sp.className.startsWith(t.c)) return;
    sp.textContent = t.v; sp.className = t.c;
    if (t.c === "" && !reduce && el._ready) { void sp.offsetWidth; sp.className = "r"; }
  });
  el._ready = true;
}
function tokens(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60, out = [];
  const num = (n) => { for (const ch of pad(n)) out.push({ v: ch, c: "" }); }, sep = () => out.push({ v: ":", c: "sep" });
  if (d) { for (const ch of String(d)) out.push({ v: ch, c: "" }); out.push({ v: "d", c: "u" }); }
  if (d || h) { num(h); sep(); }
  num(m); sep(); num(ss);
  return out;
}

// ================================================================ releases: names, the countdown card and the week board
function groupEvents(list) {
  const m = new Map();
  for (const e of list) { const g = m.get(e.utc) || { utc: e.utc, titles: [], items: [] }; if (!g.titles.includes(e.title)) { g.titles.push(e.title); g.items.push(e); } m.set(e.utc, g); }
  return [...m.values()].sort((a, b) => a.utc - b.utc);
}
const names = (g) => g.titles.length > 2 ? `${g.titles[0]}, ${g.titles[1]} and ${g.titles.length - 2} more` : g.titles.join(" and ");
const SHORT = [[/non-farm/i, "NFP"], [/fomc|federal funds/i, "FOMC"], [/^core cpi/i, "Core CPI"], [/^cpi/i, "CPI"], [/core pce/i, "Core PCE"], [/gdp/i, "GDP"], [/^core ppi|^ppi/i, "PPI"],
  [/retail sales/i, "Retail Sales"], [/ism services/i, "ISM Services"], [/ism manufacturing/i, "ISM"], [/jolts/i, "JOLTS"], [/unemployment claims|jobless/i, "Jobless Claims"], [/powell|fed chair/i, "Powell"]];
function shortName(g) { for (const [re, n] of SHORT) if (g.titles.some((t) => re.test(t))) return n; const t = g.titles[0] || "the release"; return t.length > 22 ? t.slice(0, 21) + "…" : t; }
const when = (utc, long) => new Date(utc * 1000).toLocaleString(undefined, long ? { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
const hhmmss = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

let WEEK = [], PROMO = null, weekKey = "", REC = null, REFUND = 0;
const ARM_MS = 5000, WIN_MS = 30000;   // the EA's default window: on 5 s before a release, off 30 s after
function upcoming(now) { return GROUPS.filter((g) => g.utc * 1000 > now - WIN_MS); }

function tickNext(now) {
  const list = upcoming(now), card = $("next");
  if (!list.length) { card.hidden = true; return null; }
  card.hidden = false;
  const g = list[0], left = g.utc * 1000 - now, live = left <= 0, armed = left <= ARM_MS, soon = left <= 3600000;
  $("nxTitle").textContent = names(g);
  $("nxWhen").textContent = when(g.utc, true) + ", your time";
  $("nxChipT").textContent = live ? "Out now: the window is open" : armed ? "Armed: both orders are in" : soon ? "Less than an hour to go" : "Next high-impact USD release";
  card.classList.toggle("armed", armed); card.classList.toggle("soon", soon && !armed);
  roll($("nxCount"), live ? [{ v: "+", c: "sep" }, ...tokens(-left)] : tokens(left));
  $("nxBar").style.width = (live ? 100 : Math.max(0, Math.min(1, 1 - left / 86400000)) * 100).toFixed(2) + "%";
  $("nxArm").textContent = live ? "The EA trails whichever side filled. Leftover orders go 30 seconds after the release." : armed ? "Buy stop and sell stop are 60 points either side of price." : `The EA arms at ${hhmmss(g.utc * 1000 - ARM_MS)}, your time.`;
  // card payments deliver the licence straight away and setup takes about five minutes, so offer it while the release is over an hour away
  const nb = $("nxBuy"); nb.hidden = left < 3600000;
  if (!nb.hidden) $("nxBuyT").textContent = `Pay by card and set it up in about five minutes, and it can be armed for ${shortName(g)}.`;
  // same data on the example licence card
  $("licNext").textContent = `${names(g)}, ${when(g.utc, false)}`;
  $("licArm").textContent = `Arms at ${hhmmss(g.utc * 1000 - ARM_MS)}, your time`;
  if (window.GSTerm) GSTerm.event(shortName(g) === g.titles[0] ? g.titles[0] : shortName(g));
  return { g, left };
}

function renderWeek(now) {
  const groups = groupEvents(WEEK), card = $("week");
  if (!groups.length) { card.hidden = true; return; }
  const nextIdx = groups.findIndex((g) => g.utc * 1000 > now - WIN_MS);
  const st = groups.map((g, i) => (g.utc * 1000 <= now - WIN_MS ? "done" : g.utc * 1000 - ARM_MS <= now ? "live" : i === nextIdx ? "next" : ""));
  const key = st.join();
  card.hidden = false;
  if (key === weekKey) return;
  weekKey = key;
  const ol = $("wkList"); ol.replaceChildren();
  groups.forEach((g, i) => {
    const li = document.createElement("li"); if (st[i]) li.className = st[i];
    const d = new Date(g.utc * 1000), tm = document.createElement("time"), b = document.createElement("b");
    tm.dateTime = d.toISOString();
    b.textContent = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    tm.append(b, d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
    const ttl = document.createElement("div"); ttl.className = "ttl";
    for (const e of g.items) {
      const row = document.createElement("div"), t = document.createElement("b"); t.textContent = e.title; row.appendChild(t);
      const parts = []; if (e.fc) parts.push("Forecast " + e.fc); if (e.prev) parts.push((e.fc ? "previous " : "Previous ") + e.prev);
      if (parts.length) { const sp = document.createElement("span"); sp.textContent = parts.join(", "); row.appendChild(sp); }
      ttl.appendChild(row);
    }
    li.append(tm, ttl);
    if (st[i]) { const em = document.createElement("em"); em.textContent = st[i] === "done" ? "Done" : st[i] === "live" ? "Live now" : "Next"; li.appendChild(em); }
    ol.appendChild(li);
  });
}

// ================================================================ discount bar
function tickPromo(now, nx) {
  if (!PROMO) return;
  const t = $("pmT");
  if (PROMO.endsAt && PROMO.endsAt > now) {
    t.hidden = false; setLab("Code ends", " in"); $("pmCount").textContent = fmtLeft(PROMO.endsAt - now);
  } else if (nx) {
    const sn = shortName(nx.g);
    t.hidden = false;
    if (nx.left <= 0) setLab(sn, " is out"); else setLab(sn, "", nx.left <= ARM_MS ? "Armed for " : "Be armed for ");
    $("pmCount").textContent = nx.left <= 0 ? "now" : fmtLeft(nx.left);
  } else t.hidden = true;
}
// the long words hide on narrow phones so the bar stays on one line
function setLab(core, after = "", before = "") {
  const el = $("pmLab"), key = before + core + after; if (el._k === key) return; el._k = key;
  const x = (t) => { const s = document.createElement("span"); s.className = "pm-x"; s.textContent = t; return s; };
  el.replaceChildren(); if (before) el.appendChild(x(before)); el.append(core); if (after) el.appendChild(x(after));
}
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return d ? `${d}d ${pad(h)}:${pad(m)}:${pad(ss)}` : h ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
function applyPromo(pm) {
  PROMO = pm || null;
  const bar = $("promo");
  if (!PROMO) { bar.hidden = true; return; }
  const plan = PROMO.plans.lifetime ? "lifetime" : "monthly", q = PROMO.plans[plan], code = PROMO.code, href = `/checkout?plan=${plan}&code=${encodeURIComponent(code)}`;
  $("pmSave").textContent = `${eur(q.list - q.amount)} off`;
  $("pmWhat").textContent = (plan === "lifetime" ? `Lifetime is ${eur(q.amount)}` : `${q.note === "every month" ? "Monthly" : "Your first month"} is ${eur(q.amount)}`) +
    (PROMO.usesLeft != null ? `, ${PROMO.usesLeft} left at this price,` : "") + " with code";
  $("pmCodeTxt").textContent = code;
  $("pmCode").setAttribute("aria-label", `Copy the code ${code}`);
  const go = $("pmGo"); go.href = href; go.replaceChildren("Claim"); const lg = document.createElement("span"); lg.className = "pm-long"; lg.textContent = ` ${eur(q.amount)} ${plan}`; go.appendChild(lg);
  bar.hidden = false;
  // pricing cards
  const set = (k, was, now, unit, btn, label) => {
    const p = PROMO.plans[k]; if (!p) return;
    $(was).hidden = false; $(was).textContent = eur(p.list); $(now).textContent = eur(p.amount);
    $(unit).textContent = k === "lifetime" ? "once" : p.note === "every month" ? "a month" : "first month";
    const b = $(btn); b.href = `/checkout?plan=${k}&code=${encodeURIComponent(code)}`; b.textContent = `${label} for ${eur(p.amount)}`;
  };
  set("lifetime", "pLifeWas", "pLife", "pLifeU", "buyLife", "Buy lifetime");
  set("monthly", "pMonWas", "pMon", "pMonU", "buyMon", "Start monthly");
  const hb = $("heroBuy"); hb.href = href; hb.textContent = `Get it for ${eur(q.amount)}`;
  $("heroPay").textContent = `${eur(q.amount)} ${plan === "lifetime" ? "once" : q.note === "every month" ? "a month" : "for the first month"} with code ${code}, normally ${eur(q.list)}.${REFUND ? ` ${REFUND}-day money-back guarantee.` : ""}`;
  $("sheetBuy").href = href; $("sheetBuy").textContent = `Get it for ${eur(q.amount)}`;
  $("mbWas").textContent = eur(q.list); $("mbNow").textContent = eur(q.amount); $("mbU").textContent = plan === "lifetime" ? "lifetime" : "first month"; $("mbGo").href = href;
  if (PROMO.plans.lifetime) { const tg = $("pTag"); tg.textContent = `${eur(PROMO.plans.lifetime.list - PROMO.plans.lifetime.amount)} off with code ${code}`; tg.classList.add("gold"); }
}
$("pmCode").addEventListener("click", async () => {
  if (!PROMO) return;
  const code = PROMO.code, b = $("pmCode");
  try { await navigator.clipboard.writeText(code); }
  catch { const r = document.createRange(); r.selectNodeContents($("pmCodeTxt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  b.classList.add("ok"); setTimeout(() => b.classList.remove("ok"), 2200);
  toast(`Code ${code} copied. It's also filled in for you when you tap Claim.`);
});

// ================================================================ the desk layout follows whichever cards have data
function layoutDesk() {
  const on = (id) => !$(id).hidden, row = (a, b) => { const x = [a, b].filter(on); return x.length === 2 ? `"${x[0]} ${x[1]}"` : x.length ? `"${x[0]} ${x[0]}"` : ""; };
  const ids = { next: "next", gold: "gold", week: "week", acct: "acct" };
  const top = row("next", "gold"), bot = row("week", "acct");
  const desk = $("desk"), any = ["next", "gold", "week", "acct"].some(on);
  desk.hidden = !any;
  desk.style.setProperty("--areas", [top, bot].filter(Boolean).join(" ") || '"next"');
  desk.style.setProperty("--areas-m", ["next", "gold", "acct", "week"].filter(on).map((k) => `"${ids[k]}"`).join(" ") || '"next"');
  // phone tabs: hide tabs for cards without data, and keep a visible card selected
  const tabs = [...desk.querySelectorAll(".desk-tabs [data-tab]")];
  tabs.forEach((b) => (b.hidden = !on(b.dataset.tab)));
  const sel = tabs.find((b) => b.getAttribute("aria-selected") === "true");
  if (!sel || sel.hidden) { const first = tabs.find((b) => !b.hidden); if (first) first.click(); }
}

// ================================================================ live: gold price and our account
let lastPx = 0, sparkDrawn = false, liveFails = 0, acctDone = false;
function drawSpark(sp) {
  const svg = $("gSpark");
  if (!sp || sp.length < 2) { svg.replaceChildren(); return; }
  const t0 = sp[0][0], t1 = sp[sp.length - 1][0], ps = sp.map((x) => x[1]);
  let lo = Math.min(...ps), hi = Math.max(...ps); const padv = Math.max((hi - lo) * 0.12, 0.5); lo -= padv; hi += padv;
  const X = (t) => (t1 > t0 ? (t - t0) / (t1 - t0) : 1) * 300, Y = (v) => 86 - (v - lo) / (hi - lo) * 80;
  let d = ""; sp.forEach((x, i) => (d += (i ? "L" : "M") + X(x[0]).toFixed(1) + " " + Y(x[1]).toFixed(1)));
  const last = sp[sp.length - 1];
  svg.innerHTML = `<defs><linearGradient id="gFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--gold)" stop-opacity=".22"/><stop offset="1" style="stop-color:var(--gold)" stop-opacity="0"/></linearGradient></defs>` +
    `<path class="ar" d="${d}L300 90L0 90Z"/><path class="ln" pathLength="1" d="${d}"/><circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3.5" style="fill:var(--gold)"/>`;
  if (!sparkDrawn) { sparkDrawn = true; svg.classList.add("draw"); } else svg.classList.remove("draw");
}
function applyLive(j) {
  const g = j.gold, card = $("gold");
  if (g && g.price) {
    card.hidden = false;
    const el = $("gPx");
    el.textContent = usd(g.price); window.GS_GOLD = g.price;
    if (lastPx && g.price !== lastPx) { el.classList.remove("tu", "td"); void el.offsetWidth; el.classList.add(g.price > lastPx ? "tu" : "td"); }
    lastPx = g.price;
    const sp = g.spark || [], chg = $("gChg");
    let ref = null, lab = "";
    if (g.day) { ref = g.day; lab = "24h"; }
    else if (sp.length > 1 && sp[sp.length - 1][0] - sp[0][0] >= 1200) { ref = sp[0][1]; lab = "since " + new Date(sp[0][0] * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }
    if (ref) { const c = g.price - ref; chg.textContent = `${sg(c, 2)} (${sg(c / ref * 100, 2)}%) ${lab}`; chg.className = "num chg " + (c >= 0 ? "up" : "dn"); } else chg.textContent = "";
    drawSpark(sp.length > 1 ? [...sp.slice(0, -1), [Math.floor((j.serverNow || Date.now()) / 1000), g.price]] : sp);
    const span = sp.length > 1 ? Math.round((sp[sp.length - 1][0] - sp[0][0]) / 3600) : 0;
    $("gNote").textContent = (span >= 2 ? `Last ${span} hours. ` : "") + "Public spot price, refreshed every few seconds. Your broker's quote will differ slightly.";
    $("gLive").lastChild.textContent = "Live";
  } else card.hidden = true;
  const a = j.account, ac = $("acct");
  const pf = $("pfLive");
  if (a) {
    pf.hidden = false;
    pf.querySelector(".live-dot").classList.toggle("off", !a.online);
    const t = $("pfLiveT"); t.replaceChildren(a.online ? "Our own live account is running it right now. " : "Our own live account runs it. ");
    const l = document.createElement("a"); l.href = "#record"; l.textContent = "See the results"; t.appendChild(l);
  }
  if (a) {
    ac.hidden = false;
    const chip = $("acChip");
    chip.className = "chip " + (a.online ? "pulse" : "off");
    $("acChipT").textContent = a.online ? "Online now" : "Offline right now";
    if (!acctDone) {
      acctDone = true;
      const box = $("acNums"); box.replaceChildren();
      const add = (k, v, fmt) => { const d = document.createElement("div"), l = document.createElement("span"), b = document.createElement("b"); l.className = "lab"; l.textContent = k; d.append(l, b); box.appendChild(d); countUp(b, v, fmt); };
      add("Closed trades", a.trades, (v) => Math.round(v).toLocaleString("en-GB"));
      add("Net points", a.points, (v) => sg(Math.round(v)));
      add("Won", a.winRate * 100, (v) => Math.round(v) + "%");
      const c = REC && REC.curve;
      if (c && c.length > 1) {
        const lo = Math.min(0, ...c), hi = Math.max(0, ...c), span = hi - lo || 1, y = (v) => 66 - (v - lo) / span * 60, x = (i) => i / (c.length - 1) * 300;
        let d = ""; c.forEach((v, i) => (d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)));
        const sv = $("acCurve");
        sv.innerHTML = `<line x1="0" x2="300" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#2e3644" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/><path class="ln" pathLength="1" d="${d}"/>`;
        sv.removeAttribute("hidden"); $("acCap").hidden = false;
        if (!reduce) { sv.classList.add("pre"); sv._go = () => sv.classList.add("draw"); seen.observe(sv); }
      }
    }
  } else ac.hidden = true;
  layoutDesk();
}
async function pollLive() {
  if (document.hidden) return;
  try {
    const r = await fetch("/api/live", { cache: "no-store" }); if (!r.ok) throw new Error();
    liveFails = 0; applyLive(await r.json());
  } catch { if (++liveFails > 5 && !$("gold").hidden) $("gLive").lastChild.textContent = "Paused"; }
}

// ================================================================ the one-release timeline lights up step by step
function stepLine() {
  const line = document.querySelector(".line"); if (!line || reduce) return;
  const items = [...line.children]; let i = 0, on = false, t = 0;
  const step = () => {
    if (phone()) return;
    const li = items[i], vertical = getComputedStyle(line).gridTemplateColumns.split(" ").length === 1;
    items.forEach((x, k) => x.classList.toggle("lit", k === i));
    line.style.setProperty("--p", (vertical ? li.offsetTop + 8 : li.offsetLeft + 8) + "px");
    i = (i + 1) % items.length;
  };
  new IntersectionObserver((es) => { on = es[0].isIntersecting; clearInterval(t); if (on) { step(); t = setInterval(step, 1500); } }, { threshold: 0.3 }).observe(line);
}

// ================================================================ prices, methods, record
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
function applyPublic(j) {
  if (j.prices) {
    $("pLife").textContent = eur(j.prices.lifetime); $("pMon").textContent = eur(j.prices.monthly);
    const n = Math.ceil(j.prices.lifetime / j.prices.monthly);
    $("pTag").textContent = n > 1 && n <= 12 ? `Costs less than ${WORDS[n]} months of monthly` : "Pay once";
  }
  REFUND = j.refundDays || REFUND;
  if (j.prices) {
    $("heroPay").textContent = `${eur(j.prices.lifetime)} once or ${eur(j.prices.monthly)} a month.${j.refundDays ? ` ${j.refundDays}-day money-back guarantee.` : ""}`;
  }
  if (j.methods) {
    const m = j.methods, parts = [];
    if (m.card) parts.push("by <b>card, Apple Pay or Google Pay</b>");
    if (m.bank) parts.push("by <b>bank transfer</b>");
    if (m.crypto) parts.push("in <b>crypto</b>");
    const joined = parts.length > 1 ? parts.slice(0, -1).join(", ") + " or " + parts[parts.length - 1] : parts[0] || "";
    $("payLine").innerHTML = (joined ? "Pay " + joined + ". " : "") + (j.promo ? `The code <b>${j.promo.code.replace(/[^A-Z0-9_-]/g, "")}</b> is filled in for you at checkout.` : "Got a discount code? Enter it at checkout.");
  }
  if (j.announcement && !document.querySelector(".hero .annc")) {
    const a = document.createElement("div"); a.className = "wrap annc"; a.style.marginBottom = "28px";
    const n = document.createElement("p"); n.className = "note"; n.textContent = j.announcement; a.appendChild(n);
    document.querySelector(".hero").prepend(a);
  }
  applyPromo(j.promo);
  WEEK = j.week || [];
  if (j.record) REC = j.record;
  if (j.record && j.record.trades && $("record").hidden) record(j.record);
  // the Results links only lead somewhere while the live record is public
  document.querySelectorAll('a[href="#record"]').forEach((a) => (a.hidden = !(j.record && j.record.trades)));
  if (j.verifyUrl) {
    const v = $("recVerify"); v.replaceChildren("Independently tracked: ");
    const a = document.createElement("a"); a.href = j.verifyUrl; a.rel = "noopener"; a.target = "_blank"; a.textContent = "see the verified record"; v.appendChild(a); v.append(".");
  }
}
function record(r) {
  $("record").hidden = false;
  const since = /^\d{4}\.\d\d\.\d\d/.test(String(r.since)) ? new Date(String(r.since).slice(0, 10).replace(/\./g, "-") + "T12:00:00") : new Date(r.since);
  const sinceT = since.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  $("recLede").textContent = `Streamed straight from our own ${r.demo ? "demo" : "live"} MT5 account since ${sinceT}, every closed trade counted. It's one account on one broker, so your fills will differ.`;
  const stat = (k, v, fmt) => { const d = document.createElement("div"); d.className = "stat"; const s = document.createElement("span"); s.className = "lab"; s.textContent = k; const b = document.createElement("b"); d.append(s, b); if (typeof v === "number") countUp(b, v, fmt); else b.textContent = v; return d; };
  $("recStats").replaceChildren(stat("Closed trades", r.trades, (v) => Math.round(v).toLocaleString("en-GB")), stat("Net points", r.points, (v) => sg(Math.round(v))), stat("Won", r.winRate * 100, (v) => Math.round(v) + "%"),
    r.pf == null ? stat("Profit factor", "—") : stat("Profit factor", r.pf, (v) => v.toFixed(2)), stat("Average per trade", r.avg, (v) => sg(Math.round(v)) + " pts"), stat("Deepest drawdown", r.maxDD, (v) => MINUS + Math.round(v) + " pts"));
  const c = r.curve || [], s = $("recCurve");
  if (c.length > 1) {
    const lo = Math.min(0, ...c), hi = Math.max(0, ...c), span = hi - lo || 1, y = (v) => 210 - (v - lo) / span * 200, x = (i) => i / (c.length - 1) * 600;
    let d = ""; c.forEach((v, i) => (d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)));
    s.innerHTML = `<line x1="0" x2="600" y1="${y(0)}" y2="${y(0)}" stroke="#2e3644" stroke-dasharray="3 5"/><path d="${d}" fill="none" style="stroke:var(--ice)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
}

function tick() {
  const now = Date.now() + skew;
  const nx = tickNext(now);
  renderWeek(now);
  tickPromo(now, nx);
  layoutDesk();
}

async function load() {
  try {
    const t = Date.now(), r = await fetch("/api/public", { cache: "no-store" }), j = await r.json();
    skew = j.serverNow ? j.serverNow - (t + Date.now()) / 2 : 0;
    GROUPS = groupEvents(j.news || []);
    applyPublic(j);
  } catch { /* the page works without it */ }
  tick();
}

// ================================================================ question form
const f = $("askForm");
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f)), err = $("askErr"), b = f.querySelector("button");
  err.textContent = "";
  if (!/^\S+@\S+\.\S+$/.test(d.email || "")) { err.textContent = "Enter your email so we can reply."; return; }
  if ((d.message || "").trim().length < 5) { err.textContent = "Write your question first."; return; }
  b.disabled = true;
  try {
    const r = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, topic: "before buying" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || "That didn't send. Try again.");
    f.hidden = true; $("askSent").hidden = false;
  } catch (x) { err.textContent = x.message; } finally { b.disabled = false; }
});

// ================================================================ phones: tabs and swipe
const phone = () => matchMedia("(max-width:760px)").matches;
function tabs(list, panels) {
  const btns = [...list.querySelectorAll("[data-tab]")];
  const pick = (b, focus) => {
    btns.forEach((x) => x.setAttribute("aria-selected", x === b ? "true" : "false"));
    panels().forEach((p) => p.classList.toggle("on", p.dataset.panel === b.dataset.tab));
    if (focus) b.focus();
    // keep the chosen tab in view in a scrolling tab row
    const r = b.getBoundingClientRect(), lr = list.getBoundingClientRect();
    if (r.left < lr.left || r.right > lr.right) list.scrollBy({ left: r.left - lr.left - 16, behavior: reduce ? "auto" : "smooth" });
  };
  btns.forEach((b, i) => {
    b.id = b.id || `tab-${Math.random().toString(36).slice(2, 8)}`;
    b.addEventListener("click", () => pick(b));
    b.addEventListener("keydown", (e) => {
      const vis = btns.filter((x) => !x.hidden), k = vis.indexOf(b);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); pick(vis[(k + (e.key === "ArrowRight" ? 1 : vis.length - 1)) % vis.length], true); }
    });
  });
  return { next(d) { const vis = btns.filter((x) => !x.hidden), k = vis.findIndex((x) => x.getAttribute("aria-selected") === "true"); const n = vis[k + d]; if (n) pick(n); } };
}
function swipe(el, ctl) {
  let x0 = 0, y0 = 0, t0 = 0;
  el.addEventListener("touchstart", (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (!phone()) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 700) ctl.next(dx < 0 ? 1 : -1);
  }, { passive: true });
}
function setupTabs() {
  const desk = $("desk"), dt = tabs(desk.querySelector(".desk-tabs"), () => [...desk.querySelectorAll(".dk")]); swipe(desk, dt);
  const rec = $("record"), rt = tabs(rec.querySelector(".rec-tabs"), () => [...rec.querySelectorAll(".rec>[data-panel]")]); swipe(rec.querySelector(".rec"), rt);
  const pr = $("pricing"), pt = tabs(pr.querySelector(".plan-tabs"), () => [...pr.querySelectorAll(".plan")]); swipe(pr.querySelector(".plans"), pt);
  // the five steps become tabs labelled with their times
  const line = document.querySelector(".line"), ht = document.querySelector(".how-tabs");
  [...line.children].forEach((li, i) => {
    li.dataset.panel = "s" + i; if (i === 0) li.classList.add("on");
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "tab"); b.dataset.tab = "s" + i;
    b.setAttribute("aria-selected", i === 0 ? "true" : "false"); b.textContent = li.querySelector(".t").textContent; b.setAttribute("aria-label", li.querySelector(".t").textContent + ", " + li.querySelector("h3").textContent);
    ht.appendChild(b);
  });
  const hc = tabs(ht, () => [...line.children]); swipe(line, hc);
}

// ================================================================ phone menu
function setupMenu() {
  const btn = $("menuBtn"), sheet = $("sheet");
  const set = (open) => {
    document.documentElement.style.setProperty("--hdr", Math.round(top.getBoundingClientRect().bottom) + "px");
    sheet.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false"); btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.classList.toggle("lock", open);
  };
  btn.addEventListener("click", () => set(sheet.hidden));
  sheet.addEventListener("click", (e) => { if (e.target.closest("a,button") && !e.target.closest(".tp")) set(false); });   // trying colours keeps the menu open
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) { set(false); btn.focus(); } });
  addEventListener("resize", () => { if (!phone() && innerWidth > 940 && !sheet.hidden) set(false); });
}

// ================================================================ sticky buy bar on phones
function setupBuyBar() {
  const bar = $("mbuy"), seenNow = new Map();
  const update = () => {
    const show = phone() && !seenNow.get("cta") && !seenNow.get("pricing") && !seenNow.get("foot") && scrollY > 200;
    bar.classList.toggle("show", show); bar.setAttribute("aria-hidden", show ? "false" : "true"); $("mbGo").tabIndex = show ? 0 : -1;
    document.body.classList.toggle("mbuy-on", show);
  };
  const io = new IntersectionObserver((es) => { for (const e of es) seenNow.set(e.target.dataset.k, e.isIntersecting); update(); });
  const watch = (el, k) => { if (el) { el.dataset.k = k; io.observe(el); } };
  watch(document.querySelector(".hero .cta"), "cta"); watch($("pricing"), "pricing"); watch(document.querySelector(".foot"), "foot");
  addEventListener("scroll", update, { passive: true });
}

// ================================================================ lot-size calculator
function setupCalc() {
  const r = $("cLots"), bal = $("cBal");
  const money = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const run = () => {
    const lots = Number(r.value) / 100, pt = lots * 100 * 0.01, sl = pt * 100, b = Number(bal.value);
    $("cLotsV").textContent = lots.toFixed(2);
    $("cPt").textContent = money(pt); $("cSl").textContent = money(sl);
    const has = b > 0; $("cPctRow").hidden = !has;
    if (has) { const pc = sl / b * 100; $("cPct").textContent = (pc < 0.1 ? pc.toFixed(2) : pc.toFixed(1)) + "%"; }
    r.style.setProperty("--fill", ((r.value - r.min) / (r.max - r.min) * 100).toFixed(1) + "%");
  };
  r.addEventListener("input", run); bal.addEventListener("input", run); run();
}

setupTabs();
setupMenu();
setupBuyBar();
setupCalc();
stepLine();
load();
pollLive();
setInterval(tick, 1000);
setInterval(pollLive, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLive(); });
setInterval(load, 10 * 60 * 1000);
})();
