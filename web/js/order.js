(() => {
"use strict";
const id = location.pathname.split("/").pop().toUpperCase(), q = new URLSearchParams(location.search), box = $("ord");
let timer = 0, tries = 0, redirected = false;

const chip = (cls, text, pulse) => { const c = el("span", "chip " + cls + (pulse ? " pulse" : "")); c.append(el("i"), text); return c; };
function head(stateEl, title, lede) {
  const s = el("div", "state"); s.appendChild(stateEl); s.appendChild(el("span", "fine mono", "Order " + id));
  box.replaceChildren(s, el("h1", "", title));
  if (lede) box.appendChild(el("p", "lede", lede));
}
function row(dl, k, v, copy) {
  dl.append(el("dt", "", k)); dl.append(el("dd", "", v));
  const c = el("dd");
  if (copy) { const b = el("button", "btn xs", "Copy"); b.type = "button"; b.onclick = () => copyText(copy === true ? v : copy, b); c.appendChild(b); }
  dl.append(c);
}
function acts(...btns) { const a = el("div", "acts"); btns.forEach((b) => a.appendChild(b)); box.appendChild(a); }
function link(text, href, pri) { const a = el("a", "btn" + (pri ? " pri" : ""), text); a.href = href; return a; }

function render(j) {
  const o = j.order, amount = eur(o.amount, { cents: o.amount % 100 }), what = (o.plan === "lifetime" ? "Lifetime licence" : "Monthly licence") + (o.kind === "renew" ? " renewal" : "");
  if (o.status === "paid") {
    head(chip("", "Paid"), o.kind === "renew" ? "Renewed. Thank you." : "You're in.",
      o.kind === "renew" ? "Your licence has been extended. Nothing else to do: the EA picks it up on its own." :
      `Your licence key is on your account page and on its way to ${o.email}. Download the EA there and follow the four setup steps.`);
    acts(link(j.signedIn ? "Open your account" : "Sign in to your account", "/account" + (o.kind === "renew" ? "" : "?welcome=1"), true));
    if (!j.signedIn) { const p = el("p", "fine", "Sign in with the email you used at checkout. We'll send you a 6-digit code."); p.style.marginTop = "14px"; box.appendChild(p); }
    if (j.signedIn && o.kind !== "renew" && !redirected) { redirected = true; try { sessionStorage.setItem("gs_welcome", "1"); } catch {} setTimeout(() => (location.href = "/account?welcome=1"), 2600); }
    return "done";
  }
  if (o.status === "refunded") { head(chip("dim", "Refunded"), "This order was refunded.", "The money has gone back to the way you paid. The licence from this order is switched off."); acts(link("Back to the website", "/")); return "done"; }
  if (o.status === "disputed") { head(chip("loss", "On hold"), "This order is on hold.", "The payment was disputed with the bank, so the licence is paused. Get in touch from your account page to sort it out."); return "done"; }
  if (["failed", "cancelled", "expired"].includes(o.status)) {
    head(chip("loss", o.status === "expired" ? "Expired" : "Not paid"), "This order didn't go through.", o.status === "expired" ? "We didn't receive the payment in time, so the order was closed. Nothing was charged." : "The payment wasn't completed and nothing was charged. You can start again or choose another way to pay.");
    acts(link("Try again", "/checkout?plan=" + o.plan, true), link("Back to the website", "/"));
    return "done";
  }
  // still waiting
  if (o.method === "bank") {
    head(chip("gold", "Waiting for your transfer", true), "Send the transfer to activate.", `Pay ${amount} by bank transfer to the account below. Your ${what.toLowerCase()} activates as soon as the money arrives, usually within one or two working days.`);
    const b = el("div", "box"), dl = el("dl");
    if (j.bank) {
      row(dl, "Account holder", j.bank.holder || DASH, !!j.bank.holder);
      row(dl, "IBAN", j.bank.iban || DASH, j.bank.iban ? j.bank.iban.replace(/\s+/g, "") : false);
      if (j.bank.bic) row(dl, "BIC / SWIFT", j.bank.bic, true);
      if (j.bank.bank) row(dl, "Bank", j.bank.bank);
    }
    row(dl, "Amount", amount, (o.amount / 100).toFixed(2));
    row(dl, "Reference", o.id, true);
    b.appendChild(dl); box.appendChild(b);
    const n = el("p", "note warn", `Put ${o.id} in the payment reference so we can match your transfer. We've emailed these details to ${o.email} too.`); n.style.marginTop = "16px"; box.appendChild(n);
    return "slow";
  }
  if (o.method === "crypto") {
    head(chip("gold", "Waiting for the network", true), "Waiting for your crypto payment.",
      `As soon as the payment is confirmed on the blockchain, your licence is sent to ${o.email}. That usually takes 10 to 30 minutes depending on the coin. You can close this page.`);
    const b = el("div", "box"), dl = el("dl"); row(dl, "Order", what); row(dl, "Amount", amount); b.appendChild(dl); box.appendChild(b);
    return "slow";
  }
  head(el("span", "spin"), "Confirming your payment…", `This normally takes a few seconds. Your licence key appears here and goes to ${o.email}.`);
  return "fast";
}

function mockButton() {
  if (!q.has("mock")) return;
  const b = el("button", "btn", "Simulate payment (test mode)"); b.type = "button";
  act(b, async () => { await api("/api/dev/pay/" + id, {}); load(); });
  const a = el("div", "acts"); a.appendChild(b); box.appendChild(a);
}

async function load() {
  clearTimeout(timer);
  try {
    const j = await api(`/api/order/${encodeURIComponent(id)}${q.get("s") ? "?s=" + encodeURIComponent(q.get("s")) : ""}`);
    const mode = render(j);
    if (mode !== "done") mockButton();
    tries++;
    if (mode === "fast") timer = setTimeout(load, tries < 20 ? 2000 : 6000);
    else if (mode === "slow") timer = setTimeout(load, 20000);
  } catch (x) {
    if (x.status === 404) { head(chip("loss", "Not found"), "We can't find that order.", "Check the link in your email, or sign in to your account to see your orders."); acts(link("Your account", "/account", true)); return; }
    head(chip("dim", "Offline"), "Can't reach the server right now.", "Retrying in a few seconds."); timer = setTimeout(load, 5000);
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
load();
})();
