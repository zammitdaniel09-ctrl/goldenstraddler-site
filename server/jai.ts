/*
 * GoldenStraddler Journal: the AI coach. It answers from the trader's own numbers by calling tools that run the same
 * statistics engine as the screen (web/js/jstats.js), so every figure it quotes can be found in the journal.
 */
import { all, now, one, run } from "./db";
import { E, bad, getS, json, limited, newId, str } from "./util";
import { MODELS } from "./chat";
import { aiUsage, eventsBetween, prefsOf, tradesOf } from "./journal";
import type { Customer } from "./licence";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JS = require("../web/js/jstats.js");

const CREDITS = { ask: 1, review: 1, report: 4 };
const model = () => (MODELS[getS("journal_ai_model")] ? getS("journal_ai_model") : "claude-sonnet-5-5");
const r2 = (x: any) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 100) / 100 : x === Infinity ? "infinite" : x ?? null);
const J = (x: any) => { try { return JSON.parse(x); } catch { return null; } };

// ---------------------------------------------------------------- the trader's data, prepared once per request
function context(c: Customer) {
  const prefs = prefsOf(c.id), raw = tradesOf(c.id);
  const tags = all<any>("SELECT id, name, kind FROM j_tags WHERE customer_id = ?", c.id), pbs = all<any>("SELECT id, name, rules FROM j_playbooks WHERE customer_id = ?", c.id);
  const accs = all<any>("SELECT id, name, currency, balance_start FROM j_accounts WHERE customer_id = ?", c.id);
  const tagName = new Map(tags.map((t) => [t.id, t.name])), pbName = new Map(pbs.map((p) => [p.id, p.name])), accName = new Map(accs.map((a) => [a.id, a.name]));
  const span = raw.length ? [Math.min(...raw.map((t: any) => t.ot)), Math.max(...raw.map((t: any) => t.ot))] : [0, 0];
  const events = raw.length ? eventsBetween(c.id, span[0] - 86400000, span[1] + 86400000) : [];
  const trades = JS.enrich(raw.map((t: any) => ({ ...t, tags: t.tags.map((g: string) => tagName.get(g) || g), pb: t.pb ? pbName.get(t.pb) || t.pb : null, a: accName.get(t.a) || t.a })), { tz: prefs.tz, dayStart: prefs.dayStart, be: prefs.be, events });
  return { cid: c.id, prefs, trades, tags, pbs, accs, start: accs.reduce((s, a) => s + (a.balance_start || 0), 0) };
}
type Ctx = ReturnType<typeof context>;
function applyFilters(cx: Ctx, f: any = {}) {
  const day = (s: any, end = false) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s || "")); if (!m) return undefined; return Date.UTC(+m[1], +m[2] - 1, +m[3]) + (end ? 86400000 : 0); };
  return JS.filter(cx.trades, { account: f.account || undefined, from: day(f.from), to: day(f.to, true), symbols: f.symbols, side: f.side, outcome: f.outcome, tags: f.tags, playbook: f.setup || undefined,
    weekday: f.weekday, hourFrom: f.hourFrom, hourTo: f.hourTo });
}
const tradeLine = (t: any) => ({ id: t.id, symbol: t.s, side: t.d > 0 ? "long" : "short", lots: t.v, opened: new Date(t.ot).toISOString().slice(0, 16).replace("T", " "), minutes: Math.round(t.dur / 60000),
  entry: t.op, exit: t.cp, stop: t.sl, net: r2(t.net), r: r2(t.r), mae_r: r2(t.maeR), mfe_r: r2(t.mfeR), setup: t.pb, tags: t.tags, rating: t.rt, account: t.a, release: t.ev ? `${JS.eventName(t.ev.n, t.ev.c)} (${t.ev.min >= 0 ? t.ev.min + " min after" : -t.ev.min + " min before"})` : undefined, note: t.note ? String(t.note).slice(0, 400) : undefined });
function summaryOut(s: any) {
  const o: any = {};
  for (const [k, v] of Object.entries(s)) if (typeof v !== "object" || v === null) o[k] = r2(v);
  o.streak = s.streak; o.bestDay = s.bestDay && { day: s.bestDay.day, net: r2(s.bestDay.net) }; o.worstDay = s.worstDay && { day: s.worstDay.day, net: r2(s.worstDay.net) };
  o.from = s.from ? new Date(s.from).toISOString().slice(0, 10) : null; o.to = s.to ? new Date(s.to).toISOString().slice(0, 10) : null;
  return o;
}

// ---------------------------------------------------------------- tools the coach can call
const FILTERS = { type: "object", description: "Optional filters. Dates are YYYY-MM-DD in the trader's time zone, to is inclusive.", properties: {
  account: { type: "string", description: "Account name" }, from: { type: "string" }, to: { type: "string" }, symbols: { type: "array", items: { type: "string" } },
  side: { type: "string", enum: ["long", "short"] }, outcome: { type: "string", enum: ["win", "loss"] }, tags: { type: "array", items: { type: "string" }, description: "Tag names" },
  setup: { type: "string", description: "Setup (playbook) name" }, weekday: { type: "integer", description: "0 = Monday ... 6 = Sunday" }, hourFrom: { type: "integer" }, hourTo: { type: "integer" } } };
const TOOLS = [
  { name: "summary", description: "Headline statistics for a set of trades: count, win rate, net, profit factor, average win and loss, expectancy in money and R, drawdown, streaks, Sharpe, SQN, Kelly, costs, best and worst day, consistency.", input_schema: { type: "object", properties: { filters: FILTERS } } },
  { name: "breakdown", description: "The same statistics split by one dimension, to find where results come from and where they leak.", input_schema: { type: "object", required: ["dimension"], properties: {
    dimension: { type: "string", enum: Object.keys(JS.DIMS) }, filters: FILTERS } } },
  { name: "trades", description: "List individual trades with their notes, tags, setup and R. Use to look at examples behind a pattern.", input_schema: { type: "object", properties: {
    filters: FILTERS, sort: { type: "string", enum: ["recent", "best", "worst", "biggest_r", "worst_r", "longest", "largest_size"] }, limit: { type: "integer", description: "Up to 25" } } } },
  { name: "daily", description: "Profit and loss per trading day, with the trader's own notes for that day if any.", input_schema: { type: "object", properties: { filters: FILTERS, limit: { type: "integer", description: "Most recent days, up to 60" } } } },
  { name: "discipline", description: "Check the trader's own rules (daily loss limit, max trades, max risk, stop loss required, stop after losses, trading hours, revenge trades) and what breaking them cost.", input_schema: { type: "object", properties: { filters: FILTERS } } },
  { name: "excursions", description: "Maximum adverse and favourable excursion (MAE/MFE) in R: how far trades went against and for the trader, stop and exit quality.", input_schema: { type: "object", properties: { filters: FILTERS } } },
  { name: "monte_carlo", description: "Resample the trader's own results to show the likely range of outcomes and drawdowns over the next N trades.", input_schema: { type: "object", properties: { filters: FILTERS, trades_ahead: { type: "integer" } } } },
  { name: "hour_weekday", description: "Results by hour opened and weekday, returning the strongest and weakest time slots with at least 3 trades.", input_schema: { type: "object", properties: { filters: FILTERS } } },
];
function runTool(cx: Ctx, name: string, input: any) {
  const ts = applyFilters(cx, input?.filters);
  switch (name) {
    case "summary": return ts.length ? summaryOut(JS.summary(ts, { start: cx.start })) : { n: 0, note: "No trades match." };
    case "breakdown": { const g = JS.group(ts, input.dimension); return { dimension: g.label, rows: g.rows.slice(0, 40).map((r: any) => ({ key: r.key, trades: r.n, winRate: r2(r.winRate), net: r2(r.net), pf: r2(r.pf), expectancy: r2(r.expectancy), expR: r2(r.expR), avgWin: r2(r.avgWin), avgLoss: r2(r.avgLoss) })) }; }
    case "trades": {
      const s = input.sort || "recent", k: Record<string, (a: any, b: any) => number> = { recent: (a, b) => b.ct - a.ct, best: (a, b) => b.net - a.net, worst: (a, b) => a.net - b.net,
        biggest_r: (a, b) => (b.r ?? -1e9) - (a.r ?? -1e9), worst_r: (a, b) => (a.r ?? 1e9) - (b.r ?? 1e9), longest: (a, b) => b.dur - a.dur, largest_size: (a, b) => b.v - a.v };
      return { total: ts.length, trades: [...ts].sort(k[s] || k.recent).slice(0, Math.min(25, Math.max(1, input.limit || 10))).map(tradeLine) };
    }
    case "daily": {
      const ds = JS.days(ts).slice(-Math.min(60, Math.max(1, input.limit || 30)));
      const cut = (x: string) => (x ? String(x).slice(0, 300) : undefined);
      const notes = new Map(all<any>("SELECT day, plan, review, lessons, mood, grade FROM j_days WHERE customer_id = ?", cx.cid).map((d) => [d.day, { plan: cut(d.plan), review: cut(d.review), lessons: cut(d.lessons), mood: d.mood ?? undefined, grade: d.grade ?? undefined }]));
      return { days: ds.map((d: any) => ({ day: d.day, net: r2(d.net), trades: d.n, wins: d.wins, losses: d.losses, r: r2(d.r), ...(notes.get(d.day) || {}) })) };
    }
    case "discipline": { const r = JS.rules(ts, { ...cx.prefs.rules, tz: cx.prefs.tz }); return { rules: cx.prefs.rules, score: r.score, cleanDays: r.cleanDays, days: r.days, brokenTrades: r.brokenTrades, costOfBrokenTrades: r2(r.cost), recent: r.list.slice(0, 15).map((v: any) => v.text) }; }
    case "excursions": { const x = JS.excursions(ts); if (!x) return { note: "Not enough trades with stop loss and excursion data (needs the MT5 connector, which records MAE and MFE)." }; const { points, ...rest } = x; return JSON.parse(JSON.stringify(rest, (_k, v) => r2(v))); }
    case "monte_carlo": { const m = JS.monteCarlo(ts, { start: cx.start, len: Math.min(1000, Math.max(20, input.trades_ahead || 100)) }); if (!m) return { note: "Needs at least 10 trades." }; const { paths, ...rest } = m; return JSON.parse(JSON.stringify(rest, (_k, v) => r2(v))); }
    case "hour_weekday": {
      const g = JS.heat(ts), cells: any[] = [];
      g.forEach((row: any[], wd: number) => row.forEach((c, h) => { if (c.n >= 3) cells.push({ slot: `${JS.WD[wd]} ${String(h).padStart(2, "0")}:00`, trades: c.n, net: r2(c.net), winRate: r2(c.wins / Math.max(1, c.wins + c.losses)) }); }));
      cells.sort((a, b) => b.net - a.net);
      return { strongest: cells.slice(0, 6), weakest: cells.slice(-6).reverse() };
    }
  }
  return { error: "unknown tool" };
}

// ---------------------------------------------------------------- the model call, with tools
const RULES = (cx: Ctx) => `You are the performance coach inside GoldenStraddler Journal, a trading journal. You talk to one trader about their own trading records.

How you work:
- Get every number from the tools. Never estimate, round loosely or make up a figure, a trade or a date. If the data can't answer, say what's missing (for example R needs stop losses, MAE/MFE needs the MT5 connector).
- Look before you conclude: check a pattern with a breakdown, then look at a few example trades with their notes.
- Small samples mislead. Say how many trades a finding rests on, and call anything under about 20 trades a hint, not a finding.
- Coach the process, not the market: entries, exits, stops, size, timing, rules, emotions and habits. Never say what a market will do, never recommend buying or selling anything, and don't give personal financial advice.
- Be direct and specific, like a good trading mentor: name the leak, put a number on it, and give one concrete thing to do about it.
- Money is in ${cx.accs[0]?.currency || "USD"}. Times are in ${cx.prefs.tz}. Today is ${new Date().toISOString().slice(0, 10)}.
- Write plain text with short paragraphs. Use "- " for lists and **bold** for the key numbers. Use "### " headings only in reports. No tables, no emojis.
- The trader has ${cx.trades.length} trades across ${cx.accs.length} account(s): ${cx.accs.map((a) => a.name).join(", ") || "none yet"}. Setups: ${cx.pbs.map((p) => p.name).join(", ") || "none"}. Tags: ${cx.tags.map((t) => t.name).join(", ") || "none"}.
- Their rules: ${JSON.stringify(cx.prefs.rules)}.
- High-impact news: trades are matched to high-impact releases (opened 15 minutes before to 30 minutes after one, for the symbol's currencies). Use the "news" and "event" breakdowns for questions about trading the news. "No news data" means the release calendar doesn't cover that period yet.`;

async function callModel(system: string, messages: any[], cx: Ctx, maxTokens: number) {
  const key = getS("anthropic_key");
  if (!key) throw Object.assign(new Error("The AI coach isn't connected yet."), { code: 503 });
  let tin = 0, tout = 0, cost = 0;
  const p = MODELS[model()];
  for (let i = 0; i < 9; i++) {
    const r = await fetch(E.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: model(), max_tokens: maxTokens, system: [{ type: "text", text: system }], tools: i < 8 ? TOOLS : undefined, messages }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error("The AI coach couldn't answer just now. Try again in a minute."), { code: 502, detail: JSON.stringify(j).slice(0, 300) });
    const u = j.usage || {};
    tin += u.input_tokens || 0; tout += u.output_tokens || 0; cost += Math.round((u.input_tokens || 0) * p.inUsd + (u.output_tokens || 0) * p.outUsd);
    const content = Array.isArray(j.content) ? j.content : [];
    const uses = content.filter((b: any) => b.type === "tool_use");
    if (j.stop_reason !== "tool_use" || !uses.length) {
      const text = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      return { text: text || "I couldn't put an answer together. Try asking another way.", tin, tout, cost };
    }
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: uses.map((b: any) => {
      let out: any; try { out = runTool(cx, b.name, b.input || {}); } catch (e: any) { out = { error: e.message }; }
      return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out).slice(0, 60000) };
    }) });
  }
  return { text: "That needed more digging than I can do in one go. Try a narrower question.", tin, tout, cost };
}

function spend(c: Customer, kind: keyof typeof CREDITS) {
  const u = aiUsage(c.id);
  if (u.left < CREDITS[kind]) throw Object.assign(new Error(`You've used this month's ${u.cap} AI credits. They reset on ${new Date(u.resets).toISOString().slice(0, 10)}.`), { code: 402 });
  if (limited("jai:" + c.id, 20, 600_000)) throw Object.assign(new Error("That's a lot of questions at once. Give it a few minutes."), { code: 429 });
}
const save = (cid: string, kind: string, o: { thread?: string; role?: string; title?: string; content: string; scope?: any; credits?: number; cost?: number }) => {
  const id = newId("jx");
  run("INSERT INTO j_ai (id, customer_id, kind, thread, role, title, content, scope, credits, cost_micro, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, cid, kind, o.thread || "", o.role || "", o.title || "", o.content, JSON.stringify(o.scope || {}), o.credits || 0, o.cost || 0, now());
  return id;
};

// ---------------------------------------------------------------- routes
export async function journalAi(req: Request, p: string, c: Customer, b: () => Promise<any>): Promise<Response> {
  const post = req.method === "POST";
  try {
    if (p === "/api/journal/ai/list") {
      const rows = all<any>("SELECT id, kind, thread, role, title, content, scope, created_at FROM j_ai WHERE customer_id = ? ORDER BY created_at DESC LIMIT 400", c.id);
      const threads = new Map<string, any>();
      for (const r of rows) if (r.kind === "chat") { const t = threads.get(r.thread) || { thread: r.thread, title: "", last: r.created_at, n: 0 }; t.n++; if (r.role === "user") t.title = r.content.slice(0, 80); threads.set(r.thread, t); }
      return json(200, { ok: true, usage: aiUsage(c.id), connected: !!getS("anthropic_key"),
        threads: [...threads.values()].slice(0, 40), reports: rows.filter((r) => r.kind === "report").slice(0, 40).map((r) => ({ id: r.id, title: r.title, created_at: r.created_at, scope: J(r.scope) })),
        reviews: rows.filter((r) => r.kind === "review").map((r) => ({ id: r.id, trade: J(r.scope)?.trade, content: r.content, created_at: r.created_at })) });
    }
    let m = /^\/api\/journal\/ai\/thread\/(jx_[a-z0-9]+|t_[a-z0-9]+)$/.exec(p);
    if (m) return json(200, { ok: true, messages: all("SELECT id, role, content, created_at FROM j_ai WHERE customer_id = ? AND kind = 'chat' AND thread = ? ORDER BY created_at", c.id, m[1]) });
    m = /^\/api\/journal\/ai\/item\/(jx_[a-z0-9]+)$/.exec(p);
    if (m) { const r = one<any>("SELECT id, kind, title, content, scope, created_at FROM j_ai WHERE customer_id = ? AND id = ?", c.id, m[1]); return r ? json(200, { ok: true, item: { ...r, scope: J(r.scope) } }) : bad("Not found", 404); }

    if (p === "/api/journal/ai/ask" && post) {
      const x = await b(), q = str(x.message, 2000);
      if (q.length < 2) return bad("Ask a question first.");
      spend(c, "ask");
      const thread = /^t_[a-z0-9]{6,20}$/.test(str(x.thread, 24)) ? str(x.thread, 24) : "t_" + newId("x").slice(2, 14);
      const cx = context(c);
      const past = all<any>("SELECT role, content FROM j_ai WHERE customer_id = ? AND kind = 'chat' AND thread = ? ORDER BY created_at DESC LIMIT 12", c.id, thread).reverse();
      const scope = x.filters && typeof x.filters === "object" ? `\n(The screen is filtered to: ${JSON.stringify(x.filters).slice(0, 400)}. Use the same filters unless the question asks for something else.)` : "";
      const msgs = [...past.map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: r.content })), { role: "user", content: q + scope }];
      const out = await callModel(RULES(cx), msgs, cx, 1400);
      save(c.id, "chat", { thread, role: "user", content: q, credits: CREDITS.ask });
      save(c.id, "chat", { thread, role: "assistant", content: out.text, cost: out.cost });
      return json(200, { ok: true, thread, answer: out.text, usage: aiUsage(c.id) });
    }
    if (p === "/api/journal/ai/report" && post) {
      const x = await b(), cx = context(c);
      const period = ["week", "month", "quarter", "all", "custom"].includes(x.period) ? x.period : "week";
      const today = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10);
      let from = "", to = iso(today), title = "";
      if (period === "week") { const d = new Date(today); d.setUTCDate(d.getUTCDate() - 6); from = iso(d); title = "Weekly review"; }
      else if (period === "month") { const d = new Date(today); d.setUTCDate(d.getUTCDate() - 29); from = iso(d); title = "Monthly review"; }
      else if (period === "quarter") { const d = new Date(today); d.setUTCDate(d.getUTCDate() - 89); from = iso(d); title = "Quarterly review"; }
      else if (period === "custom") { from = /^\d{4}-\d\d-\d\d$/.test(str(x.from, 10)) ? str(x.from, 10) : ""; to = /^\d{4}-\d\d-\d\d$/.test(str(x.to, 10)) ? str(x.to, 10) : to; title = "Review"; }
      else title = "Full history review";
      const f = { from: from || undefined, to, account: x.account ? str(x.account, 60) : undefined };
      const n = applyFilters(cx, f).length;
      if (n < 3) return bad("There need to be at least 3 trades in that period for a review.");
      spend(c, "report");
      const ask = `Write my ${title.toLowerCase()} for ${from ? from + " to " + to : "my whole history"}${f.account ? " on the account " + f.account : ""} (${n} trades). Use these filters in every tool call: ${JSON.stringify(f)}.
Structure it exactly like this:
### The numbers
Three to five lines with the key results, each compared with my history before this period where that's telling.
### What worked
The two or three strongest patterns, each with its number and sample size.
### Where it leaked
The two or three most expensive habits or conditions, with what they cost.
### Discipline
How well I kept my own rules and what breaking them cost.
### Next ${period === "week" ? "week" : "period"}
Three specific, measurable rules to follow, each tied to a finding above.`;
      const out = await callModel(RULES(cx), [{ role: "user", content: ask }], cx, 2600);
      const id = save(c.id, "report", { title: `${title}${from ? `, ${from} to ${to}` : ""}`, content: out.text, scope: f, credits: CREDITS.report, cost: out.cost });
      return json(200, { ok: true, id, title, content: out.text, usage: aiUsage(c.id) });
    }
    if (p === "/api/journal/ai/review" && post) {
      const x = await b(), cx = context(c), t = cx.trades.find((tr: any) => tr.id === str(x.trade, 40));
      if (!t) return bad("Trade not found.", 404);
      spend(c, "review");
      const ask = `Review this one trade of mine and keep it under 180 words. First get my numbers for the same symbol and, if it has one, the same setup, so you can say whether it was typical for me.
Then: was the entry, the stop, the size and the exit sound given my own history; what did I do well; and one thing to do differently next time.
Trade: ${JSON.stringify(tradeLine(t))}`;
      const out = await callModel(RULES(cx), [{ role: "user", content: ask }], cx, 900);
      run("DELETE FROM j_ai WHERE customer_id = ? AND kind = 'review' AND scope = ?", c.id, JSON.stringify({ trade: t.id }));
      save(c.id, "review", { content: out.text, scope: { trade: t.id }, credits: CREDITS.review, cost: out.cost });
      return json(200, { ok: true, content: out.text, usage: aiUsage(c.id) });
    }
    if (p.startsWith("/api/journal/ai/delete/") && post) {
      const id = p.slice("/api/journal/ai/delete/".length);
      if (/^t_[a-z0-9]+$/.test(id)) run("DELETE FROM j_ai WHERE customer_id = ? AND kind = 'chat' AND thread = ?", c.id, id);
      else if (/^jx_[a-z0-9]+$/.test(id)) run("DELETE FROM j_ai WHERE customer_id = ? AND id = ? AND kind != 'chat'", c.id, id);
      return json(200, { ok: true });
    }
  } catch (e: any) {
    if (e.detail) console.error("journal ai:", e.detail);
    return bad(e.message || "Something went wrong.", e.code || 500);
  }
  return bad("Unknown route", 404);
}
