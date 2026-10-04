# GoldenStraddler: product knowledge

## What it is
GoldenStraddler is an Expert Advisor (EA), a trading program, for MetaTrader 5 (MT5). It trades gold (XAUUSD) in the seconds around high-impact US economic releases, the "red-folder" events such as Non-Farm Payrolls (NFP), CPI and FOMC decisions. Those releases often move gold sharply, but nobody knows in advance which way, so the EA doesn't guess: it places an order on both sides and lets the release choose. Between releases it does nothing, by design.

It runs inside the customer's own MT5 terminal, on their own trading account, with the settings they choose. GoldenStraddler (the company) never has access to the trading account, the MT5 password or the money. It is software, not a signal service, managed account or investment advice.

## How it trades (default settings)
1. 5 seconds before the release it places a buy stop 60 points above the ask and a sell stop 60 points below the bid, 0.10 lots each, both sent at the same moment. Each order has a 100-point stop loss and no take profit. If the spread has widened (brokers widen it in the seconds before big news), each order and its stop sit at least twice the live spread away instead.
2. The release hits. Price breaks one way and fills one order. The moment that happens the other order is deleted, so it's only ever in one trade.
3. Nothing moves until the trade is 50 points in profit. From then on the stop loss follows 50 points behind price and only ever tightens.
4. The trailing stop closes the trade when price turns. If the news window is still open, a fresh buy stop and sell stop go on around the new price straight away.
5. 30 seconds after the release the window closes and pending orders are removed. A trade that's still open keeps trailing until its stop closes it.

Speed (version 3.10): every order, cancel and stop move is sent without waiting for the broker's answer, so both sides of the straddle leave together, a stop move never holds anything else up, and every order is priced from the newest tick. If the broker refuses one side because price moved, only that side is sent again straight away. If both sides ever fill, the older position is closed at once. Around each release the EA keeps the computer quiet (no statistics, file or calendar work until the window ends) and writes a timing log to Common\Files\GoldenStraddler_timing_<magic>.csv showing how fast the broker answered each request. A Windows VPS close to the broker's trade server is the biggest single speed gain.

Points: 1 point = 0.01 in the gold price on a 2-digit quote. On 3-digit quotes the EA scales its point inputs by 10 automatically. With the usual 100-ounce contract, each point is worth about $0.10 at 0.10 lots ($1 per point per 1.00 lot), so the default 100-point stop risks about $10 at 0.10 lots, plus slippage and costs. The home page has a calculator for this.

Timing uses the broker's tick clock, not the computer clock. The calendar comes from ForexFactory's public weekly calendar (served from goldenstraddler.com), with MetaTrader 5's own economic calendar as a backup and a saved copy on disk. Most weeks have a handful of red-folder USD events.

There is also an "Always on" mode that trades continuously instead of only around news. It is a very different, much busier way of trading.

## Common doubts, answered straight
- Grid or martingale? No. Every order is the lot size the customer sets, with its own stop loss. It's only ever in one trade at a time, never adds to a losing trade and never raises the size after a loss. If a trade closes while the window is still open, a fresh pair goes on at the same size.
- Why pay when free news EAs exist? Free straddle EAs exist (for example open-source or forum ones) and are a fine way to learn the idea. GoldenStraddler is built and tuned for gold on MT5: both orders leave in the same instant, prices come from the newest tick, entries and stops move out to twice the live spread when brokers widen it, point distances scale to 2- or 3-digit quotes, the red-folder calendar loads by itself with two backups, and customers get a private live dashboard, new versions, a setup guide and real support. Whether that's worth it is the customer's call; the money-back guarantee lets them find out. Never run down other products by name.
- Why is the win rate so low? By design. A losing trade stops out near its fixed stop (slippage around news can add to it) and a winning one is left to run with the trailing stop, so it can lose more often than it wins. Net points, profit factor and drawdown say more than the win rate. Never promise that the winners will outweigh the losers.
- Which broker should I use? Any MT5 broker that offers gold and allows Expert Advisors, including regulated brokers in the UK, EU and Australia. The three on the site are ones we use and partner with, not a requirement.
- If it works, why sell it? It isn't a money machine. It automates one well-known way of trading news and it doesn't win every release: some go nowhere and some reverse into the stop. Selling it pays for development and support. We run it on our own live account and show every closed trade so people can judge the record, not promises.

## Settings (inputs, press F7 on the chart)
- Licence key (empty by default): paste the key from the account page.
- Show this account on your online dashboard (on): sends status and closed trades to the private dashboard. Can be switched off; the licence check still runs.
- Pending distance from price: 60. Stop loss from entry: 100 (0 means none, not recommended). Trailing starts at a profit of: 50. Trailing distance behind price: 50. Stop moves in steps of: 10. Lot size per order: 0.10. Entry and stop at least N x the live spread: 2 (0 switches this off).
- When to trade: News only (default) or Always on. Turn on N seconds before: 5. Keep running N seconds after: 30. Where events come from: ForexFactory plus MT5 (default), either alone, or both combined. Currency: USD.
- Magic number 20260930 (use a different number on each chart if running more than one), order comment, x10 point inputs on 3-digit gold (leave on), dashboard position and size, chart colours, statistics look-back days, export closed trades to CSV.

## The chart panel
States: WAITING (outside a window; shows next release and a countdown; normal most of the time), ARMED (inside a window; orders placed or about to be), IN TRADE (one side filled), PAUSED (no new orders; open trades keep trailing), ALGO OFF (Algo Trading switched off in MT5), REJECTED (broker rejected an order; panel shows the reason), LICENCE (licence not active on this account; panel says why).
Buttons: PAUSE/RESUME; ARM NOW (opens a manual window straight away, 35 seconds with defaults; use with care); CLOSE ALL (asks to confirm, closes GoldenStraddler's positions and pending orders on that symbol and pauses the EA).

## What you need
- MetaTrader 5 for Windows, logged in to a trading account. It does NOT run on MetaTrader 4. On a Mac, use a Windows VPS.
- A broker that offers gold on MT5. Any symbol name works (XAUUSD, GOLD, XAUUSD.r and so on). A raw-spread or ECN account with fast execution gives the best fills around news.
- MT5 open and connected at release time. A Windows VPS is the reliable way: at least 2 GB RAM, ideally close to the broker's servers (many brokers' servers are in London, New York or Equinix data centres). Some brokers offer a free or discounted VPS.
- There is no fixed minimum balance. Choose a lot size where a full stop loss plus slippage is an amount you're comfortable losing many times over.
- Prop firms: many funded-account programmes don't allow trading around news. Check the rules first.
- Demo first is recommended. The licence locks to the first account it runs on, and the customer can move it to their live account straight away from the account page.
- There is no free trial. Instead there is the money-back guarantee (the refund window is in the live facts): someone can buy, run it on a demo account, and ask for a full refund from their account page within that window if it isn't for them. When someone is undecided, mention this.

## Brokers we use and partner with
Any MT5 broker with gold works. On the home page (/#brokers) we list the three brokers we use and partner with. We are an introducing broker (IB) for all three and may earn a commission when someone opens an account through our links; always say so when you recommend one. Facts are from the brokers' own sites (September 2026) and can change.
- Fortune Prime Global (our pick for this EA): ECN account with raw spreads from 0.0 pips and $3.50 per lot commission, min deposit $50, leverage up to 1:500, min lot 0.01, MT4 and MT5, EAs and hedging allowed. PRO30 account: spreads from 1.2 pips, no commission. Since 2011; regulated by the VFSC (Vanuatu) and the FSA (St Vincent and the Grenadines), and ASIC for Australian clients only. The international entity doesn't serve the USA, Japan, Ukraine, New Zealand, Australia, North Korea, Myanmar or Iran. ECN link: https://portal.fortuneprime.com/getview?view=register&token=0jRb0f , PRO30 link: https://portal.fortuneprime.com/getview?view=register&token=0jRb0D
- Ultima Markets: MT5 and MT4, Standard, ECN, Cent and demo accounts; client accounts insured up to US$1M each through Willis Towers Watson; licensed by the FSC (Mauritius) and FSCA (South Africa), UK entity with the FCA; member of The Financial Commission. Doesn't serve the USA, UK, Singapore, Hong Kong or sanctioned countries. Link: https://www.ultimamarkets.com/accounts/open-trading-account/?affid=MjQ5MDE0MzI=
- PU Prime: MT5 and MT4 plus its own app, live, demo and copy-trading accounts; segregated client funds and insurance up to $1M through Lloyd's; licensed by the FSA (Seychelles), FSC (Mauritius), FSCA (South Africa) and CMA (UAE). Doesn't serve the USA, Singapore, China, the Philippines or FATF-blacklisted countries. Link: https://www.puprime.partners/forex-trading-account/?affid=MjMyMTMwODY=
People in the EU or UK should check that the broker can take them as a client.

## Installing (about five minutes)
1. Sign in at goldenstraddler.com/account and download GoldenStraddler.ex5. The licence key is on the same page with a Copy button.
2. In MT5: File > Open Data Folder > MQL5 > Experts, copy the file in. In the Navigator (Ctrl+N) right-click Expert Advisors > Refresh.
3. Tools > Options > Expert Advisors tab: tick Allow algorithmic trading and Allow WebRequest for listed URL, add https://goldenstraddler.com, click OK. Without this the EA can't check its licence or load the calendar.
4. Open an XAUUSD (gold) chart, any timeframe, drag GoldenStraddler onto it. Common tab: Allow Algo Trading ticked. Inputs tab: paste the licence key, check the lot size. OK.
5. Click Algo Trading in the toolbar so it turns green. The panel appears showing WAITING with the next release. Leave MT5 running.
The PDF guide shows every screen. Customers download it from their account page.

## The customer account and dashboard
At goldenstraddler.com/account the customer signs in with their email and a 6-digit code we email them (or email plus licence key). It shows: the licence (key, plan, which MT5 account it's locked to, whether the EA is online), downloads (EA and guide), live status from MT5 (state, open position, balance and equity, next releases), performance (net profit, equity curve, per-trade results, by hour and side, day/7-day/30-day filters), every closed trade, orders and payments (with the refund button during the money-back period), a help form, and subscription management for card subscriptions.

## Licence rules
- One licence runs on one MT5 account at a time. It locks to the first account it runs on. A second account at the same time needs a second licence.
- Moving: on the account page click Move to another MT5 account, then attach the EA with the key on the new account. The old account stops placing new orders. A licence can be moved once every 30 days.
- The EA checks the licence with our server when it starts and from time to time. A good answer is trusted for 48 hours, so a short internet outage doesn't stop trading. It never contacts the server during a news window, in the minute before one, or while its orders are working.
- Keys are personal. Sharing a key gets it switched off.
- Running the same licence on a PC and a VPS on the same account means both copies place orders. Run it in one place only.

## Plans and prices
- Lifetime: one payment, never expires, all future updates included.
- Monthly: one month at a time. By card or wallet it renews automatically until cancelled (cancel any time with Manage subscription on the account page; it stays active to the end of the paid month). By crypto (or bank transfer if offered) the customer pays each month from the account page and gets a reminder email.
- When a monthly plan isn't renewed there are three extra days. After that the EA shows SUBSCRIPTION ENDED, stops placing new orders and removes its pending orders. A trade already open keeps its stop and trailing until it closes. Renew and it starts again on its own.
- Both plans: same EA, same dashboard, licence for one MT5 account. Current prices, discount code and payment methods are in the live facts below.
- Payment: card, Apple Pay and Google Pay through Stripe (instant), crypto through NOWPayments (active after network confirmations). Bank transfer only if listed as available in the live facts. We never see card details.
- Delivery: as soon as payment is confirmed the licence key appears on screen, in the account and by email. At checkout the buyer asks for immediate delivery and so loses the statutory 14-day withdrawal right for digital content; the money-back guarantee applies on top.
- A discount code is entered at checkout. Links like /checkout?plan=lifetime&code=CODE fill it in automatically.

## Refunds (money-back guarantee)
- Within the refund period (see live facts, normally 7 days) of the first payment, no reason needed: sign in, Orders, Request refund. We confirm by email, usually within one working day.
- Lifetime: full amount. Monthly: the full first payment; later renewals aren't refundable, but can be cancelled any time.
- The licence is switched off when the refund is processed.
- Card/wallet refunds go back to the same card in 5 to 10 working days. Crypto refunds are paid in USDT to a wallet the customer gives, worth the euro amount paid less the network fee.
- If someone can't sign in they can use the question form on the home page with their order number.
- Please don't use a chargeback: the licence is paused while a dispute is open.

## Fixing common problems
- Panel says "Allow https://goldenstraddler.com": add it to Tools > Options > Expert Advisors > WebRequest list exactly, then re-attach the EA.
- "Paste your licence key in the EA inputs": press F7 and paste the key from the account page.
- "This licence key doesn't exist": a typo; copy it again with the Copy button.
- "This licence is locked to account ...": it's locked to another MT5 account; move it from the account page.
- "Your subscription has ended": renew from the account page.
- "Can't reach the licence server": check the internet or firewall; trading carries on up to 48 hours after the last good check.
- "Turn on Algo Trading": switch on the toolbar button and Allow Algo Trading on the EA's Common tab.
- "Order rejected: invalid stops": the broker's minimum stop distance is bigger than the settings; increase the pending distance or stop loss, or ask the broker about its stop level.
- "Order rejected: not enough money": lower the lot size.
- "No upcoming releases shown": check https://goldenstraddler.com is in the WebRequest list; MT5's calendar is the backup.
- Still stuck: use the help form on the account page, ideally with a screenshot of the chart panel and the Experts tab (Ctrl+T).

## Risks (always be straight about these)
Trading gold CFDs and other leveraged products carries a high risk of losing money quickly. Most retail CFD accounts lose money. Around news: spreads widen, stop orders and stop losses can fill with slippage well away from their price, price can gap, a release can fill one side and snap back into the stop loss, and some releases do nothing. Some brokers delay, requote or reject orders around news. Technology can fail (sleeping computer, dropped connection, VPS or broker outage, wrong calendar entry). Past results, including our own account, come from one account at one broker over a limited time and don't predict future results. Start on demo, size small. Full disclosure: /risk.

## Our own live account
We run GoldenStraddler on our own live MT5 account and stream every closed trade to the home page (section "The live account, as it trades"), in points. It's one account on one broker, trading small lots while the record builds. The latest numbers are in the live facts.

## The replays on the home page ("Watch it trade a release")
- A phone-screen replay with several scenarios to pick from. Two use real prices from our own screen recording of the US jobs report (NFP) on Friday 2 October 2026, 14:29 to 14:31 Malta time, XAUUSD at 0.1 lots; the others are simulated releases. Each one is labelled on the phone and next to it.
- "2 Oct, as recorded" is the real recording rebuilt: a sell filled on a dip about 12 seconds before the number and was stopped for -$15.20, then the buy filled at 4187.41 just before the release and the trailing stop closed it at 4223.76 for +$363.50 (top tick 4228.31). The re-entries in the minute after were mostly small losses; the whole session came to about +$259 over 14 trades. It ran our earlier timing (orders 15 seconds before, new orders until 60 seconds after). The smaller trades after the release are read off the chart and may be a few dollars out each.
- "2 Oct, today's settings" runs today's rules (5 seconds before, nothing new after 30 seconds) over the same recorded prices. It's a simulation: about +$384 over 17 trades, with the release trade around +$371. Fills are at the recorded prices with the broker answer times seen in the recording; real fills differ.
- "Our other recordings" (25, 28 and 29 September) use real gold prices read off five more of our own screen recordings, replayed at real speed and traded with today's rules in always-on mode with default settings and 0.1 lots. They were quiet stretches between releases: results range from about -$26 to +$27 each. The recordings themselves ran an earlier version with other settings, and the ask is the bid plus an estimated spread.
- The simulated releases (breakout, whipsaw, fake-out, slow grind, and a choppy one that loses) use generated prices traded by the same rules. They show the kinds of release the EA meets, not real results and not a forecast.
- It's one real release on one account. Results vary, fills differ by broker, and many releases are small or reverse into the stop.
## Pages
- Home and pricing: / (pricing at /#pricing, results at /#record, FAQ at /#faq)
- Checkout: /checkout?plan=lifetime or /checkout?plan=monthly (add &code=CODE)
- Customer account, downloads, dashboard, refunds, help form: /account
- Terms /terms, refund policy /refunds, privacy /privacy, risk disclosure /risk, imprint /imprint
- Support email: shown in the live facts.

## The Markets desk (goldenstraddler.com/markets)
- A free weekly page with a call (bullish, bearish or no clear lean, with a confidence level) for 16 markets: gold, silver, platinum, copper, WTI and Brent crude, natural gas, EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD, bitcoin and ether.
- The calls come from a transparent scoring model on public data: trend, weekly RSI, CFTC positioning (fund flows and crowding), the dollar index, real yields, 2 year Treasury yields (Fed path), the VIX, and crude stocks or oil for CAD. Each point on the page is a number with its source.
- It also has live prices, a signal matrix showing what pushes each market up or down, a hedge-fund positioning table, the week's high-impact releases with a "Watch on YouTube" search link and the official source, and a "Copy as Telegram post" button.
- Other tools on the page: market hours (Sydney, Tokyo, London and New York sessions drawn in the visitor's own time, with the week's high-impact releases on the same line and the London and New York overlap marked); a heatmap of how each market moved over 1 day, 1 week, 1 month, 3 months, this year and 1 year; a full-week calendar with medium-impact releases and a currency filter; a Ranges table (average daily range, this week's range against the usual, the 52 week range, 14 day RSI, distance from the 50 day average); a correlation grid of weekly returns over 13 or 52 weeks; and a position size calculator (market, account currency, balance, risk %, stop distance, contract size, leverage) that uses live prices.
- Each market's own page adds its returns over each period, the 52 week range, seasonality (average return by calendar month) and what it moves with, including the dollar index, real yields and the VIX.
- Track record: the weights were picked on 2018 to 2022 and tested on 2023 onwards. Forex has held up best on unseen data; energy and crypto haven't beaten a coin flip since 2023, and the page says so. Don't overstate the accuracy.
- It's general market information, not advice, and separate from the EA: the EA trades gold news releases on its own rules and doesn't follow these calls. Calls update every weekend.

## Colours on the website
- The colour button in the top bar (or the phone menu) offers dark or light, ten colours (Ice, Cobalt, Emerald, Violet, Bullion, Copper, Rose, Platinum, Lime, Orchid) and Custom, where a visitor picks any hue or an exact colour. The choice is remembered on that device. Rising prices always keep a colour that's easy to tell apart from falling ones.
