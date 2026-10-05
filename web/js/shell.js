// The shared header for the EA, Markets and Journal. Loaded in <head> so it can decide how the page arrives
// before anything is drawn: a fresh visit gets the headline rising in; coming from another part of the site
// slides the page across (view transitions where the browser has them, a short slide where it doesn't).
(() => {
"use strict";
const d = document.documentElement, KEY = "gs-nav";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const crossDoc = "onpageswap" in window;               // browsers that animate between pages themselves
const secOf = (p) => p.startsWith("/markets") ? 1 : p.startsWith("/journal") ? 2 : 0;
const depth = (p) => p.split("/").filter(Boolean).length;
const here = location.pathname, sec = secOf(here);
let curI = 0;

const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } };
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ p: here, s: sec, i: curI, t: Date.now() })); } catch { /* private mode */ } };
// which way the page should move, given where the visitor was
const dirBetween = (fromPath, fromSec, toPath, toSec) => {
  if (fromPath === toPath) return "";
  if (fromSec !== toSec) return fromSec < toSec ? "fwd" : "back";
  const a = depth(fromPath), b = depth(toPath);
  return b > a ? "fwd" : b < a ? "back" : "";
};

// ---------------------------------------------------------------- how this page arrives
const rec = read();
const fromHere = rec && Date.now() - rec.t < 6000 && rec.p !== here;   // just came from another page of the site
if (!reduce) {
  if (!fromHere) d.classList.add("gs-rise");
  else if (!crossDoc) {
    const dir = dirBetween(rec.p, rec.s, here, sec);
    if (dir) d.classList.add("gs-from-" + dir);
    if (rec.s !== sec) { d.classList.add("gs-lensin"); d.dataset.swFrom = String(rec.i | 0); }
  }
}

addEventListener("pagehide", save);
addEventListener("pageswap", (e) => {
  save();
  const vt = e.viewTransition; if (!vt) return;
  const url = e.activation && e.activation.entry && e.activation.entry.url;
  let to = null; try { to = url ? new URL(url) : null; } catch { /* leave it */ }
  if (!to || to.origin !== location.origin) { vt.skipTransition(); return; }
  const dir = reduce ? "" : dirBetween(here, sec, to.pathname, secOf(to.pathname));
  if (dir) d.dataset.vt = dir;
});
addEventListener("pagereveal", (e) => {
  const vt = e.viewTransition; if (!vt) return;
  const r = read();
  const dir = reduce || !r ? "" : dirBetween(r.p, r.s, here, sec);
  if (dir) d.dataset.vt = dir; else delete d.dataset.vt;
  vt.finished.finally(() => { delete d.dataset.vt; });
});

// ---------------------------------------------------------------- the header, once it exists
const ready = (fn) => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once: true }) : fn();
ready(() => {
  const top = document.getElementById("top");
  if (!top || !top.classList.contains("shell")) return;
  const sw = top.querySelector(".sw"), btn = document.getElementById("menuBtn"), sheet = document.getElementById("sheet");
  curI = sw ? Number(sw.style.getPropertyValue("--i")) || 0 : 0;

  // the lens glides from where you were (browsers without view transitions)
  if (d.classList.contains("gs-lensin")) requestAnimationFrame(() => requestAnimationFrame(() => d.classList.remove("gs-lensin")));
  if (d.classList.contains("gs-from-fwd") || d.classList.contains("gs-from-back")) setTimeout(() => d.classList.remove("gs-from-fwd", "gs-from-back"), 700);

  const onScroll = () => top.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  const setH = () => {
    const r = top.getBoundingClientRect();
    d.style.setProperty("--top-h", Math.round(r.height) + "px");
    d.style.setProperty("--hdr", Math.round(Math.max(r.bottom, r.height)) + "px");
  };
  setH(); addEventListener("resize", setH, { passive: true });

  // the switcher: the lens moves the moment you choose, the page follows
  const reset = () => { if (!sw) return; sw.style.setProperty("--i", String(curI)); sw.querySelectorAll("a.sw-go").forEach((a) => a.classList.remove("sw-go")); };
  if (sw) sw.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (new URL(a.href).pathname === here) { e.preventDefault(); scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); return; }
    sw.style.setProperty("--i", a.dataset.i);
    sw.querySelectorAll("a").forEach((x) => x.classList.toggle("sw-go", x === a));
  });
  // the logo on the home page takes you back to the top rather than reloading it
  const mark = top.querySelector(".mark");
  if (mark && here === "/") mark.addEventListener("click", (e) => {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

  // ---------------------------------------------------------------- the menu
  if (!btn || !sheet) return;
  sheet.querySelectorAll("nav a").forEach((a, k) => a.style.setProperty("--k", String(k)));
  const wide = () => innerWidth > 760;
  let open = false, hideT = 0, wasWide = wide();
  const set = (o, focusIn) => {
    if (o === open) return;
    open = o; clearTimeout(hideT);
    btn.setAttribute("aria-expanded", String(o)); btn.setAttribute("aria-label", o ? "Close menu" : "Open menu");
    if (o) {
      setH(); wasWide = wide();
      sheet.hidden = false; void sheet.offsetWidth;   // start from the closed look, then open
      sheet.classList.add("on");
      document.body.classList.toggle("lock", !wasWide);
      if (focusIn) { const f = sheet.querySelector("a,button"); if (f) f.focus({ preventScroll: true }); }
    } else {
      sheet.classList.remove("on"); document.body.classList.remove("lock");
      hideT = setTimeout(() => { if (!open) sheet.hidden = true; }, reduce ? 0 : 360);
    }
  };
  btn.addEventListener("click", (e) => set(!open, e.detail === 0));   // opened from the keyboard: focus goes into the menu
  sheet.addEventListener("click", (e) => { if (e.target.closest("a,button") && !e.target.closest(".tp")) set(false); });   // trying colours keeps it open
  document.addEventListener("click", (e) => { if (open && !sheet.contains(e.target) && !btn.contains(e.target)) set(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { set(false); btn.focus(); } });
  sheet.addEventListener("focusout", (e) => { if (open && wide() && e.relatedTarget && !sheet.contains(e.relatedTarget) && e.relatedTarget !== btn) set(false); });
  addEventListener("resize", () => { if (open && wide() !== wasWide) set(false); }, { passive: true });
  // back to this page from the browser's cache: everything as it was before you left
  addEventListener("pageshow", (e) => { if (e.persisted) { reset(); set(false); delete d.dataset.vt; } });
});
})();
