// Licences: issuing, the EA check-in protocol, account locking and the per-licence dashboard feed.
import { all, audit, db, now, one, run } from "./db";
import { DAY, E, getN, getS, hmacHex, newId, newLicenceKey, str } from "./util";
import { mailLicence, mailRenewed, notifyAdmins } from "./mail";

export type Licence = {
  id: string; key: string; customer_id: string; plan: "lifetime" | "monthly" | "journal"; status: string; expires_at: number | null; source: string;
  account: string; account_server: string; account_name: string; account_demo: number; bound_at: number | null; last_move_at: number | null;
  last_seen: number | null; ea_build: string; stripe_sub: string; refundable_until: number | null; note: string; created_at: number;
};
export type Order = {
  id: string; customer_id: string | null; email: string; plan: string; kind: string; licence_id: string | null; method: string; status: string;
  list_cents: number; amount_cents: number; currency: string; code: string; provider_ref: string; payment_ref: string;
  consent_at: number | null; ip: string; country: string; created_at: number; paid_at: number | null; refunded_at: number | null; note: string;
};
export type Customer = { id: string; email: string; name: string; created_at: number; stripe_customer: string; notes: string };

const GRACE_DAYS = 3;          // monthly: days after the paid period before the bot stops
const OFFLINE_HOURS = 48;      // EA keeps trading this long without reaching the server
const SIGN = (E.EA_SIGN_SECRET || "dev-sign-secret-change-me").trim();

export const maskAcc = (a: string) => (a && a.length > 3 ? "••••" + a.slice(-3) : a);
export function effective(l: Licence) {
  if (l.status === "revoked") return "revoked";
  if (l.status !== "active") return l.status;
  if (l.expires_at && l.expires_at < now()) return "expired";
  return "active";
}

// ---------------------------------------------------------------- customers + issuing
export function customerFor(email: string, name = "") {
  email = email.toLowerCase();
  let c = one<Customer>("SELECT * FROM customers WHERE email = ?", email);
  if (!c) {
    const id = newId("cus");
    run("INSERT INTO customers (id, email, name, created_at) VALUES (?, ?, ?, ?)", id, email, name, now());
    c = one<Customer>("SELECT * FROM customers WHERE id = ?", id)!;
  } else if (name && !c.name) run("UPDATE customers SET name = ? WHERE id = ?", name, c.id);
  return c;
}

export function issueLicence(customerId: string, plan: string, source: string, expiresAt: number | null, extra: Partial<Licence> = {}) {
  const id = newId("lic");
  let key = newLicenceKey();
  while (one("SELECT id FROM licences WHERE key = ?", key)) key = newLicenceKey();
  run(`INSERT INTO licences (id, key, customer_id, plan, status, expires_at, source, stripe_sub, refundable_until, note, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    id, key, customerId, plan, expiresAt, source, extra.stripe_sub || "", extra.refundable_until ?? null, extra.note || "", now());
  return one<Licence>("SELECT * FROM licences WHERE id = ?", id)!;
}

// Called once a payment is confirmed. Safe to call twice for the same order.
// periodEnd (ms) is the end of the paid period for monthly plans when the provider knows it (Stripe).
export function fulfil(orderId: string, opts: { periodEnd?: number; paymentRef?: string; stripeSub?: string; stripeCustomer?: string; actor?: string } = {}) {
  const o = one<Order>("SELECT * FROM orders WHERE id = ?", orderId);
  if (!o) throw new Error("order not found: " + orderId);
  if (o.status === "paid" || o.status === "refunded") return o;
  let lic: Licence | null = null;
  db.transaction(() => {
    const c = customerFor(o.email);
    if (opts.stripeCustomer) run("UPDATE customers SET stripe_customer = ? WHERE id = ?", opts.stripeCustomer, c.id);
    const t = now(), monthEnd = (from: number) => from + (o.plan === "journal_year" ? 365 : 30) * DAY;
    if (o.kind === "renew" && o.licence_id) {
      lic = one<Licence>("SELECT * FROM licences WHERE id = ?", o.licence_id);
      if (lic) {
        // the new period starts where the paid one ends (expiry minus grace), or now if it already lapsed
        const start = Math.max(lic.expires_at ? lic.expires_at - GRACE_DAYS * DAY : t, t);
        const exp = (opts.periodEnd || monthEnd(start)) + GRACE_DAYS * DAY;
        run("UPDATE licences SET expires_at = ?, status = CASE WHEN status = 'revoked' THEN status ELSE 'active' END WHERE id = ?", exp, lic.id);
      }
    } else {
      const exp = o.plan !== "lifetime" ? (opts.periodEnd || monthEnd(t)) + GRACE_DAYS * DAY : null;
      lic = issueLicence(c.id, o.plan === "journal_year" ? "journal" : o.plan, o.method, exp, { stripe_sub: opts.stripeSub || "", refundable_until: t + getN("refund_days") * DAY });
    }
    run("UPDATE orders SET status = 'paid', paid_at = ?, customer_id = ?, licence_id = ?, payment_ref = CASE WHEN ? != '' THEN ? ELSE payment_ref END WHERE id = ?",
      t, c.id, lic ? lic.id : o.licence_id, opts.paymentRef || "", opts.paymentRef || "", o.id);
    if (o.code) run("UPDATE codes SET uses = uses + 1 WHERE code = ?", o.code);
    audit(opts.actor || "system", o.kind === "renew" ? "licence renewed" : "licence issued", lic ? lic.key : "", `order ${o.id} via ${o.method}`);
  })();
  const paid = one<Order>("SELECT * FROM orders WHERE id = ?", orderId)!;
  const l = paid.licence_id ? one<Licence>("SELECT * FROM licences WHERE id = ?", paid.licence_id) : null;
  if (l) {
    (o.kind === "renew" ? mailRenewed(paid, l) : mailLicence(paid, l)).catch((e) => console.error("mail:", e.message));
    notifyAdmins(`New ${o.kind === "renew" ? "renewal" : "sale"}: ${o.plan} ${(paid.amount_cents / 100).toFixed(2)} EUR (${o.method})`,
      `${paid.email} paid ${(paid.amount_cents / 100).toFixed(2)} EUR for ${o.plan} via ${o.method}. Order ${o.id}.`).catch(() => {});
  }
  return paid;
}

export function revoke(licenceId: string, reason: string, actor: string) {
  run("UPDATE licences SET status = 'revoked', note = TRIM(note || ' ' || ?) WHERE id = ?", reason, licenceId);
  audit(actor, "licence revoked", licenceId, reason);
}
export function restore(licenceId: string, actor: string) {
  run("UPDATE licences SET status = 'active' WHERE id = ?", licenceId);
  audit(actor, "licence restored", licenceId);
}

// ---------------------------------------------------------------- EA check-in
// Response is signed so a fake local server can't unlock the EA:
// sig = HMAC-SHA256(secret, key|account|status|exp|now|valid)   (unix seconds)
function signed(key: string, account: string, status: string, exp: number, msg: string, plan = "") {
  const t = Math.floor(now() / 1000);
  let valid = 0;
  if (status === "ok") valid = exp ? Math.min(t + OFFLINE_HOURS * 3600, exp) : t + OFFLINE_HOURS * 3600;
  const sig = hmacHex("sha256", SIGN, [key, account, status, exp, t, valid].join("|"));
  return { ok: status === "ok", status, plan, exp, now: t, valid, msg, sig, renew: getS("site_url").replace(/\/+$/, "") + "/account" };
}

export function eaHello(b: any) {
  const key = str(b.key, 40).toUpperCase(), account = str(b.account, 20);
  if (!key || !/^\d{3,20}$/.test(account)) return signed(key, account, "invalid", 0, "Enter your licence key in the EA inputs.");
  const l = one<Licence>("SELECT * FROM licences WHERE key = ?", key);
  if (!l) return signed(key, account, "invalid", 0, "This licence key doesn't exist. Check it in your GoldenStraddler account.");
  const exp = l.expires_at ? Math.floor(l.expires_at / 1000) : 0, st = effective(l);
  if (st === "revoked") return signed(key, account, "revoked", exp, "This licence has been switched off. Contact support from your account page.", l.plan);
  // a Journal plan key opens the journal, not the EA, and never locks to a trading account
  if (l.plan === "journal") return signed(key, account, "invalid", 0, "This key is for the Journal plan. The EA needs a GoldenStraddler licence.");
  // a free trial only runs on demo accounts, and never locks to a live one
  if ((l.plan as string) === "trial" && !b.demo) return signed(key, account, "invalid", exp, "This is a demo trial. It runs on demo accounts only. Buy a licence from goldenstraddler.com to trade on a live account.", l.plan);
  if (!l.account) {
    run("UPDATE licences SET account = ?, account_server = ?, account_name = ?, account_demo = ?, bound_at = ? WHERE id = ?",
      account, str(b.server, 96), str(b.name, 96), b.demo ? 1 : 0, now(), l.id);
    audit("ea", "licence locked to account", l.key, `${maskAcc(account)} on ${str(b.server, 96)}`);
    l.account = account;
  }
  if (l.account !== account)
    return signed(key, account, "locked", exp, `This licence is locked to account ${maskAcc(l.account)}. Move it from your GoldenStraddler account page.`, l.plan);
  run("UPDATE licences SET last_seen = ?, ea_build = ?, account_server = CASE WHEN ? != '' THEN ? ELSE account_server END WHERE id = ?",
    now(), str(b.build, 20), str(b.server, 96), str(b.server, 96), l.id);
  if (st === "expired") return signed(key, account, "expired", exp, (l.plan as string) === "trial" ? "Your demo trial has ended. Buy a licence from your GoldenStraddler account to keep trading." : "Your subscription has ended. Renew from your GoldenStraddler account to keep trading.", l.plan);
  if (st !== "active") return signed(key, account, st, exp, "This licence isn't active yet.", l.plan);
  return signed(key, account, "ok", exp, l.plan === "lifetime" ? "Lifetime licence active" : (l.plan as string) === "trial" ? "Demo trial active" : "Subscription active", l.plan);
}

// licence for an EA sync call: key + the account it's locked to
export function licenceForSync(b: any) {
  const key = str(b.key, 40).toUpperCase(), account = str(b.account, 20);
  const l = key ? one<Licence>("SELECT * FROM licences WHERE key = ?", key) : null;
  if (!l || l.plan === "journal" || !l.account || l.account !== account || l.status === "revoked") return null;
  return l;
}

const NUMS = ["volume", "open_price", "close_price", "points", "gross", "commission", "swap", "fee", "net"];
export function storeStatus(l: Licence, b: any) {
  const st = { ...b }; delete st.key; delete st.account;
  run(`INSERT INTO feeds (licence_id, status, status_at, updated_at, symbol, magic, currency) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(licence_id) DO UPDATE SET status = excluded.status, status_at = excluded.status_at, symbol = excluded.symbol, magic = excluded.magic, currency = excluded.currency`,
    l.id, JSON.stringify(st).slice(0, 60000), now(), now(), str(b.symbol, 48), str(b.magic, 32), str(b.currency, 8) || "USD");
  run("UPDATE licences SET last_seen = ? WHERE id = ?", now(), l.id);
}
const upsertTrade = db.query(`INSERT INTO trades (licence_id, id, side, open_time, close_time, volume, open_price, close_price, points, gross, commission, swap, fee, net)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(licence_id, id) DO UPDATE SET side = excluded.side, open_time = excluded.open_time, close_time = excluded.close_time, volume = excluded.volume,
  open_price = excluded.open_price, close_price = excluded.close_price, points = excluded.points, gross = excluded.gross, commission = excluded.commission,
  swap = excluded.swap, fee = excluded.fee, net = excluded.net`);
export function storeTrades(l: Licence, list: any[], reset: boolean) {
  let added = 0;
  db.transaction(() => {
    if (reset) run("DELETE FROM trades WHERE licence_id = ?", l.id);
    for (const t of list.slice(0, 5000)) {
      const id = str(t?.id, 32), side = str(t?.side, 4).toUpperCase();
      if (!id || (side !== "BUY" && side !== "SELL")) continue;
      const n = NUMS.map((k) => { const v = Number(t[k]); return Number.isFinite(v) ? v : 0; });
      const r = upsertTrade.run(l.id, id, side, str(t.open_time, 24), str(t.close_time, 24), ...n);
      if (r.changes) added++;
    }
    run("UPDATE feeds SET updated_at = ? WHERE licence_id = ?", now(), l.id);
  })();
  const c = one<{ n: number; last: string }>("SELECT COUNT(*) n, (SELECT id FROM trades WHERE licence_id = ? ORDER BY close_time DESC, id DESC LIMIT 1) last FROM trades WHERE licence_id = ?", l.id, l.id)!;
  return { have: c.n, last_id: c.last || "", added };
}

// dashboard payload in the shape the dashboard script expects
export function dashState(l: Licence) {
  const f = one<any>("SELECT * FROM feeds WHERE licence_id = ?", l.id);
  const trades = all("SELECT id, side, open_time, close_time, volume, open_price, close_price, points, gross, commission, swap, fee, net FROM trades WHERE licence_id = ? ORDER BY close_time, id", l.id);
  if (!f && !trades.length) return null;
  let status: any = null; try { status = f && f.status ? JSON.parse(f.status) : null; } catch {}
  return {
    feed: { key: l.id, account: maskAcc(l.account), server: l.account_server, company: "", currency: (f && f.currency) || "USD", demo: !!l.account_demo,
      symbol: (f && f.symbol) || "", magic: (f && f.magic) || "", statusAt: f ? f.status_at : 0, count: trades.length },
    status, statusAt: f ? f.status_at : 0, trades, hidden: 0,
  };
}

export function publicLicence(l: Licence) {
  return { id: l.id, key: l.key, plan: l.plan, status: effective(l), expires_at: l.expires_at, account: maskAcc(l.account), account_server: l.account_server,
    account_demo: !!l.account_demo, bound_at: l.bound_at, last_move_at: l.last_move_at, last_seen: l.last_seen, source: l.source, stripe_sub: !!l.stripe_sub,
    refundable_until: l.refundable_until, created_at: l.created_at, online: !!(one<any>("SELECT status_at FROM feeds WHERE licence_id = ? AND status_at > ?", l.id, now() - 20000)) };
}
