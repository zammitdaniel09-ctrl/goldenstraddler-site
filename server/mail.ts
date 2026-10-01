// Transactional email through Resend (https://resend.com). Without a key, mails are logged and kept in a dev outbox.
import { all, one } from "./db";
import { E, esc, euros, getS, siteUrl } from "./util";
import type { Licence, Order } from "./licence";

export const outbox: { to: string; subject: string; html: string; at: number }[] = [];

export async function sendMail(to: string | string[], subject: string, html: string, text = "") {
  const key = getS("resend_key"), list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return false;
  if (!key) {
    outbox.push({ to: list.join(","), subject, html, at: Date.now() }); if (outbox.length > 200) outbox.shift();
    console.log(`mail (not sent, no Resend key): ${list.join(",")} | ${subject}`);
    return false;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: getS("mail_from"), to: list, subject, html, text: text || undefined, reply_to: getS("support_email") || undefined }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) { console.error("resend:", r.status, (await r.text()).slice(0, 300)); return false; }
  return true;
}

// one layout for every email: dark header, white card, plain footer
function layout(title: string, bodyHtml: string) {
  const site = siteUrl();
  return `<!doctype html><html><body style="margin:0;background:#0b0e13;padding:28px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0e1116">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="padding:6px 4px 18px;color:#fff;font-size:18px;font-weight:800;letter-spacing:-.3px">Golden<span style="color:#3FC4FC">Straddler</span></td></tr>
<tr><td style="background:#ffffff;border-radius:14px;padding:28px 26px">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 6px;color:#8a93a3;font-size:12px;line-height:1.6">Trading carries risk. GoldenStraddler is trading software and does not give investment advice.<br>
<a href="${site}" style="color:#8a93a3">${site.replace(/^https?:\/\//, "")}</a> &middot; <a href="${site}/account" style="color:#8a93a3">Your account</a></td></tr>
</table></td></tr></table></body></html>`;
}
const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2a3140">${s}</p>`;
const btn = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#3FC4FC;color:#001018;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${esc(label)}</a></p>`;
const keyBox = (k: string) =>
  `<p style="margin:6px 0 18px;padding:14px 16px;background:#f2f5f9;border-radius:10px;font:600 17px Consolas,Menlo,monospace;letter-spacing:.5px;color:#0e1116">${esc(k)}</p>`;

export function mailLicence(o: Order, l: Licence) {
  const site = siteUrl();
  const plan = l.plan === "lifetime" ? "Lifetime licence" : "Monthly subscription";
  return sendMail(o.email, "Your GoldenStraddler licence", layout("You're in. Here's your licence.", [
    p(`Thanks for buying GoldenStraddler (${plan}, ${euros(o.amount_cents)}). Your licence key:`),
    keyBox(l.key),
    p("Set-up takes about five minutes:"),
    `<ol style="margin:0 0 16px 18px;padding:0;font-size:15px;line-height:1.7;color:#2a3140">
      <li>Sign in to your account and download the EA and the user guide.</li>
      <li>Add GoldenStraddler to MT5 and allow its web address (the guide shows where).</li>
      <li>Attach it to an XAUUSD chart and paste your licence key. It locks to that MT5 account.</li></ol>`,
    btn(site + "/account", "Open your account"),
    p(`Order ${esc(o.id)}. ${l.plan === "lifetime" ? "This licence never expires." : "Your subscription renews every month until you cancel it from your account."}`),
    p(`Not happy? You can ask for a full refund within ${getS("refund_days")} days from your account page.`),
  ].join("")));
}

export function mailRenewed(o: Order, l: Licence) {
  return sendMail(o.email, "GoldenStraddler subscription renewed", layout("Payment received, you're set for another month", [
    p(`We received ${euros(o.amount_cents)} for your GoldenStraddler subscription. The bot keeps running without anything to do on your side.`),
    l.expires_at ? p(`Paid until ${new Date(l.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`) : "",
    btn(siteUrl() + "/account", "View your account"),
  ].join("")));
}

export function mailLoginCode(email: string, code: string) {
  return sendMail(email, `${code} is your GoldenStraddler sign-in code`, layout("Your sign-in code", [
    p("Enter this code to sign in. It works for 10 minutes."),
    keyBox(code.replace(/(\d{3})(\d{3})/, "$1 $2")),
    p("If you didn't try to sign in, you can ignore this email."),
  ].join("")), `Your GoldenStraddler sign-in code is ${code}. It works for 10 minutes.`);
}

export function mailBankInstructions(o: Order) {
  const rows = [["Amount", euros(o.amount_cents)], ["Reference", o.id], ["Account holder", getS("bank_holder")], ["IBAN", getS("bank_iban")], ["BIC", getS("bank_bic")], ["Bank", getS("bank_name")]]
    .filter((r) => r[1]).map((r) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7383;font-size:14px">${esc(r[0])}</td><td style="padding:6px 0;font:600 15px Consolas,Menlo,monospace">${esc(r[1])}</td></tr>`).join("");
  return sendMail(o.email, `Bank transfer details for order ${o.id}`, layout("Complete your order by bank transfer", [
    p("Send the amount below and put the reference on the transfer so we can match it. Your licence is emailed to you as soon as the payment arrives, usually within one working day."),
    `<table role="presentation" style="margin:0 0 16px">${rows}</table>`,
    btn(siteUrl() + "/order/" + o.id, "View your order"),
  ].join("")));
}

export function mailExpiring(email: string, l: Licence, payUrl: string) {
  return sendMail(email, "Your GoldenStraddler subscription ends soon", layout("Your subscription ends soon", [
    p(`Your GoldenStraddler subscription runs until ${new Date(l.expires_at || 0).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. Pay for the next month to keep the bot running.`),
    btn(payUrl, "Pay for next month"),
  ].join("")));
}

export function mailRefunded(email: string, o: Order) {
  return sendMail(email, `Refund for order ${o.id}`, layout("Your refund is on its way", [
    p(`We've refunded ${euros(o.amount_cents)} for order ${esc(o.id)}. Depending on your bank or payment method it can take a few days to show.`),
    p("The licence for this order has been switched off."),
  ].join("")));
}

// a team member answered in the website chat while the visitor was away
export function mailChatReply(email: string, who: string, text: string) {
  return sendMail(email, `${who} replied to your chat`, layout("We replied to your chat", [
    p(`${esc(who)} from GoldenStraddler wrote:`),
    `<div style="margin:0 0 16px;padding:14px 16px;background:#f2f5f9;border-radius:10px;font-size:15px;line-height:1.6;color:#0e1116;white-space:pre-wrap">${esc(text)}</div>`,
    btn(siteUrl() + "/?chat=1", "Continue the chat"),
    p("You can also just reply to this email."),
  ].join("")), `${who} from GoldenStraddler wrote:\n\n${text}\n\nContinue the chat: ${siteUrl()}/?chat=1`);
}

export async function notifyAdmins(subject: string, text: string) {
  const extra = getS("notify_emails").split(/[,\s]+/).filter(Boolean);
  const admins = all<{ email: string }>("SELECT email FROM admins WHERE active = 1").map((a) => a.email);
  const to = [...new Set([...admins, ...extra])];
  if (!to.length) return false;
  return sendMail(to, "[GoldenStraddler] " + subject, layout(subject, p(esc(text)) + btn(siteUrl() + "/admin", "Open admin")), text);
}
export const mailConfigured = () => !!getS("resend_key");
export { one, E };
