// Colour themes: the visitor picks one, it's remembered on this device, and every page applies it
// before it paints (a tiny inline script in each page's head reads the same key).
(() => {
"use strict";
const KEY = "gs-theme", THEMES = ["ice", "cobalt", "emerald", "violet", "bullion"], de = document.documentElement;
const cur = () => (THEMES.includes(de.dataset.theme) ? de.dataset.theme : "ice");
const mark = () => document.querySelectorAll("[data-set-theme]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.setTheme === cur())));
function set(t) {
  if (!THEMES.includes(t) || t === cur()) return;
  if (t === "ice") delete de.dataset.theme; else de.dataset.theme = t;
  try { if (t === "ice") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) { /* private mode: the choice lasts for this page */ }
  mark();
  document.dispatchEvent(new CustomEvent("gs-theme", { detail: t }));
}
document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-set-theme]"); if (b) set(b.dataset.setTheme); });
document.querySelectorAll(".thm-list").forEach((g) => g.addEventListener("keydown", (e) => {
  const bs = [...g.querySelectorAll("button")], i = bs.indexOf(document.activeElement), d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (i < 0 || !d) return;
  e.preventDefault(); const n = bs[(i + d + bs.length) % bs.length]; n.focus(); set(n.dataset.setTheme);
}));
const btn = document.getElementById("thmBtn"), pop = document.getElementById("thmPop");
if (btn && pop) {
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation(); const open = pop.hidden; pop.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open) (pop.querySelector('[aria-checked="true"]') || pop.querySelector("button")).focus();
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { close(); btn.focus(); } });
}
mark();
})();
