// Markets hub: filter by asset class, open briefs on phones, copy a brief as a Telegram post, local times and countdowns.
(() => {
"use strict";
document.documentElement.classList.add("js");
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const toastEl = document.getElementById("toast");
let toastT = 0;
function toast(msg) { if (!toastEl) return; toastEl.textContent = msg; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2600); }

// times in the visitor's own time zone
const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
$$("time[data-utc]").forEach((t) => { t.textContent = fmt.format(new Date(Number(t.dataset.utc) * 1000)); });
const cds = $$("[data-cd]");
function tick() {
  const n = Date.now() / 1000;
  for (const c of cds) {
    const d = Number(c.dataset.cd) - n;
    c.textContent = d <= -600 ? "" : d <= 0 ? "Out now" : d < 3600 ? `in ${Math.ceil(d / 60)} min` : d < 86400 ? `in ${Math.floor(d / 3600)} h ${Math.floor((d % 3600) / 60)} min` : `in ${Math.floor(d / 86400)} d ${Math.floor((d % 86400) / 3600)} h`;
  }
}
if (cds.length) { tick(); setInterval(tick, 30000); }

// filter tabs
const tabs = $$(".mk-tabs [data-f]");
function filter(f) {
  tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.f === f)));
  $$(".mk-grid, .mk-cls").forEach((g) => (g.hidden = f !== "all" && g.dataset.cls !== f));
  $$(".board tbody tr").forEach((r) => (r.hidden = f !== "all" && r.dataset.cls !== f));
}
tabs.forEach((b, i) => {
  b.addEventListener("click", () => filter(b.dataset.f));
  b.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
    e.preventDefault(); const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); filter(n.dataset.f);
  });
});

// phones: a button to open each brief
$$(".bf:not(.full)").forEach((bf) => {
  const nFor = $$(".pro li", bf).length, nAg = $$(".con li", bf).length;
  const b = document.createElement("button");
  b.type = "button"; b.className = "btn sm bf-more"; b.setAttribute("aria-expanded", "false");
  const label = () => (bf.classList.contains("open") ? "Hide the data" : `Show the data${nFor + nAg ? ` (${nFor + nAg} points)` : ""}`);
  b.textContent = label();
  b.addEventListener("click", () => { bf.classList.toggle("open"); b.setAttribute("aria-expanded", String(bf.classList.contains("open"))); b.textContent = label(); });
  bf.querySelector(".bf-v").after(b);
});
// a link to #gold opens that brief
function openHash() { const t = location.hash && document.getElementById(location.hash.slice(1)); if (t && t.classList.contains("bf")) { t.classList.add("open"); const b = t.querySelector(".bf-more"); if (b) { b.setAttribute("aria-expanded", "true"); b.textContent = "Hide the data"; } } }
addEventListener("hashchange", openHash); openHash();

// copy as a Telegram post
$$("[data-copy]").forEach((btn) => btn.addEventListener("click", async () => {
  const t = btn.closest(".bf").querySelector("template.bf-post"), text = t ? t.content.textContent.trim() : "";
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into Telegram."); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.append(ta); ta.select();
    try { document.execCommand("copy"); toast("Copied. Paste it into Telegram."); } catch { toast("Couldn't copy here. Select the text and copy it instead."); }
    ta.remove();
  }
}));
})();
