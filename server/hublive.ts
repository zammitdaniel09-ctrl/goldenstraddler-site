/*
 * Markets hub, live prices between the weekly calls. Free and keyless:
 * gold-api.com for metals and crypto, Kraken's public ticker for the forex pairs it lists.
 * Polled once a minute. A 24 hour buffer of 5 minute bars feeds the hourly candles, and each market's
 * running daily candle is saved, so markets without free candle history build their own real highs and lows.
 */
import { E } from "./util";
import { kvGet, kvSet, ohlc, putOhlc, putSeries, type Bar } from "./hubdata";

type Q = { p: number; t: number; src: string };
const GA: Record<string, string> = { gold: "XAU", silver: "XAG", platinum: "XPT", copper: "HG", btc: "BTC", eth: "ETH" };
const KR: Record<string, string> = { eurusd: "EURUSD", gbpusd: "GBPUSD", usdjpy: "USDJPY", usdcad: "USDCAD", usdchf: "USDCHF", audusd: "AUDUSD", nzdusd: "NZDUSD" };
const URL_GA = E.HUB_GA || "https://api.gold-api.com", URL_KR = E.HUB_KR || "https://api.kraken.com";
export const quotes = new Map<string, Q>();
// 5 minute bars: [start (unix s), open, high, low, close]
type B5 = [number, number, number, number, number];
const buf = new Map<string, B5[]>();
let saved = 0, lastErr = "", krOk: string[] | null = null;
try {
  const o = JSON.parse(kvGet("live_buf") || "{}");
  for (const [k, v] of Object.entries(o)) if (Array.isArray(v)) buf.set(k, (v as number[][]).map((x) => (x.length >= 5 ? x : [x[0], x[1], x[1], x[1], x[1]]) as B5));
} catch {}
const days = new Map<string, Bar>();                                          // today's candle for each market
const today = (t: number) => new Date(t).toISOString().slice(0, 10);

function keep(id: string, p: number, src: string) {
  if (!(p > 0)) return;
  const t = Date.now(); quotes.set(id, { p, t, src });
  const b = buf.get(id) || [], s = Math.floor(t / 1000), slot = s - (s % 300), last = b[b.length - 1];
  if (last && last[0] === slot) { last[2] = Math.max(last[2], p); last[3] = Math.min(last[3], p); last[4] = p; }
  else b.push([slot, p, p, p, p]);
  while (b.length && b[0][0] < s - 86400 - 600) b.shift();
  buf.set(id, b);
  // the daily candle; after a restart it carries on from the saved one
  const d = today(t); let dc = days.get(id);
  if (!dc || dc.d !== d) { const was = ohlc("live:" + id, d)[0]; dc = was && was.d === d ? { ...was } : { d, o: p, h: p, l: p, c: p }; days.set(id, dc); }
  dc.h = Math.max(dc.h, p); dc.l = Math.min(dc.l, p); dc.c = p;
  putOhlc("live:" + id, [dc]);
}
async function get(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "GoldenStraddler-Markets/1" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json() as any;
}
async function poll() {
  const errs: string[] = [];
  for (const [id, sym] of Object.entries(GA)) {
    try { const j = await get(`${URL_GA}/price/${sym}`); keep(id, Number(j && j.price), "gold-api"); if (Number(j?.price) > 0) putSeries("spot:" + sym, [[new Date().toISOString().slice(0, 10), Number(j.price)]]); }
    catch (e: any) { errs.push(sym + " " + e.message); }
    await Bun.sleep(150);
  }
  try {
    // one unknown pair makes Kraken reject the whole request, so find the ones it lists once, then ask for those
    if (!krOk) {
      krOk = [];
      for (const pair of Object.values(KR)) { try { const t = await get(`${URL_KR}/0/public/Ticker?pair=${pair}`); if (t?.result && Object.keys(t.result).length) krOk.push(pair); } catch {} await Bun.sleep(200); }
      console.log("hub live: Kraken lists " + (krOk.join(", ") || "none of our pairs"));
    }
    if (!krOk.length) throw new Error("no pairs");
    const j = await get(`${URL_KR}/0/public/Ticker?pair=${krOk.join(",")}`);
    if (j && Array.isArray(j.error) && j.error.length && !j.result) { krOk = null; throw new Error(j.error.join(", ")); }
    for (const [k, v] of Object.entries<any>(j?.result || {})) {
      const norm = k.replace(/^[XZ]([A-Z]{3})[XZ]([A-Z]{3})$/, "$1$2");
      const id = Object.keys(KR).find((x) => KR[x] === norm);
      if (id && v && Array.isArray(v.c)) keep(id, Number(v.c[0]), "Kraken");
    }
  } catch (e: any) { errs.push("kraken " + e.message); }
  const msg = errs.join("; ");
  if (msg && msg !== lastErr) console.error("hub live", msg);
  lastErr = msg;
  if (Date.now() - saved > 600_000) { saved = Date.now(); kvSet("live_buf", JSON.stringify(Object.fromEntries(buf))); }
}
export function startLive() {
  if (E.HUB_OFF === "1") return;
  setTimeout(poll, 5000);
  setInterval(poll, 60_000);
}
// the last 24 hours as hourly candles
export function intraday(id: string) {
  const b = buf.get(id) || [], out: { t: number; o: number; h: number; l: number; c: number }[] = [];
  for (const x of b) {
    const hr = x[0] - (x[0] % 3600), cur = out[out.length - 1];
    if (cur && cur.t === hr) { cur.h = Math.max(cur.h, x[2]); cur.l = Math.min(cur.l, x[3]); cur.c = x[4]; }
    else out.push({ t: hr, o: cur ? cur.c : x[1], h: Math.max(x[2], cur ? cur.c : x[1]), l: Math.min(x[3], cur ? cur.c : x[1]), c: x[4] });
  }
  return out.slice(-24);
}
export function day(id: string) {
  const b = buf.get(id) || [], s = Date.now() / 1000, old = b.find((x) => x[0] >= s - 86400 - 300);
  return old && s - old[0] >= 23 * 3600 ? old[1] : null;
}
