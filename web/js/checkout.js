(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const MINUS = "−";
const eur = (c) => "€" + (c / 100).toLocaleString("en-IE", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const form = $("co"), q = new URLSearchParams(location.search);
let PUB = null, QUOTE = null, applied = "";

const plan = () => form.querySelector("input[name=plan]:checked").value;
const method = () => { const m = form.querySelector("input[name=method]:checked"); return m ? m.value : ""; };

const JOURNAL = q.get("plan") === "journal";
if (q.get("plan") === "monthly") form.querySelector("input[value=monthly]").checked = true;
// the journal is bought on its own: only its plan shows
if (JOURNAL) {
  for (const l of $("plans").querySelectorAll("label")) l.hidden = l.querySelector("input").value !== "journal";
  form.querySelector("input[value=journal]").checked = true;
  document.querySelector("main h1").textContent = "Get GoldenStraddler Journal";
  document.querySelector("[data-lic]").textContent = "Where should we send your access?";
  $("oneAcc").textContent = "Includes the AI coach. Cancel any time from your account.";
}
if (q.has("cancelled")) $("cancelled").hidden = false;
if (q.get("code")) $("code").value = q.get("code").toUpperCase();
try { const e = sessionStorage.getItem("gs_email"); if (e && !$("email").value) $("email").value = e; } catch {}

function render() {
  const p = plan(), list = PUB ? PUB.prices[p] : null, Q = QUOTE && QUOTE.plan === p ? QUOTE : null;
  $("sPlan").textContent = p === "lifetime" ? "Lifetime licence" : p === "journal" ? "Journal plan" : "Monthly licence";
  if (list != null) $("sList").textContent = eur(list) + (p !== "lifetime" ? " a month" : "");
  const amount = Q ? Q.amount : list;
  if (Q && Q.discount) {
    $("sOffRow").hidden = false; $("sOffLab").textContent = `Code ${Q.code}` + (p !== "lifetime" ? (Q.codeNote === "every month" ? ", every month" : ", first month") : "");
    $("sOff").textContent = MINUS + eur(Q.discount);
  } else $("sOffRow").hidden = true;
  if (amount != null) $("sTotal").textContent = eur(amount);
  const m = method();
  let then = "";
  if (p !== "lifetime" && list != null) {
    const next = Q && Q.discount && Q.codeNote === "every month" ? amount : list;
    then = m === "card" ? `Then ${eur(next)} a month, charged automatically until you cancel.` : `Then ${eur(next)} a month. You pay each month from your account page.`;
  } else if (p === "lifetime") then = "One payment. Nothing else to pay, ever.";
  $("sThen").textContent = then;
  $("payBtn").textContent = !m ? "Continue to payment" : m === "card" ? `Pay ${amount != null ? eur(amount) : ""}` : m === "bank" ? "Get bank details" : `Pay ${amount != null ? eur(amount) : ""} in crypto`;
  $("safeProc").textContent = m === "crypto" ? "Crypto payments are handled by NOWPayments. You pay from your own wallet." :
    m === "bank" ? "You'll get our bank details and a reference on the next page. Your licence activates when the transfer arrives." :
    "Card and wallet payments are handled by Stripe. We never see your card details.";
  $("methodNote").textContent = p !== "lifetime" && m && m !== "card" ? "With bank transfer or crypto, the plan doesn't renew by itself. Pay each month from your account page; you get a reminder email first." : "";
}

async function applyCode(silent) {
  const code = $("code").value.trim().toUpperCase(), msg = $("codeMsg");
  msg.className = "codemsg"; msg.textContent = "";
  if (!code) { QUOTE = null; applied = ""; render(); return true; }
  try {
    const r = await fetch(`/api/quote?plan=${plan()}&code=${encodeURIComponent(code)}`, { cache: "no-store" }), j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || "Couldn't check that code.");
    if (j.error) { QUOTE = null; applied = ""; msg.className = "codemsg err"; msg.textContent = j.error; render(); return false; }
    QUOTE = j; applied = code;
    msg.className = "codemsg ok"; msg.textContent = `Code applied: ${MINUS}${eur(j.discount)}` + (j.plan !== "lifetime" ? (j.codeNote === "every month" ? " every month" : " on the first month") : "");
    render(); return true;
  } catch (x) { if (!silent) { msg.className = "codemsg err"; msg.textContent = x.message; } return false; }
}

$("applyCode").addEventListener("click", () => applyCode(false));
$("code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCode(false); } });
$("code").addEventListener("input", () => { if ($("code").value.trim().toUpperCase() !== applied) { $("codeMsg").textContent = ""; if (QUOTE) { QUOTE = null; render(); } } });
form.querySelectorAll("input[name=plan]").forEach((r) => r.addEventListener("change", () => { history.replaceState(null, "", "?plan=" + plan() + ($("code").value ? "&code=" + encodeURIComponent($("code").value.trim()) : "")); if ($("code").value.trim()) applyCode(true); else render(); }));
form.querySelectorAll("input[name=method]").forEach((r) => r.addEventListener("change", render));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("coErr"), btn = $("payBtn"), email = $("email").value.trim();
  err.textContent = "";
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = "Enter your email address. Your licence is sent there."; $("email").focus(); return; }
  if ($("code").value.trim() && $("code").value.trim().toUpperCase() !== applied) { if (!(await applyCode(false))) { err.textContent = "Fix or remove the discount code first."; return; } }
  if (!method()) { err.textContent = "Choose how you want to pay."; $("methods").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  if (!$("c1").checked || !$("c2").checked) { err.textContent = "Tick both boxes to continue."; $("c1").focus(); return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = "Opening payment…";
  try {
    try { sessionStorage.setItem("gs_email", email); } catch {}
    const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: plan(), method: method(), email, name: form.name.value.trim(), code: applied, consent: true }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || "The payment page couldn't be opened. Try again.");
    location.href = j.url;
  } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = old; }
});

(async () => {
  try {
    const r = await fetch("/api/public", { cache: "no-store" }); PUB = await r.json();
    $("lpLife").textContent = eur(PUB.prices.lifetime); $("lpMon").textContent = eur(PUB.prices.monthly);
    if (PUB.prices.journal) $("lpJournal").textContent = eur(PUB.prices.journal);
    else if (JOURNAL) { $("closed").hidden = false; $("closed").textContent = "The Journal plan isn't open yet."; form.hidden = true; }
    let any = false, first = null;
    for (const lab of $("methods").querySelectorAll("label")) {
      const on = !!PUB.methods[lab.dataset.m]; lab.hidden = !on;
      if (on) { any = true; first = first || lab.querySelector("input"); }
    }
    const shown = [...$("methods").querySelectorAll("label")].filter((l) => !l.hidden).length;
    $("methods").classList.toggle("three", shown === 3);
    if (!any) { $("closed").hidden = false; form.hidden = true; }
    else if (shown === 1 || PUB.methods.card) (PUB.methods.card ? form.querySelector("input[value=card]") : first).checked = true;
  } catch { /* prices shown from the page itself */ }
  if ($("code").value) await applyCode(true);
  render();
})();
})();
