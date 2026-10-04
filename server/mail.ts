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
  if (l.plan === "journal") return sendMail(o.email, "Your GoldenStraddler Journal is ready", layout("Your journal is ready", [
    p(`Thanks for subscribing to GoldenStraddler Journal (${euros(o.amount_cents)} a month). Sign in with this email address to open it.`),
    `<ol style="margin:0 0 16px 18px;padding:0;font-size:15px;line-height:1.7;color:#2a3140">
      <li>Open the journal and add your trading account.</li>
      <li>Connect MT5 with the small connector EA, or import a history file from MT4, MT5 or any platform.</li>
      <li>Ask the AI coach what's working and where your trading leaks.</li></ol>`,
    btn(site + "/journal/app", "Open your journal"),
    p(`Order ${esc(o.id)}. Your subscription renews every month until you cancel it from your account.`),
    p(`Not happy? You can ask for a full refund within ${getS("refund_days")} days from your account page.`),
  ].join("")));
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
    p(l.plan === "journal" ? `We received ${euros(o.amount_cents)} for your GoldenStraddler Journal subscription. Your journal stays open with everything in it.`
      : `We received ${euros(o.amount_cents)} for your GoldenStraddler subscription. The bot keeps running without anything to do on your side.`),
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
    p(`Your GoldenStraddler ${l.plan === "journal" ? "Journal " : ""}subscription runs until ${new Date(l.expires_at || 0).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. Pay for the next month to keep ${l.plan === "journal" ? "your journal open" : "the bot running"}.`),
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

// a prop-firm limit getting close, hit, or the target reached (from the journal, after a connector sync)
export function mailLimit(email: string, account: string, cur: string, k: string, level: string, r: any) {
  const m = (v: number) => (cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur + " ") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pc = (v: number) => Math.round(v * 100) + "%";
  const subj = k === "target" ? `${account}: profit target reached` : level === "hit" ? `${account}: ${k === "daily" ? "daily loss limit" : "drawdown limit"} reached` : `${account}: ${pc(r.used)} of your ${k === "daily" ? "daily loss limit" : "drawdown limit"} used`;
  const body = k === "target" ? [p(`Your closed trades on <b>${esc(account)}</b> have reached the profit target you set: ${m(r.now)} of ${m(r.cap)}.`), p("Check the other rules (minimum trading days, consistency) in your journal before you request a review from your firm.")]
    : k === "daily" ? [p(`Today's closed trades on <b>${esc(account)}</b> have lost ${m(-r.today)} against your daily loss limit of ${m(r.cap)} (${pc(r.used)} used).`), p(level === "hit" ? "That's the limit you set. Your firm also counts open positions and uses its own day boundary, so check its dashboard too." : "You still have " + m(r.cap + r.today) + " of room today on closed trades. Open positions count with most firms too.")]
    : [p(`<b>${esc(account)}</b> is ${m(r.now)} below its ${r.label.toLowerCase().includes("trailing") ? "highest closed balance" : "starting balance"}, against a limit of ${m(r.cap)} (${pc(r.used)} used).`), p(level === "hit" ? "That's the limit you set. Check your firm's dashboard for its own figure." : `Room left on closed trades: ${m(r.room)}.`)];
  return sendMail(email, subj, layout(subj, [...body, btn(siteUrl() + "/journal/app#/accounts", "Open your journal"), p('<span style="font-size:13px;color:#6b7383">Turn these emails off in your journal under Settings.</span>')].join("")));
}
// Monday's journal email: last week's numbers and one nudge
export function mailWeekly(email: string, o: any) {
  const m = (v: number, sg = true) => (sg ? (v > 0 ? "+" : v < 0 ? "−" : "") : "") + (o.cur === "USD" ? "$" : o.cur === "EUR" ? "€" : o.cur === "GBP" ? "£" : o.cur + " ") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (k: string) => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const row = (k: string, v: string) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e8ecf2;color:#5a6373;font-size:14px">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #e8ecf2;text-align:right;font-weight:600;font-size:14px;color:#0e1116">${esc(v)}</td></tr>`;
  const rows = [row("Result", m(o.net)), row("Closed trades", String(o.n)), row("Win rate", Math.round(o.winRate * 100) + "%"), row("Profit factor", o.pf == null ? "–" : o.pf === Infinity ? "No losses" : o.pf.toFixed(2)),
    o.expR != null ? row("Average trade", (o.expR > 0 ? "+" : o.expR < 0 ? "−" : "") + Math.abs(o.expR).toFixed(2) + "R") : "", row("Best trade", `${o.best.s} ${m(o.best.net)}`), row("Worst trade", `${o.worst.s} ${m(o.worst.net)}`),
    o.score != null ? row("Days you kept every rule", o.score + "%") : ""].join("");
  const nudge = o.mistake ? `“${esc(o.mistake.name)}” cost you ${m(o.mistake.net)} over ${o.mistake.n} trade${o.mistake.n === 1 ? "" : "s"}. That's the one to watch this week.`
    : o.breaks ? `You broke one of your rules ${o.breaks} time${o.breaks === 1 ? "" : "s"}. The Discipline page shows which.` : o.unreviewed ? `${o.unreviewed} trade${o.unreviewed === 1 ? " is" : "s are"} waiting for a review.` : "Every trade is reviewed. Nice and tidy.";
  const subj = `Your trading week, ${d(o.from)} to ${d(o.to)}: ${m(o.net)}`;
  return sendMail(email, subj, layout(`Your week, ${d(o.from)} to ${d(o.to)}`, [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${rows}</table>`, p(nudge),
    btn(siteUrl() + "/journal/app#/overview", "Open your journal"),
    p('<span style="font-size:13px;color:#6b7383">From your GoldenStraddler Journal. Turn this email off under Settings.</span>')].join("")));
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
