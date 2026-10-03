// Colour themes: ten ready-made colours or any colour the visitor picks, on dark or light. The choice is remembered on
// this device, and every page applies it before it paints (a tiny inline script in each page's head reads the same keys:
// gs-theme, gs-mode, and gs-vars, the custom colour's palette worked out here).
(() => {
"use strict";
const de = document.documentElement;
const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode: the choice lasts for this page */ } };
// id, name, accent and second colour as shown on the swatch (the dark versions)
const PRESETS = [
  ["ice", "Ice", "#3FC4FC", "#E6B450"], ["cobalt", "Cobalt", "#7B93FF", "#E6B450"], ["emerald", "Emerald", "#3DDC97", "#E6B450"], ["violet", "Violet", "#B197FC", "#E6B450"],
  ["bullion", "Bullion", "#E6B450", "#3FC4FC"], ["copper", "Copper", "#F2A065", "#3FC4FC"], ["rose", "Rose", "#FF8DB8", "#E6B450"], ["platinum", "Platinum", "#DCE3EC", "#E6B450"],
  ["lime", "Lime", "#B9F25A", "#E6B450"], ["orchid", "Orchid", "#E58CFF", "#E6B450"],
];
const IDS = PRESETS.map((p) => p[0]).concat("custom");
let theme = IDS.includes(de.dataset.theme) ? de.dataset.theme : "ice";
let mode = de.dataset.mode === "light" ? "light" : "dark";
let seed = /^#[0-9a-f]{6}$/i.test(get("gs-custom") || "") ? get("gs-custom").toLowerCase() : "#2ec4b6";

// ---------------------------------------------------------------- a full palette from one colour
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; }
  return [h, s, l];
}
function hsl(h, s, l) {
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgb2hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
const lum = (hex) => { const c = hex2rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function palette(hex, m) {
  const [h, s0] = rgb2hsl(hex2rgb(hex)), S = Math.max(0.1, Math.min(0.95, s0)), o = {};
  const reddish = S > 0.25 && hueGap(h, 354) < 38, goldish = S > 0.25 && hueGap(h, 42) < 22;   // too close to the loss red, or to the gold
  let L = 0.64, acc = hsl(h, S, L);                                                              // bright enough to read on near-black
  while (contrast(acc, "#0E1116") < 7.5 && L < 0.88) { L += 0.02; acc = hsl(h, S, L); }
  if (m === "dark") {
    const t = S * 0.24;
    Object.assign(o, { "--ice": acc, "--deep": hsl(h, S, L - 0.14), "--frost": hsl(h, Math.min(1, S + 0.05), Math.min(0.93, L + 0.18)), "--on-ice": hsl(h, Math.min(0.8, S), 0.08),
      "--carbon": hsl(h, t, 0.065), "--carbon2": hsl(h, t, 0.095), "--edge": hsl(h, t * 0.9, 0.155), "--edge2": hsl(h, t * 0.8, 0.225), "--term1": hsl(h, t, 0.065), "--term2": hsl(h, t, 0.04) });
    if (reddish) o["--up"] = "#3DDC97";
    if (goldish) Object.assign(o, { "--gold": "#3FC4FC", "--on-gold": "#001018" });
  } else {
    let Ld = 0.46, d = hsl(h, S * 0.92, Ld);                                                     // deep enough to read on white
    while (contrast(d, "#FFFFFF") < 4.2 && Ld > 0.18) { Ld -= 0.02; d = hsl(h, S * 0.92, Ld); }
    Object.assign(o, { "--ice": d, "--deep": hsl(h, S * 0.92, Ld - 0.08), "--frost": hsl(h, S * 0.92, Ld + 0.08), "--on-ice": "#fff", "--ice-d": acc });
    if (reddish) Object.assign(o, { "--up": "#0B9A69", "--up-d": "#3DDC97" });
    if (goldish) Object.assign(o, { "--gold": "#0B8BD0", "--gold-d": "#3FC4FC" });
  }
  for (const k of ["--ice", "--up", "--gold", "--ice-d", "--gold-d", "--up-d"]) if (o[k]) o[k + "-rgb"] = hex2rgb(o[k]).join(",");
  return o;
}

// ---------------------------------------------------------------- applying and remembering a choice
let setKeys = [];
function apply() {
  if (theme === "ice") delete de.dataset.theme; else de.dataset.theme = theme;
  if (mode === "light") de.dataset.mode = "light"; else delete de.dataset.mode;
  for (const k of setKeys) de.style.removeProperty(k);
  const p = theme === "custom" ? palette(seed, mode) : {};
  setKeys = Object.keys(p); for (const k of setKeys) de.style.setProperty(k, p[k]);
  put("gs-theme", theme === "ice" ? null : theme); put("gs-mode", mode === "light" ? "light" : null);
  put("gs-vars", setKeys.length ? setKeys.map((k) => k + ":" + p[k]).join(";") : null);
  if (theme === "custom") put("gs-custom", seed);
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = mode === "light" ? "#F2F4F7" : "#000000";
  mark();
  document.dispatchEvent(new CustomEvent("gs-theme", { detail: { theme, mode } }));
}
// pages written before this script may carry a custom palette from the head script; take it over
for (let i = 0; i < de.style.length; i++) if (de.style[i].startsWith("--")) setKeys.push(de.style[i]);

// ---------------------------------------------------------------- the picker, drawn into each place that asks for it
const SUN = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const MOON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.2 12.6A6.7 6.7 0 0 1 7.4 3.8a6.7 6.7 0 1 0 8.8 8.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const sw = (a, b) => `<i class="thm-sw" style="--a:${a};--b:${b}"></i>`;
const html = `<p class="tp-t">Colours</p><div class="tp">
  <div class="tp-mode" role="radiogroup" aria-label="Background"><button type="button" role="radio" data-set-mode="dark">${MOON}Dark</button><button type="button" role="radio" data-set-mode="light">${SUN}Light</button></div>
  <div class="tp-grid" role="radiogroup" aria-label="Colour">${PRESETS.map(([id, name, a, b]) => `<button type="button" role="radio" data-set-theme="${id}">${sw(a, b)}<span>${name}</span></button>`).join("")}<button type="button" role="radio" data-set-theme="custom"><i class="thm-sw tp-any"></i><span>Custom</span></button></div>
  <div class="tp-own" hidden><label class="tp-hue"><span>Pick a hue</span><input type="range" min="0" max="359" step="1" aria-label="Hue for your own colour"></label>
    <label class="tp-exact"><input type="color" aria-label="Pick an exact colour"><span>Or an exact colour</span><b class="num"></b></label>
    <p class="tp-note">Rising prices keep a colour you can tell apart from falling ones, whatever you pick.</p></div>
</div>`;
const hosts = [...document.querySelectorAll("[data-thm-host]")];
for (const h of hosts) h.innerHTML = html;

function mark() {
  const [hh] = rgb2hsl(hex2rgb(seed));
  for (const h of hosts) {
    h.querySelectorAll("[data-set-theme]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.setTheme === theme)));
    h.querySelectorAll("[data-set-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.setMode === mode)));
    const own = h.querySelector(".tp-own"); own.hidden = theme !== "custom";
    const r = own.querySelector("input[type=range]"), c = own.querySelector("input[type=color]");
    if (document.activeElement !== r) r.value = String(Math.round(hh));
    c.value = seed; own.querySelector(".tp-exact b").textContent = seed.toUpperCase();
    // the hue thumb shows the colour itself
    r.style.setProperty("--thumb", hsl(hh, 0.85, 0.6));
  }
}

let raf = 0;
const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); }); };
document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest("[data-set-theme],[data-set-mode]"); if (!t) return;
  if (t.dataset.setTheme && IDS.includes(t.dataset.setTheme)) theme = t.dataset.setTheme;
  if (t.dataset.setMode) mode = t.dataset.setMode === "light" ? "light" : "dark";
  apply();
});
for (const h of hosts) {
  h.querySelector(".tp-own input[type=range]").addEventListener("input", (e) => {
    const [, s] = rgb2hsl(hex2rgb(seed)); seed = hsl(Number(e.target.value), s < 0.2 ? 0.8 : s, 0.6); theme = "custom"; later();
  });
  h.querySelector(".tp-own input[type=color]").addEventListener("input", (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { seed = e.target.value.toLowerCase(); theme = "custom"; later(); } });
  // arrow keys move through each group and pick as they go
  h.querySelectorAll("[role=radiogroup]").forEach((g) => g.addEventListener("keydown", (e) => {
    const bs = [...g.querySelectorAll("button")], i = bs.indexOf(document.activeElement), d = { ArrowDown: g.classList.contains("tp-grid") ? 4 : 1, ArrowRight: 1, ArrowUp: g.classList.contains("tp-grid") ? -4 : -1, ArrowLeft: -1 }[e.key];
    if (i < 0 || !d) return;
    e.preventDefault(); const n = bs[Math.max(0, Math.min(bs.length - 1, i + d))]; n.focus(); n.click();
  }));
}

// ---------------------------------------------------------------- the header button that opens the picker
const btn = document.getElementById("thmBtn"), pop = document.getElementById("thmPop");
if (btn && pop) {
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation(); const open = pop.hidden; pop.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open) (pop.querySelector('.tp-grid [aria-checked="true"]') || pop.querySelector("button")).focus();
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { close(); btn.focus(); } });
}
if (theme === "custom" && !setKeys.length) apply(); else mark();
})();
