(() => {
"use strict";
let ME = null, CUR = null;

// ---------------------------------------------------------------- sign-in (email code, or email + licence key)
function gate() {
  $("app").hidden = true; $("gate").hidden = false;
  let step = "email", useKey = false;
  const otp = otpBoxes($("gOtp"), () => submit());
  const setMode = () => {
    $("gOtp").hidden = step !== "code"; $("gKey").hidden = !useKey; $("gEmail").hidden = step === "code";
    $("gBtn").textContent = useKey ? "Sign in" : step === "email" ? "Send me a code" : "Sign in";
    $("gHelp").textContent = useKey ? "Enter the email you bought with and your licence key (it's in your licence email)." :
      step === "email" ? "Enter the email you bought with. We'll send you a 6-digit code." : `We sent a code to ${$("gEmail").value.trim()}. It works for 10 minutes.`;
    $("gAlt").textContent = useKey ? "Get a code by email instead" : step === "code" ? "Use a different email" : "Sign in with your licence key instead";
    $("gErr").textContent = "";
  };
  async function submit() {
    const email = $("gEmail").value.trim();
    $("gBtn").disabled = true; $("gErr").textContent = "";
    try {
      if (useKey) { await api("/api/login/key", { email, key: $("gKey").value.trim() }); return start(); }
      if (step === "email") {
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
        const r = await api("/api/login/code", { email });
        if (!r.email) { useKey = true; setMode(); $("gErr").textContent = "Email codes aren't available right now. Sign in with your licence key."; return; }
        step = "code"; setMode(); otp.focus(); return;
      }
      const code = otp.code(); if (code.length < 6) throw new Error("Enter all 6 digits.");
      await api("/api/login/verify", { email, code }); start();
    } catch (x) { $("gErr").textContent = x.message; if (step === "code") { otp.shake(); otp.clear(); } }
    finally { $("gBtn").disabled = false; }
  }
  $("gateForm").onsubmit = (e) => { e.preventDefault(); submit(); };
  $("gAlt").onclick = () => { if (step === "code" && !useKey) step = "email"; else useKey = !useKey; setMode(); ($("gEmail").hidden ? otp : $("gEmail")).focus(); };
  setMode(); setTimeout(() => $("gEmail").focus(), 50);
}

// ---------------------------------------------------------------- account
async function start() {
  try { ME = await api("/api/me"); } catch (x) { if (x.status === 401) return gate(); $("gate").hidden = false; $("gErr").textContent = x.message; return; }
  $("gate").hidden = true; $("app").hidden = false;
  document.title = "Your account | GoldenStraddler";
  $("logout").onclick = async () => { try { await api("/api/logout", {}); } catch {} location.href = "/"; };
  $("helpEmail").value = ME.customer.email;
  const dayW = (v) => new Date(typeof v === "string" ? v + "T12:00:00" : v).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  $("eaVer").textContent = `Version ${ME.eaVersion}` + (ME.eaUpdated ? `, updated ${dayW(ME.eaUpdated)}` : "") + (/^\d{4}-\d\d-\d\d$/.test(ME.guideUpdated || "") ? `. Guide updated ${dayW(ME.guideUpdated)}` : "") + ". Download them again any time, for example on a new PC or VPS.";
  if (!ME.eaReady) {
    const d = $("dlEa"); d.removeAttribute("href"); d.setAttribute("aria-disabled", "true"); d.style.opacity = ".55"; d.style.pointerEvents = "none"; d.textContent = "EA download being prepared";
    $("eaVer").textContent = "We're putting the finishing touches to the download. We'll email you as soon as it's ready.";
  }
  document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copyText(b.dataset.copy, b)));
  const q = new URLSearchParams(location.search);
  if (q.has("welcome") || sessionStorageGet("gs_welcome")) {
    $("welcome").hidden = false;
    $("welcomeTxt").textContent = ME.hasEa ? "Payment received, you're in. Your licence key is below and in your email. Download the EA, follow the four steps, and it locks to your MT5 account the first time it runs."
      : "Payment received, you're in. Open your journal to add your trading account and bring your trades in.";
  }
  renderLicences(); renderOrders(); helpForm();
  // journal-only customers have no EA to download or dashboard to show
  if (!ME.hasEa) document.querySelectorAll("[data-ea-only]").forEach((x) => (x.hidden = true));
  if (ME.journal) { const j = $("journalCard"); if (j) j.hidden = false; }
  const lics = ME.licences.filter((l) => l.status !== "revoked" && l.plan !== "journal");
  const pick = $("licPick");
  if (lics.length > 1) {
    pick.hidden = false; pick.replaceChildren();
    lics.forEach((l) => { const o = el("option", "", `${PLAN[l.plan]} · ${l.key.slice(-9)}${l.account ? " · " + l.account : ""}`); o.value = l.id; pick.appendChild(o); });
    pick.onchange = () => GSDash.show(pick.value);
  }
  CUR = lics[0] || ME.licences[0];
  if (CUR) GSDash.show(CUR.id); else { $("d-live").hidden = $("d-perf").hidden = $("d-trades").hidden = true; }
}
function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }

function statusText(l) {
  if (l.status === "active") return l.plan === "lifetime" ? ["Active, never expires", "active"] : l.plan === "trial" ? ["Active on demo accounts", "active"] : ["Active", "active"];
  if (l.status === "expired") return [l.plan === "trial" ? "Trial ended" : "Subscription ended", "expired"];
  if (l.status === "revoked") return ["Switched off", "revoked"];
  return [l.status, "pending"];
}
function renderLicences() {
  const box = $("lics"); box.replaceChildren();
  if (!ME.licences.length) {
    const c = el("div", "card"); c.append(el("p", "", "There's no licence on this account yet. If you just paid by bank transfer or crypto, it appears here as soon as the payment is confirmed."), (() => { const a = el("a", "btn pri sm", "See plans"); a.href = "/#pricing"; a.style.marginTop = "12px"; return a; })());
    box.appendChild(c); return;
  }
  ME.licences.forEach((l) => {
    const c = el("article", "licard dark-ui"), left = el("div"), right = el("dl");
    const [st, cls] = statusText(l);
    left.append(el("span", "lab", l.plan === "journal" ? "Journal plan" : PLAN[l.plan] + " licence"));
    const key = el("div", "key", l.key); left.appendChild(key);
    const row = el("div", "row");
    const cp = el("button", "btn sm pri", "Copy licence key"); cp.type = "button"; cp.onclick = () => copyText(l.key, cp); row.appendChild(cp);
    if (l.plan === "journal" && l.status === "active") { const o = el("a", "btn sm", "Open your journal"); o.href = "/journal/app"; row.appendChild(o); }
    if (l.plan !== "lifetime" && l.stripe_sub && ME.customer.portal) row.appendChild(act(el("button", "btn sm", "Manage subscription"), async () => { const r = await api("/api/me/portal", {}); location.href = r.url; }));
    if (l.plan === "trial") { const b = el("a", "btn sm", "Buy a licence"); b.href = "/#pricing"; row.appendChild(b); }
    if (l.plan !== "lifetime" && l.plan !== "trial" && !l.stripe_sub && l.status !== "revoked") {
      if (ME.methods.crypto) row.appendChild(act(el("button", "btn sm", "Pay next month in crypto"), async () => { const r = await api("/api/me/renew", { licence: l.id, method: "crypto" }); location.href = r.url; }));
      if (ME.methods.bank) row.appendChild(act(el("button", "btn sm", "Pay next month by bank transfer"), async () => { const r = await api("/api/me/renew", { licence: l.id, method: "bank" }); location.href = r.url; }));
    }
    if (l.account && l.canMove) {
      const mv = el("button", "btn sm", "Move to another MT5 account"); mv.type = "button"; mv.dataset.confirm = "Click again: this unlocks the current account";
      row.appendChild(act(mv, async () => { await api("/api/me/move", { licence: l.id }); ME = await api("/api/me"); renderLicences(); },
        "Unlocked. Attach the EA with your key on the new account and it locks to that one. The old account stops placing orders."));
    }
    left.appendChild(row);
    const add = (k, v, extra) => { right.append(el("dt", "", k)); const d = el("dd"); if (v instanceof Node) d.appendChild(v); else d.textContent = v; if (extra) d.append(" ", el("span", "fine", extra)); right.append(d); };
    add("Status", el("span", "pill " + cls, st));
    if (l.plan === "trial") add("Trial ends", l.expires_at ? dateFmt(l.expires_at, false) : DASH, "demo accounts only");
    else if (l.plan !== "lifetime") add(l.stripe_sub ? "Renews" : "Paid until", l.expires_at ? dateFmt(l.expires_at, false) : DASH, l.stripe_sub ? "automatically" : "");
    if (l.plan === "journal") add("Includes", "GoldenStraddler Journal with the AI coach");
    else {
      add("MT5 account", l.account ? `${l.account}${l.account_demo ? " (demo)" : ""}` : "Locks on first run", l.account_server || "");
      add("EA", l.online ? "online now" : l.last_seen ? "last seen " + agoFmt(l.last_seen) : "not connected yet");
    }
    if (l.account && !l.canMove && l.nextMove) add("Next move", "from " + dateFmt(l.nextMove, false));
    c.append(left, right); box.appendChild(c);
  });
}
function renderOrders() {
  const box = $("orderList"); box.replaceChildren();
  if (!ME.orders.length) { box.appendChild(el("p", "fine", "No orders yet.")); return; }
  ME.orders.forEach((o) => {
    const r = el("div", "orow"), a = el("div");
    a.append(el("b", "", `${PLAN[o.plan]}${o.kind === "renew" ? " renewal" : ""}`), el("div", "fine mono", `${o.id} · ${METHOD[o.method] || o.method} · ${dateFmt(o.created_at)}`));
    const b = el("div", "row-acts");
    b.appendChild(el("span", "pill " + o.status, o.status));
    if (o.status === "pending" && (o.method === "bank" || o.method === "crypto")) { const v = el("a", "btn xs", "View"); v.href = "/order/" + o.id; b.appendChild(v); }
    if (o.refundable) {
      const rb = el("button", "btn xs", `Request refund`); rb.type = "button";
      rb.onclick = async () => {
        const reason = prompt(`Refunds are available within ${ME.refundDays} days. Tell us briefly why (optional):`, "");
        if (reason === null) return;
        try { await api("/api/me/refund", { order: o.id, reason }); toast("Refund requested. We'll confirm by email, usually within a working day."); rb.disabled = true; } catch (x) { toast(x.message, true); }
      };
      b.appendChild(rb);
    }
    r.append(a, el("span", "mono", eur(o.amount, { cents: o.amount % 100 })), b); box.appendChild(r);
  });
}
function helpForm() {
  const f = $("helpForm");
  f.onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const b = f.querySelector("button[type=submit]"); b.disabled = true;
    try { await api("/api/contact", d); toast("Message sent. We'll reply by email."); f.message.value = ""; } catch (x) { toast(x.message, true); } finally { b.disabled = false; }
  };
}
start();
})();
