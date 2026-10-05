// One header for the three parts of the site (the EA, the Markets desk, the Journal), so moving between them feels like
// moving through one place. Each page has <!--SHELL--> where its body starts; the switcher in the middle marks where you are.
import { hubPublic } from "./hub";
import { journalOpen } from "./journal";

export type Section = "ea" | "markets" | "journal";

// what each part's menu lists: its own sections first, then the way out
const LOCAL: Record<Section, [string, string][]> = {
  ea: [["#how", "How it works"], ["#replay", "Watch it trade"], ["#desk", "Live gold and this week"], ["#record", "Results"], ["#need", "What you need"], ["#pricing", "Pricing"], ["#brokers", "Brokers"], ["#faq", "FAQ"]],
  markets: [["/markets#hours", "Market hours"], ["/markets#moves", "How markets moved"], ["/markets#next", "Releases ahead"], ["/markets#desk", "The desk"], ["/markets#tools", "Position size calculator"], ["/markets#briefs", "The briefs"]],
  journal: [["#bot", "With the EA"], ["#trades", "Trades"], ["#analytics", "Analytics"], ["#coach", "AI coach"], ["#rules", "Prop firms and rules"], ["#pricing", "Pricing"], ["#faq", "FAQ"]],
};
const CTA: Record<Section, { top: [string, string]; sheet: [string, string]; signin: string }> = {
  ea: { top: ["#pricing", "Get it"], sheet: ["#pricing", "Get GoldenStraddler"], signin: "/account" },
  markets: { top: ["/#pricing", "Get the EA"], sheet: ["/#pricing", "Get GoldenStraddler"], signin: "/account" },
  journal: { top: ["/journal/app?demo=1", "Try the demo"], sheet: ["/journal/app?demo=1", "Explore the journal"], signin: "/journal/app" },
};

export function shell(section: Section) {
  const parts: [Section, string, string, string][] = [["ea", "/", "The EA", "EA"]];
  if (hubPublic() || section === "markets") parts.push(["markets", "/markets", "Markets", "Markets"]);   // the part you're in always shows, even in an admin preview
  if (journalOpen() || section === "journal") parts.push(["journal", "/journal", "Journal", "Journal"]);
  const i = Math.max(0, parts.findIndex((p) => p[0] === section)), c = CTA[section];
  const sw = parts.length > 1 ? `<nav class="sw" aria-label="GoldenStraddler" style="--n:${parts.length};--i:${i}">${parts.map(([k, href, lg, sh], n) =>
    `<a href="${href}" data-i="${n}"${k === section ? ' aria-current="page"' : ""}><span class="lg">${lg}</span><span class="sh">${sh}</span></a>`).join("")}<i class="sw-lens" aria-hidden="true"></i></nav>` : "";
  const other = parts.filter((p) => p[0] !== section).map(([, href, lg]) => `<a href="${href}">${lg === "The EA" ? "GoldenStraddler EA" : lg === "Markets" ? "The Markets desk" : "GoldenStraddler Journal"}</a>`).join("");
  return `<header class="top shell" id="top" data-sec="${section}"><div class="wrap">
  <a class="mark" href="/"><svg aria-hidden="true"><use href="#gs"/></svg><span>GoldenStraddler</span></a>
  ${sw}
  <div class="r"><div class="thm"><button class="thm-btn" id="thmBtn" type="button" aria-expanded="false" aria-controls="thmPop" aria-label="Colours"><i class="thm-sw"></i></button>
    <div class="thm-pop" id="thmPop" hidden data-thm-host></div></div>
    <a class="signin" href="${c.signin}">Sign in</a><a class="btn pri sm top-cta" href="${c.top[0]}">${c.top[1]}</a>
    <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="sheet" aria-label="Open menu"><svg aria-hidden="true" viewBox="0 0 24 24"><path class="m1" d="M4 8h16"/><path class="m2" d="M4 16h16"/></svg></button></div>
</div><i class="top-prog" aria-hidden="true"></i></header>
<div class="sheet" id="sheet" hidden>
  <nav aria-label="On this page">${LOCAL[section].map(([h, t]) => `<a href="${h}">${t}</a>`).join("")}</nav>
  <nav class="sheet-x" aria-label="Elsewhere">${other}<a href="${c.signin}">Sign in</a></nav>
  <div class="sheet-thm" data-thm-host></div>
  <div class="sheet-cta"><a class="btn pri" id="sheetBuy" href="${c.sheet[0]}">${c.sheet[1]}</a><button class="btn" type="button" data-chat-open>Ask a question</button></div>
</div>
<script type="speculationrules">{"prefetch":[{"source":"document","where":{"selector_matches":".sw a, .sheet-x a"},"eagerness":"moderate"}]}</script>`;
}

// The page's headline, split into words so it can rise in on a fresh visit (shell.css). Screen readers get the
// sentence whole from aria-label; elements inside the headline stay in one piece.
export function rise(html: string) {
  return html.replace(/<h1>([\s\S]*?)<\/h1>/, (_, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().replace(/"/g, "&quot;");
    let k = 0;
    const body = inner.trim().replace(/<(\w+)[^>]*>[\s\S]*?<\/\1>|[^\s<]+/g, (w) => `<span class="w" aria-hidden="true"><span style="--d:${k++}">${w}</span></span>`);
    return `<h1 class="rise" aria-label="${label}">${body}</h1>`;
  });
}
