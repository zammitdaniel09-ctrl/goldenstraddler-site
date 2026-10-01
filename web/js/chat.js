// Website chat: AI assistant first, a person from the team can take over. Talks to /api/chat/*.
(() => {
"use strict";
if (window.GSChat) return;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = () => matchMedia("(max-width:760px)").matches;
const hasChat = () => /(?:^|;\s*)gs_chat_x=1/.test(document.cookie);
const ss = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch {} } };
let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}

const I = {
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17.5h-1A1.5 1.5 0 0 1 3 16V7a1.5 1.5 0 0 1 1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8.5" cy="11.5" r="1.15" fill="currentColor"/><circle cx="12" cy="11.5" r="1.15" fill="currentColor"/><circle cx="15.5" cy="11.5" r="1.15" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11m0-11l-11 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logo: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="1" y="1" width="62" height="62" rx="16" fill="#0E1116" stroke="#2e3644" stroke-width="2"/><text x="25" y="44" font-family="Unbounded,Arial Black,sans-serif" font-weight="800" font-size="30" fill="#fff" text-anchor="middle">G</text><text x="42" y="49" font-family="Sedgwick Ave,Segoe Script,cursive" font-size="36" fill="#3FC4FC" text-anchor="middle">S</text></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z" fill="currentColor"/></svg>',
  fresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.8 20c.9-3.6 3.8-5.6 7.2-5.6s6.3 2 7.2 5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

// ---------------------------------------------------------------- tiny markdown: paragraphs, **bold**, lists, links to our own pages
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function inline(s) {
  s = escH(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/\[([^\]]{1,120})\]\(([^)\s]{1,300})\)/g, (m, t, u) => {
    const ok = !/[\\\s]/.test(u) && (/^\/(?!\/)/.test(u) || /^https:\/\/(www\.)?goldenstraddler\.com(\/|$)/.test(u) || /^mailto:[^@\s]+@goldenstraddler\.com$/.test(u) || /^https:\/\/(portal\.fortuneprime\.com|www\.ultimamarkets\.com|www\.puprime\.partners)\//.test(u));
    const ext = /^https:\/\/(?!(www\.)?goldenstraddler\.com)/.test(u);
    return ok ? `<a href="${u.replace(/&amp;/g, "&").replace(/"/g, "%22")}"${ext ? ' target="_blank" rel="sponsored noopener"' : ""}>${t}</a>` : t;
  });
  s = s.replace(/(^|[\s(])(https:\/\/goldenstraddler\.com[^\s<)]*)/g, '$1<a href="$2">$2</a>');
  return s;
}
function md(text) {
  const out = []; let list = null;
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd(), ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (!list || list.kind !== kind) { if (list) out.push(list); list = { kind, items: [] }; }
      list.items.push(inline((ul || ol)[1])); continue;
    }
    if (list) { out.push(list); list = null; }
    out.push(line ? { p: inline(line) } : { gap: 1 });
  }
  if (list) out.push(list);
  let html = "", para = [];
  const flush = () => { if (para.length) { html += `<p>${para.join("<br>")}</p>`; para = []; } };
  for (const b of out) {
    if (b.p !== undefined) para.push(b.p);
    else if (b.gap) flush();
    else { flush(); html += `<${b.kind}>${b.items.map((i) => `<li>${i}</li>`).join("")}</${b.kind}>`; }
  }
  flush();
  return html;
}

// ---------------------------------------------------------------- DOM
const root = document.createElement("div");
root.className = "gsc";
root.innerHTML = `
<div class="gsc-tease" hidden><p></p><button class="gsc-tx" type="button" aria-label="Dismiss">${I.x}</button></div>
<button class="gsc-launch" type="button" aria-expanded="false" aria-controls="gscPanel" aria-label="Chat with us">${I.chat}<span class="gsc-l">Ask us</span><em class="gsc-badge" hidden>1</em></button>
<section class="gsc-panel" id="gscPanel" role="dialog" aria-label="Chat with GoldenStraddler" hidden>
  <header class="gsc-hd">
    <span class="gsc-av">${I.logo}</span>
    <div class="gsc-who"><b>GoldenStraddler</b><span class="gsc-sub"><i class="gsc-dot"></i><span class="gsc-subt">AI assistant. A person can join</span></span></div>
    <button class="gsc-new" type="button" title="Start a new chat" aria-label="Start a new chat">${I.fresh}</button>
    <button class="gsc-x" type="button" aria-label="Close chat">${I.x}</button>
  </header>
  <div class="gsc-log" role="log" aria-live="polite" aria-relevant="additions"></div>
  <div class="gsc-typing" hidden><span></span><i></i><i></i><i></i></div>
  <div class="gsc-sugg" role="group" aria-label="Suggested questions"></div>
  <form class="gsc-form">
    <textarea rows="1" maxlength="1500" placeholder="Ask anything about GoldenStraddler" aria-label="Your message"></textarea>
    <button type="submit" class="gsc-send" aria-label="Send">${I.send}</button>
  </form>
  <div class="gsc-ft"><button type="button" class="gsc-human">${I.person}Talk to a person</button><span>AI can make mistakes. Not financial advice. <a href="/privacy">Privacy</a></span></div>
</section>`;
const $ = (s) => root.querySelector(s);
const launch = $(".gsc-launch"), panel = $(".gsc-panel"), log = $(".gsc-log"), form = $(".gsc-form"), ta = $("textarea"), sugg = $(".gsc-sugg"), badge = $(".gsc-badge"), tease = $(".gsc-tease");

let rated = false, checkShown = false, idleT = 0, userMsgs = 0;
let BOOT = null, CFG = null, started = false, isOpen = false, busy = false, es = null, unread = 0, mode = "ai", email = "", signedIn = false, lastId = 0, handoffShown = false;

function scrollEnd(smooth) { log.scrollTo({ top: log.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" }); }
function bubble(role, text, who, opts = {}) {
  const row = document.createElement("div"); row.className = "gsc-m " + role;
  if (role === "ai" || role === "agent") { const l = document.createElement("span"); l.className = "gsc-by"; l.textContent = role === "ai" ? "AI assistant" : (who || "GoldenStraddler team"); row.appendChild(l); }
  const b = document.createElement("div"); b.className = "gsc-b";
  if (role === "user" || role === "sys") b.textContent = text; else b.innerHTML = md(text);
  row.appendChild(b);
  if (opts.before) log.insertBefore(row, opts.before); else log.appendChild(row);
  scrollEnd(true);
  return b;
}
function render(m) {
  if (m.id && m.id <= lastId) return;
  if (m.id) lastId = m.id;
  bubble(m.role, m.text, m.who);
}
function setSub() {
  const t = $(".gsc-subt"), dot = $(".gsc-dot");
  if (mode === "human") { t.textContent = CFG.teamOnline ? "A person from our team is here" : "Our team will reply here"; dot.className = "gsc-dot person"; }
  else if (CFG.ai) { t.textContent = CFG.teamOnline ? "AI assistant. Team online too" : "AI assistant. A person can join"; dot.className = "gsc-dot"; }
  else { t.textContent = "Leave a message and our team replies here"; dot.className = "gsc-dot person"; }
}
function suggestions(show) {
  sugg.replaceChildren();
  if (!show || !CFG.suggestions) { sugg.hidden = true; return; }
  sugg.hidden = false;
  for (const q of CFG.suggestions) { const b = document.createElement("button"); b.type = "button"; b.textContent = q; b.onclick = () => send(q); sugg.appendChild(b); }
}

// ---------------------------------------------------------------- start, stream of team messages
async function start() {
  if (started) return true;
  try {
    let j = BOOT; BOOT = null;
    if (!j) { const r = await fetch("/api/chat/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); j = await r.json(); if (!r.ok) throw new Error(j.error || "Chat isn't available"); }
    if (!j.ok) throw new Error(j.error || "Chat isn't available");
    CFG = j.config; signedIn = j.signedIn; email = (j.chat && j.chat.email) || j.customerEmail || "";
    mode = (j.chat && j.chat.mode) || (CFG.ai ? "ai" : "human");
    rated = !!(j.chat && j.chat.rated); userMsgs = (j.messages || []).filter((m) => m.role === "user").length;
    started = true;
    log.replaceChildren();
    bubble("ai", CFG.ai ? CFG.greeting : "Hi. Leave your question here and someone from our team will reply in this chat. Add your email and you'll get the answer even if you close the page.");
    if (!CFG.ai) log.lastChild.querySelector(".gsc-by").textContent = "GoldenStraddler";
    (j.messages || []).forEach(render);
    suggestions(!(j.messages || []).some((m) => m.role === "user"));
    setSub();
    if (j.chat) stream();
    return true;
  } catch (e) { return false; }
}
function stream() {
  if (es || !window.EventSource) return;
  es = new EventSource("/api/chat/stream");
  es.addEventListener("msg", (e) => {
    const m = JSON.parse(e.data); if (m.id <= lastId) return;
    $(".gsc-typing").hidden = true;
    if (started) render(m); else lastId = Math.max(lastId, m.id);
    if (m.role === "agent" && (!isOpen || document.hidden)) { unread++; badge.textContent = unread; badge.hidden = false; }
    if (m.role === "agent") armIdle();
  });
  es.addEventListener("rate", () => { if (started) showStars(); });
  es.addEventListener("mode", (e) => { mode = JSON.parse(e.data).mode; if (CFG) setSub(); });
  let tt;
  es.addEventListener("typing", (e) => {
    const t = $(".gsc-typing"); t.querySelector("span").textContent = `${JSON.parse(e.data).who || "Our team"} is typing`; t.hidden = false;
    clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 5000);
  });
  es.onerror = () => { if (es && es.readyState === 2) { es = null; } };
}

// ---------------------------------------------------------------- sending
function typing(on) { const t = $(".gsc-typing"); t.querySelector("span").textContent = ""; t.hidden = !on; if (on) scrollEnd(true); }
async function send(text) {
  text = String(text || "").trim();
  if (!text || busy) return;
  busy = true; form.classList.add("busy"); suggestions(false);
  const mine = bubble("user", text);
  userMsgs++; clearTimeout(idleT); root.querySelectorAll(".gsc-check").forEach((x) => x.remove());
  ta.value = ""; grow();
  try {
    const r = await fetch("/api/chat/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, page: location.pathname + location.hash, tz }) });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "That didn't send. Try again."); }
    if (ct.includes("application/json")) {
      const j = await r.json();
      if (j.user) lastId = Math.max(lastId, j.user.id);
      if (j.sys) render(j.sys);
      mode = "human"; setSub();
      if (!email && !handoffShown) handoff(true);
    } else {
      typing(true);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "", full = "", b = null, raf = 0;
      const paint = () => { raf = 0; if (b) { b.innerHTML = md(full); scrollEnd(false); } };
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const blk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (blk.match(/^event: (.+)$/m) || [])[1], data = (blk.match(/^data: (.+)$/m) || [])[1];
          if (!ev || !data) continue;
          const d = JSON.parse(data);
          if (ev === "user") lastId = Math.max(lastId, d.id);
          else if (ev === "delta") { if (!b) { typing(false); b = bubble("ai", ""); } full += d.t; if (!raf) raf = requestAnimationFrame(paint); }
          else if (ev === "done") {
            typing(false);
            if (d.msg.role === "sys") { if (b) b.parentNode.remove(); render(d.msg); }
            else { lastId = Math.max(lastId, d.msg.id); if (!b) b = bubble("ai", ""); full = d.msg.text; paint(); }
            if (d.email) email = d.email;
            if (d.handoff) { mode = "human"; setSub(); if (!handoffShown) handoff(!email); }
            else if (d.check) showCheck();
            else armIdle();
          }
        }
      }
    }
    stream();
  } catch (e) {
    typing(false);
    const s = bubble("sys", e.message || "That didn't send. Try again.");
    s.parentNode.classList.add("err");
    if (!mine.parentNode.isConnected) bubble("user", text);
  } finally { busy = false; form.classList.remove("busy"); if (!phone()) ta.focus(); }
}

// ---------------------------------------------------------------- "all sorted?" and a one-click rating
function armIdle() {
  clearTimeout(idleT);
  if (rated || checkShown || userMsgs < 1) return;
  idleT = setTimeout(() => { if (isOpen && !busy && !ta.value.trim()) showCheck(); }, 50000);
}
function showCheck() {
  if (rated || checkShown) return;
  checkShown = true; clearTimeout(idleT);
  const card = document.createElement("div"); card.className = "gsc-check";
  card.innerHTML = `<p>Did that answer everything?</p><div><button type="button" class="yes">Yes, all sorted</button><button type="button" class="no">I have another question</button></div>`;
  log.appendChild(card); scrollEnd(true);
  card.querySelector(".yes").onclick = () => { card.remove(); showStars(); };
  card.querySelector(".no").onclick = () => { card.remove(); checkShown = false; ta.focus(); };
}
function showStars() {
  if (rated || root.querySelector(".gsc-rate")) return;
  checkShown = true;
  const card = document.createElement("div"); card.className = "gsc-rate";
  card.innerHTML = `<p>How did we do?</p><div class="gsc-stars" role="group" aria-label="Rate this chat">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} out of 5">${I.star}</button>`).join("")}</div><span class="gsc-rate-err" aria-live="polite"></span>`;
  log.appendChild(card); scrollEnd(true);
  const btns = [...card.querySelectorAll("button")];
  const paint = (n) => btns.forEach((b, i) => b.classList.toggle("on", i < n));
  btns.forEach((b) => {
    b.onmouseenter = () => paint(+b.dataset.n); b.onfocus = () => paint(+b.dataset.n);
    b.onclick = async () => {
      const n = +b.dataset.n; paint(n); btns.forEach((x) => (x.disabled = true));
      try {
        const r = await fetch("/api/chat/rate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stars: n }) }), j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "That didn't save. Try again.");
        rated = true; card.classList.add("done"); card.querySelector("p").textContent = "Thanks for rating us";
        setTimeout(() => { card.remove(); render(j.msg); }, 900);
      } catch (x) { card.querySelector(".gsc-rate-err").textContent = x.message; btns.forEach((y) => (y.disabled = false)); }
    };
  });
  card.querySelector(".gsc-stars").onmouseleave = () => paint(0);
}

// ---------------------------------------------------------------- hand over to a person
function handoff(needEmail) {
  handoffShown = true;
  const card = document.createElement("form"); card.className = "gsc-hand";
  card.innerHTML = `<b>Bring in a person</b><p>${needEmail ? "Leave your email and our team will reply here and by email, so you get the answer even if you close this page." : "Our team will pick this up and reply here."}</p>
    ${needEmail ? `<input type="email" required autocomplete="email" placeholder="you@example.com" aria-label="Your email" value="${escH(email)}">` : ""}
    <div class="gsc-hand-a"><button type="submit" class="gsc-hand-go">${needEmail ? "Ask for a person" : "Yes, ask for a person"}</button><button type="button" class="gsc-hand-no">Not now</button></div><span class="gsc-hand-err" aria-live="polite"></span>`;
  log.appendChild(card); scrollEnd(true);
  card.querySelector(".gsc-hand-no").onclick = () => { card.remove(); handoffShown = false; };
  card.onsubmit = async (e) => {
    e.preventDefault();
    const inp = card.querySelector("input"), em = inp ? inp.value.trim() : email, err = card.querySelector(".gsc-hand-err"), go = card.querySelector(".gsc-hand-go");
    if (inp && !/^\S+@\S+\.\S+$/.test(em)) { err.textContent = "Enter your email so we can reply."; inp.focus(); return; }
    go.disabled = true; err.textContent = "";
    try {
      if (!hasChat()) { await send("I'd like to talk to a person."); card.remove(); return; }
      const r = await fetch("/api/chat/human", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em }) }), j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "That didn't work. Try again.");
      email = em || email; mode = "human"; setSub(); card.remove(); render(j.msg); stream();
    } catch (x) { err.textContent = x.message; go.disabled = false; }
  };
  const inp = card.querySelector("input"); if (inp && !phone()) inp.focus();
}

// ---------------------------------------------------------------- open, close, teaser
async function open() {
  if (isOpen) return;
  hideTease(); ss.set("gsc_seen", "1");
  isOpen = true; panel.hidden = false; root.classList.add("open"); launch.setAttribute("aria-expanded", "true");
  if (phone()) document.documentElement.classList.add("gsc-lock");
  ss.set("gsc_open", "1");
  unread = 0; badge.hidden = true;
  if (!started) {
    log.innerHTML = '<div class="gsc-load"><i></i><i></i><i></i></div>';
    const ok = await start();
    if (!ok) { log.replaceChildren(); bubble("sys", "Chat isn't available right now. Use the question form on the home page or email us."); }
  }
  scrollEnd(false);
  if (!phone()) ta.focus();
}
function close() {
  if (!isOpen) return;
  isOpen = false; panel.hidden = true; root.classList.remove("open"); launch.setAttribute("aria-expanded", "false");
  document.documentElement.classList.remove("gsc-lock");
  ss.set("gsc_open", "0");
  launch.focus();
}
let teaseT = 0;
function hideTease() { tease.hidden = true; clearTimeout(teaseT); }
function maybeTease() {
  if (isOpen || ss.get("gsc_seen") === "1" || ss.get("gsc_tease") === "1") return;
  ss.set("gsc_tease", "1");
  tease.querySelector("p").textContent = "Questions about brokers, setup or the discount code? Ask here. You get an answer in seconds.";
  tease.hidden = false; teaseT = setTimeout(hideTease, 14000);
}
tease.querySelector(".gsc-tx").onclick = (e) => { e.stopPropagation(); hideTease(); ss.set("gsc_seen", "1"); };
tease.onclick = () => open();

launch.onclick = () => (isOpen ? close() : open());
$(".gsc-x").onclick = close;
$(".gsc-human").onclick = async () => { if (!started) await start(); if (!handoffShown) handoff(!email); };
$(".gsc-new").onclick = async () => {
  await fetch("/api/chat/new", { method: "POST" }).catch(() => {});
  if (es) { es.close(); es = null; }
  started = false; lastId = 0; handoffShown = false; mode = "ai"; email = ""; rated = false; checkShown = false; userMsgs = 0; clearTimeout(idleT);
  await start(); ta.focus();
};
addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen) close(); });
form.onsubmit = (e) => { e.preventDefault(); send(ta.value); };
function grow() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 132) + "px"; }
ta.addEventListener("input", grow);
ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); } });
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-chat-open]"); if (!t) return;
  e.preventDefault();
  if (root.isConnected) { open(); return; }
  // chat switched off: fall back to the email form on the home page
  const q = document.querySelector(".mailq"); if (q) { q.open = true; q.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); } else location.href = "/#contact";
});

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    const r = await fetch("/api/chat/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return;                       // chat switched off: no launcher
    BOOT = await r.json();
  } catch { return; }
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add("ready"));
  if (hasChat()) stream();
  if (/[?&]chat=1\b/.test(location.search) || ss.get("gsc_open") === "1") open();
  // a gentle prompt, once per visit: after a while on the page and some scrolling
  let scrolled = false;
  addEventListener("scroll", () => { if (scrollY > innerHeight * 0.9) scrolled = true; }, { passive: true });
  setTimeout(function chk() { if (scrolled || !phone()) maybeTease(); else setTimeout(chk, 5000); }, phone() ? 40000 : 25000);
}
window.GSChat = { open, close };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
