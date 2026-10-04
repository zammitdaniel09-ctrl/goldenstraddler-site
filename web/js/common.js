// Small shared helpers for the account and admin pages.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; };
const MINUS = "−", DASH = "—";
const pad2 = (n) => String(n).padStart(2, "0");
const eur = (cents, opts = {}) => {
  const v = (cents || 0) / 100;
  return (v < 0 ? MINUS : "") + "€" + Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: opts.cents || v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
const dateFmt = (ms, withTime = true) => !ms ? DASH : new Date(ms).toLocaleString("en-GB", withTime ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" });
const agoFmt = (ms) => { if (!ms) return "never"; const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? Math.round(s) + " s ago" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago"; };

class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(path, body, method) {
  const r = await fetch(path, body === undefined && !method ? { cache: "no-store" } : { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok || j.ok === false) throw new ApiError(j.error || "Something went wrong. Try again.", r.status);
  return j;
}

let toastT;
function toast(msg, bad = false) {
  let t = $("toast");
  if (!t) { t = el("div", "toast"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.className = "toast on" + (bad ? " bad" : "");
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast" + (bad ? " bad" : "")), 3800);
}
// a button that runs an async action, shows progress and reports errors
function act(btn, fn, okMsg) {
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (btn.dataset.confirm && btn.dataset.armed !== "1") {
      btn.dataset.armed = "1"; const old = btn.textContent; btn.textContent = btn.dataset.confirm;
      setTimeout(() => { btn.dataset.armed = ""; btn.textContent = old; }, 4000); return;
    }
    btn.dataset.armed = ""; btn.disabled = true;
    try { const r = await fn(); if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg); }
    catch (x) { toast(x.message, true); }
    finally { btn.disabled = false; }
  });
  return btn;
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => (btn.textContent = o), 1500); } else toast("Copied"); }
  catch { toast("Select the text and copy it", true); }
}
// 6-box code entry used by both sign-in pages
function otpBoxes(box, onFull) {
  box.replaceChildren();
  for (let i = 0; i < 6; i++) { const inp = el("input"); Object.assign(inp, { inputMode: "numeric", maxLength: 1, autocomplete: i ? "off" : "one-time-code" }); inp.setAttribute("aria-label", "Digit " + (i + 1)); box.appendChild(inp); }
  const ins = [...box.querySelectorAll("input")], code = () => ins.map((i) => i.value).join("");
  const fill = (s, from) => { s = s.replace(/\D/g, ""); for (let i = 0; i < s.length && from + i < 6; i++) ins[from + i].value = s[i]; ins[Math.min(5, from + s.length)].focus(); if (code().length === 6) onFull(code()); };
  ins.forEach((inp, i) => {
    inp.addEventListener("input", () => { const v = inp.value; inp.value = ""; fill(v, i); box.classList.remove("bad"); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !inp.value && i) { ins[i - 1].value = ""; ins[i - 1].focus(); e.preventDefault(); } if (e.key === "ArrowLeft" && i) ins[i - 1].focus(); if (e.key === "ArrowRight" && i < 5) ins[i + 1].focus(); });
    inp.addEventListener("paste", (e) => { e.preventDefault(); fill((e.clipboardData || window.clipboardData).getData("text"), i); });
  });
  return { code, clear() { ins.forEach((i) => (i.value = "")); ins[0].focus(); }, shake() { box.classList.remove("bad"); void box.offsetWidth; box.classList.add("bad"); }, focus() { ins[0].focus(); } };
}
const PLAN = { lifetime: "Lifetime", monthly: "Monthly", journal: "Journal", trial: "Demo trial" };
const METHOD = { card: "Card / wallet", crypto: "Crypto", bank: "Bank transfer", manual: "Manual" };
