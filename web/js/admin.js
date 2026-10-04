(() => {
"use strict";
let ME = null, STREAM = null, REFRESH = null;
const view = $("view");

// ---------------------------------------------------------------- sign-in
function showGate() {
  $("app").hidden = true; $("gate").hidden = false;
  const otp = otpBoxes($("gOtp"), () => submit());
  async function submit() {
    const email = $("gEmail").value.trim(), code = otp.code();
    if (!email) { $("gErr").textContent = "Enter your email."; $("gEmail").focus(); return; }
    if (code.length < 6) { $("gErr").textContent = "Enter all 6 digits."; return; }
    $("gBtn").disabled = true; $("gErr").textContent = "";
    try { await api("/api/admin/login", { email, code }); $("gate").hidden = true; start(); }
    catch (x) { $("gErr").textContent = x.message; otp.shake(); otp.clear(); }
    finally { $("gBtn").disabled = false; }
  }
  $("gateForm").onsubmit = (e) => { e.preventDefault(); submit(); };
  setTimeout(() => ($("gEmail").value ? otp.focus() : $("gEmail").focus()), 50);
}

async function start() {
  try { ME = (await api("/api/admin/me")).admin; } catch (x) { if (x.status === 401) return showGate(); throw x; }
  $("app").hidden = false;
  $("meName").textContent = ME.name || ME.email; $("meRole").textContent = ME.role === "owner" ? "Owner" : "Admin";
  $("logout").onclick = async () => { try { await api("/api/admin/logout", {}); } catch {} location.reload(); };
  $("menuBtn").onclick = () => $("side").classList.toggle("open");
  addEventListener("hashchange", route);
  openStream(); route();
}
function openStream() {
  if (!window.EventSource) return;
  STREAM = new EventSource("/api/admin/stream");
  let t;
  const soon = () => { clearTimeout(t); t = setTimeout(() => { if (["overview", "live", "messages", "orders"].includes(page())) render(page(), true); }, 700); };
  ["status", "trades", "message"].forEach((ev) => STREAM.addEventListener(ev, soon));
  STREAM.addEventListener("chat", (e) => { const d = JSON.parse(e.data); chatEvent(d); });
}
const page = () => (location.hash.slice(1) || "overview").split("/")[0];
function route() {
  $("side").classList.remove("open");
  document.querySelectorAll(".side nav a").forEach((a) => a.getAttribute("href") === "#" + page() ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  clearInterval(REFRESH);
  render(page());
}
async function render(p, quiet) {
  const fn = VIEWS[p] || VIEWS.overview;
  try { await fn(quiet); } catch (x) { if (x.status === 401) return showGate(); view.replaceChildren(el("p", "err", x.message)); }
}
function head(title, ...acts) {
  const h = el("div", "top"), a = el("div", "acts");
  h.append(el("h1", "", title), a); a.append(...acts);
  return h;
}
function table(cols, rows, empty, onClick) {
  const wrap = el("div", "tbl-x"), t = el("table", "t"), th = el("thead"), tr = el("tr"), tb = el("tbody");
  cols.forEach((c) => { const x = el("th", c.r ? "r" : "", c.t); tr.appendChild(x); });
  th.appendChild(tr); t.append(th, tb); wrap.appendChild(t);
  if (!rows.length) { const r = el("tr"), d = el("td", "empty-row", empty || "Nothing here yet."); d.colSpan = cols.length; r.appendChild(d); tb.appendChild(r); }
  rows.forEach((row) => {
    const r = el("tr", onClick ? "click" : "");
    cols.forEach((c) => { const d = el("td", (c.n ? "n " : "") + (c.r ? "r" : "")); const v = c.f(row); if (v instanceof Node) d.appendChild(v); else d.textContent = v ?? DASH; r.appendChild(d); });
    if (onClick) r.addEventListener("click", (e) => { if (!e.target.closest("button,a")) onClick(row); });
    tb.appendChild(r);
  });
  return wrap;
}
const pill = (s, txt) => el("span", "pill " + s, txt || s);
const btn = (label, cls = "btn xs") => { const b = el("button", cls, label); b.type = "button"; return b; };
const card = (title, ...kids) => { const c = el("section", "card"); if (title) c.appendChild(typeof title === "string" ? el("h2", "", title) : title); c.append(...kids); return c; };

// ---------------------------------------------------------------- overview
const VIEWS = {};
VIEWS.overview = async () => {
  const d = await api("/api/admin/overview");
  $("nPending").hidden = !d.pendingBank.length; $("nPending").textContent = d.pendingBank.length;
  $("nMsg").hidden = !d.unread; $("nMsg").textContent = d.unread;
  setChatBadge(d.chatsWaiting || 0);
  const stat = (label, v, s) => { const x = el("div", "stat"); x.append(el("span", "lab", label), el("div", "v", v), el("div", "s", s || "")); return x; };
  const g = el("div", "grid g4");
  g.append(stat("Revenue today", eur(d.revenue.today.s), `${d.revenue.today.n} payment${d.revenue.today.n === 1 ? "" : "s"}`),
    stat("Last 30 days", eur(d.revenue.month.s), `${d.revenue.month.n} payments · ${eur(d.revenue.all.s)} all time`),
    stat("Active licences", String(d.licences.active), `${d.licences.lifetime} lifetime · ${d.licences.monthly} monthly`),
    stat("Online now", String(d.online), `MRR ${eur(d.mrr)} · ${d.customers} customers`));
  const out = [head("Overview"), g];
  const setup = d.setup, steps = [["stripe", "Connect Stripe (card, Apple Pay, Google Pay)"], ["crypto", "Connect NOWPayments (crypto)"], ["bank", "Add bank details for transfers"], ["email", "Connect email sending (Resend)"], ["seller", "Add seller details for the legal pages"], ["chat", "Connect the AI chat (Claude API key)"]];
  if (steps.some(([k]) => !setup[k])) {
    const s = el("div", "setup");
    steps.forEach(([k, t]) => { const a = el("a", setup[k] ? "done" : ""); a.href = "#settings"; a.append(el("b", "", setup[k] ? "✓" : ""), document.createTextNode(t)); s.appendChild(a); });
    out.push(card("Finish setting up", s));
  }
  // revenue bars (30 days)
  const days = [], map = Object.fromEntries(d.daily.map((x) => [x.d, x]));
  for (let i = 29; i >= 0; i--) { const t = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push(map[t] || { d: t, s: 0, n: 0 }); }
  const max = Math.max(1, ...days.map((x) => x.s)), bars = el("div", "bars");
  days.forEach((x) => { const i = el("i", x.s ? "" : "z"); i.style.height = Math.max(3, (x.s / max) * 100) + "%"; i.title = `${x.d}: ${eur(x.s)} (${x.n})`; bars.appendChild(i); });
  const g2 = el("div", "grid g2a");
  g2.append(card(el("h2", "", "Revenue, last 30 days"), bars),
    card("Needs attention", (() => {
      const s = el("div", "stack");
      if (!d.pendingBank.length && !d.refundRequests.length) s.appendChild(el("p", "fine", "Nothing waiting. Bank transfers to confirm and refund requests show up here."));
      d.pendingBank.forEach((o) => {
        const r = el("div", "key-row"); r.style.justifyContent = "space-between";
        r.append(el("span", "", `Bank transfer ${o.id} · ${eur(o.amount_cents)} · ${o.email}`), act(btn("Mark paid", "btn xs pri"), () => markPaid(o.id), "Marked as paid. The licence was emailed."));
        s.appendChild(r);
      });
      d.refundRequests.forEach((m) => {
        const r = el("div", "stack"); r.style.gap = "6px";
        const id = (m.message.match(/order (GS-[A-Z0-9]+)/) || [])[1];
        r.append(el("span", "", `Refund request from ${m.email}`), el("span", "fine", m.message));
        if (id) { const b = btn("Refund " + id, "btn xs danger"); b.dataset.confirm = "Click again to refund"; r.appendChild(act(b, async () => { await api(`/api/admin/order/${id}/refund`, {}); render("overview"); }, "Refunded and licence switched off.")); }
        s.appendChild(r);
      });
      return s;
    })()));
  out.push(g2, card(el("h2", "", "Latest orders"), ordersTable(d.recent)));
  view.replaceChildren(...out);
};
async function markPaid(id) {
  const ref = prompt("Bank reference or note (optional):", "") ;
  if (ref === null) throw new Error("Cancelled");
  await api(`/api/admin/order/${id}/paid`, { ref }); render(page());
}
function ordersTable(rows, actions) {
  return table([
    { t: "Order", f: (o) => o.id, n: 1 }, { t: "Customer", f: (o) => o.email },
    { t: "Plan", f: (o) => PLAN[o.plan] + (o.kind === "renew" ? " renewal" : "") }, { t: "Method", f: (o) => METHOD[o.method] || o.method },
    { t: "Amount", f: (o) => eur(o.amount_cents) + (o.code ? ` (${o.code})` : ""), n: 1, r: 1 }, { t: "Status", f: (o) => pill(o.status) },
    { t: "Created", f: (o) => dateFmt(o.created_at), n: 1 },
    ...(actions ? [{ t: "", r: 1, f: (o) => {
      const a = el("div", "row-acts");
      if (["pending", "processing", "failed", "expired"].includes(o.status) && (o.method === "bank" || o.method === "crypto")) a.appendChild(act(btn("Mark paid", "btn xs pri"), () => markPaid(o.id), "Marked as paid."));
      if (o.status === "paid") { const b = btn("Refund", "btn xs danger"); b.dataset.confirm = "Confirm refund"; a.appendChild(act(b, async () => { await api(`/api/admin/order/${o.id}/refund`, {}); render(page()); }, "Refunded. The licence is switched off.")); }
      if (o.status === "pending" || o.status === "processing") a.appendChild(act(btn("Cancel"), async () => { await api(`/api/admin/order/${o.id}/cancel`, {}); render(page()); }, "Order cancelled."));
      return a; } }] : []),
  ], rows, "No orders yet.");
}

// ---------------------------------------------------------------- live accounts
VIEWS.live = async (quiet) => {
  const d = await api("/api/admin/live");
  const online = d.accounts.filter((a) => a.online).length;
  const t = table([
    { t: "", f: (a) => el("span", "dot" + (a.online ? " on" : "")) },
    { t: "Customer", f: (a) => a.email }, { t: "MT5 account", f: (a) => `${a.account}${a.demo ? " (demo)" : ""}`, n: 1 },
    { t: "Server", f: (a) => a.server || DASH }, { t: "Licence", f: (a) => pill(a.licence === "active" ? "ok" : a.licence, a.licence) },
    { t: "EA", f: (a) => a.online ? (a.state || DASH) : "offline " + agoFmt(a.statusAt || a.lastSeen) },
    { t: "Balance", f: (a) => a.balance !== undefined && a.balance !== null ? Number(a.balance).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + a.currency : DASH, n: 1, r: 1 },
    { t: "Open P/L", f: (a) => a.position ? Number(a.position.profit).toFixed(2) : DASH, n: 1, r: 1 },
    { t: "Trades", f: (a) => String(a.trades), n: 1, r: 1 }, { t: "Net", f: (a) => a.net.toFixed(2), n: 1, r: 1 }, { t: "Points", f: (a) => Math.round(a.points).toLocaleString(), n: 1, r: 1 },
  ], d.accounts, "No EA has connected yet. Accounts appear here the first time a customer's EA checks its licence.", (a) => openLicence(a.id));
  view.replaceChildren(head("Live accounts", el("span", "chip" + (online ? " pulse" : " dim"), `${online} online`)), card(null, t));
  if (!quiet) { clearInterval(REFRESH); REFRESH = setInterval(() => page() === "live" && render("live", true), 10000); }
};

// ---------------------------------------------------------------- customers
VIEWS.customers = async () => {
  const q = el("input", "field"); q.placeholder = "Search email or name"; q.type = "search";
  const box = el("div");
  const load = async () => {
    const d = await api("/api/admin/customers?q=" + encodeURIComponent(q.value.trim()));
    box.replaceChildren(table([{ t: "Email", f: (c) => c.email }, { t: "Name", f: (c) => c.name || DASH }, { t: "Licences", f: (c) => String(c.licences), r: 1, n: 1 },
      { t: "Spent", f: (c) => eur(c.spent), r: 1, n: 1 }, { t: "EA last seen", f: (c) => agoFmt(c.last_seen) }, { t: "Since", f: (c) => dateFmt(c.created_at, false) }],
      d.customers, "No customers yet.", (c) => openCustomer(c.id)));
  };
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  const f = el("div", "filters"); f.appendChild(q);
  const add = btn("Issue a licence", "btn sm pri"); add.onclick = issueDialog;
  view.replaceChildren(head("Customers", add), card(null, f, box));
  await load();
};
function drawer(...kids) {
  const d = $("drawer"); d.replaceChildren(...kids); d.classList.add("open");
  const close = (e) => { if (e.type === "keydown" && e.key !== "Escape") return; d.classList.remove("open"); removeEventListener("keydown", close); };
  addEventListener("keydown", close);
  d.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => { d.classList.remove("open"); removeEventListener("keydown", close); }));
}
function drHead(title, sub) {
  const h = el("div", "hd"), t = el("div"); const h2 = el("h2", "", title); h2.id = "drTitle"; t.append(h2);
  if (sub) t.append(el("p", "fine", sub));
  const x = btn("Close", "btn sm"); x.dataset.close = "1"; h.append(t, x); return h;
}
async function openCustomer(id) {
  const d = await api("/api/admin/customer/" + id), c = d.customer;
  const notes = el("textarea", "field"); notes.value = c.notes || ""; notes.rows = 3;
  const name = el("input", "field"); name.value = c.name || ""; name.placeholder = "Name";
  const save = act(btn("Save notes", "btn xs"), () => api(`/api/admin/customer/${c.id}/notes`, { notes: notes.value, name: name.value }), "Saved.");
  const so = act(btn("Sign out everywhere", "btn xs"), () => api(`/api/admin/customer/${c.id}/signout`, {}), "Customer signed out on every device.");
  const lics = el("div", "stack"); d.licences.forEach((l) => lics.appendChild(licenceCard(l, () => openCustomer(id))));
  if (!d.licences.length) lics.appendChild(el("p", "fine", "No licences."));
  const msgs = el("div", "stack");
  d.messages.forEach((m) => { const x = el("div", "lic"); x.append(el("span", "fine", `${dateFmt(m.at)} · ${m.topic || "message"}`), el("div", "", m.message)); msgs.appendChild(x); });
  drawer(drHead(c.email, `Customer since ${dateFmt(c.created_at, false)}`),
    el("section", "", ""), (() => { const s = el("section"); s.append(el("h3", "", "Licences"), lics); return s; })(),
    (() => { const s = el("section"); s.append(el("h3", "", "Orders"), ordersTable(d.orders, true)); return s; })(),
    (() => { const s = el("section"), g = el("div", "formgrid"); const l1 = el("label", "full"); l1.append("Name", name); const l2 = el("label", "full"); l2.append("Private notes (only admins see these)", notes);
      g.append(l1, l2); const a = el("div", "row-acts"); a.style.justifyContent = "flex-start"; a.style.marginTop = "10px"; a.append(save, so, (() => { const m = el("a", "btn xs", "Email customer"); m.href = "mailto:" + c.email; return m; })());
      s.append(el("h3", "", "Customer"), g, a); return s; })(),
    ...(d.messages.length ? [(() => { const s = el("section"); s.append(el("h3", "", "Messages"), msgs); return s; })()] : []));
}
function licenceCard(l, reload) {
  const c = el("div", "lic"), top = el("div", "key-row"); top.style.justifyContent = "space-between";
  const k = el("span", "k", l.key), cp = btn("Copy key"); cp.onclick = () => copyText(l.key, cp);
  top.append(k, cp);
  const eff = l.effective || l.status;
  const kv = el("dl", "kvs");
  const add = (a, b) => { kv.append(el("dt", "", a)); const dd = el("dd"); if (b instanceof Node) dd.appendChild(b); else dd.textContent = b; kv.append(dd); };
  add("Status", pill(eff === "active" ? "active" : eff, eff));
  add("Plan", PLAN[l.plan] + (l.source ? ` · ${METHOD[l.source] || l.source}` : ""));
  add("Paid until", l.expires_at ? dateFmt(l.expires_at) : "Never expires");
  add("MT5 account", l.account ? `${l.account}${l.account_demo ? " (demo)" : ""} on ${l.account_server || "?"}` : "Not locked yet");
  add("EA", l.online ? "online now" : "last seen " + agoFmt(l.last_seen) + (l.ea_build ? ` · v${l.ea_build}` : ""));
  if (l.note) add("Note", l.note);
  const a = el("div", "row-acts"); a.style.justifyContent = "flex-start";
  const call = (action, body, msg) => act(btn(action === "revoke" ? "Switch off" : action === "restore" ? "Switch on" : action === "release" ? "Unlock account" : action === "extend" ? "Add 30 days" : action === "lifetime" ? "Make lifetime" : "Resend email",
    action === "revoke" ? "btn xs danger" : "btn xs"), async () => { await api(`/api/admin/licence/${l.id}/${action}`, body || {}); reload(); }, msg);
  if (l.status === "revoked") a.appendChild(call("restore", {}, "Licence switched on."));
  else { const r = call("revoke", { reason: "switched off by admin" }, "Licence switched off. The EA stops placing new orders within 30 minutes."); r.dataset.confirm = "Click again to switch off"; a.appendChild(r); }
  if (l.account) { const u = call("release", {}, "Account unlocked. The next MT5 account it runs on gets locked."); u.dataset.confirm = "Click again to unlock"; a.appendChild(u); }
  if (l.plan === "monthly") { a.appendChild(call("extend", { days: 30 }, "Added 30 days.")); a.appendChild(call("lifetime", {}, "Changed to lifetime.")); }
  a.appendChild(call("resend", {}, "Licence email sent again."));
  c.append(top, kv, a);
  return c;
}
async function openLicence(id) {
  const d = await api("/api/admin/licence/" + id);
  const c = await api("/api/admin/customer/" + d.licence.customer_id);
  openCustomer(c.customer.id);
}
function issueDialog() {
  const g = el("form", "formgrid");
  const email = el("input", "field"); email.type = "email"; email.required = true;
  const name = el("input", "field");
  const plan = el("select", "field"); ["lifetime", "monthly", "journal", "trial"].forEach((p) => { const o = el("option", "", p === "journal" ? "Journal only" : p === "trial" ? "Demo trial (demo accounts only)" : PLAN[p]); o.value = p; plan.appendChild(o); });
  const days = el("input", "field"); days.type = "number"; days.min = "0"; days.placeholder = "30";
  const amount = el("input", "field"); amount.type = "number"; amount.min = "0"; amount.step = "0.01"; amount.value = "0";
  const note = el("input", "field"); note.placeholder = "e.g. paid in cash, partner, friend";
  const lab = (t, inp, full) => { const l = el("label", full ? "full" : ""); l.append(t, inp); return l; };
  const go = btn("Issue licence and email it", "btn sm pri"); go.type = "submit";
  g.append(lab("Customer email", email), lab("Name (optional)", name), lab("Plan", plan), lab("Days (monthly or journal; blank = 30)", days), lab("Amount received (EUR)", amount), lab("Note", note), go);
  g.onsubmit = async (e) => { e.preventDefault(); go.disabled = true;
    try { const r = await api("/api/admin/licence/new", { email: email.value, name: name.value, plan: plan.value, days: days.value, amount: amount.value, note: note.value });
      toast("Licence " + r.licence.key + " issued and emailed."); $("drawer").classList.remove("open"); render(page()); }
    catch (x) { toast(x.message, true); } finally { go.disabled = false; } };
  drawer(drHead("Issue a licence", "For bank transfers you received outside the site, partners or free licences."), g);
  email.focus();
}

// ---------------------------------------------------------------- licences
VIEWS.licences = async () => {
  const q = el("input", "field"); q.type = "search"; q.placeholder = "Search email, key or MT5 account";
  const box = el("div");
  const load = async () => {
    const d = await api("/api/admin/licences?q=" + encodeURIComponent(q.value.trim()));
    box.replaceChildren(table([
      { t: "", f: (l) => el("span", "dot" + (l.online ? " on" : "")) }, { t: "Key", f: (l) => l.key, n: 1 }, { t: "Customer", f: (l) => l.email },
      { t: "Plan", f: (l) => PLAN[l.plan] }, { t: "Status", f: (l) => pill(l.effective === "active" ? "active" : l.effective, l.effective) },
      { t: "Paid until", f: (l) => l.expires_at ? dateFmt(l.expires_at, false) : "Lifetime" }, { t: "MT5 account", f: (l) => l.account || "not locked", n: 1 },
      { t: "Last seen", f: (l) => agoFmt(l.last_seen) }], d.licences, "No licences yet.", (l) => openLicence(l.id)));
  };
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  const f = el("div", "filters"); f.appendChild(q);
  const add = btn("Issue a licence", "btn sm pri"); add.onclick = issueDialog;
  view.replaceChildren(head("Licences", add), card(null, f, box)); await load();
};

// ---------------------------------------------------------------- orders
VIEWS.orders = async () => {
  const st = el("select", "field"), me = el("select", "field"), q = el("input", "field");
  [["", "All statuses"], ["paid", "Paid"], ["pending", "Pending"], ["processing", "Processing"], ["refunded", "Refunded"], ["disputed", "Disputed"], ["failed", "Failed"], ["expired", "Expired"], ["cancelled", "Cancelled"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; st.appendChild(o); });
  [["", "All methods"], ["card", "Card / wallet"], ["crypto", "Crypto"], ["bank", "Bank transfer"], ["manual", "Manual"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; me.appendChild(o); });
  q.type = "search"; q.placeholder = "Search email or order";
  const box = el("div");
  const load = async () => { const d = await api(`/api/admin/orders?status=${st.value}&method=${me.value}&q=${encodeURIComponent(q.value.trim())}`); box.replaceChildren(ordersTable(d.orders, true)); };
  st.onchange = me.onchange = load; let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  const f = el("div", "filters"); f.append(st, me, q);
  view.replaceChildren(head("Orders"), card(null, f, box)); await load();
};

// ---------------------------------------------------------------- discount codes
VIEWS.codes = async () => {
  const d = await api("/api/admin/codes");
  const g = el("form", "formgrid");
  const code = el("input", "field"); code.placeholder = "e.g. GOLD500"; code.required = true; code.style.textTransform = "uppercase";
  const kind = el("select", "field"); [["amount", "Euros off"], ["percent", "Percent off"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; kind.appendChild(o); });
  const value = el("input", "field"); value.type = "number"; value.min = "1"; value.step = "0.01"; value.required = true; value.value = "500";
  const plans = el("select", "field"); [["lifetime", "Lifetime only"], ["monthly", "Monthly only"], ["both", "Both plans"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; plans.appendChild(o); });
  const dur = el("select", "field"); [["once", "First month only"], ["forever", "Every month"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; dur.appendChild(o); });
  const max = el("input", "field"); max.type = "number"; max.min = "1"; max.placeholder = "Unlimited";
  const exp = el("input", "field"); exp.type = "date";
  const note = el("input", "field"); note.placeholder = "Who it's for (e.g. partner name)";
  const lab = (t, inp, cls) => { const l = el("label", cls || ""); l.append(t, inp); return l; };
  const preview = el("p", "fine full");
  const upd = () => { const v = Number(value.value) || 0, pl = plans.value; const L = d.prices.lifetime, M = d.prices.monthly;
    const off = (p) => kind.value === "percent" ? Math.round(p * Math.min(100, v) / 100) : Math.round(v * 100);
    preview.textContent = (pl !== "monthly" ? `Lifetime ${eur(L)} → ${eur(Math.max(100, L - off(L)))}` : "") + (pl === "both" ? "   ·   " : "") + (pl !== "lifetime" ? `Monthly ${eur(M)} → ${eur(Math.max(100, M - off(M)))} (${dur.value === "once" ? "first month" : "every month"})` : ""); };
  [kind, value, plans, dur].forEach((x) => (x.oninput = x.onchange = upd)); upd();
  const go = btn("Create code", "btn sm pri"); go.type = "submit";
  g.append(lab("Code", code), lab("Discount type", kind), lab("Amount", value), lab("Applies to", plans), lab("Monthly discount lasts", dur), lab("Max uses", max), lab("Expires (optional)", exp), lab("Note", note), preview, go);
  g.onsubmit = async (e) => { e.preventDefault(); go.disabled = true;
    try { await api("/api/admin/codes", { code: code.value, kind: kind.value, value: value.value, plans: plans.value === "both" ? ["lifetime", "monthly"] : [plans.value], monthly_duration: dur.value, max_uses: max.value, expires: exp.value, note: note.value });
      toast("Code " + code.value.toUpperCase() + " is live."); render("codes"); } catch (x) { toast(x.message, true); } finally { go.disabled = false; } };
  const t = table([
    { t: "Code", f: (c) => c.code, n: 1 }, { t: "Discount", f: (c) => c.kind === "percent" ? c.value + "%" : eur(c.value) },
    { t: "Plans", f: (c) => c.plans.split(",").map((p) => PLAN[p]).join(", ") + (c.plans.includes("monthly") ? (c.monthly_duration === "once" ? " (1st month)" : " (every month)") : "") },
    { t: "Used", f: (c) => c.uses + (c.max_uses ? " / " + c.max_uses : ""), n: 1, r: 1 }, { t: "Revenue", f: (c) => eur(c.revenue), n: 1, r: 1 },
    { t: "Expires", f: (c) => c.expires_at ? dateFmt(c.expires_at, false) : DASH }, { t: "Note", f: (c) => c.note || DASH },
    { t: "Status", f: (c) => pill(c.active ? "active" : "expired", c.active ? "on" : "off") },
    { t: "", r: 1, f: (c) => { const a = el("div", "row-acts"); a.appendChild(act(btn(c.active ? "Switch off" : "Switch on"), async () => { await api("/api/admin/code/" + encodeURIComponent(c.code), { active: !c.active }); render("codes"); }));
      if (!c.uses) { const del = btn("Delete", "btn xs danger"); del.dataset.confirm = "Confirm"; a.appendChild(act(del, async () => { await api("/api/admin/code/" + encodeURIComponent(c.code), { delete: true }); render("codes"); })); } return a; } },
  ], d.codes, "No codes yet. Create one above, e.g. GOLD500 for €500 off Lifetime.");
  const tip = el("p", "fine"); tip.textContent = "EU rule: don't advertise a crossed-out 'was' price you never charged. Codes you hand out are fine.";
  view.replaceChildren(head("Discount codes"), card("New code", g), card("Codes", t, tip));
};

// ---------------------------------------------------------------- messages
VIEWS.messages = async () => {
  const d = await api("/api/admin/messages");
  const list = el("div", "stack");
  if (!d.messages.length) list.appendChild(el("p", "fine", "No messages yet. The contact form, support requests and refund requests land here."));
  d.messages.forEach((m) => {
    const c = el("div", "lic"); if (m.handled) c.style.opacity = ".6";
    const top = el("div", "key-row"); top.style.justifyContent = "space-between";
    top.append(el("b", "", `${m.name ? m.name + " · " : ""}${m.email}`), el("span", "fine", `${m.topic || "message"} · ${dateFmt(m.at)}`));
    const body = el("div", ""); body.style.whiteSpace = "pre-wrap"; body.textContent = m.message;
    const a = el("div", "row-acts"); a.style.justifyContent = "flex-start";
    const rep = el("a", "btn xs", "Reply by email"); rep.href = `mailto:${m.email}?subject=${encodeURIComponent("Re: your GoldenStraddler message")}`;
    a.append(rep, act(btn(m.handled ? "Mark as open" : "Mark as handled"), async () => { await api("/api/admin/message/" + m.id, { handled: !m.handled }); render("messages"); }));
    c.append(top, body, a); list.appendChild(c);
  });
  view.replaceChildren(head("Messages"), list);
};

// ---------------------------------------------------------------- chats
let CHAT_ID = null, CHAT_FILTER = "open", CHAT_TYPING = 0;
function setChatBadge(n) { const b = $("nChat"); b.hidden = !n; b.textContent = n; document.title = (n ? `(${n}) ` : "") + "Admin | GoldenStraddler"; }
let chatT;
function chatEvent(d) {
  if (page() !== "chats") { if (d.kind === "human" || d.kind === "message") api("/api/admin/chat-stats").then((s) => setChatBadge(s.waiting)).catch(() => {}); return; }
  clearTimeout(chatT); chatT = setTimeout(() => { loadChatList(); if (CHAT_ID === d.id) { if (d.kind === "delete") { CHAT_ID = null; showChat(null); } else openChat(d.id, true); } }, 250);
}
const chatWho = (c) => c.name || c.email || c.cust_email || "Visitor" + (c.country ? " (" + c.country + ")" : "");
function chatPill(c) {
  if (c.status === "closed") return pill("closed", "closed");
  if (c.wants_human && c.unread) return pill("pending", "needs you");
  return c.mode === "human" ? pill("active", "with team") : pill("", "AI");
}
VIEWS.chats = async () => {
  const st = await api("/api/admin/chat-stats");
  setChatBadge(st.waiting);
  const out = [];
  const flt = el("select", "field"); [["open", "Open chats"], ["all", "All chats"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; flt.appendChild(o); });
  flt.value = CHAT_FILTER; flt.onchange = () => { CHAT_FILTER = flt.value; loadChatList(); };
  flt.style.width = "auto";
  const nameBtn = btn("Your name in replies: " + (/^(owner|admin)$/i.test(ME.name || "") || !ME.name ? "not set" : ME.name), "btn sm");
  nameBtn.onclick = () => {
    const f = el("form", "formgrid"), i = el("input", "field"); i.value = /^(owner|admin)$/i.test(ME.name || "") ? "" : ME.name || ""; i.placeholder = "e.g. Daniel"; i.maxLength = 40;
    const l = el("label", "full"); l.append("Shown to visitors above your replies, for example Daniel", i);
    const s = btn("Save", "btn sm pri"); s.type = "submit"; f.append(l, s);
    f.onsubmit = async (e) => { e.preventDefault(); try { const r = await api("/api/admin/chat-name", { name: i.value.trim() }); ME.name = r.name; $("meName").textContent = r.name; $("drawer").classList.remove("open"); toast("Saved."); render("chats"); } catch (x) { toast(x.message, true); } };
    drawer(drHead("Your name in chat", "Visitors see this name above your replies."), f); setTimeout(() => i.focus(), 50);
  };
  out.push(head("Chats", flt, nameBtn));
  if (!st.connected) out.push(el("p", "note", "The AI assistant isn't connected yet, so every chat comes straight to you. Add a Claude API key under Settings, AI chat."));
  const w = el("div", "chatw"), list = el("div", "chat-list"), pane = el("section", "chat-pane");
  list.id = "chatList"; pane.id = "chatPane";
  w.append(list, pane); out.push(w);
  const foot = el("p", "fine"); foot.textContent = `Last 30 days: ${st.month.chats} chats, ${st.month.replies} AI answers, about $${st.month.costUsd.toFixed(2)} in AI costs, ${st.ratings.n ? `average rating ${st.ratings.avg} from ${st.ratings.n}` : "no ratings yet"}. Today: ${st.today} of ${st.cap} AI answers.`;
  out.push(foot);
  view.replaceChildren(...out);
  await loadChatList();
  const want = location.hash.split("/")[1];
  if (want) openChat(want); else if (CHAT_ID) openChat(CHAT_ID); else showChat(null);
};
async function loadChatList() {
  const list = $("chatList"); if (!list) return;
  const d = await api("/api/admin/chats?status=" + CHAT_FILTER);
  list.replaceChildren();
  if (!d.chats.length) list.appendChild(el("p", "fine pad", "No chats yet. When a visitor writes in the chat on the website it shows up here straight away."));
  d.chats.forEach((c) => {
    const b = el("button", "chat-i" + (c.id === CHAT_ID ? " on" : "") + (c.wants_human && c.unread ? " hot" : "")); b.type = "button"; b.dataset.id = c.id;
    const t = el("div", "r1"); const who = el("b", "", chatWho(c)); if (c.online) who.prepend(el("i", "dot on"));
    t.append(who, el("span", "fine", agoFmt(c.updated_at)));
    const r2 = el("div", "r2"); r2.append(chatPill(c)); if (c.unread) r2.append(el("em", "cnt", String(c.unread))); if (c.rating) r2.append(el("span", "stars", "★".repeat(c.rating) + "☆".repeat(5 - c.rating)));
    const pv = el("p", "pv", (c.last_role === "agent" ? "You: " : c.last_role === "ai" ? "AI: " : c.last_role === "sys" ? "" : "") + (c.last_text || ""));
    b.append(t, r2, pv);
    b.onclick = () => { history.replaceState(null, "", "#chats/" + c.id); openChat(c.id); };
    list.appendChild(b);
  });
}
function showChat(node) {
  const pane = $("chatPane"); if (!pane) return;
  if (!node) { pane.replaceChildren(el("div", "chat-empty", "Pick a chat on the left. New messages appear here live.")); document.querySelector(".chatw").classList.remove("open"); return; }
  pane.replaceChildren(node); document.querySelector(".chatw").classList.add("open");
}
async function openChat(id, quiet) {
  let d; try { d = await api("/api/admin/chat/" + id); } catch (x) { if (!quiet) toast(x.message, true); return; }
  const c = d.chat, keep = $("chatReply") ? $("chatReply").value : "";
  const prevId = CHAT_ID; CHAT_ID = id;
  document.querySelectorAll(".chat-i").forEach((x) => x.classList.toggle("on", x.dataset.id === id));
  const box = el("div", "chat-box");
  const hd = el("div", "chat-hd"), back = btn("Back", "btn xs chat-back"); back.onclick = () => { CHAT_ID = null; history.replaceState(null, "", "#chats"); showChat(null); };
  const info = el("div", "chat-info"), title = el("b", "", chatWho(c));
  const meta = el("span", "fine", [c.email && c.email !== chatWho(c) ? c.email : "", c.page ? "on " + c.page : "", "started " + dateFmt(c.created_at), c.online ? "here now" : "not on the site now", c.rating ? `rated ${c.rating} of 5` : ""].filter(Boolean).join(", "));
  info.append(title, meta);
  if (c.customer) { const a = el("a", "btn xs", "Customer"); a.href = "#customers"; a.onclick = (e) => { e.preventDefault(); openCustomer(c.customer.id); }; info.append(a); }
  const acts = el("div", "row-acts");
  const mode = act(btn(c.mode === "human" ? "Hand back to the AI" : "Take over", "btn xs"), async () => { await api(`/api/admin/chat/${id}/${c.mode === "human" ? "handback" : "takeover"}`, {}); openChat(id, true); loadChatList(); });
  const cl = act(btn(c.status === "closed" ? "Closed" : "Close chat", "btn xs"), async () => { await api(`/api/admin/chat/${id}/close`, {}); openChat(id, true); loadChatList(); });
  if (c.status === "closed") cl.disabled = true;
  acts.append(mode, cl);
  if (ME.role === "owner") { const del = btn("Delete", "btn xs danger"); del.dataset.confirm = "Delete for good?"; act(del, async () => { await api(`/api/admin/chat/${id}/delete`, {}); CHAT_ID = null; showChat(null); loadChatList(); }, "Chat deleted."); acts.append(del); }
  hd.append(back, info, acts);
  const msgs = el("div", "chat-msgs");
  d.messages.forEach((m) => {
    const row = el("div", "cm " + m.role);
    if (m.role !== "user" && m.role !== "sys") row.append(el("span", "by", m.role === "ai" ? "AI assistant" : (m.who || "Team")));
    if (m.role === "user") row.append(el("span", "by", chatWho(c)));
    const bb = el("div", "bb", m.text); row.append(bb, el("span", "at", new Date(m.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })));
    msgs.append(row);
  });
  const f = el("form", "chat-compose"), ta = el("textarea", "field"); ta.id = "chatReply"; ta.rows = 2; ta.placeholder = c.mode === "human" ? "Write a reply. Enter sends, Shift+Enter for a new line." : "Write a reply to take over from the AI"; ta.value = keep;
  const send = btn("Send", "btn sm pri"); send.type = "submit";
  f.append(ta, send);
  const sub = async (e) => {
    e && e.preventDefault(); const text = ta.value.trim(); if (!text) return;
    send.disabled = true;
    try { const r = await api(`/api/admin/chat/${id}/reply`, { text }); ta.value = ""; if (r.mailed) toast("They've left the site, so your reply was also emailed to them."); else if (!r.online) toast(c.email ? "They've left the site. They'll see it next time, and we email at most every 10 minutes." : "They've left the site and left no email. They'll see your reply if they come back."); openChat(id, true); loadChatList(); }
    catch (x) { toast(x.message, true); } finally { send.disabled = false; }
  };
  f.onsubmit = sub;
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sub(); } });
  ta.addEventListener("input", () => { if (Date.now() - CHAT_TYPING > 3000) { CHAT_TYPING = Date.now(); api(`/api/admin/chat/${id}/typing`, {}).catch(() => {}); } });
  const tip = el("p", "fine", c.mode === "human" ? "You're handling this chat. The AI stays quiet until you hand it back." : "The AI is answering. Replying takes over, or use Take over.");
  box.append(hd, msgs, f, tip);
  showChat(box);
  msgs.scrollTop = msgs.scrollHeight;
  if (prevId !== id || !quiet) ta.focus();
}

// ---------------------------------------------------------------- admins
VIEWS.admins = async () => {
  const d = await api("/api/admin/admins");
  const out = [head("Admins")];
  const t = table([{ t: "Name", f: (a) => a.name }, { t: "Email", f: (a) => a.email }, { t: "Role", f: (a) => a.role === "owner" ? "Owner" : "Admin" },
    { t: "Status", f: (a) => pill(a.active ? "active" : "revoked", a.active ? "active" : "disabled") }, { t: "Last sign-in", f: (a) => agoFmt(a.last_login) },
    { t: "", r: 1, f: (a) => { if (ME.role !== "owner" || a.id === ME.id) return el("span"); const x = el("div", "row-acts");
      x.appendChild(act(btn(a.active ? "Disable" : "Enable", a.active ? "btn xs danger" : "btn xs"), async () => { await api(`/api/admin/admin/${a.id}/${a.active ? "disable" : "enable"}`, {}); render("admins"); }));
      x.appendChild(act(btn("New authenticator code"), async () => { const r = await api(`/api/admin/admin/${a.id}/reset`, {}); showQr(a.email, r); }));
      return x; } }], d.admins);
  out.push(card("Team", t));
  if (ME.role === "owner") {
    const g = el("form", "formgrid"), email = el("input", "field"), name = el("input", "field"), role = el("select", "field");
    email.type = "email"; email.required = true; name.required = true;
    [["admin", "Admin (everything except settings and admins)"], ["owner", "Owner (full access)"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; role.appendChild(o); });
    const lab = (t, i) => { const l = el("label"); l.append(t, i); return l; };
    const go = btn("Add admin", "btn sm pri"); go.type = "submit";
    g.append(lab("Name", name), lab("Email", email), lab("Role", role), go);
    g.onsubmit = async (e) => { e.preventDefault(); go.disabled = true; try { const r = await api("/api/admin/admins", { email: email.value, name: name.value, role: role.value }); showQr(email.value, r); render("admins"); } catch (x) { toast(x.message, true); } finally { go.disabled = false; } };
    out.push(card("Add a partner or admin", el("p", "fine", "They sign in with their email and the authenticator app. You'll get a QR code to send them privately."), g));
  }
  view.replaceChildren(...out);
};
function showQr(email, r) {
  const q = el("div", "qr"); q.innerHTML = r.qr;
  const s = el("div", "secret", r.secret), cp = btn("Copy setup key"); cp.onclick = () => copyText(r.secret, cp);
  drawer(drHead("Authenticator for " + email, "Show this once. It won't be shown again."),
    el("p", "", "In Google Authenticator tap + then Scan a QR code. Or enter the setup key by hand (time-based)."), (() => { const w = el("div", "stack"); w.style.marginTop = "14px"; w.append(q, s, cp); return w; })(),
    el("p", "fine", "They then sign in at " + location.origin + "/admin with " + email + " and the 6-digit code."));
}

// ---------------------------------------------------------------- settings
VIEWS.settings = async () => {
  const d = await api("/api/admin/settings"), s = d.settings, owner = ME.role === "owner";
  const fields = {};
  const inp = (k, label, opts = {}) => { const i = opts.area ? el("textarea", "field") : el(opts.select ? "select" : "input", "field");
    if (opts.select) opts.select.forEach(([v, t]) => { const o = el("option", "", t); o.value = v; i.appendChild(o); });
    if (opts.type) i.type = opts.type; if (opts.step) i.step = opts.step; i.value = opts.money ? (Number(s[k]) / 100).toFixed(2) : s[k] ?? ""; if (!owner) i.disabled = true;
    if (opts.ph) i.placeholder = opts.ph; fields[k] = { i, money: opts.money }; const l = el("label", opts.full ? "full" : ""); l.append(label, i); return l; };
  const form = (title, intro, ...rows) => { const g = el("form", "formgrid"); g.append(...rows);
    if (owner) { const b = btn("Save", "btn sm pri"); b.type = "submit"; g.append(b); g.onsubmit = async (e) => { e.preventDefault(); const body = {};
      Object.keys(fields).forEach((k) => { if (g.contains(fields[k].i)) body[k] = fields[k].money ? fields[k].i.value : fields[k].i.value; });
      b.disabled = true; try { await api("/api/admin/settings", body); toast("Saved."); } catch (x) { toast(x.message, true); } finally { b.disabled = false; } }; }
    return card(title, ...(intro ? [el("p", "fine", intro)] : []), g); };
  const yn = [["1", "On"], ["0", "Off"]];
  const out = [head("Settings")];
  if (!owner) out.push(el("p", "note", "Only the owner can change settings."));
  // integrations
  const integ = el("div", "stack");
  const conn = (ok) => pill(ok ? "active" : "pending", ok ? "connected" : "not connected");
  const stripeRow = el("div", "stack"), sk = el("input", "field"); sk.type = "password"; sk.placeholder = "Secret key from Stripe → Developers → API keys (sk_live_...)"; sk.autocomplete = "off";
  const sBtn = act(btn("Connect Stripe", "btn sm pri"), async () => { const r = await api("/api/admin/integrations", { stripe_secret: sk.value.trim() }); sk.value = ""; render("settings"); return r; }, (r) => `Stripe connected (${r.stripe.account}, ${r.stripe.live ? "live" : "test"} mode). Payments are on.`);
  stripeRow.append(el("div", "key-row", ""), sk, el("div", "key-row"));
  stripeRow.firstChild.append(el("b", "", "Stripe"), conn(d.connected.stripe && d.connected.stripe_webhook), el("span", "fine", "Card, Apple Pay, Google Pay"));
  stripeRow.lastChild.append(sBtn);
  const npRow = el("div", "stack"), nk = el("input", "field"), ns = el("input", "field");
  nk.type = ns.type = "password"; nk.autocomplete = ns.autocomplete = "off"; nk.placeholder = "NOWPayments API key"; ns.placeholder = "NOWPayments IPN secret key";
  npRow.append(el("div", "key-row"), nk, ns, el("div", "key-row"));
  npRow.firstChild.append(el("b", "", "NOWPayments"), conn(d.connected.np && d.connected.np_ipn), el("span", "fine", "Crypto"));
  npRow.lastChild.append(act(btn("Connect NOWPayments", "btn sm pri"), async () => { await api("/api/admin/integrations", { np_api_key: nk.value.trim(), np_ipn_secret: ns.value.trim() }); render("settings"); }, "NOWPayments connected."));
  const rsRow = el("div", "stack"), rk = el("input", "field"); rk.type = "password"; rk.autocomplete = "off"; rk.placeholder = "Resend API key (re_...)";
  rsRow.append(el("div", "key-row"), rk, el("div", "key-row"));
  rsRow.firstChild.append(el("b", "", "Email (Resend)"), conn(d.connected.resend), el("span", "fine", "Licence emails, sign-in codes, receipts"));
  rsRow.lastChild.append(act(btn("Connect email", "btn sm pri"), async () => { await api("/api/admin/integrations", { resend_key: rk.value.trim() }); render("settings"); }, "Email connected."),
    act(btn("Send me a test email", "btn sm"), () => api("/api/admin/test-email", {}), "Test email sent. Check your inbox."));
  integ.append(stripeRow, el("hr", ""), npRow, el("hr", ""), rsRow);
  integ.querySelectorAll("hr").forEach((h) => { h.style.border = "0"; h.style.borderTop = "1px solid var(--edge)"; h.style.margin = "4px 0"; });
  const wh = el("p", "fine"); wh.textContent = `Webhook addresses (set automatically for Stripe): ${d.webhooks.stripe} · ${d.webhooks.nowpayments}`;
  if (owner) out.push(card("Payments and email", el("p", "fine", "Paste each key once. They're stored encrypted and never shown again."), integ, wh));
  // AI chat
  const cs = await api("/api/admin/chat-stats").catch(() => null);
  if (owner && cs) {
    const kRow = el("div", "stack"), ak = el("input", "field"); ak.type = "password"; ak.autocomplete = "off"; ak.placeholder = "Claude API key (sk-ant-...)";
    kRow.append(el("div", "key-row"), ak, el("div", "key-row"));
    kRow.firstChild.append(el("b", "", "Claude (Anthropic)"), conn(d.connected.anthropic), el("span", "fine", "Answers chat questions"));
    kRow.lastChild.append(act(btn("Connect AI chat", "btn sm pri"), async () => { await api("/api/admin/integrations", { anthropic_key: ak.value.trim() }); ak.value = ""; render("settings"); }, "AI chat connected. The assistant now answers on the website."));
    const help = el("p", "fine", "Create a key at console.anthropic.com, under API keys, and add some credit under Billing. We check the key before saving it.");
    const use = el("p", "fine", `Last 30 days: ${cs.month.chats} chats, ${cs.month.replies} AI answers, about $${cs.month.costUsd.toFixed(2)}. Today: ${cs.today} of ${cs.cap} answers.`);
    out.push(card("AI chat", kRow, help, use));
    const modelOpts = cs.models.map((m) => [m.id, m.label]);
    out.push(form("Chat settings", "The chat sits in the corner of every public page. The AI answers first; anyone can ask for a person, and you reply from Chats.",
      inp("chat_enabled", "Show the chat on the website", { select: yn }), inp("chat_ai", "AI answers first", { select: yn }),
      inp("chat_model", "AI model", { select: modelOpts }), inp("chat_daily_cap", "Most AI answers per day (cost cap)", { type: "number" }),
      inp("chat_greeting", "Greeting (blank = default)", { full: 1, area: 1 })));
  }

  if (owner) {
    const ea = await api("/api/admin/ea"), f = el("input", "field"), v = el("input", "field");
    f.type = "file"; f.accept = ".ex5"; v.placeholder = "Version, e.g. 3.10"; v.value = ea.version || "";
    const st = el("p", "fine", ea.present ? `Customers download version ${ea.version}, ${Math.round(ea.size / 1024)} KB${ea.at ? ", uploaded " + dateFmt(ea.at) : ""}.` : "No EA uploaded yet. Customers see \"being prepared\" instead of a download.");
    const up = act(btn("Upload EA", "btn sm pri"), async () => {
      const file = f.files[0]; if (!file) throw new Error("Choose the compiled GoldenStraddler.ex5 first.");
      const r = await fetch("/api/admin/ea?version=" + encodeURIComponent(v.value.trim()), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
      const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || "Upload failed.");
      render("settings"); return j;
    }, (j) => `Uploaded. Customers now get version ${j.version}.`);
    const g = el("div", "formgrid"); const l1 = el("label"); l1.append("Compiled EA (.ex5)", f); const l2 = el("label"); l2.append("Version", v); g.append(l1, l2, up);
    out.push(card("EA file for customers", st, g));
  }
  out.push(form("Prices", "Prices in euros, including VAT if you charge it.",
    inp("price_lifetime", "Lifetime (EUR)", { type: "number", step: "0.01", money: 1 }), inp("price_monthly", "Monthly (EUR)", { type: "number", step: "0.01", money: 1 }),
    inp("methods_card", "Card / Apple Pay / Google Pay", { select: yn }), inp("methods_crypto", "Crypto", { select: yn }), inp("methods_bank", "Bank transfer", { select: yn }),
    inp("stripe_tax", "Let Stripe calculate VAT (Stripe Tax)", { select: yn })));
  out.push(form("Bank transfer details", "Shown to customers who pick bank transfer. You confirm each payment under Orders.",
    inp("bank_holder", "Account holder"), inp("bank_iban", "IBAN"), inp("bank_bic", "BIC / SWIFT"), inp("bank_name", "Bank name")));
  out.push(form("Seller details", "Required on the Terms and Imprint pages in the EU.",
    inp("seller_name", "Legal name (company or your name)"), inp("seller_reg", "Company number (if any)"), inp("seller_address", "Registered address", { full: 1 }), inp("seller_vat", "VAT number (if any)")));
  out.push(form("Emails", "",
    inp("support_email", "Support address (shown to customers)"), inp("mail_from", "Send emails as"), inp("notify_emails", "Also notify about sales (comma separated)", { full: 1 })));
  out.push(form("Website", "",
    inp("record_public", "Show the live track record on the sales page", { select: yn }), inp("record_min_trades", "Only once it has at least this many trades", { type: "number" }),
    inp("refund_days", "Money-back period (days)", { type: "number" }), inp("move_days", "Customers can move a licence every (days)", { type: "number" }),
    inp("trial_days", "Free demo trial length in days (0 = no trial; runs on demo accounts only)", { type: "number" }),
    inp("record_verify_url", "Verified record link, e.g. your public Myfxbook page (blank = none)", { full: 1, ph: "https://www.myfxbook.com/members/..." }),
    inp("promo_code", "Code shown in the bar at the top of the home page (blank = no bar). Give it an end date under Codes and the bar counts down to it", { full: 1 }),
    inp("announcement", "Banner on the sales page (blank = none)", { full: 1 }), inp("ea_version", "Current EA version"), inp("site_url", "Site address")));
  // the Markets page: publish switch and the health of each free data source
  const hub = await api("/api/admin/hub").catch(() => null);
  if (hub) {
    out.push(form("Markets page", hub.public ? "Published: linked from the site menu and open to search engines." : "Hidden: anyone with the link can open it, but it isn't in the menu and search engines are asked not to index it.",
      inp("hub_public", "Publish the Markets page", { select: yn })));
    const list = el("div", "hub-srcs"), bad = hub.sources.filter((r) => !r.ok_at || r.err);
    for (const r of [...bad, ...hub.sources.filter((r) => r.ok_at && !r.err)]) {
      const ok = !!r.ok_at, fresh = ok && !r.err, row = el("div", "hub-src");
      row.title = (r.err || r.last || "");
      row.append(pill(fresh ? "active" : ok ? "pending" : "revoked", fresh ? "ok" : ok ? "stale" : "failing"), el("span", "", r.name || r.src));
      if (!fresh) row.append(el("span", "fine", (r.err || "").slice(0, 90)));
      list.append(row);
    }
    const open = el("a", "btn sm", "Open the Markets page"); open.href = "/markets"; open.target = "_blank"; open.rel = "noopener";
    const acts = el("div", "row"); acts.append(open);
    if (owner) acts.append(act(btn("Fetch all data now", "btn sm"), () => api("/api/admin/hub/refresh", {}), () => "Fetching. It takes about a minute; reload this page after."));
    out.push(card("Markets data", el("p", "fine", `${hub.markets} markets, calls for the week ending ${hub.asOf || "(not yet)"}${hub.computedAt ? ", worked out " + new Date(hub.computedAt).toLocaleString() : ""}. Live record: ${hub.live.n ? hub.live.hits + " of " + hub.live.n + " right" : "starts once the first week is graded"}.${hub.err ? " Error: " + hub.err : ""}`), list, acts));
  }
  // the journal: hidden until it's switched on here
  if (cs) {
    const modelOpts2 = cs.models.map((m) => [m.id, m.label]);
    const open = el("a", "btn sm", "Open the journal"); open.href = "/journal/app"; open.target = "_blank"; open.rel = "noopener";
    const demo = el("a", "btn sm", "Open it with sample data"); demo.href = "/journal/app?demo=1"; demo.target = "_blank"; demo.rel = "noopener";
    const land = el("a", "btn sm", "Open the journal page"); land.href = "/journal"; land.target = "_blank"; land.rel = "noopener";
    const row = el("div", "row"); row.append(open, demo, land);
    out.push(form("Journal", d.settings.journal_public === "1" ? "Published: the journal page is linked and the Journal plan can be bought. GoldenStraddler customers get it included." : "Hidden: only you (signed in to admin) can open it. Customers don't see it and the Journal plan can't be bought yet.",
      inp("journal_public", "Publish the journal", { select: yn }), inp("price_journal", "Journal plan (EUR a month)", { type: "number", step: "0.01", money: 1 }),
      inp("journal_ai_credits", "AI coach credits per customer each month (a question or trade review is 1, a review is 4)", { type: "number" }), inp("journal_ai_model", "AI coach model", { select: modelOpts2 })));
    out.push(card("Open the journal", el("p", "fine", "To use it yourself, sign in to your customer account in this browser as well (any email with a licence), then open it."), row));
  }
  if (owner) { const b = el("a", "btn sm", "Download a backup of the database"); b.href = "/api/admin/export"; out.push(card("Backup", el("p", "fine", "Everything: customers, licences, orders, codes, trades."), b)); }
  view.replaceChildren(...out);
};

// ---------------------------------------------------------------- activity
VIEWS.activity = async () => {
  const d = await api("/api/admin/audit");
  view.replaceChildren(head("Activity"), card(null, table([{ t: "When", f: (a) => dateFmt(a.at), n: 1 }, { t: "Who", f: (a) => a.actor }, { t: "What", f: (a) => a.action }, { t: "Target", f: (a) => a.target || DASH, n: 1 }, { t: "Detail", f: (a) => a.detail || DASH }], d.audit)));
};

start();
})();
