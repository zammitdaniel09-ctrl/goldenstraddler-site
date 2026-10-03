"""Builds web/legal/*.html from the bodies below. {{VARS}} are filled in by the server at request time."""
import os
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', 'web', 'legal')
HEAD = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<script>try{{var t=localStorage.getItem("gs-theme");if(t&&/^[a-z]+$/.test(t))document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<title>{title} | GoldenStraddler</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{{{{SITE_URL}}}}/{slug}">
<meta property="og:type" content="website"><meta property="og:site_name" content="GoldenStraddler"><meta property="og:title" content="{title} | GoldenStraddler"><meta property="og:image" content="{{{{SITE_URL}}}}/og.png?v=2">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/unbounded-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/space-grotesk-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/chat.css">
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="gs" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="16" fill="#0E1116" stroke="#2e3644" stroke-width="2"/><text x="25" y="44" font-family="Unbounded,Arial Black,sans-serif" font-weight="800" font-size="30" fill="#fff" text-anchor="middle">G</text><text x="42" y="49" font-family="Sedgwick Ave,Segoe Script,cursive" font-size="36" style="fill:var(--ice)" text-anchor="middle">S</text></symbol></svg>
<header class="top scrolled"><div class="wrap">
  <a class="mark" href="/"><svg aria-hidden="true"><use href="#gs"/></svg><span>GoldenStraddler</span></a>
  <div class="r"><a class="signin" href="/account">Sign in</a><a class="btn pri sm" href="/#pricing">Get it</a></div>
</div></header>
<main class="legal">
<h1>{title}</h1>
<p class="upd">Last updated {{{{UPDATED}}}}</p>
'''
FOOT = '''</main>
<footer class="foot"><div class="wrap">
  <p>GoldenStraddler is trading software. It doesn't give investment advice and never holds client funds. Trading leveraged products carries a high risk of losing money.</p>
  <nav aria-label="Legal"><a href="/markets">Markets</a><a href="/terms">Terms</a><a href="/refunds">Refunds</a><a href="/privacy">Privacy</a><a href="/risk">Risk</a><a href="/imprint">Imprint</a></nav>
</div></footer>
<script src="/js/chat.js" defer></script>
</body>
</html>
'''
PAGES = {}

PAGES['terms'] = ('Terms of sale and licence', 'The terms for buying and using a GoldenStraddler licence.', '''
<p>These terms apply when you buy or use a GoldenStraddler licence from {{SITE}}. Please read them together with the <a href="/refunds">refund policy</a>, the <a href="/privacy">privacy policy</a> and the <a href="/risk">risk disclosure</a>.</p>

<h2>1. Who sells it</h2>
<p>GoldenStraddler is sold by <strong>{{SELLER_NAME}}</strong>, {{SELLER_ADDRESS}} (VAT number {{SELLER_VAT}}, registration {{SELLER_REG}}). In these terms "we" and "us" means the seller and "you" means the buyer. You can reach us through the help form in your account, the question form on the home page, or at {{SUPPORT_EMAIL}}.</p>

<h2>2. What you're buying</h2>
<p>You buy a <strong>licence to use</strong> the GoldenStraddler Expert Advisor ("the EA"), software for MetaTrader&nbsp;5, together with access to your online account page and dashboard. You don't buy the software itself, and you don't buy any trading signal, advice or managed service.</p>
<p>GoldenStraddler is a tool. It runs inside your own MetaTrader&nbsp;5 terminal, on your own trading account, with the settings you choose. Every trade it places is placed on your instruction, by software you chose to run. We never have access to your trading account, your password or your money.</p>

<h2>3. Plans and prices</h2>
<ul>
<li><strong>Lifetime</strong> is a single payment ({{PRICE_LIFETIME}} at the list price). The licence has no expiry date and stays valid for as long as GoldenStraddler is offered.</li>
<li><strong>Monthly</strong> ({{PRICE_MONTHLY}} a month at the list price) covers one month at a time. Paid by card or wallet, it renews automatically each month until you cancel. Paid by bank transfer or crypto, you pay each month yourself from your account page.</li>
</ul>
<p>Prices are in euro. A discount code changes the price only as shown at checkout. The price you pay is the one shown on the checkout summary before you pay.</p>

<h2>4. Payment and delivery</h2>
<p>Card and wallet payments are processed by Stripe and crypto payments by NOWPayments. We don't see or store your card details. Bank transfers go to our business account and are matched by the order number in the reference.</p>
<p>The licence is digital content. It's delivered as soon as your payment is confirmed: your licence key appears on screen, in your account and in an email. At checkout you ask us to deliver it straight away and confirm that you lose the statutory 14-day right of withdrawal for digital content once it's delivered. Our <a href="/refunds">{{REFUND_DAYS}}-day money-back guarantee</a> applies on top of that.</p>

<h2>5. The licence rules</h2>
<ul>
<li>One licence runs on <strong>one MetaTrader&nbsp;5 account at a time</strong>. It locks to the first account it runs on.</li>
<li>You can move it to a different account from your account page once every {{MOVE_DAYS}} days. The previous account stops placing new orders.</li>
<li>Your licence key is personal. Don't share it, publish it, resell it or let anyone else use it.</li>
<li>Don't copy, decompile, modify or reverse-engineer the EA, and don't try to get around the licence check.</li>
<li>The EA contacts our server to check the licence and, if you leave dashboard sync on, to show your account on your dashboard. A good check is trusted for 48 hours.</li>
</ul>
<p>If a licence is shared or abused, we may switch it off. We'll tell you why by email.</p>

<h2>6. Monthly plans: renewal, cancellation and the end of a period</h2>
<p>You can cancel a card subscription at any time from your account page. It stops renewing and stays active until the end of the period you've paid for. When a monthly licence isn't renewed, it keeps working for three extra days. After that, the EA stops placing new orders and removes its pending orders. A trade that's already open keeps its stop loss and trailing stop until they close it.</p>

<h2>7. Refunds, disputes and chargebacks</h2>
<p>Refunds work as described in the <a href="/refunds">refund policy</a>. If something's wrong, please ask us first. If you open a dispute or chargeback with your bank instead, we pause the licence while the dispute is open. If the dispute is decided in your favour, the licence is switched off for good.</p>

<h2>8. No advice and no guarantee of results</h2>
<p>Nothing on this website, in the EA, in the guide or in our replies is investment, financial, tax or legal advice. We don't know your circumstances and we don't recommend any trade. Trading results depend on your broker, your account, your settings, market conditions and luck. <strong>We don't promise any profit, and you can lose money, including more than you expect.</strong> Read the <a href="/risk">risk disclosure</a> before you use the EA on a live account.</p>

<h2>9. Availability and updates</h2>
<p>We work to keep the licence server, the news feed and the dashboards running, but we can't promise they'll never be interrupted. The EA depends on things outside our control: your computer or VPS, your internet connection, your broker's servers and the third-party economic calendar. We may release updated versions of the EA. Updates are included in your plan for as long as it's active.</p>

<h2>10. Liability</h2>
<p>We're responsible for providing the licence as described. We're <strong>not liable for trading losses</strong>, lost profits, slippage, missed trades or other results of trading decisions or of the software running as configured. Our total liability to you for anything related to GoldenStraddler is limited to the amount you paid us in the 12 months before the claim. Nothing in these terms limits liability that can't be limited by law, or takes away your rights as a consumer under the law of the country where you live.</p>

<h2>11. Changes</h2>
<p>We may update these terms. The version that applies to your purchase is the one shown when you paid. For monthly plans, we'll email you at least 14 days before a change that affects you, and you can cancel before it takes effect.</p>

<h2>12. Law and complaints</h2>
<p>These terms are governed by the law of Malta. If you're a consumer, you also keep the protection of the mandatory laws of the country where you live, and you can bring a claim in your local courts. Please contact us first so we can try to fix the problem.</p>
''')

PAGES['refunds'] = ('Refund policy', 'How the GoldenStraddler money-back guarantee works.', '''
<p>If GoldenStraddler isn't for you, you can have your money back within <strong>{{REFUND_DAYS}} days of your first payment</strong>. You don't have to give a reason.</p>

<h2>How to ask</h2>
<ol>
<li>Sign in to your account.</li>
<li>Under <strong>Orders</strong>, click <strong>Request refund</strong> next to the order.</li>
<li>We confirm by email, usually within one working day.</li>
</ol>
<p>Can't sign in? Use the question form on the home page with your order number and the email you bought with.</p>

<h2>What gets refunded</h2>
<ul>
<li><strong>Lifetime:</strong> the full amount you paid.</li>
<li><strong>Monthly:</strong> the full first payment. Later monthly renewals aren't refundable, but you can cancel at any time and keep access until the end of the month you've paid for.</li>
</ul>
<p>The licence from a refunded order is switched off as soon as the refund is processed. The EA then stops placing new orders on your account.</p>

<h2>How the money comes back</h2>
<table>
<tr><th>You paid by</th><th>Refunded to</th><th>Usually takes</th></tr>
<tr><td>Card, Apple Pay, Google Pay</td><td>The same card or wallet</td><td>5 to 10 working days</td></tr>
<tr><td>Bank transfer</td><td>The bank account the payment came from</td><td>1 to 3 working days</td></tr>
<tr><td>Crypto</td><td>A wallet address you give us, in USDT, worth the euro amount you paid, less the network fee</td><td>1 to 3 working days</td></tr>
</table>

<h2>After the {{REFUND_DAYS}} days</h2>
<p>After that, payments aren't refundable, except where the law says otherwise or if we can't provide the licence as described. If the EA doesn't run as described, contact us and we'll fix it or refund you.</p>

<h2>Please don't use a chargeback</h2>
<p>If you open a chargeback or bank dispute instead of asking us, the licence is paused while the dispute is open. Asking us is faster and keeps things simple for both sides.</p>
''')

PAGES['privacy'] = ('Privacy policy', 'What personal data GoldenStraddler collects and why.', '''
<p>This policy explains what personal data we collect when you visit {{SITE}}, buy a licence or run the EA, and what we do with it. We collect as little as we can.</p>

<h2>Who is responsible</h2>
<p>The data controller is <strong>{{SELLER_NAME}}</strong>, {{SELLER_ADDRESS}}. Contact us about privacy at {{SUPPORT_EMAIL}} or through the help form in your account.</p>

<h2>What we collect</h2>
<table>
<tr><th>Data</th><th>Why</th><th>Legal basis</th></tr>
<tr><td>Email address and, if you give it, your name</td><td>To deliver your licence, sign you in with a code and send receipts and important notices</td><td>Contract</td></tr>
<tr><td>Order details: plan, price, discount code, payment method, payment confirmation from Stripe or NOWPayments, IP address and country at checkout</td><td>To process the sale, keep accounting records and prevent fraud</td><td>Contract, legal obligation, legitimate interest</td></tr>
<tr><td>Licence data: your MT5 account number, broker server and the times the EA checked in</td><td>To lock the licence to one account and keep it working</td><td>Contract</td></tr>
<tr><td>Dashboard data, if dashboard sync is on: account balance and equity, open position and closed trades placed by the EA</td><td>To show your own live dashboard</td><td>Contract. You can switch it off in the EA inputs.</td></tr>
<tr><td>Messages you send us</td><td>To answer you</td><td>Legitimate interest</td></tr>
<tr><td>Website chat: what you write, our replies, the page you were on, your time zone, your IP address and, if you give it, your email</td><td>To answer your questions in the chat, let a person from our team take over and reply to you by email if you've left</td><td>Legitimate interest. For customers, also contract.</td></tr>
<tr><td>Basic server logs: IP address, page requested, time</td><td>To keep the service secure and working</td><td>Legitimate interest</td></tr>
</table>
<p>We never receive your card number, your MT5 password or access to your trading account.</p>

<h2>Cookies</h2>
<p>We only use cookies that are needed for the site to work: one that keeps you signed in, one that links your browser to an order you just placed, and two that keep your website chat going when you move between pages. There are no advertising or analytics cookies, so there's no cookie banner. Fonts are hosted on our own server.</p>

<h2>Who we share it with</h2>
<ul>
<li><strong>Stripe</strong> (card and wallet payments) and <strong>NOWPayments</strong> (crypto payments) receive the details they need to take your payment.</li>
<li><strong>Railway</strong> hosts the website and its database.</li>
<li><strong>Resend</strong> sends our emails.</li>
<li><strong>Anthropic</strong> provides the AI that answers in the website chat. What you write in the chat is sent to it to produce the answer. It doesn't use these messages to train its models.</li>
<li>Our accountant and the tax authorities, where the law requires it.</li>
</ul>
<p>Some of these providers process data outside the EU. Where they do, they use the European Commission's standard contractual clauses or another lawful safeguard. We don't sell your data and we don't share it for advertising.</p>

<h2>How long we keep it</h2>
<ul>
<li>Order and invoice records: as long as tax and accounting law requires, up to 10 years.</li>
<li>Your account and licence: while you have a licence, and for 12 months after it ends.</li>
<li>Dashboard trade data: while the licence is active. It's deleted when you move the licence to another account or ask us to delete it.</li>
<li>Website chats: up to 12 months after the last message, then deleted. Ask us and we delete a chat sooner.</li>
<li>Server logs: up to 30 days.</li>
</ul>

<h2>Your rights</h2>
<p>You can ask for a copy of your data, ask us to correct or delete it, object to how we use it, or ask for it in a portable format. Contact us and we'll reply within one month. If you're not happy with our answer, you can complain to the Information and Data Protection Commissioner in Malta (idpc.org.mt) or to the data protection authority where you live.</p>
''')

PAGES['risk'] = ('Risk disclosure', 'The risks of trading gold with GoldenStraddler.', '''
<div class="box"><p><strong>Trading gold CFDs and other leveraged products carries a high risk of losing money quickly because of leverage.</strong> Most retail accounts lose money trading CFDs. Only trade with money you can afford to lose. GoldenStraddler is software, not advice, and it doesn't make trading safe.</p></div>

<h2>News trading is especially fast</h2>
<p>GoldenStraddler is built to trade the seconds around high-impact economic releases. That's when markets move fastest and conditions are worst:</p>
<ul>
<li><strong>Spreads widen</strong>, sometimes many times over their normal size.</li>
<li><strong>Slippage:</strong> stop orders can fill well away from their price, and stop losses can close worse than set.</li>
<li><strong>Gaps:</strong> price can jump past an order or a stop without trading in between.</li>
<li><strong>Whipsaws:</strong> price can fill one side and reverse straight into the stop loss.</li>
<li><strong>No move:</strong> some releases do nothing, and neither order fills.</li>
<li>Some brokers delay, requote or reject orders around news, or change their conditions without notice.</li>
</ul>

<h2>Technology can fail</h2>
<p>The EA only works while MetaTrader&nbsp;5 is running and connected. A computer that sleeps, a dropped connection, a VPS problem, a broker outage, a wrong calendar entry or a software fault can mean missed trades, unmanaged positions or unexpected results.</p>

<h2>Past results don't predict future results</h2>
<p>Any result shown on this website, including our own account, comes from one account at one broker over a limited time. Your results will be different, and they can be much worse.</p>

<h2>Check your broker and prop firm rules</h2>
<p>Many funded-account programmes and some brokers don't allow trading around news, or limit it. Using the EA against those rules can cost you your account or your payouts. Read their terms first.</p>

<h2>You're in control</h2>
<p>You choose the account, the lot size, the settings and whether to run it at all. Start on a demo account, use a size you're comfortable losing, and make sure you understand how the EA works before you go live. If you're unsure whether trading is right for you, speak to an independent, licensed financial adviser.</p>
''')

PAGES['imprint'] = ('Imprint', 'Business details for GoldenStraddler.', '''
<table>
<tr><th>Seller</th><td>{{SELLER_NAME}}</td></tr>
<tr><th>Address</th><td>{{SELLER_ADDRESS}}</td></tr>
<tr><th>VAT number</th><td>{{SELLER_VAT}}</td></tr>
<tr><th>Registration</th><td>{{SELLER_REG}}</td></tr>
<tr><th>Email</th><td>{{SUPPORT_EMAIL}}</td></tr>
<tr><th>Website</th><td>{{SITE}}</td></tr>
</table>
<p style="margin-top:24px">The quickest way to reach us is the help form in your account, or the question form on the <a href="/#contact">home page</a>.</p>
<p>If you have a complaint, contact us first and we'll do our best to sort it out directly.</p>
''')

for slug, (title, desc, body) in PAGES.items():
    with open(os.path.join(OUT, slug + '.html'), 'w') as f:
        f.write(HEAD.format(title=title, desc=desc, slug=slug) + body.strip() + '\n' + FOOT)
print('built', len(PAGES))
