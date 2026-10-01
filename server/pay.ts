// Prices, discount codes, orders and the three ways to pay: Stripe (card, Apple/Google Pay, PayPal, SEPA),
// NOWPayments (crypto) and manual bank transfer confirmed by an admin.
import { all, audit, now, one, run, seenEvent } from "./db";
import { DAY, getN, getS, hmacHex, newOrderId, safeEq, setS, sha256, siteUrl, str, token } from "./util";
import { fulfil, revoke, type Licence, type Order } from "./licence";
import { mailBankInstructions, mailRefunded, notifyAdmins } from "./mail";

export type Plan = "lifetime" | "monthly";
export type Code = { code: string; kind: "percent" | "amount"; value: number; plans: string; monthly_duration: "once" | "forever"; max_uses: number | null;
  uses: number; expires_at: number | null; active: number; note: string; stripe_coupon: string; created_by: string; created_at: number };

export const listPrice = (plan: Plan) => getN(plan === "lifetime" ? "price_lifetime" : "price_monthly");
export function quote(plan: Plan, rawCode = "") {
  const list = listPrice(plan), code = str(rawCode, 40).toUpperCase().replace(/\s+/g, "");
  const base = { plan, list, amount: list, discount: 0, code: "", codeNote: "", error: "" };
  if (!code) return base;
  const c = one<Code>("SELECT * FROM codes WHERE code = ?", code);
  const err = !c || !c.active ? "That code isn't valid." : c.expires_at && c.expires_at < now() ? "That code has expired."
    : c.max_uses !== null && c.uses >= c.max_uses ? "That code has been used up." : !c.plans.split(",").includes(plan) ? `That code doesn't apply to the ${plan} plan.` : "";
  if (err) return { ...base, error: err };
  const off = c!.kind === "percent" ? Math.round(list * Math.min(100, c!.value) / 100) : Math.min(list - 100, c!.value);
  const amount = Math.max(100, list - off);
  const codeNote = plan === "monthly" ? (c!.monthly_duration === "forever" ? "every month" : "first month") : "";
  return { ...base, amount, discount: list - amount, code, codeNote };
}

// ---------------------------------------------------------------- orders
export function createOrder(o: { email: string; plan: Plan; method: string; code: string; list: number; amount: number; ip: string; country: string; kind?: string; licenceId?: string }) {
  const id = (() => { let i = newOrderId(); while (one("SELECT id FROM orders WHERE id = ?", i)) i = newOrderId(); return i; })();
  const claim = token(24);
  run(`INSERT INTO orders (id, email, plan, kind, licence_id, method, status, list_cents, amount_cents, currency, code, consent_at, ip, country, created_at, claim_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'eur', ?, ?, ?, ?, ?, ?)`,
    id, o.email.toLowerCase(), o.plan, o.kind || "new", o.licenceId || null, o.method, o.list, o.amount, o.code, now(), o.ip, o.country, now(), sha256(claim));
  return { order: one<Order>("SELECT * FROM orders WHERE id = ?", id)!, claim };
}
export const orderById = (id: string) => one<Order>("SELECT * FROM orders WHERE id = ?", id);

// ---------------------------------------------------------------- Stripe (REST, pinned API version)
const STRIPE_VERSION = "2024-06-20";
function form(obj: any, prefix = "", out: string[] = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}
export async function stripe(path: string, params?: any, method = params ? "POST" : "GET") {
  const key = getS("stripe_secret");
  if (!key) throw new Error("Stripe isn't connected yet.");
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method, headers: { Authorization: "Bearer " + key, "Stripe-Version": STRIPE_VERSION, ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? form(params) : undefined, signal: AbortSignal.timeout(15000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Stripe: " + (j?.error?.message || r.status));
  return j;
}

async function stripeCoupon(c: Code) {
  if (c.stripe_coupon) return c.stripe_coupon;
  const id = ("GS_" + c.code + "_" + c.kind[0] + c.value + "_" + c.monthly_duration).slice(0, 60);
  const params: any = { id, name: c.code, duration: c.monthly_duration, metadata: { code: c.code } };
  if (c.kind === "percent") params.percent_off = Math.min(100, c.value); else { params.amount_off = c.value; params.currency = "eur"; }
  try { await stripe("coupons", params); } catch (e: any) { if (!/already exists/i.test(e.message)) throw e; }
  run("UPDATE codes SET stripe_coupon = ? WHERE code = ?", id, c.code);
  return id;
}

export async function stripeCheckout(o: Order) {
  const site = siteUrl(), cust = one<{ stripe_customer: string }>("SELECT stripe_customer FROM customers WHERE email = ?", o.email);
  const name = o.plan === "lifetime" ? "GoldenStraddler Lifetime licence" : "GoldenStraddler Monthly subscription";
  const p: any = {
    client_reference_id: o.id, metadata: { order: o.id }, success_url: `${site}/order/${o.id}?s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/checkout?plan=${o.plan}&cancelled=1`, locale: "auto", billing_address_collection: "auto",
    ...(cust && cust.stripe_customer ? { customer: cust.stripe_customer } : { customer_email: o.email }),
  };
  if (getS("stripe_tax") === "1") p.automatic_tax = { enabled: true };
  if (o.plan === "lifetime") {
    p.mode = "payment";
    if (!(cust && cust.stripe_customer)) p.customer_creation = "always";
    p.line_items = [{ quantity: 1, price_data: { currency: "eur", unit_amount: o.amount_cents, product_data: { name, description: "One MetaTrader 5 account, never expires." } } }];
    p.payment_intent_data = { metadata: { order: o.id }, description: `${name} (${o.id})` };
    p.invoice_creation = { enabled: true, invoice_data: { metadata: { order: o.id } } };
  } else {
    p.mode = "subscription";
    p.line_items = [{ quantity: 1, price_data: { currency: "eur", unit_amount: o.list_cents, recurring: { interval: "month" }, product_data: { name } } }];
    p.subscription_data = { metadata: { order: o.id }, description: name };
    if (o.code) { const c = one<Code>("SELECT * FROM codes WHERE code = ?", o.code); if (c) p.discounts = [{ coupon: await stripeCoupon(c) }]; }
  }
  const s = await stripe("checkout/sessions", p);
  run("UPDATE orders SET provider_ref = ? WHERE id = ?", s.id, o.id);
  return s.url as string;
}

function verifyStripe(raw: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t || 0), v1s = header.split(",").filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  if (!t || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const want = hmacHex("sha256", secret, `${t}.${raw}`);
  return v1s.some((v) => safeEq(v, want));
}

async function periodEndOf(subId: string) {
  try { const s = await stripe("subscriptions/" + subId); return (s.current_period_end || 0) * 1000 || undefined; } catch { return undefined; }
}

// Confirms an order from a finished Checkout Session (webhook or the success page, whichever comes first)
export async function settleStripeSession(s: any) {
  const id = s.client_reference_id || s.metadata?.order;
  const o = id ? orderById(id) : null;
  if (!o || o.status === "paid" || o.status === "refunded") return o;
  if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") {
    if (s.status === "complete") run("UPDATE orders SET status = 'processing', note = 'Waiting for the bank transfer or debit to clear' WHERE id = ? AND status = 'pending'", o.id);
    return o;
  }
  const sub = typeof s.subscription === "string" ? s.subscription : s.subscription?.id || "";
  let payRef = typeof s.payment_intent === "string" ? s.payment_intent : "";
  if (sub && s.invoice) { try { const inv = await stripe("invoices/" + (typeof s.invoice === "string" ? s.invoice : s.invoice.id)); payRef = inv.payment_intent || inv.charge || payRef; } catch {} }
  run("UPDATE orders SET amount_cents = CASE WHEN ? > 0 THEN ? ELSE amount_cents END WHERE id = ?", s.amount_total || 0, s.amount_total || 0, o.id);
  return fulfil(o.id, { paymentRef: payRef, stripeSub: sub, stripeCustomer: typeof s.customer === "string" ? s.customer : "", periodEnd: sub ? await periodEndOf(sub) : undefined });
}

export async function stripeWebhook(req: Request) {
  const raw = await req.text(), secret = getS("stripe_webhook_secret");
  if (!secret || !verifyStripe(raw, req.headers.get("stripe-signature") || "", secret)) return new Response("bad signature", { status: 400 });
  const ev = JSON.parse(raw), obj = ev.data?.object || {};
  if (seenEvent("stripe:" + ev.id)) return new Response("ok");
  try {
    switch (ev.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await settleStripeSession(obj); break;
      case "checkout.session.async_payment_failed": {
        const id = obj.client_reference_id || obj.metadata?.order;
        if (id) run("UPDATE orders SET status = 'failed', note = 'Bank payment failed' WHERE id = ? AND status IN ('pending','processing')", id);
        break;
      }
      case "invoice.paid": {
        if (obj.billing_reason !== "subscription_cycle" || !obj.subscription) break;
        const l = one<Licence>("SELECT * FROM licences WHERE stripe_sub = ?", obj.subscription);
        if (!l) break;
        const cust = one<{ email: string }>("SELECT email FROM customers WHERE id = ?", l.customer_id);
        const { order } = createOrder({ email: cust?.email || obj.customer_email || "", plan: "monthly", method: "card", code: "", list: obj.subtotal || obj.amount_paid, amount: obj.amount_paid, ip: "", country: "", kind: "renew", licenceId: l.id });
        run("UPDATE orders SET provider_ref = ? WHERE id = ?", obj.id, order.id);
        const end = (obj.lines?.data?.[0]?.period?.end || 0) * 1000 || (await periodEndOf(obj.subscription));
        fulfil(order.id, { paymentRef: obj.payment_intent || obj.charge || "", periodEnd: end });
        break;
      }
      case "customer.subscription.deleted": {
        const l = one<Licence>("SELECT * FROM licences WHERE stripe_sub = ?", obj.id);
        if (l) { run("UPDATE licences SET expires_at = MIN(COALESCE(expires_at, ?), ?) WHERE id = ?", now(), now(), l.id); audit("stripe", "subscription ended", l.key); }
        break;
      }
      case "customer.subscription.updated": {
        const l = one<Licence>("SELECT * FROM licences WHERE stripe_sub = ?", obj.id);
        if (l && obj.cancel_at_period_end) audit("stripe", "subscription set to cancel", l.key);
        break;
      }
      case "charge.refunded": {
        const o = one<Order>("SELECT * FROM orders WHERE payment_ref = ? AND status = 'paid'", obj.payment_intent || obj.id);
        if (o && obj.refunded) await markRefunded(o, "stripe");
        break;
      }
      case "charge.dispute.created": {
        const o = one<Order>("SELECT * FROM orders WHERE payment_ref = ?", obj.payment_intent || obj.charge);
        if (o && o.licence_id) { revoke(o.licence_id, "card dispute opened", "stripe"); run("UPDATE orders SET status = 'disputed' WHERE id = ?", o.id); }
        break;
      }
    }
  } catch (e: any) {
    console.error("stripe webhook", ev.type, e.message);
    run("DELETE FROM events WHERE id = ?", "stripe:" + ev.id); // let Stripe retry
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
}

// creates the webhook endpoint on the connected Stripe account and stores its signing secret
export async function connectStripe(secretKey: string) {
  setS("stripe_secret", secretKey.trim());
  const acct = await stripe("account");
  const url = siteUrl() + "/webhooks/stripe";
  const list = await stripe("webhook_endpoints?limit=100");
  for (const w of list.data || []) if (w.url === url) await stripe("webhook_endpoints/" + w.id, undefined, "DELETE");
  const events = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "invoice.paid",
    "customer.subscription.deleted", "customer.subscription.updated", "charge.refunded", "charge.dispute.created"];
  const w = await stripe("webhook_endpoints", { url, enabled_events: events, api_version: STRIPE_VERSION, description: "GoldenStraddler site" });
  setS("stripe_webhook_secret", w.secret);
  return { account: acct.settings?.dashboard?.display_name || acct.business_profile?.name || acct.id, live: !secretKey.includes("_test_"), webhook: url };
}

export async function billingPortal(stripeCustomer: string) {
  const s = await stripe("billing_portal/sessions", { customer: stripeCustomer, return_url: siteUrl() + "/account" });
  return s.url as string;
}

// ---------------------------------------------------------------- NOWPayments (crypto)
async function np(path: string, payload: any) {
  const key = getS("np_api_key");
  if (!key) throw new Error("Crypto payments aren't connected yet.");
  const r = await fetch("https://api.nowpayments.io/v1/" + path, { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("NOWPayments: " + (j?.message || r.status));
  return j;
}
export async function cryptoInvoice(o: Order) {
  const site = siteUrl();
  const j = await np("invoice", { price_amount: o.amount_cents / 100, price_currency: "eur", order_id: o.id,
    order_description: o.plan === "lifetime" ? "GoldenStraddler Lifetime licence" : "GoldenStraddler Monthly (30 days)",
    ipn_callback_url: site + "/webhooks/nowpayments", success_url: `${site}/order/${o.id}`, cancel_url: `${site}/checkout?plan=${o.plan}&cancelled=1` });
  run("UPDATE orders SET provider_ref = ? WHERE id = ?", String(j.id), o.id);
  return j.invoice_url as string;
}
const sortDeep = (x: any): any => Array.isArray(x) ? x.map(sortDeep) : x && typeof x === "object" ? Object.keys(x).sort().reduce((a: any, k) => (a[k] = sortDeep(x[k]), a), {}) : x;
export async function nowpaymentsWebhook(req: Request) {
  const raw = await req.text(), secret = getS("np_ipn_secret");
  let b: any; try { b = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const sig = req.headers.get("x-nowpayments-sig") || "";
  if (!secret || !safeEq(sig, hmacHex("sha512", secret, JSON.stringify(sortDeep(b))))) return new Response("bad signature", { status: 400 });
  const o = orderById(str(b.order_id, 20));
  if (!o) return new Response("ok");
  const st = String(b.payment_status || "");
  if (st === "finished" || st === "confirmed") {
    const paidEur = Number(b.price_amount || 0), currencyOk = String(b.price_currency || "").toLowerCase() === "eur";
    // price_amount is only the invoice price; check what actually arrived against what was asked for
    const want = Number(b.pay_amount || 0), got = Number(b.actually_paid || 0);
    const short = !(want > 0) || !(got >= want * 0.995);
    if (!currencyOk || Math.round(paidEur * 100) < o.amount_cents || short) {
      run("UPDATE orders SET status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END, note = ? WHERE id = ?",
        `Crypto payment needs checking: received ${b.actually_paid} of ${b.pay_amount} ${String(b.pay_currency || "").toUpperCase()} (${b.price_amount} ${b.price_currency})`, o.id);
      notifyAdmins("Crypto payment needs checking", `Order ${o.id}: received ${b.actually_paid} of ${b.pay_amount} ${b.pay_currency}. Confirm it in admin if it's fine.`).catch(() => {});
    } else if (!seenEvent("np:" + b.payment_id + ":paid")) fulfil(o.id, { paymentRef: String(b.payment_id || "") });
  } else if (st === "partially_paid") run("UPDATE orders SET status = 'processing', note = 'Partly paid in crypto' WHERE id = ? AND status = 'pending'", o.id);
  else if (st === "failed" || st === "expired") run("UPDATE orders SET status = 'failed', note = ? WHERE id = ? AND status IN ('pending','processing')", "Crypto payment " + st, o.id);
  else if (st === "confirming" || st === "sending" || st === "waiting") run("UPDATE orders SET status = 'processing', note = 'Crypto payment confirming' WHERE id = ? AND status = 'pending' AND ? != 'waiting'", o.id, st);
  return new Response("ok");
}

// ---------------------------------------------------------------- checkout entry point
export async function startPayment(o: Order) {
  if (Bun.env.MOCK_PAY === "1") return `${siteUrl()}/order/${o.id}?mock=1`; // local testing: the order page offers a fake "pay" button
  if (o.method === "card") return stripeCheckout(o);
  if (o.method === "crypto") return cryptoInvoice(o);
  mailBankInstructions(o).catch(() => {});
  return `${siteUrl()}/order/${o.id}`;
}

// ---------------------------------------------------------------- refunds
export async function markRefunded(o: Order, actor: string) {
  run("UPDATE orders SET status = 'refunded', refunded_at = ? WHERE id = ?", now(), o.id);
  if (o.licence_id) {
    const l = one<Licence>("SELECT * FROM licences WHERE id = ?", o.licence_id);
    // refunding a renewal only removes that month; refunding the first payment switches the licence off
    if (l && (o.kind === "new" || l.plan === "lifetime")) revoke(l.id, "refunded", actor);
    else if (l && l.expires_at) run("UPDATE licences SET expires_at = MAX(?, expires_at - ?) WHERE id = ?", now(), 30 * DAY, l.id);
  }
  audit(actor, "order refunded", o.id);
  mailRefunded(o.email, o).catch(() => {});
}
export async function refundOrder(o: Order, actor: string) {
  if (o.status !== "paid") throw new Error("Only paid orders can be refunded.");
  if (o.method === "card" && Bun.env.MOCK_PAY !== "1") {
    if (!o.payment_ref) throw new Error("No Stripe payment found for this order.");
    const pi = o.payment_ref.startsWith("ch_") ? { charge: o.payment_ref } : { payment_intent: o.payment_ref };
    await stripe("refunds", { ...pi, reason: "requested_by_customer", metadata: { order: o.id } });
    const l = o.licence_id ? one<Licence>("SELECT * FROM licences WHERE id = ?", o.licence_id) : null;
    if (l && l.stripe_sub && o.kind === "new") { try { await stripe("subscriptions/" + l.stripe_sub, undefined, "DELETE"); } catch {} }
  }
  // crypto and bank transfers are paid back by hand; this records it and switches the licence off
  await markRefunded(o, actor);
}

export const ordersFor = (customerId: string) => all<Order>("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC", customerId);
