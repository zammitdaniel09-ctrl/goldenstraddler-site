//+------------------------------------------------------------------+
//| GoldenStraddler Journal Connector                                |
//| Sends this account's closed trades to your GoldenStraddler        |
//| Journal: entry, exit, the stop loss each trade opened with, costs |
//| and how far price went for and against it (from 1-minute bars),   |
//| plus the candles around each trade for the journal's replay.      |
//| It only reads history. It never opens, changes or closes trades.  |
//+------------------------------------------------------------------+
#property copyright "GoldenStraddler"
#property link      "https://goldenstraddler.com/journal"
#property version   "1.10"
#property description "Sends your closed trades to GoldenStraddler Journal. Read-only: it never places, changes or closes a trade."

input string InpToken    = "";                              // Connector token (from Journal > Accounts)
input string InpServer   = "https://goldenstraddler.com";   // Journal address (add it under Tools > Options > Expert Advisors)
input int    InpDays     = 3650;                            // How far back to send on the first run (days)
input bool   InpCalendar = true;                            // Also send high-impact releases from MT5's calendar
input bool   InpCharts   = true;                            // Also send the candles around each trade (for the replay)
input int    InpChartDays = 180;                            // ...for trades closed in the last this many days

#define BATCH        400
#define MAX_CHUNK    3000000                                // characters per request
#define PAD_BARS     30                                     // candles shown before the entry and after the exit
#define RECENT_DAYS  4
#define GV_DONE      "GSJ_FULL_"

datetime g_lastRun = 0;
long     g_done[];                                          // positions already sent in this session
long     g_pend[];                                          // positions sent before their closing candles existed
datetime g_pendDue[];
string   g_status  = "";
int      g_sent    = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpToken) < 10)
   {
      Show("Paste your connector token on the Inputs tab. You'll find it in your journal under Accounts.");
      return(INIT_SUCCEEDED);
   }
   EventSetTimer(60);
   Show("Starting…");
   Sync();
   return(INIT_SUCCEEDED);
}
void OnDeinit(const int reason) { EventKillTimer(); Comment(""); }
void OnTimer() { Sync(); }
void OnTick() { }

//+------------------------------------------------------------------+
void Show(string msg)
{
   g_status = msg;
   Comment("GoldenStraddler Journal\n", msg);
}

string Esc(string s)
{
   string o = "";
   int n = StringLen(s);
   for(int i = 0; i < n; i++)
   {
      ushort c = StringGetCharacter(s, i);
      if(c == '"')       o += "\\\"";
      else if(c == '\\') o += "\\\\";
      else if(c < 32)    o += " ";
      else               o += ShortToString(c);
   }
   return o;
}
string Num(double v, int digits = 8) { return DoubleToString(v, digits); }

//+------------------------------------------------------------------+
//| Worst and best price while the trade was open                    |
//+------------------------------------------------------------------+
bool Excursion(string sym, long dir, datetime from, datetime to, double &worst, double &best)
{
   MqlRates r[];
   ENUM_TIMEFRAMES tfs[3] = {PERIOD_M1, PERIOD_M15, PERIOD_H1};
   for(int k = 0; k < 3; k++)
   {
      ArrayFree(r);
      int n = CopyRates(sym, tfs[k], from, to, r);
      if(n <= 0 || n > 20000) continue;
      double hi = r[0].high, lo = r[0].low;
      for(int i = 1; i < n; i++) { if(r[i].high > hi) hi = r[i].high; if(r[i].low < lo) lo = r[i].low; }
      worst = dir > 0 ? lo : hi;
      best  = dir > 0 ? hi : lo;
      return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Candles around one trade: the smallest timeframe that fits it     |
//+------------------------------------------------------------------+
int ChartTf(long dur, ENUM_TIMEFRAMES &tf)
{
   ENUM_TIMEFRAMES tfs[6] = {PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_H1, PERIOD_H4, PERIOD_D1};
   int secs[6] = {60, 300, 900, 3600, 14400, 86400};
   if(dur < 60) dur = 60;
   for(int k = 0; k < 6; k++)
      if(dur / secs[k] + 2 * PAD_BARS <= 400 || k == 5) { tf = tfs[k]; return secs[k]; }
   tf = PERIOD_D1; return 86400;
}
long Pts(double v, double base, double pt) { return (long)MathRound((v - base) / pt); }
string Candles(string sym, datetime ot, datetime ct, double base, int dg)
{
   ENUM_TIMEFRAMES tf; int sec = ChartTf((long)(ct - ot), tf);
   MqlRates r[];
   int n = CopyRates(sym, tf, ot - (datetime)(PAD_BARS * sec), ct + (datetime)(PAD_BARS * sec), r);
   if(n < 2 || n > 800) return "";
   double pt = SymbolInfoDouble(sym, SYMBOL_POINT); if(pt <= 0) pt = MathPow(10, -dg);
   datetime t0 = r[0].time;
   string b = "";
   for(int i = 0; i < n; i++)
      b += (i ? "," : "") + StringFormat("[%I64d,%I64d,%I64d,%I64d,%I64d]", (long)((r[i].time - t0) / sec),
                                         Pts(r[i].open, base, pt), Pts(r[i].high, base, pt), Pts(r[i].low, base, pt), Pts(r[i].close, base, pt));
   return StringFormat(",\"bars\":{\"tf\":%d,\"t\":%I64d,\"base\":%s,\"pt\":%s,\"b\":[%s]}", sec, (long)t0, Num(base, dg), DoubleToString(pt, 10), b);
}

//+------------------------------------------------------------------+
//| One closed position, rebuilt from its deals                      |
//+------------------------------------------------------------------+
bool Position(long posId, string &json, datetime &closedAt, datetime &later)
{
   if(!HistorySelectByPosition(posId)) return false;
   int n = HistoryDealsTotal();
   if(n < 2) return false;
   double inVol = 0, outVol = 0, inVal = 0, outVal = 0, comm = 0, swap = 0, fee = 0, profit = 0, sl = 0, tp = 0;
   datetime ot = 0, ct = 0;
   long dir = 0, magic = 0;
   string sym = "", comment = "";
   ulong openOrder = 0;
   for(int i = 0; i < n; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY), type = HistoryDealGetInteger(d, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      double vol = HistoryDealGetDouble(d, DEAL_VOLUME), price = HistoryDealGetDouble(d, DEAL_PRICE);
      datetime t = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
      comm += HistoryDealGetDouble(d, DEAL_COMMISSION);
      swap += HistoryDealGetDouble(d, DEAL_SWAP);
      fee  += HistoryDealGetDouble(d, DEAL_FEE);
      if(entry == DEAL_ENTRY_IN)
      {
         if(ot == 0 || t < ot) { ot = t; dir = (type == DEAL_TYPE_BUY) ? 1 : -1; openOrder = (ulong)HistoryDealGetInteger(d, DEAL_ORDER);
            sym = HistoryDealGetString(d, DEAL_SYMBOL); magic = HistoryDealGetInteger(d, DEAL_MAGIC); comment = HistoryDealGetString(d, DEAL_COMMENT);
            sl = HistoryDealGetDouble(d, DEAL_SL); tp = HistoryDealGetDouble(d, DEAL_TP); }
         inVol += vol; inVal += vol * price;
      }
      else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
      {
         outVol += vol; outVal += vol * price; profit += HistoryDealGetDouble(d, DEAL_PROFIT);
         if(t > ct) ct = t;
      }
   }
   if(dir == 0 || inVol <= 0 || outVol < inVol - 0.0000001 || ct == 0) return false;   // still open, or not a trade
   // the stop the trade opened with: the opening order's stop, else the stop at the fill
   if(openOrder > 0 && HistoryOrderSelect(openOrder))
   {
      double osl = HistoryOrderGetDouble(openOrder, ORDER_SL), otp = HistoryOrderGetDouble(openOrder, ORDER_TP);
      if(osl > 0) sl = osl;
      if(otp > 0) tp = otp;
   }
   double worst = 0, best = 0;
   bool hasEx = Excursion(sym, dir, ot, ct, worst, best);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS); if(dg <= 0) dg = 5;
   // the chart goes once the candles after the exit exist; until then the trade goes without it and is sent again later
   string chart = "";
   later = 0;
   datetime now = TimeTradeServer();
   if(InpCharts && ct >= now - (datetime)((long)InpChartDays * 86400))
   {
      ENUM_TIMEFRAMES tf; int sec = ChartTf((long)(ct - ot), tf);
      if(now < ct + (datetime)(PAD_BARS * sec) + 60) later = ct + (datetime)(PAD_BARS * sec) + 60;
      else chart = Candles(sym, ot, ct, inVal / inVol, dg);
   }
   json = StringFormat("{\"id\":\"%I64d\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%s,\"open_time\":%I64d,\"close_time\":%I64d,\"open_price\":%s,\"close_price\":%s,"
                       "\"sl\":%s,\"tp\":%s,\"commission\":%s,\"swap\":%s,\"fee\":%s,\"profit\":%s,\"magic\":\"%I64d\",\"comment\":\"%s\"%s}",
                       posId, Esc(sym), dir > 0 ? "buy" : "sell", Num(inVol, 2), (long)ot, (long)ct, Num(inVal / inVol, dg + 1), Num(outVal / outVol, dg + 1),
                       Num(sl, dg), Num(tp, dg), Num(comm, 2), Num(swap, 2), Num(fee, 2), Num(profit, 2), magic, Esc(comment),
                       hasEx ? StringFormat(",\"mae\":%s,\"mfe\":%s", Num(worst, dg), Num(best, dg)) + chart : chart);
   closedAt = ct;
   return true;
}

//+------------------------------------------------------------------+
//| High-impact releases from MT5's own calendar                     |
//+------------------------------------------------------------------+
string Events(datetime from, datetime to)
{
   if(!InpCalendar) return "";
   MqlCalendarValue v[];
   string out = "";
   int count = 0;
   for(datetime a = from; a < to && count < 20000; a += 30 * 86400)
   {
      datetime b = a + 30 * 86400; if(b > to) b = to;
      ArrayFree(v);
      int n = CalendarValueHistory(v, a, b, NULL, NULL);
      for(int i = 0; i < n && count < 20000; i++)
      {
         MqlCalendarEvent e;
         if(!CalendarEventById(v[i].event_id, e) || e.importance != CALENDAR_IMPORTANCE_HIGH) continue;
         MqlCalendarCountry c;
         if(!CalendarCountryById(e.country_id, c)) continue;
         out += (count ? "," : "") + StringFormat("{\"time\":%I64d,\"currency\":\"%s\",\"name\":\"%s\"}", (long)v[i].time, Esc(c.currency), Esc(e.name));
         count++;
      }
   }
   return out;
}

//+------------------------------------------------------------------+
bool Post(string positions, string events, int &added)
{
   long offset = (long)MathRound((double)(TimeTradeServer() - TimeGMT()) / 900.0) * 15;
   string body = StringFormat("{\"token\":\"%s\",\"login\":\"%I64d\",\"server\":\"%s\",\"company\":\"%s\",\"currency\":\"%s\",\"demo\":%s,\"balance\":%s,\"equity\":%s,\"offset_min\":%I64d,\"positions\":[%s],\"events\":[%s]}",
                              Esc(InpToken), AccountInfoInteger(ACCOUNT_LOGIN), Esc(AccountInfoString(ACCOUNT_SERVER)), Esc(AccountInfoString(ACCOUNT_COMPANY)),
                              Esc(AccountInfoString(ACCOUNT_CURRENCY)), AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO ? "true" : "false",
                              Num(AccountInfoDouble(ACCOUNT_BALANCE), 2), Num(AccountInfoDouble(ACCOUNT_EQUITY), 2), offset, positions, events);
   char data[], res[];
   string headers = "Content-Type: application/json\r\n", resHeaders;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   if(len < 0) len = 0;
   ArrayResize(data, len);
   string url = InpServer;
   if(StringSubstr(url, StringLen(url) - 1) == "/") url = StringSubstr(url, 0, StringLen(url) - 1);
   ResetLastError();
   int code = WebRequest("POST", url + "/api/journal/sync", headers, 20000, data, res, resHeaders);
   if(code == -1)
   {
      int err = GetLastError();
      if(err == 4014) Show("Allow the journal's address first: Tools > Options > Expert Advisors > Allow WebRequest for listed URL, then add " + url);
      else Show("Couldn't reach the journal (error " + IntegerToString(err) + "). It tries again in a minute.");
      return false;
   }
   string reply = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   if(code != 200)
   {
      int p = StringFind(reply, "\"error\":\"");
      string msg = p >= 0 ? StringSubstr(reply, p + 9, StringFind(reply, "\"", p + 9) - p - 9) : "HTTP " + IntegerToString(code);
      Show(msg);
      return false;
   }
   int p2 = StringFind(reply, "\"added\":");
   added = p2 >= 0 ? (int)StringToInteger(StringSubstr(reply, p2 + 8, 8)) : 0;
   return true;
}

void Later(long id, datetime due)
{
   for(int i = ArraySize(g_pend) - 1; i >= 0; i--) if(g_pend[i] == id) { g_pendDue[i] = due; return; }
   int s = ArraySize(g_pend); ArrayResize(g_pend, s + 1, 100); ArrayResize(g_pendDue, s + 1, 100); g_pend[s] = id; g_pendDue[s] = due;
}
void Done(long id)
{
   int s = ArraySize(g_pend);
   for(int i = s - 1; i >= 0; i--) if(g_pend[i] == id) { g_pend[i] = g_pend[s - 1]; g_pendDue[i] = g_pendDue[s - 1]; ArrayResize(g_pend, s - 1); ArrayResize(g_pendDue, s - 1); return; }
}
bool Sent(long id) { for(int i = ArraySize(g_done) - 1; i >= 0; i--) if(g_done[i] == id) return true; return false; }
void Remember(long &list[])
{
   for(int i = 0; i < ArraySize(list); i++) if(!Sent(list[i])) { int s = ArraySize(g_done); ArrayResize(g_done, s + 1, 1000); g_done[s] = list[i]; }
   ArrayFree(list);
}

//+------------------------------------------------------------------+
//| First run: the whole history in batches. Afterwards: the last    |
//| few days every minute (the journal ignores what it already has). |
//+------------------------------------------------------------------+
void Sync()
{
   if(StringLen(InpToken) < 10) return;
   string gv = GV_DONE + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   bool full = !GlobalVariableCheck(gv);
   datetime now = TimeTradeServer(), from = full ? now - (datetime)((long)InpDays * 86400) : now - RECENT_DAYS * 86400;
   if(!HistorySelect(from, now + 86400)) { Show("Couldn't read the account history yet. It tries again in a minute."); return; }
   // closed positions in the window, by position id
   long ids[];
   int nd = HistoryDealsTotal();
   for(int i = 0; i < nd; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) continue;
      long pid = HistoryDealGetInteger(d, DEAL_POSITION_ID);
      bool seen = false;
      for(int k = ArraySize(ids) - 1; k >= 0 && k >= ArraySize(ids) - 50; k--) if(ids[k] == pid) { seen = true; break; }
      if(!seen) { int s = ArraySize(ids); ArrayResize(ids, s + 1, 1000); ids[s] = pid; }
   }
   // trades sent earlier without their chart, now that the candles after the exit exist
   for(int i = ArraySize(g_pend) - 1; i >= 0; i--)
      if(g_pendDue[i] <= now)
      {
         bool dup = false;
         for(int k = ArraySize(ids) - 1; k >= 0; k--) if(ids[k] == g_pend[i]) { dup = true; break; }
         if(!dup) { int s = ArraySize(ids); ArrayResize(ids, s + 1, 1000); ids[s] = g_pend[i]; }
      }
   int total = ArraySize(ids), batch = 0, added = 0, sentNow = 0;
   datetime first = now, last = 0;
   string chunk = "";
   long inChunk[];
   for(int i = 0; i < total; i++)
   {
      bool due = false;
      for(int k = ArraySize(g_pend) - 1; k >= 0; k--) if(g_pend[k] == ids[i] && g_pendDue[k] <= now) { due = true; break; }
      if(!full && Sent(ids[i]) && !due) continue;
      string js; datetime ct, later;
      if(!Position(ids[i], js, ct, later)) continue;
      if(later > 0) Later(ids[i], later); else if(due) Done(ids[i]);
      if(ct < first) first = ct;
      if(ct > last) last = ct;
      chunk += (batch ? "," : "") + js; batch++;
      int s = ArraySize(inChunk); ArrayResize(inChunk, s + 1, BATCH); inChunk[s] = ids[i];
      if(batch >= BATCH || StringLen(chunk) > MAX_CHUNK)
      {
         int a = 0;
         if(!Post(chunk, "", a)) return;
         Remember(inChunk);
         added += a; sentNow += batch; chunk = ""; batch = 0;
         Show(StringFormat("Sending your history: %d of %d trades…", sentNow, total));
      }
   }
   // the releases around these trades go with the last batch
   string ev = "";
   if(full && sentNow + batch > 0) ev = Events(first - 86400, now);
   else if(!full && (int)(now - g_lastRun) > 6 * 3600) ev = Events(now - RECENT_DAYS * 86400, now + 7 * 86400);
   if(batch > 0 || StringLen(ev) > 0 || full)
   {
      int a = 0;
      if(!Post(chunk, ev, a)) return;
      Remember(inChunk);
      added += a; sentNow += batch;
      if(StringLen(ev) > 0 || full) g_lastRun = now;
   }
   if(full) GlobalVariableSet(gv, (double)now);
   g_sent += added;
   Show(StringFormat("Connected. %s%d new trade%s sent this session. Last check %s.", full ? "History sent. " : "", g_sent, g_sent == 1 ? "" : "s", TimeToString(TimeLocal(), TIME_MINUTES)));
}
//+------------------------------------------------------------------+
