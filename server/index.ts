/*
 * goldenstraddler.com - sales site, checkout, customer accounts, admin, and the licence + sync API for the EA.
 * Bun + SQLite on a Railway volume. Static pages live in /web.
 */
import { renderShare } from "./share";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createDecipheriv, createHash } from "node:crypto";
import { join, normalize } from "node:path";
import QRCode from "qrcode";
import { all, audit, backupTo, DB_PATH, now, one, run } from "./db";
import { DAY, E, SEC_H, SECRET_KEYS, bad, body, emailOk, esc, euros, getN, getS, ipOf, json, limited, newId, setS, siteUrl, str, sha256, cookie, token } from "./util";
import { adminLogin, adminOf, bootstrapOwner, checkLoginCode, endAllSessions, endSession, newLoginCode, newTotpSecret, otpauthUri, sessionOf, startSession, type Admin } from "./auth";
import { customerFor, dashState, eaHello, effective, issueLicence, licenceForSync, maskAcc, publicLicence, restore, revoke, storeStatus, storeTrades, type Customer, type Licence, type Order } from "./licence";
import { billingPortal, connectStripe, createOrder, listPrice, nowpaymentsWebhook, orderById, ordersFor, promo, quote, refundOrder, settleStripeSession, startPayment, stripe, stripeWebhook, type Plan } from "./pay";
import { mailConfigured, mailExpiring, mailLicence, mailLoginCode, notifyAdmins, outbox, sendMail } from "./mail";
import { fulfil } from "./licence";
import { chatAdmin, chatEnabled, chatRoute, initChat, testAnthropicKey } from "./chat";
import { hubDetail, hubJson, hubLive, hubPublic, hubRefreshNow, hubStatus, hubTeaser, renderHub, startHub } from "./hub";
import { archiveEvents, connectorSync, journalAccess, journalAdmin, journalApi, journalOpen, weeklyDigests } from "./journal";
import { journalAi } from "./jai";

const PORT = Number(E.PORT) || 3000, DEV = E.DEV === "1";
const WEB = join(import.meta.dir, "..", "web");
const STARTED = now();
const ASSET_V = (E.RAILWAY_GIT_COMMIT_SHA || String(STARTED)).slice(0, 10);
const EA_FILE = join(DB_PATH, "..", "GoldenStraddler.ex5");     // uploaded from admin, lives on the volume (not in git)
const eaPath = () => (existsSync(EA_FILE) ? EA_FILE : existsSync(join(WEB, "dl", "GoldenStraddler.ex5")) ? join(WEB, "dl", "GoldenStraddler.ex5") : "");
// A build can also ship the EA encrypted in assets/ea (AES-256-GCM: iv[12] tag[16] data, key in EA_BLOB_KEY).
// It's installed once per new file, so a later upload from admin isn't overwritten on restart.
function installShippedEa() {
  const enc = join(import.meta.dir, "..", "assets", "ea", "GoldenStraddler.ex5.enc"), key = (E.EA_BLOB_KEY || "").trim();
  if (!key || !existsSync(enc)) return;
  try {
    const raw = readFileSync(enc), sha = createHash("sha256").update(raw).digest("hex");
    if (getS("ea_blob_sha") === sha) return;
    const d = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const ex5 = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
    writeFileSync(EA_FILE + ".tmp", ex5); renameSync(EA_FILE + ".tmp", EA_FILE);
    const vf = join(import.meta.dir, "..", "assets", "ea", "version.txt"), version = existsSync(vf) ? readFileSync(vf, "utf8").trim().slice(0, 12) : "";
    if (version) setS("ea_version", version);
    setS("ea_blob_sha", sha);
    audit("system", "installed the EA shipped with this deploy", version, `${Math.round(ex5.length / 1024)} KB`);
    console.log("ea: installed shipped EA", version, ex5.length, "bytes");
  } catch (e: any) { console.error("ea: couldn't install the shipped EA:", e.message); }
}
installShippedEa();

// ================================================================ static files
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", webp: "image/webp", ico: "image/x-icon", json: "application/json", txt: "text/plain; charset=utf-8", xml: "application/xml",
  pdf: "application/pdf", mp4: "video/mp4", woff2: "font/woff2", ex5: "application/octet-stream", webmanifest: "application/manifest+json" };
const CSP = "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const gzCache = new Map<string, { mtime: number; gz: Uint8Array }>();
async function file(req: Request, rel: string, opts: { noindex?: boolean; cache?: number; replace?: (s: string) => string; download?: string } = {}) {
  const p = normalize(join(WEB, rel));
  if (!p.startsWith(WEB) || !existsSync(p) || statSync(p).isDirectory()) return notFound(req);
  const ext = p.split(".").pop()!.toLowerCase(), type = TYPES[ext] || "application/octet-stream", st = statSync(p);
  const h: Record<string, string> = { "Content-Type": type, ...SEC_H, "Cache-Control": ext === "html" ? "no-cache" : `public, max-age=${opts.cache ?? 3600}` };
  if (ext === "html") h["Content-Security-Policy"] = CSP;
  if (opts.noindex) h["X-Robots-Tag"] = "noindex";
  if (opts.download) h["Content-Disposition"] = `attachment; filename="${opts.download}"`;
  const textual = /^(text|application\/(json|xml|manifest)|image\/svg)/.test(type);
  let data: Uint8Array | string = textual ? await Bun.file(p).text() : new Uint8Array(await Bun.file(p).arrayBuffer());
  if (opts.replace && typeof data === "string") data = opts.replace(data);
  // version the page's own css/js/img links so a new deploy is never hidden behind a cached file
  if (ext === "html" && typeof data === "string") data = data.replace(/((?:href|src)=")(\/(?:css|js|img)\/[^"?#]+)"/g, `$1$2?v=${ASSET_V}"`);
  if (textual && /\bgzip\b/.test(req.headers.get("accept-encoding") || "")) {
    const k = p + (opts.replace ? ":r" : "");
    let c = gzCache.get(k);
    if (!c || c.mtime !== st.mtimeMs || opts.replace) { c = { mtime: st.mtimeMs, gz: gzipSync(data as string) }; if (!opts.replace) gzCache.set(k, c); }
    return new Response(c.gz, { headers: { ...h, "Content-Encoding": "gzip", Vary: "Accept-Encoding" } });
  }
  return new Response(data, { headers: h });
}
const notFound = (req: Request) => file(req, "404.html").then((r) => new Response(r.body, { status: 404, headers: r.headers }));

// the Markets link appears in the home page menus once the hub is published
const hubNav = (s: string) => (hubPublic() ? s.replace(/<!--HUB_NAV-->/g, '<a href="/markets">Markets</a>').replace("<!--HUB_TEASER-->", () => hubTeaser()) : s);
// seller details are filled into the legal pages
function legalVars(s: string) {
  const v: Record<string, string> = {
    SELLER_NAME: getS("seller_name") || "[Seller name to be added]", SELLER_ADDRESS: getS("seller_address") || "[Registered address to be added]",
    SELLER_VAT: getS("seller_vat") || "-", SELLER_REG: getS("seller_reg") || "-", SUPPORT_EMAIL: getS("support_email"),
    REFUND_DAYS: getS("refund_days"), MOVE_DAYS: getS("move_days"), PRICE_LIFETIME: euros(listPrice("lifetime")), PRICE_MONTHLY: euros(listPrice("monthly")), PRICE_JOURNAL: euros(listPrice("journal")), AI_CREDITS: String(getN("journal_ai_credits") || 100),
    SITE: siteUrl().replace(/^https?:\/\//, ""), SITE_URL: siteUrl(), UPDATED: "1 October 2026",
  };
  return s.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => esc(v[k] ?? ""));
}

// structured data for search engines: the product with both plans, and the questions on the page
function jsonLd(s: string) {
  const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").trim();
  const faq = [...s.matchAll(/<details><summary>([\s\S]*?)<\/summary><div class="a">([\s\S]*?)<\/div><\/details>/g)].map((m) => ({ "@type": "Question", name: strip(m[1]), acceptedAnswer: { "@type": "Answer", text: strip(m[2]) } }));
  const price = (c: number) => (c / 100).toFixed(2), url = siteUrl() + "/";
  const data = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "GoldenStraddler", applicationCategory: "FinanceApplication", operatingSystem: "Windows, MetaTrader 5", url,
      description: "An Expert Advisor for MetaTrader 5 that trades gold (XAUUSD) around high-impact US news with a buy stop and a sell stop placed five seconds before each release and a trailing stop.",
      offers: [{ "@type": "Offer", name: "Lifetime licence", price: price(listPrice("lifetime")), priceCurrency: "EUR", url: siteUrl() + "/checkout?plan=lifetime", availability: "https://schema.org/InStock" },
        { "@type": "Offer", name: "Monthly licence", price: price(listPrice("monthly")), priceCurrency: "EUR", url: siteUrl() + "/checkout?plan=monthly", availability: "https://schema.org/InStock" }] },
    ...(faq.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq }] : []),
  ];
  return s.replace("<!--JSONLD-->", () => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);
}

// ================================================================ live updates (Server-Sent Events)
type Sub = { admin: boolean; licence: string };
const subs = new Map<ReadableStreamDefaultController, Sub>();
const enc = new TextEncoder();
function push(event: string, data: any, filter: (s: Sub) => boolean) {
  const chunk = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const [c, s] of subs) if (filter(s)) { try { c.enqueue(chunk); } catch { subs.delete(c); } }
}
function sse(req: Request, sub: Sub) {
  let ctrl: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(c) { ctrl = c; subs.set(c, sub); c.enqueue(enc.encode(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ serverNow: now() })}\n\n`)); },
    cancel() { subs.delete(ctrl); },
  });
  req.signal.addEventListener("abort", () => { subs.delete(ctrl); try { ctrl.close(); } catch {} });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
setInterval(() => push("ping", now(), () => true), 15000);

// ================================================================ news + public track record
const news = { events: [] as { utc: number; title: string; src: number; fc: string; prev: string }[], fetchedAt: 0, tryAt: 0, raw: "" };
async function refreshNews() {
  if (now() < news.tryAt) return;
  news.tryAt = now() + 600_000;
  try {
    const r = await fetch(E.FF_URL || "https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: { "User-Agent": "GoldenStraddler/3" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const raw = await r.text(), list: any = JSON.parse(raw);
    if (Array.isArray(list) && list.length) { news.raw = raw; try { archiveEvents(list); } catch (e: any) { console.error("news archive:", e.message); } }   // served to customers' EAs, so they only need to allow one address
    news.events = (Array.isArray(list) ? list : []).filter((e: any) => e && e.country === "USD" && e.impact === "High" && typeof e.date === "string" && !/T00:00:00/.test(e.date))
      .map((e: any) => ({ utc: Math.round(Date.parse(e.date) / 1000), title: str(e.title, 120), src: 1, fc: str(e.forecast, 24), prev: str(e.previous, 24) })).filter((e) => Number.isFinite(e.utc)).sort((a, b) => a.utc - b.utc);
    news.fetchedAt = now(); news.tryAt = now() + 3_600_000;
  } catch (e: any) { console.error("news:", e.message); }
}
const record = { data: null as any, at: 0 };
async function refreshRecord() {
  if (now() - record.at < 60_000) return;
  record.at = now();
  try {
    const r = await fetch(getS("record_url"), { signal: AbortSignal.timeout(8000) });
    const j: any = await r.json();
    record.data = j && j.record ? { ...j.record, online: !!j.online } : null;
  } catch { /* keep the last copy */ }
}

// ---------------------------------------------------------------- gold spot price for the home page (public feed, one-minute history kept for a day)
type Sample = [number, number];   // [unix seconds, price]
const gold = { price: 0, at: 0, fetchedAt: 0, tryAt: 0, buf: [] as Sample[], savedAt: 0 };
try { const b = JSON.parse(getS("gold_buf") || "[]"); if (Array.isArray(b)) gold.buf = b.filter((x: any) => Array.isArray(x) && x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1])); } catch {}
async function refreshGold(minGap: number) {
  if (now() - gold.fetchedAt < minGap || now() < gold.tryAt) return;
  gold.tryAt = now() + Math.max(minGap, 5000);
  try {
    const r = await fetch(E.GOLD_URL || "https://api.gold-api.com/price/XAU", { headers: { "User-Agent": "GoldenStraddler/3" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j: any = await r.json(), px = Number(j && j.price);
    if (!Number.isFinite(px) || px < 100 || px > 100000) throw new Error("no price");
    gold.price = Math.round(px * 100) / 100; gold.at = Date.parse(j.updatedAt) || now(); gold.fetchedAt = now();
    const t = Math.floor(now() / 1000), last = gold.buf[gold.buf.length - 1];
    if (last && t - last[0] < 55) last[1] = gold.price; else gold.buf.push([t, gold.price]);
    const cut = t - 86400 - 600; while (gold.buf.length && gold.buf[0][0] < cut) gold.buf.shift();
    if (now() - gold.savedAt > 600_000) { gold.savedAt = now(); setS("gold_buf", JSON.stringify(gold.buf)); }
  } catch (e: any) { if (now() - gold.fetchedAt > 600_000) gold.price = 0; }
}
setInterval(() => refreshGold(50_000), 60_000); refreshGold(0);
function goldPublic() {
  if (!gold.price) return null;
  const t = Math.floor(now() / 1000), win = gold.buf.filter((x) => x[0] >= t - 6 * 3600);
  const step = Math.max(1, Math.ceil(win.length / 120)), spark = win.filter((_, i) => i % step === 0 || i === win.length - 1);
  const old = gold.buf.find((x) => x[0] >= t - 86400 - 300);
  const day = old && t - old[0] >= 23 * 3600 ? old[1] : null;
  return { price: gold.price, at: gold.at, spark, day };
}

// ================================================================ helpers
const plans = new Set(["lifetime", "monthly", "journal"]);
// the Journal plan can only be bought once the journal is public
const planOk = (p: string) => p === "lifetime" || p === "monthly" || (p === "journal" && journalOpen());
const meCustomer = (req: Request) => { const id = sessionOf(req, "customer"); return id ? one<Customer>("SELECT * FROM customers WHERE id = ?", id) : null; };
const licOf = (c: Customer, id: string) => one<Licence>("SELECT * FROM licences WHERE id = ? AND customer_id = ?", id, c.id);
const MOCK = E.MOCK_PAY === "1";
const methodsOn = () => ({ card: getS("methods_card") === "1" && (MOCK || !!getS("stripe_secret")), crypto: getS("methods_crypto") === "1" && (MOCK || !!getS("np_api_key")),
  bank: getS("methods_bank") === "1" && (MOCK || !!getS("bank_iban")) });
const ago = (t: number | null) => (t ? Math.round((now() - t) / 1000) : null);
function err(e: any) { console.error(e?.stack || e); return bad(e?.message || "Something went wrong", e?.code && e.code >= 400 && e.code < 600 ? e.code : 500); }

// ================================================================ AI chat wiring
function chatFacts(tz: string) {
  let zone = "UTC"; try { if (tz) { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); zone = tz; } } catch {}
  const fmt = (utc: number) => new Date(utc * 1000).toLocaleString("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const L: string[] = [`LIVE FACTS (now ${new Date().toLocaleString("en-GB", { timeZone: zone, dateStyle: "full", timeStyle: "short" })}, visitor's time zone ${zone})`];
  L.push(`- Prices: Lifetime ${euros(listPrice("lifetime"))} once. Monthly ${euros(listPrice("monthly"))} a month.`);
  const pm = promo();
  if (pm) {
    for (const [plan, q] of Object.entries(pm.plans)) L.push(`- Discount code ${pm.code}: ${plan} ${euros(q.amount)} instead of ${euros(q.list)} (${euros(q.list - q.amount)} off${plan === "monthly" ? ", " + (q.note || "first month") : ""}). Checkout link with the code filled in: /checkout?plan=${plan}&code=${pm.code}`);
    L.push(pm.endsAt ? `- The code ends ${fmt(Math.round(pm.endsAt / 1000))}.` : "- The code has no end date set, so never say it's ending or limited.");
    if (pm.usesLeft !== null) L.push(`- ${pm.usesLeft} uses of the code are left.`);
    if (!pm.plans.monthly) L.push(`- The code doesn't apply to the monthly plan.`);
  } else L.push("- There is no public discount code right now.");
  const m = methodsOn(), meth = [m.card && "card, Apple Pay and Google Pay (Stripe)", m.crypto && "crypto (NOWPayments)", m.bank && "bank transfer"].filter(Boolean);
  L.push(`- Payment methods available now: ${meth.join(", ") || "none at the moment"}.`);
  L.push(`- Money-back guarantee: ${getN("refund_days")} days from the first payment. A licence can move to another MT5 account once every ${getN("move_days")} days.`);
  const up = news.events.filter((e) => e.utc > now() / 1000 - 60).slice(0, 10);
  if (up.length) {
    const g = new Map<number, typeof up>(); for (const e of up) g.set(e.utc, [...(g.get(e.utc) || []), e]);
    L.push("- Next high-impact USD releases this week (visitor's time): " + [...g.entries()].slice(0, 5).map(([t, es]) => `${fmt(t)}: ${es.map((e) => e.title + (e.fc ? ` (forecast ${e.fc}${e.prev ? ", previous " + e.prev : ""})` : "")).join("; ")}`).join(" | "));
  } else L.push("- No more high-impact USD releases on this week's calendar.");
  const rec = record.data;
  if (getS("record_public") === "1" && rec && rec.trades >= getN("record_min_trades"))
    L.push(`- Our own ${rec.demo ? "demo" : "live"} account's public record: ${rec.trades} closed trades since ${String(rec.since).slice(0, 10)}, ${rec.points >= 0 ? "+" : ""}${Math.round(rec.points)} points net, ${Math.round(rec.winRate * 100)}% of trades won, profit factor ${rec.pf == null ? "n/a" : rec.pf.toFixed(2)}, deepest drawdown ${Math.round(rec.maxDD)} points. ${rec.online ? "It's online right now." : ""} One account at one broker, small lots. Past results don't predict future results.`);
  else L.push("- Our live account record isn't published on the site yet.");
  L.push(`- Current EA version: ${getS("ea_version")}.`, `- Support email: ${getS("support_email")}.`);
  return L.join("\n") + "\n";
}
function chatCustomerFacts(customerId: string) {
  const c = one<Customer>("SELECT * FROM customers WHERE id = ?", customerId);
  if (!c) return "- The visitor is not signed in to a customer account.\n";
  const lics = all<Licence>("SELECT * FROM licences WHERE customer_id = ? ORDER BY created_at DESC", c.id);
  const L = [`- The visitor is signed in as a customer (${c.email}). Don't read out private details unless they ask about their own account.`];
  for (const l of lics.slice(0, 3)) {
    const pl = publicLicence(l);
    L.push(`  - ${l.plan} licence, status ${pl.status}${l.expires_at ? ", paid up to " + new Date(l.expires_at).toISOString().slice(0, 10) : ""}, ${l.account ? "locked to an MT5 " + (l.account_demo ? "demo" : "live") + " account" : "not locked to an MT5 account yet (the EA hasn't run with this key)"}, EA ${pl.online ? "online right now" : l.last_seen ? "last checked in " + new Date(l.last_seen).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never checked in"}.`);
  }
  if (!lics.length) L.push("  - No licence yet.");
  return L.join("\n") + "\n";
}
initChat({
  facts: chatFacts,
  refresh: () => Promise.all([refreshNews(), refreshRecord()]),
  customer: (req) => { const c = meCustomer(req); return c ? { id: c.id, email: c.email, name: c.name } : null; },
  customerFacts: chatCustomerFacts,
  pushAdmin: (ev, d) => push(ev, d, (s) => s.admin),
  adminsOnline: () => { let n = 0; for (const s of subs.values()) if (s.admin) n++; return n; },
});

// ================================================================ routes
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url), p = url.pathname.replace(/\/+$/, "") || "/", post = req.method === "POST";
  const host = (req.headers.get("host") || "").toLowerCase();
  if (host.startsWith("www.") && req.method === "GET") return Response.redirect(siteUrl() + url.pathname + url.search, 301);

  // ---------------------------------------------------------------- EA
  if (p.startsWith("/api/ea/")) {
    if (!post) return bad("POST only", 405);
    if (limited("ea:" + ipOf(req), 900, 60_000)) return bad("Slow down", 429);
    const b = await body(req, 4 << 20);
    if (p === "/api/ea/hello") return json(200, eaHello(b));
    const l = licenceForSync(b);
    if (!l) return bad("licence not active on this account", 403);
    if (p === "/api/ea/status") {
      storeStatus(l, b);
      const st = { ...b }; delete st.key; delete st.account;
      push("status", { licence: l.id, status: st, statusAt: now(), serverNow: now() }, (s) => s.admin || s.licence === l.id);
      const c = one<{ n: number; last: string }>("SELECT COUNT(*) n, (SELECT id FROM trades WHERE licence_id = ? ORDER BY close_time DESC, id DESC LIMIT 1) last FROM trades WHERE licence_id = ?", l.id, l.id)!;
      return json(200, { ok: true, have: c.n, last_id: c.last || "", server_now: now(), licence: effective(l) });
    }
    if (p === "/api/ea/trades") {
      const r = storeTrades(l, Array.isArray(b.trades) ? b.trades : [], !!b.reset);
      push("trades", { licence: l.id }, (s) => s.admin || s.licence === l.id);
      return json(200, { ok: true, ...r });
    }
    return bad("unknown EA route", 404);
  }

  // ---------------------------------------------------------------- news calendar for the EA (a cached copy of the ForexFactory weekly feed)
  if (p === "/ea/calendar.json") {
    if (limited("cal:" + ipOf(req), 120, 3_600_000)) return bad("Slow down", 429);
    await refreshNews();
    if (!news.raw) return bad("Calendar not available yet", 503);
    return new Response(news.raw, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Fetched-At": String(news.fetchedAt) } });
  }

  // ---------------------------------------------------------------- website chat
  if (p.startsWith("/api/chat/")) return chatRoute(req, url, p);

  // ---------------------------------------------------------------- journal (hidden behind an admin session until journal_public is on)
  if (p === "/api/journal/sync") {
    if (!post) return bad("POST only", 405);
    if (limited("jsync:" + ipOf(req), 240, 3_600_000)) return bad("Slow down", 429);
    let b: any; try { b = await body(req, 16 << 20); } catch (e: any) { return bad(e.message, e.code || 400); }
    const r = connectorSync(b);
    return json(r.code, r.body);
  }
  if (p.startsWith("/api/journal/")) {
    if (!journalOpen() && !adminOf(req)) return bad("Not found", 404);
    const c = meCustomer(req);
    const rd = (max: number) => () => body(req, max);
    try {
      if (p.startsWith("/api/journal/ai/")) {
        if (!c) return bad("Sign in to use your journal.", 401);
        const a = journalAccess(c);
        if (!a.ok) return json(403, { ok: false, error: "The journal comes with GoldenStraddler or the Journal plan.", why: a.why });
        return await journalAi(req, p, c, rd(1 << 20));
      }
      return await journalApi(req, p, c, rd(32 << 20));
    } catch (e: any) { return bad(e.message || "Something went wrong.", e.code || 500); }
  }

  // ---------------------------------------------------------------- payment webhooks
  if (p === "/webhooks/stripe" && post) return stripeWebhook(req);
  if (p === "/webhooks/nowpayments" && post) return nowpaymentsWebhook(req);

  // ---------------------------------------------------------------- public API
  if (p === "/api/public") {
    await Promise.all([refreshNews(), refreshRecord()]);
    const minTrades = getN("record_min_trades"), rec = record.data;
    const showRec = getS("record_public") === "1" && rec && rec.trades >= minTrades;
    return json(200, { ok: true, serverNow: now(), prices: { lifetime: listPrice("lifetime"), monthly: listPrice("monthly"), ...(journalOpen() || adminOf(req) ? { journal: listPrice("journal") } : {}) }, methods: methodsOn(),
      refundDays: getN("refund_days"), news: news.events.filter((e) => e.utc > now() / 1000 - 75).slice(0, 8), week: news.events, record: showRec ? rec : null,
      announcement: getS("announcement"), promo: promo(), verifyUrl: /^https:\/\/[\w.-]+\//.test(getS("record_verify_url")) ? getS("record_verify_url") : "" });
  }
  if (p === "/api/markets/live") { if (limited("mkl:" + ipOf(req), 60, 60_000)) return bad("Slow down", 429); return json(200, hubLive()); }
  if (p === "/api/markets") {
    const id = url.searchParams.get("id");
    if (id) { if (limited("mkd:" + ipOf(req), 30, 60_000)) return bad("Slow down", 429); const d = hubDetail(id); return d ? json(200, d) : bad("Unknown market", 404); }
    return json(200, hubJson());
  }
  if (p === "/api/live") {
    if (limited("live:" + ipOf(req), 90, 60_000)) return bad("Slow down", 429);
    await Promise.all([refreshGold(6000), refreshRecord()]);
    const rec = record.data, showRec = getS("record_public") === "1" && rec && rec.trades >= getN("record_min_trades");
    return json(200, { ok: true, serverNow: now(), gold: goldPublic(), account: showRec ? { online: !!rec.online, trades: rec.trades, points: rec.points, winRate: rec.winRate } : null });
  }
  if (p === "/api/quote") {
    const plan = url.searchParams.get("plan") as Plan;
    if (!planOk(plan)) return bad("Choose a plan.");
    if (limited("quote:" + ipOf(req), 60, 600_000)) return bad("Too many tries. Wait a few minutes.", 429);
    return json(200, { ok: true, ...quote(plan, url.searchParams.get("code") || "") });
  }
  if (p === "/api/checkout" && post) {
    const ip = ipOf(req);
    if (limited("checkout:" + ip, 12, 3_600_000)) return bad("Too many checkout attempts. Try again later.", 429);
    const b = await body(req), plan = b.plan as Plan, method = str(b.method, 10), email = str(b.email, 200).toLowerCase();
    if (!planOk(plan)) return bad("Choose a plan.");
    if (!emailOk(email)) return bad("Enter a valid email address. Your licence is sent there.");
    if (!b.consent) return bad("Please accept the Terms and Risk Disclosure to continue.");
    const m = methodsOn() as any;
    if (!m[method]) return bad("That payment method isn't available right now.");
    const q = quote(plan, b.code || "");
    if (q.error) return bad(q.error);
    const { order, claim } = createOrder({ email, plan, method, code: q.code, list: q.list, amount: q.amount, ip, country: req.headers.get("cf-ipcountry") || "" });
    if (str(b.name, 80)) customerFor(email, str(b.name, 80));
    try {
      const go = await startPayment(order);
      return json(200, { ok: true, order: order.id, url: go }, { "Set-Cookie": `gs_o=${claim}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${14 * 86400}` });
    } catch (e: any) {
      run("UPDATE orders SET status = 'failed', note = ? WHERE id = ?", String(e.message).slice(0, 300), order.id);
      console.error("checkout:", e.message);
      return bad("The payment page couldn't be opened. Try again or pick another payment method.", 502);
    }
  }
  if (p.startsWith("/api/order/")) {
    let o = orderById(p.slice(11).toUpperCase());
    if (!o) return bad("Order not found", 404);
    const sid = url.searchParams.get("s") || "";
    if (sid && o.method === "card" && o.status !== "paid" && o.provider_ref === sid) {
      try { const s = await stripe("checkout/sessions/" + encodeURIComponent(sid)); o = (await settleStripeSession(s)) || o; } catch (e: any) { console.error("session check:", e.message); }
    }
    const claimed = !!o.claim_hash && sha256(cookie(req, "gs_o")) === o.claim_hash;
    const headers: Record<string, string> = {};
    let signedIn = !!sessionOf(req, "customer");
    if (claimed && o.status === "paid" && o.customer_id && !signedIn && o.paid_at && now() - o.paid_at < 7 * DAY) { headers["Set-Cookie"] = startSession("customer", o.customer_id); signedIn = true; }
    const bank = o.method === "bank" && (o.status === "pending" || o.status === "processing")
      ? { holder: getS("bank_holder"), iban: getS("bank_iban"), bic: getS("bank_bic"), bank: getS("bank_name") } : null;
    return json(200, { ok: true, order: { id: o.id, status: o.status, plan: o.plan, kind: o.kind, method: o.method, amount: o.amount_cents, list: o.list_cents,
      code: o.code, email: claimed ? o.email : o.email.replace(/^(.).*(@.*)$/, "$1•••$2"), created_at: o.created_at, paid_at: o.paid_at, note: claimed ? o.note : "" },
      bank, signedIn }, headers);
  }
  if (p === "/api/contact" && post) {
    if (limited("contact:" + ipOf(req), 4, 3_600_000)) return bad("You've sent a few messages already. We'll reply soon.", 429);
    const b = await body(req);
    if (b.company) return json(200, { ok: true });
    const email = str(b.email, 200).toLowerCase(), message = str(b.message, 3000);
    if (!emailOk(email)) return bad("Enter a valid email address.");
    if (message.length < 5) return bad("Write a short message.");
    const c = meCustomer(req);
    run("INSERT INTO messages (id, at, name, email, topic, message, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?)", newId("msg"), now(), str(b.name, 80), email, str(b.topic, 40), message, c ? c.id : "");
    push("message", { at: now() }, (s) => s.admin);
    notifyAdmins("New message: " + (str(b.topic, 40) || "general"), `${email}: ${message.slice(0, 500)}`).catch(() => {});
    return json(200, { ok: true });
  }

  // ---------------------------------------------------------------- customer sign-in
  if (p === "/api/login/code" && post) {
    const b = await body(req), email = str(b.email, 200).toLowerCase(), ip = ipOf(req);
    if (!emailOk(email)) return bad("Enter a valid email address.");
    if (limited("lcode:" + ip, 8, 900_000) || limited("lcode:" + email, 4, 900_000)) return bad("Too many codes requested. Wait 15 minutes.", 429);
    const c = one<Customer>("SELECT * FROM customers WHERE email = ?", email);
    if (c && mailConfigured()) await mailLoginCode(email, newLoginCode(email));
    else if (c && DEV) console.log("dev login code for", email, newLoginCode(email));
    return json(200, { ok: true, email: mailConfigured() || DEV });
  }
  if (p === "/api/login/verify" && post) {
    const b = await body(req), email = str(b.email, 200).toLowerCase(), code = str(b.code, 10).replace(/\D/g, "");
    if (limited("lverify:" + ipOf(req), 20, 900_000)) return bad("Too many attempts. Wait 15 minutes.", 429);
    const c = one<Customer>("SELECT * FROM customers WHERE email = ?", email);
    if (!c || !checkLoginCode(email, code)) return bad("That code didn't match or has expired.", 401);
    return json(200, { ok: true }, { "Set-Cookie": startSession("customer", c.id) });
  }
  if (p === "/api/login/key" && post) {   // fallback sign-in with email + licence key
    const b = await body(req), email = str(b.email, 200).toLowerCase(), key = str(b.key, 40).toUpperCase();
    if (limited("lkey:" + ipOf(req), 10, 900_000)) return bad("Too many attempts. Wait 15 minutes.", 429);
    const l = one<Licence & { email: string }>("SELECT l.*, c.email FROM licences l JOIN customers c ON c.id = l.customer_id WHERE l.key = ?", key);
    if (!l || l.email !== email) return bad("That email and licence key don't match.", 401);
    return json(200, { ok: true }, { "Set-Cookie": startSession("customer", l.customer_id) });
  }
  if (p === "/api/logout" && post) return json(200, { ok: true }, { "Set-Cookie": endSession(req, "customer") });

  // ---------------------------------------------------------------- customer area
  if (p.startsWith("/api/me")) {
    const c = meCustomer(req);
    if (!c) return bad("Sign in required", 401);
    const lics = all<Licence>("SELECT * FROM licences WHERE customer_id = ? ORDER BY created_at DESC", c.id);
    if (p === "/api/me") {
      const moveDays = getN("move_days");
      return json(200, { ok: true, customer: { email: c.email, name: c.name, since: c.created_at, portal: !!c.stripe_customer },
        licences: lics.map((l) => ({ ...publicLicence(l), canMove: !!l.account && (!l.last_move_at || now() - l.last_move_at > moveDays * DAY), nextMove: l.last_move_at ? l.last_move_at + moveDays * DAY : null })),
        orders: ordersFor(c.id).map((o) => ({ id: o.id, plan: o.plan, kind: o.kind, method: o.method, status: o.status, amount: o.amount_cents, created_at: o.created_at, paid_at: o.paid_at,
          refundable: o.status === "paid" && o.kind === "new" && !!o.paid_at && now() - o.paid_at < getN("refund_days") * DAY })),
        eaVersion: getS("ea_version"), eaReady: !!eaPath(), methods: methodsOn(), moveDays, refundDays: getN("refund_days"), support: getS("support_email"), serverNow: now(),
        journal: (journalOpen() || !!adminOf(req)) && journalAccess(c).ok, hasEa: lics.some((l) => l.plan !== "journal" && l.status !== "revoked") });
    }
    if (p === "/api/me/state") {
      const l = licOf(c, url.searchParams.get("licence") || "") || lics[0];
      if (!l) return json(200, { ok: true, serverNow: now(), current: null });
      return json(200, { ok: true, serverNow: now(), role: "customer", settings: {}, current: dashState(l) });
    }
    if (p === "/api/me/stream") {
      const l = licOf(c, url.searchParams.get("licence") || "") || lics[0];
      return sse(req, { admin: false, licence: l ? l.id : "-" });
    }
    if (p === "/api/me/news") { await refreshNews(); return json(200, { ok: true, events: news.events }); }
    if (!post) return bad("not found", 404);
    const b = await body(req);
    if (p === "/api/me/move") {
      const l = licOf(c, str(b.licence, 40));
      if (!l) return bad("Licence not found", 404);
      if (!l.account) return bad("This licence isn't locked to an account yet.");
      if (l.last_move_at && now() - l.last_move_at < getN("move_days") * DAY) return bad(`You can move a licence once every ${getS("move_days")} days. Contact support if you need it sooner.`);
      run("UPDATE licences SET account = '', account_server = '', account_name = '', bound_at = NULL, last_move_at = ? WHERE id = ?", now(), l.id);
      run("DELETE FROM feeds WHERE licence_id = ?", l.id); run("DELETE FROM trades WHERE licence_id = ?", l.id);
      audit("customer:" + c.email, "licence released for a new account", l.key, maskAcc(l.account));
      return json(200, { ok: true });
    }
    if (p === "/api/me/portal") {
      if (!c.stripe_customer) return bad("There's no card subscription on this account.");
      try { return json(200, { ok: true, url: await billingPortal(c.stripe_customer) }); } catch (e: any) { return bad(e.message, 502); }
    }
    if (p === "/api/me/renew") {
      const l = licOf(c, str(b.licence, 40)), method = str(b.method, 10);
      if (!l || (l.plan !== "monthly" && l.plan !== "journal") || l.stripe_sub) return bad("This licence renews automatically or can't be renewed here.");
      if (l.status === "revoked") return bad("This licence has been switched off. Contact support.");
      if (!(methodsOn() as any)[method] || method === "card") return bad("Choose crypto or bank transfer.");
      const price = listPrice(l.plan);
      const { order, claim } = createOrder({ email: c.email, plan: l.plan, method, code: "", list: price, amount: price, ip: ipOf(req), country: "", kind: "renew", licenceId: l.id });
      const go = await startPayment(order);
      return json(200, { ok: true, url: go }, { "Set-Cookie": `gs_o=${claim}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${14 * 86400}` });
    }
    if (p === "/api/me/refund") {
      const o = one<Order>("SELECT * FROM orders WHERE id = ? AND customer_id = ?", str(b.order, 20), c.id);
      if (!o || o.status !== "paid") return bad("Order not found.");
      if (!o.paid_at || now() - o.paid_at > getN("refund_days") * DAY || o.kind !== "new") return bad(`Refunds are available within ${getS("refund_days")} days of the first payment.`);
      run("INSERT INTO messages (id, at, name, email, topic, message, customer_id) VALUES (?, ?, ?, ?, 'refund', ?, ?)",
        newId("msg"), now(), c.name, c.email, `Refund requested for order ${o.id} (${euros(o.amount_cents)}). Reason: ${str(b.reason, 1000) || "not given"}`, c.id);
      audit("customer:" + c.email, "refund requested", o.id);
      push("message", { at: now() }, (s) => s.admin);
      notifyAdmins("Refund requested", `${c.email} asked for a refund of order ${o.id} (${euros(o.amount_cents)}).`).catch(() => {});
      return json(200, { ok: true });
    }
    return bad("not found", 404);
  }

  // ---------------------------------------------------------------- admin
  if (p === "/api/admin/login" && post) {
    const ip = ipOf(req);
    if (limited("alogin:" + ip, 6, 900_000) || limited("alogin:*", 30, 900_000, false)) return bad("Too many attempts. Wait 15 minutes.", 429);
    const b = await body(req), a = adminLogin(str(b.email, 200), str(b.code, 10).replace(/\s/g, ""));
    if (!a) { limited("alogin:*", 30, 900_000); return bad("That email and code don't match.", 401); }
    audit(a.email, "signed in", "", ip);
    return json(200, { ok: true }, { "Set-Cookie": startSession("admin", a.id) });
  }
  if (p === "/api/admin/logout" && post) return json(200, { ok: true }, { "Set-Cookie": endSession(req, "admin") });
  if (p.startsWith("/api/admin/")) {
    const a = adminOf(req);
    if (!a) return bad("Admin sign-in required", 401);
    if (p === "/api/admin/ea") {
      if (!post) { const f = eaPath(); return json(200, { ok: true, present: !!f, uploaded: f === EA_FILE, size: f ? statSync(f).size : 0, at: f ? statSync(f).mtimeMs : null, version: getS("ea_version") }); }
      if (a.role !== "owner") return bad("Only the owner can upload a new EA.", 403);
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length < 4096 || buf.length > 12 << 20) return bad("That doesn't look like a compiled EA (.ex5) file.");
      const version = str(url.searchParams.get("version") || "", 12).replace(/[^\w.\-]/g, "");
      await Bun.write(EA_FILE + ".tmp", buf);
      renameSync(EA_FILE + ".tmp", EA_FILE);
      if (version) setS("ea_version", version);
      audit(a.email, "uploaded a new EA", version || "", `${Math.round(buf.length / 1024)} KB`);
      return json(200, { ok: true, size: buf.length, version: getS("ea_version") });
    }
    return adminRoute(req, url, p.slice(10), a);
  }

  // ---------------------------------------------------------------- dev helpers
  if (DEV && p === "/api/dev/outbox") return json(200, outbox.slice(-20));
  if (DEV && p === "/api/dev/weekly" && post) { const b = await body(req); return json(200, { ok: true, sent: await weeklyDigests(Number(b.at) || now()) }); }
  if (MOCK && p.startsWith("/api/dev/pay/") && post) { const o = fulfil(p.slice(13), { paymentRef: "mock_" + token(6) }); return json(200, { ok: true, status: o.status }); }

  // ---------------------------------------------------------------- downloads (customers with a licence)
  if (p === "/dl/GoldenStraddler.ex5" || p === "/dl/GoldenStraddler-Guide.pdf") {
    const c = meCustomer(req);
    const ok = c && one("SELECT id FROM licences WHERE customer_id = ? AND status != 'revoked' AND plan != 'journal'", c.id);
    if (!ok) return Response.redirect(siteUrl() + "/account", 302);
    if (p.endsWith(".ex5")) {
      const f = eaPath();
      if (!f) return Response.redirect(siteUrl() + "/account?ea=soon", 302);
      audit("customer:" + c!.email, "downloaded", "the EA", getS("ea_version"));
      return new Response(Bun.file(f), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="GoldenStraddler.ex5"', "Cache-Control": "no-store", ...SEC_H } });
    }
    audit("customer:" + c!.email, "downloaded", p.slice(4));
    return file(req, p.slice(1), { download: p.slice(4), cache: 0 });
  }

  // ---------------------------------------------------------------- pages
  if (req.method !== "GET" && req.method !== "HEAD") return bad("Method not allowed", 405);
  if (p === "/robots.txt") return new Response(`User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /admin\nDisallow: /order/\nDisallow: /journal/app\nDisallow: /api/\nSitemap: ${siteUrl()}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain" } });
  if (p === "/sitemap.xml") {
    const u = ["", "/checkout", "/terms", "/refunds", "/privacy", "/risk", "/imprint", ...(hubPublic() ? ["/markets", ...hubJson().markets.map((m) => "/markets/" + m.id)] : []), ...(journalOpen() ? ["/journal"] : [])]
      .map((x) => `<url><loc>${siteUrl()}${x}</loc></url>`).join("");
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u}</urlset>`, { headers: { "Content-Type": "application/xml" } });
  }
  if (p === "/health") return json(200, { ok: true, uptime: Math.round((now() - STARTED) / 1000) });
  const pages: Record<string, [string, boolean?]> = { "/": ["index.html"], "/checkout": ["checkout.html"], "/account": ["account.html", true], "/admin": ["admin.html", true] };
  if (pages[p]) return file(req, pages[p][0], { noindex: !!pages[p][1], replace: (s) => {
    let o = hubNav(legalVars(s));
    if (p === "/") { o = jsonLd(o); if (getS("record_public") !== "1") o = o.replace(/<a href="#record">/g, '<a href="#record" hidden>'); }
    return o;
  } });
  if (p === "/markets" || /^\/markets\/[a-z]{2,12}$/.test(p)) {
    const r = renderHub(p);
    if (!r) return notFound(req);
    return file(req, "markets.html", { noindex: !hubPublic(), replace: (s) => legalVars(s.replace("<!--HUB_MAIN-->", () => r.html)            // a function, so "$&" in the page isn't read as a pattern
      .replace(/\{\{HUB_TITLE\}\}/g, () => esc(r.title)).replace(/\{\{HUB_DESC\}\}/g, () => esc(r.desc)).replace(/\{\{HUB_PATH\}\}/g, () => p)) });
  }
  if (/^\/order\/[A-Z0-9-]{6,12}$/i.test(p)) return file(req, "order.html", { noindex: true });
  if (p === "/journal" || p === "/journal/app") {
    const open = journalOpen();
    if (!open && !adminOf(req)) return notFound(req);
    if (p === "/journal/app") return file(req, "journal-app.html", { noindex: true });
    return file(req, "journal.html", { noindex: !open, replace: (s) => hubNav(legalVars(s)) });
  }
  const shm = /^\/j\/([A-Za-z0-9_-]{12,40})$/.exec(p);
  if (shm) {
    if (limited("share:" + ipOf(req), 240, 3_600_000)) return bad("Slow down", 429);
    const r = renderShare(shm[1]);
    if (!r) return notFound(req);
    const open = journalOpen();
    return file(req, "share.html", { noindex: true, replace: (s) => legalVars(s).replace(/%%SH_HOME%%/g, open ? "/journal" : "/").replace(/%%SH_CTA%%/g, open ? "Start your own journal" : "GoldenStraddler")
      .replace(/%%SH_TITLE%%/g, () => esc(r.title)).replace(/%%SH_DESC%%/g, () => esc(r.desc)).replace("<!--SH_MAIN-->", () => r.main) });
  }
  if (p === "/dl/GoldenStraddler-Journal.ex5" || p === "/dl/GoldenStraddler-Journal.mq5") {
    const c = meCustomer(req);
    if (!c || !journalAccess(c).ok) return Response.redirect(siteUrl() + "/journal/app", 302);
    // until the compiled connector is shipped, send people back with a note rather than a bare 404
    if (!existsSync(join(WEB, p.slice(1)))) return Response.redirect(siteUrl() + "/journal/app?soon=connector#/accounts", 302);
    return file(req, p.slice(1), { download: p.slice(4), cache: 0 });
  }
  if (["/terms", "/refunds", "/privacy", "/risk", "/imprint"].includes(p)) return file(req, "legal" + p + ".html", { replace: legalVars });
  if (/^\/(css|js|img|fonts)\/[\w.\-/]+$/.test(p) || /^\/[\w.-]+\.(png|ico|svg|webmanifest|jpg)$/.test(p)) return file(req, p.slice(1), { cache: 86400 });
  return notFound(req);
}

// ================================================================ admin routes
async function adminRoute(req: Request, url: URL, p: string, a: Admin): Promise<Response> {
  const post = req.method === "POST", owner = a.role === "owner", who = a.email;
  const b = post ? await body(req) : {};
  const q = (k: string) => url.searchParams.get(k) || "";

  if (p === "/me") return json(200, { ok: true, admin: { id: a.id, email: a.email, name: a.name, role: a.role }, mail: mailConfigured(), serverNow: now() });
  if (p === "/stream") return sse(req, { admin: true, licence: "" });
  { const r = await chatAdmin(req, url, p, a, b); if (r) return r; }
  if (p === "/hub") return json(200, { ok: true, ...hubStatus() });
  if (p === "/hub/refresh" && post) {
    if (!owner) return bad("Only the owner can do that.", 403);
    hubRefreshNow(true).catch((e) => console.error("hub refresh", e.message));
    return json(200, { ok: true });
  }

  if (p === "/overview") {
    const t = now(), day = t - DAY, month = t - 30 * DAY;
    const sum = (since: number) => one<{ s: number; n: number }>("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM orders WHERE status = 'paid' AND paid_at >= ?", since)!;
    const refunds = one<{ s: number; n: number }>("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM orders WHERE status = 'refunded'")!;
    const lic = all<Licence>("SELECT * FROM licences");
    const active = lic.filter((l) => effective(l) === "active");
    const online = one<{ n: number }>("SELECT COUNT(*) n FROM feeds WHERE status_at > ?", t - 20000)!.n;
    const daily = all<{ d: string; s: number; n: number }>(`SELECT strftime('%Y-%m-%d', paid_at/1000, 'unixepoch') d, SUM(amount_cents) s, COUNT(*) n FROM orders
      WHERE status = 'paid' AND paid_at >= ? GROUP BY d ORDER BY d`, t - 30 * DAY);
    return json(200, { ok: true,
      revenue: { today: sum(day), month: sum(month), all: sum(0), refunds },
      licences: { active: active.length, lifetime: active.filter((l) => l.plan === "lifetime").length, monthly: active.filter((l) => l.plan === "monthly").length, journal: active.filter((l) => l.plan === "journal").length,
        expired: lic.filter((l) => effective(l) === "expired").length, revoked: lic.filter((l) => l.status === "revoked").length, total: lic.length },
      mrr: active.filter((l) => l.plan === "monthly").length * listPrice("monthly") + active.filter((l) => l.plan === "journal").length * listPrice("journal"),
      journal: journalAdmin(),
      online, customers: one<{ n: number }>("SELECT COUNT(*) n FROM customers")!.n, daily,
      pendingBank: all("SELECT id, email, plan, amount_cents, created_at FROM orders WHERE method = 'bank' AND status IN ('pending','processing') ORDER BY created_at DESC LIMIT 20"),
      refundRequests: all("SELECT id, at, email, message FROM messages WHERE topic = 'refund' AND handled = 0 ORDER BY at DESC"),
      unread: one<{ n: number }>("SELECT COUNT(*) n FROM messages WHERE handled = 0")!.n,
      chatsWaiting: one<{ n: number }>("SELECT COUNT(*) n FROM chats WHERE wants_human = 1 AND unread > 0 AND status = 'open'")!.n,
      chats24: one<{ n: number }>("SELECT COUNT(DISTINCT chat_id) n FROM chat_msgs WHERE role = 'user' AND at > ?", t - DAY)!.n,
      recent: all(`SELECT o.id, o.email, o.plan, o.kind, o.method, o.status, o.amount_cents, o.code, o.created_at, o.paid_at FROM orders o ORDER BY o.created_at DESC LIMIT 12`),
      setup: { stripe: !!getS("stripe_secret"), crypto: !!getS("np_api_key"), bank: !!getS("bank_iban"), email: mailConfigured(), seller: !!getS("seller_name"), chat: !!getS("anthropic_key") } });
  }

  if (p === "/customers") {
    const s = "%" + q("q").toLowerCase() + "%";
    return json(200, { ok: true, customers: all(`SELECT c.id, c.email, c.name, c.created_at,
      (SELECT COUNT(*) FROM licences l WHERE l.customer_id = c.id) licences,
      (SELECT COALESCE(SUM(amount_cents),0) FROM orders o WHERE o.customer_id = c.id AND o.status = 'paid') spent,
      (SELECT MAX(last_seen) FROM licences l WHERE l.customer_id = c.id) last_seen
      FROM customers c WHERE lower(c.email) LIKE ? OR lower(c.name) LIKE ? ORDER BY c.created_at DESC LIMIT 300`, s, s) });
  }
  if (p.startsWith("/customer/")) {
    const id = p.split("/")[2], c = one<Customer>("SELECT * FROM customers WHERE id = ?", id);
    if (!c) return bad("Customer not found", 404);
    if (post && p.endsWith("/notes")) { run("UPDATE customers SET notes = ?, name = ? WHERE id = ?", str(b.notes, 4000), str(b.name, 80), c.id); audit(who, "customer notes", c.email); return json(200, { ok: true }); }
    if (post && p.endsWith("/signout")) { endAllSessions("customer", c.id); audit(who, "signed customer out", c.email); return json(200, { ok: true }); }
    return json(200, { ok: true, customer: c,
      licences: all<Licence>("SELECT * FROM licences WHERE customer_id = ? ORDER BY created_at DESC", c.id).map((l) => ({ ...l, account: l.account, effective: effective(l), online: !!one("SELECT 1 FROM feeds WHERE licence_id = ? AND status_at > ?", l.id, now() - 20000) })),
      orders: ordersFor(c.id), messages: all("SELECT * FROM messages WHERE email = ? OR customer_id = ? ORDER BY at DESC", c.email, c.id) });
  }

  if (p === "/licences") {
    const s = "%" + q("q").toLowerCase() + "%";
    const rows = all<Licence & { email: string; status_at: number | null }>(`SELECT l.*, c.email, f.status_at FROM licences l JOIN customers c ON c.id = l.customer_id
      LEFT JOIN feeds f ON f.licence_id = l.id WHERE lower(c.email) LIKE ? OR lower(l.key) LIKE ? OR l.account LIKE ? ORDER BY l.created_at DESC LIMIT 500`, s, s, s);
    return json(200, { ok: true, licences: rows.map((l) => ({ ...l, effective: effective(l), online: !!l.status_at && l.status_at > now() - 20000 })) });
  }
  if (p === "/licence/new" && post) {
    const email = str(b.email, 200).toLowerCase(), plan: Plan = b.plan === "monthly" ? "monthly" : b.plan === "journal" ? "journal" : "lifetime", days = Math.max(0, Math.min(3650, Number(b.days) || 0));
    if (!emailOk(email)) return bad("Enter a valid email address.");
    const c = customerFor(email, str(b.name, 80));
    const l = issueLicence(c.id, plan, "manual", plan !== "lifetime" ? now() + (days || 30) * DAY : (days ? now() + days * DAY : null), { note: str(b.note, 300) });
    const price = Number(b.amount) >= 0 ? Math.round(Number(b.amount) * 100) : 0;
    const { order } = createOrder({ email, plan, method: "manual", code: "", list: listPrice(plan), amount: price, ip: "", country: "" });
    run("UPDATE orders SET status = 'paid', paid_at = ?, customer_id = ?, licence_id = ?, note = ? WHERE id = ?", now(), c.id, l.id, "Issued by " + who, order.id);
    audit(who, "manual licence issued", l.key, `${email} ${plan}${days ? " " + days + "d" : ""}`);
    if (b.send !== false) mailLicence({ ...one<Order>("SELECT * FROM orders WHERE id = ?", order.id)! }, l).catch(() => {});
    return json(200, { ok: true, licence: l });
  }
  if (p.startsWith("/licence/")) {
    const [, , id, action] = p.split("/"), l = one<Licence>("SELECT * FROM licences WHERE id = ?", id);
    if (!l) return bad("Licence not found", 404);
    if (!post) return json(200, { ok: true, licence: { ...l, effective: effective(l) }, state: dashState(l) });
    if (action === "revoke") { revoke(l.id, str(b.reason, 200) || "switched off by admin", who); }
    else if (action === "restore") restore(l.id, who);
    else if (action === "release") { run("UPDATE licences SET account = '', account_server = '', account_name = '', bound_at = NULL WHERE id = ?", l.id); run("DELETE FROM feeds WHERE licence_id = ?", l.id); run("DELETE FROM trades WHERE licence_id = ?", l.id); audit(who, "licence released", l.key, maskAcc(l.account)); }
    else if (action === "extend") { const d = Math.max(1, Math.min(3650, Number(b.days) || 30)); run("UPDATE licences SET expires_at = MAX(COALESCE(expires_at, ?), ?) + ? WHERE id = ? AND expires_at IS NOT NULL", now(), now(), d * DAY, l.id); audit(who, "licence extended", l.key, d + " days"); }
    else if (action === "lifetime") { run("UPDATE licences SET plan = 'lifetime', expires_at = NULL WHERE id = ?", l.id); audit(who, "licence made lifetime", l.key); }
    else if (action === "note") { run("UPDATE licences SET note = ? WHERE id = ?", str(b.note, 500), l.id); }
    else if (action === "resend") { const o = one<Order>("SELECT * FROM orders WHERE licence_id = ? ORDER BY created_at LIMIT 1", l.id); if (o) await mailLicence(o, l); audit(who, "licence email resent", l.key); }
    else return bad("Unknown action", 404);
    return json(200, { ok: true });
  }

  if (p === "/orders") {
    const st = q("status"), m = q("method"), s = "%" + q("q").toLowerCase() + "%";
    return json(200, { ok: true, orders: all(`SELECT * FROM orders WHERE (? = '' OR status = ?) AND (? = '' OR method = ?) AND (lower(email) LIKE ? OR lower(id) LIKE ?) ORDER BY created_at DESC LIMIT 500`, st, st, m, m, s, s) });
  }
  if (p.startsWith("/order/") && post) {
    const [, , id, action] = p.split("/"), o = orderById(id);
    if (!o) return bad("Order not found", 404);
    if (action === "paid") {
      if (!["pending", "processing", "failed", "expired"].includes(o.status)) return bad("This order can't be marked as paid.");
      fulfil(o.id, { paymentRef: str(b.ref, 100) || "bank", actor: who });
      audit(who, "order marked paid", o.id, str(b.ref, 100));
    } else if (action === "refund") {
      try { await refundOrder(o, who); } catch (e: any) { return bad(e.message, 502); }
      run("UPDATE messages SET handled = 1 WHERE topic = 'refund' AND message LIKE ?", "%" + o.id + "%");
    } else if (action === "cancel") {
      if (o.status === "paid") return bad("Refund a paid order instead.");
      run("UPDATE orders SET status = 'cancelled' WHERE id = ?", o.id); audit(who, "order cancelled", o.id);
    } else return bad("Unknown action", 404);
    return json(200, { ok: true });
  }

  if (p === "/codes") {
    if (post) {
      const code = str(b.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, ""), kind = b.kind === "amount" ? "amount" : "percent";
      const value = kind === "percent" ? Math.max(1, Math.min(100, Math.round(Number(b.value)))) : Math.max(100, Math.round(Number(b.value) * 100));
      if (code.length < 3) return bad("Codes need at least 3 letters or numbers.");
      if (!Number.isFinite(value)) return bad("Enter the discount.");
      if (one("SELECT code FROM codes WHERE code = ?", code)) return bad("That code already exists.");
      const plansS = (Array.isArray(b.plans) ? b.plans : ["lifetime", "monthly"]).filter((x: string) => plans.has(x)).join(",") || "lifetime,monthly";
      run(`INSERT INTO codes (code, kind, value, plans, monthly_duration, max_uses, expires_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        code, kind, value, plansS, b.monthly_duration === "forever" ? "forever" : "once", Number(b.max_uses) > 0 ? Math.round(Number(b.max_uses)) : null,
        b.expires ? Date.parse(b.expires) || null : null, str(b.note, 200), who, now());
      audit(who, "code created", code, `${kind} ${value} ${plansS}`);
    }
    return json(200, { ok: true, codes: all(`SELECT c.*, (SELECT COALESCE(SUM(list_cents - amount_cents),0) FROM orders o WHERE o.code = c.code AND o.status = 'paid') given,
      (SELECT COALESCE(SUM(amount_cents),0) FROM orders o WHERE o.code = c.code AND o.status = 'paid') revenue FROM codes c ORDER BY created_at DESC`),
      prices: { lifetime: listPrice("lifetime"), monthly: listPrice("monthly") } });
  }
  if (p.startsWith("/code/") && post) {
    const code = decodeURIComponent(p.split("/")[2] || "");
    if (!one("SELECT code FROM codes WHERE code = ?", code)) return bad("Code not found", 404);
    if (typeof b.active === "boolean") run("UPDATE codes SET active = ? WHERE code = ?", b.active ? 1 : 0, code);
    if (b.delete === true) { if ((one<any>("SELECT uses FROM codes WHERE code = ?", code)).uses > 0) return bad("Used codes can only be switched off."); run("DELETE FROM codes WHERE code = ?", code); }
    audit(who, b.delete ? "code deleted" : b.active ? "code switched on" : "code switched off", code);
    return json(200, { ok: true });
  }

  if (p === "/live") {
    const rows = all<any>(`SELECT l.id, l.key, l.plan, l.account, l.account_server, l.account_demo, l.status, l.expires_at, l.last_seen, c.email, f.status, f.status_at, f.symbol,
      (SELECT COUNT(*) FROM trades t WHERE t.licence_id = l.id) trades, (SELECT COALESCE(SUM(net),0) FROM trades t WHERE t.licence_id = l.id) net,
      (SELECT COALESCE(SUM(points),0) FROM trades t WHERE t.licence_id = l.id) points
      FROM licences l JOIN customers c ON c.id = l.customer_id LEFT JOIN feeds f ON f.licence_id = l.id WHERE l.account != '' ORDER BY f.status_at DESC`);
    return json(200, { ok: true, serverNow: now(), accounts: rows.map((r) => { let st: any = null; try { st = r.status ? JSON.parse(r.status) : null; } catch {}
      return { id: r.id, key: r.key, plan: r.plan, email: r.email, account: r.account, server: r.account_server, demo: !!r.account_demo, symbol: r.symbol, licence: effective(r),
        online: !!r.status_at && r.status_at > now() - 20000, statusAt: r.status_at, lastSeen: r.last_seen, trades: r.trades, net: r.net, points: r.points,
        state: st?.ea?.state || "", balance: st?.balance, equity: st?.equity, currency: st?.currency || "USD", position: st?.position || null, today: st?.today || null }; }) });
  }

  if (p === "/messages") return json(200, { ok: true, messages: all("SELECT * FROM messages ORDER BY handled, at DESC LIMIT 300") });
  if (p.startsWith("/message/") && post) { run("UPDATE messages SET handled = ? WHERE id = ?", b.handled === false ? 0 : 1, p.split("/")[2]); return json(200, { ok: true }); }

  if (p === "/admins") {
    if (post) {
      if (!owner) return bad("Only the owner can add admins.", 403);
      const email = str(b.email, 200).toLowerCase(), name = str(b.name, 80) || email;
      if (!emailOk(email)) return bad("Enter a valid email address.");
      if (one("SELECT id FROM admins WHERE email = ?", email)) return bad("That admin already exists.");
      const secret = newTotpSecret(), id = newId("adm");
      run("INSERT INTO admins (id, email, name, role, totp_secret, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, email, name, b.role === "owner" ? "owner" : "admin", secret, now());
      audit(who, "admin added", email);
      const uri = otpauthUri(secret, email);
      return json(200, { ok: true, secret, uri, qr: await QRCode.toString(uri, { type: "svg", margin: 1, color: { dark: "#000000", light: "#ffffff" } }) });
    }
    return json(200, { ok: true, admins: all("SELECT id, email, name, role, active, last_login, created_at FROM admins ORDER BY created_at") });
  }
  if (p.startsWith("/admin/") && post) {
    if (!owner) return bad("Only the owner can change admins.", 403);
    const [, , id, action] = p.split("/"), t = one<Admin>("SELECT * FROM admins WHERE id = ?", id);
    if (!t) return bad("Admin not found", 404);
    if (t.id === a.id && action !== "reset") return bad("You can't change your own access here.");
    if (action === "disable") { run("UPDATE admins SET active = 0 WHERE id = ?", t.id); endAllSessions("admin", t.id); }
    else if (action === "enable") run("UPDATE admins SET active = 1 WHERE id = ?", t.id);
    else if (action === "reset") {
      const secret = newTotpSecret(); run("UPDATE admins SET totp_secret = ?, last_step = 0 WHERE id = ?", secret, t.id); endAllSessions("admin", t.id);
      audit(who, "admin authenticator reset", t.email);
      const uri = otpauthUri(secret, t.email);
      return json(200, { ok: true, secret, uri, qr: await QRCode.toString(uri, { type: "svg", margin: 1 }) });
    } else return bad("Unknown action", 404);
    audit(who, "admin " + action, t.email);
    return json(200, { ok: true });
  }

  if (p === "/settings") {
    const editable = ["price_lifetime", "price_monthly", "mail_from", "support_email", "notify_emails", "bank_name", "bank_holder", "bank_iban", "bank_bic",
      "seller_name", "seller_address", "seller_vat", "seller_reg", "record_public", "record_min_trades", "stripe_tax", "methods_card", "methods_crypto", "methods_bank",
      "refund_days", "move_days", "announcement", "site_url", "ea_version", "promo_code", "record_verify_url",
      "chat_enabled", "chat_ai", "chat_model", "chat_daily_cap", "chat_greeting", "hub_public",
      "journal_public", "journal_ai_credits", "journal_ai_model", "price_journal"];
    if (post) {
      if (!owner) return bad("Only the owner can change settings.", 403);
      for (const k of editable) if (b[k] !== undefined) {
        let v = str(b[k], 600);
        if (k.startsWith("price_")) { const n = Math.round(Number(v) * 100); if (!(n >= 100)) return bad("Prices must be at least €1."); v = String(n); }
        if (k === "promo_code") v = v.toUpperCase().replace(/\s+/g, "");
        setS(k, v);
      }
      audit(who, "settings changed", "", Object.keys(b).filter((k) => editable.includes(k)).join(", "));
    }
    const out: Record<string, string> = {};
    for (const k of editable) out[k] = getS(k);
    return json(200, { ok: true, settings: out, connected: { stripe: !!getS("stripe_secret"), stripe_webhook: !!getS("stripe_webhook_secret"), np: !!getS("np_api_key"),
      np_ipn: !!getS("np_ipn_secret"), resend: mailConfigured(), anthropic: !!getS("anthropic_key") }, webhooks: { stripe: siteUrl() + "/webhooks/stripe", nowpayments: siteUrl() + "/webhooks/nowpayments" } });
  }
  if (p === "/integrations" && post) {
    if (!owner) return bad("Only the owner can connect payment accounts.", 403);
    try {
      if (b.stripe_secret) { const r = await connectStripe(str(b.stripe_secret, 300)); audit(who, "Stripe connected", r.account, r.live ? "live" : "test"); return json(200, { ok: true, stripe: r }); }
      if (b.np_api_key !== undefined || b.np_ipn_secret !== undefined) {
        if (b.np_api_key) setS("np_api_key", str(b.np_api_key, 200));
        if (b.np_ipn_secret) setS("np_ipn_secret", str(b.np_ipn_secret, 200));
        audit(who, "NOWPayments connected"); return json(200, { ok: true });
      }
      if (b.resend_key) { setS("resend_key", str(b.resend_key, 200)); audit(who, "Resend connected"); return json(200, { ok: true }); }
      if (b.anthropic_key) { const k = str(b.anthropic_key, 300); await testAnthropicKey(k); setS("anthropic_key", k); audit(who, "AI chat connected"); return json(200, { ok: true }); }
      if (b.disconnect && SECRET_KEYS.has(b.disconnect)) { setS(b.disconnect, ""); audit(who, "disconnected", b.disconnect); return json(200, { ok: true }); }
    } catch (e: any) { return bad(e.message, 502); }
    return bad("Nothing to connect.");
  }
  if (p === "/test-email" && post) {
    const ok = await sendMail(a.email, "GoldenStraddler test email", "<p>Email is working.</p>");
    return ok ? json(200, { ok: true }) : bad("The email wasn't sent. Check the Resend key and that the domain is verified in Resend.", 502);
  }
  if (p === "/audit") return json(200, { ok: true, audit: all("SELECT * FROM audit ORDER BY id DESC LIMIT 400") });
  if (p === "/export") {
    if (!owner) return bad("Only the owner can download backups.", 403);
    const tmp = join(DB_PATH, "..", `backup-${Date.now()}.db`);
    backupTo(tmp); audit(who, "backup downloaded");
    const data = await Bun.file(tmp).arrayBuffer();
    try { (await import("node:fs")).unlinkSync(tmp); } catch {}
    return new Response(data, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="goldenstraddler-${new Date().toISOString().slice(0, 10)}.db"`, "Cache-Control": "no-store" } });
  }
  return bad("Not found", 404);
}

// ================================================================ background jobs
async function hourly() {
  try {
    const t = now();
    // crypto/bank monthly licences: remind 5 days before the paid period ends
    const due = all<Licence & { email: string }>(`SELECT l.*, c.email FROM licences l JOIN customers c ON c.id = l.customer_id WHERE l.plan IN ('monthly', 'journal') AND l.stripe_sub = ''
      AND l.status = 'active' AND l.expires_at BETWEEN ? AND ? AND (l.reminded_at IS NULL OR l.reminded_at < l.expires_at - ?)`, t, t + 8 * DAY, 9 * DAY);
    for (const l of due) { await mailExpiring(l.email, l, siteUrl() + "/account"); run("UPDATE licences SET reminded_at = ? WHERE id = ?", t, l.id); }
    // abandoned orders
    run("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND method IN ('card','crypto') AND created_at < ?", t - 2 * DAY);
    run("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND method = 'bank' AND created_at < ?", t - 14 * DAY);
    run("DELETE FROM login_codes WHERE expires_at < ?", t);
    run("DELETE FROM events WHERE at < ?", t - 60 * DAY);
    // Monday's journal email, once the journal is open to customers
    if (journalOpen()) await weeklyDigests(t);
  } catch (e: any) { console.error("hourly:", e.message); }
}
setInterval(hourly, 3_600_000);

// ================================================================ start
bootstrapOwner();
const server = Bun.serve({ port: PORT, hostname: "0.0.0.0", idleTimeout: 120,
  fetch: (req) => handle(req).catch(err) });
console.log(`goldenstraddler.com on :${server.port} | db ${DB_PATH} | stripe ${getS("stripe_secret") ? "on" : "off"} | crypto ${getS("np_api_key") ? "on" : "off"} | email ${mailConfigured() ? "on" : "off"}${DEV ? " | DEV" : ""}`);
hourly();
startHub();
