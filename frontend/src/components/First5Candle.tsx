"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { BarChart2, TrendingUp, TrendingDown, Clock, Minus } from "lucide-react";
import StrategyCalendar from "./StrategyCalendar";

interface FiveMinCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isBullish: boolean;
}

interface Orb5State {
  symbol: string;
  resistance: number;
  support: number;
  windowCandles: FiveMinCandle[];
  activationCandle: FiveMinCandle | null;
  state: "WAITING" | "WATCHING" | "TRADED" | "EXPIRED";
  breakoutDirection?: "CE" | "PE";
  breakoutAt?: number;
  tradedAt?: number;
  lastUpdated: number;
}

function toIST(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

function CandleBar({ candle, label }: { candle: FiveMinCandle; label?: string }) {
  const color = candle.isBullish ? "text-emerald-400" : "text-red-400";
  const bg    = candle.isBullish ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30";
  return (
    <div className={`flex flex-col gap-0.5 text-[10px] font-mono px-2 py-1.5 rounded-lg border ${bg}`}>
      <span className={`font-bold ${color}`}>
        {candle.isBullish ? "🟢" : "🔴"} {label ?? toIST(candle.time * 1000)}
      </span>
      <span className="text-neutral-400">H: <span className="text-white">{candle.high.toFixed(2)}</span></span>
      <span className="text-neutral-400">L: <span className="text-white">{candle.low.toFixed(2)}</span></span>
      <span className="text-neutral-400">O: {candle.open.toFixed(2)} → C: {candle.close.toFixed(2)}</span>
    </div>
  );
}

function StateChip({ state, direction }: { state: Orb5State["state"]; direction?: string }) {
  if (state === "WAITING")  return <span className="px-2 py-0.5 text-xs rounded bg-neutral-800 text-neutral-400">⏳ Waiting</span>;
  if (state === "WATCHING") return <span className="px-2 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400 animate-pulse">👀 Watching</span>;
  if (state === "TRADED")   return <span className={`px-2 py-0.5 text-xs rounded font-bold ${direction === "CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>✅ Traded {direction}</span>;
  return <span className="px-2 py-0.5 text-xs rounded bg-neutral-800 text-neutral-500">Expired</span>;
}

export default function First5Candle({ portfolio, history, handleSquareOff, squaringOff }: {
  portfolio?: any;
  history?: any[];
  handleSquareOff?: (token: string) => void;
  squaringOff?: string | null;
}) {
  const [states, setStates]               = useState<Orb5State[]>([]);
  const [loading, setLoading]             = useState(true);
  const [lastUpdated, setLastUpdated]     = useState("");
  const [activeInnerTab, setActiveInnerTab] = useState<"signals" | "ledger">("signals");
  const [niftyLots, setNiftyLots]         = useState(2);
  const [bankNiftyLots, setBankNiftyLots] = useState(2);
  const [lotSaving, setLotSaving]         = useState(false);
  const [lotSaved, setLotSaved]           = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  const fetchStates = async () => {
    try {
      const res = await axios.get(`${API_URL}/first5candle`);
      if (res.data.status === "success") {
        setStates(res.data.data);
        setLastUpdated(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }));
      }
    } catch { } finally { setLoading(false); }
  };

  const fetchLotConfig = async () => {
    try {
      const res = await axios.get(`${API_URL}/shoonya-config`);
      if (res.data.first5CandleNiftyLots !== undefined)     setNiftyLots(res.data.first5CandleNiftyLots);
      if (res.data.first5CandleBankNiftyLots !== undefined) setBankNiftyLots(res.data.first5CandleBankNiftyLots);
    } catch { }
  };

  const saveLotConfig = async () => {
    setLotSaving(true);
    try {
      const existing = (await axios.get(`${API_URL}/shoonya-config`)).data;
      await axios.post(`${API_URL}/shoonya-config`, {
        ...existing,
        first5CandleNiftyLots: niftyLots,
        first5CandleBankNiftyLots: bankNiftyLots,
      });
      setLotSaved(true);
      setTimeout(() => setLotSaved(false), 2000);
    } catch { } finally { setLotSaving(false); }
  };

  useEffect(() => {
    fetchStates();
    fetchLotConfig();
    const id = setInterval(fetchStates, 15000);
    return () => clearInterval(id);
  }, []);

  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

  const dailyPnl = (() => {
    const realized = (history || [])
      .filter((h: any) =>
        h.strategyName === "FIRST_5_CANDLE" &&
        h.exitTime &&
        new Date(h.exitTime).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === today &&
        !(h.exitReason?.includes("Reconciled"))
      )
      .reduce((sum: number, h: any) => sum + (h.realizedPnl || 0), 0);
    const open = (portfolio?.positions || [])
      .filter((p: any) => p.strategyName === "FIRST_5_CANDLE")
      .reduce((sum: number, p: any) => sum + (p.currentLtp - p.entryPrice) * p.qty, 0);
    return realized + open;
  })();

  const activePositions = (portfolio?.positions || []).filter((p: any) => p.strategyName === "FIRST_5_CANDLE");
  const todayHistory    = (history || []).filter((h: any) =>
    h.strategyName === "FIRST_5_CANDLE" &&
    new Date(h.entryTime).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === today
  );

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">

      {/* Header */}
      <div className="bg-gradient-to-r from-violet-400/10 via-purple-500/10 to-transparent border border-violet-500/20 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-3">
              <BarChart2 className="w-7 h-7 text-violet-400" />
              5-Candle Rolling ORB
            </h2>
            <p className="text-sm text-neutral-400 mt-1">
              5-min chart. Rolling 5-candle range. Breakout on candle close confirmation. One trade per index per day.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Window</div>
              <div className="text-violet-400 font-mono font-bold text-sm">9:40–12:30</div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">SL / Target</div>
              <div className="text-violet-400 font-mono font-bold text-sm">−10% / +20%</div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Day P&L</div>
              <div className={`font-mono font-bold text-sm ${dailyPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                ₹{dailyPnl.toFixed(0)}
              </div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Indices</div>
              <div className="text-violet-400 font-mono font-bold text-sm">{states.length}</div>
            </div>

            {/* Lot config */}
            <div className="bg-neutral-900 border border-violet-500/20 px-4 py-2 rounded-xl flex items-center gap-3">
              <div>
                <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Lots</div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] text-neutral-600 mb-0.5">NIFTY</span>
                    <input type="number" min={1} max={10} value={niftyLots}
                      onChange={e => setNiftyLots(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-12 text-center font-mono text-sm bg-neutral-800 border border-neutral-700 rounded-lg px-1 py-1 text-white focus:border-violet-500 focus:outline-none" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] text-neutral-600 mb-0.5">BANKNIFTY</span>
                    <input type="number" min={1} max={10} value={bankNiftyLots}
                      onChange={e => setBankNiftyLots(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-12 text-center font-mono text-sm bg-neutral-800 border border-neutral-700 rounded-lg px-1 py-1 text-white focus:border-violet-500 focus:outline-none" />
                  </div>
                  <button onClick={saveLotConfig} disabled={lotSaving}
                    className={`mt-4 text-xs px-2 py-1 rounded-lg border font-medium transition-all ${lotSaved ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" : "border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20"} disabled:opacity-50`}>
                    {lotSaving ? "..." : lotSaved ? "✓" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Inner tabs */}
      <div className="flex gap-2 border-b border-neutral-800 pb-2">
        {(["signals", "ledger"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveInnerTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-all capitalize ${activeInnerTab === tab ? "text-violet-400 border-b-2 border-violet-400" : "text-neutral-500 hover:text-neutral-300"}`}>
            {tab === "signals" ? `Signals (${states.length})` : `Ledger (${activePositions.length + todayHistory.length})`}
          </button>
        ))}
      </div>

      {activeInnerTab === "signals" && (
        <div className="space-y-6">

          {lastUpdated && (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Clock className="w-3 h-3" /> Last updated {lastUpdated} IST · Refreshes every 15s
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-neutral-500">
              <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              Loading ORB states...
            </div>
          )}

          {/* Active positions */}
          <div>
            <h3 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${activePositions.length > 0 ? "bg-violet-400 animate-pulse" : "bg-neutral-600"}`} />
              Active Positions ({activePositions.length})
            </h3>
            {activePositions.length === 0 ? (
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 text-center text-sm text-neutral-500">
                No open ORB positions. A position appears here once a 5-candle breakout is confirmed.
              </div>
            ) : (
              <div className="space-y-3">
                {activePositions.map((pos: any) => {
                  const pnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                  const sl  = parseFloat((pos.entryPrice * 0.90).toFixed(2));
                  const tgt = parseFloat((pos.entryPrice * 1.20).toFixed(2));
                  return (
                    <div key={pos.token} className="bg-neutral-900 border border-violet-500/30 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${pos.type === "CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{pos.type}</span>
                          <span className="font-bold text-white">{pos.symbol}</span>
                          <span className="text-xs text-neutral-500 font-mono">{pos.tradingSymbol}</span>
                        </div>
                        <button onClick={() => handleSquareOff?.(pos.token)} disabled={squaringOff === pos.token}
                          className="text-xs px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 transition-all disabled:opacity-50">
                          {squaringOff === pos.token ? "Closing..." : "Square Off"}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div><span className="text-neutral-500">Entry (prem)</span><div className="font-mono text-white">₹{pos.entryPrice?.toFixed(2)}</div></div>
                        <div><span className="text-neutral-500">LTP (prem)</span><div className="font-mono text-white">₹{pos.currentLtp?.toFixed(2)}</div></div>
                        <div><span className="text-neutral-500">Qty</span><div className="font-mono text-white">{pos.qty}</div></div>
                        <div><span className="text-neutral-500">P&L</span><div className={`font-mono font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>₹{pnl.toFixed(0)}</div></div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                        <div><span className="text-neutral-500">Target (+20%)</span><div className="font-mono text-emerald-400">₹{tgt.toFixed(2)}</div></div>
                        <div><span className="text-neutral-500">SL (−10%)</span><div className="font-mono text-red-400">₹{sl.toFixed(2)}</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ORB state cards for NIFTY and BANKNIFTY */}
          <div>
            <h3 className="text-sm font-semibold text-neutral-300 mb-3">Rolling Range Status</h3>
            {states.length === 0 && !loading ? (
              <div className="text-center py-12 text-neutral-600">
                <BarChart2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <div className="text-sm">No states yet.</div>
                <div className="text-xs mt-1">Rolling ORB begins at 9:40 AM IST after 5 candles complete.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {states.map(s => (
                  <div key={s.symbol} className={`bg-neutral-900 rounded-xl p-4 border ${
                    s.state === "TRADED"   ? (s.breakoutDirection === "CE" ? "border-emerald-500/40" : "border-red-500/40") :
                    s.state === "WATCHING" ? "border-yellow-500/30" : "border-neutral-800"
                  }`}>
                    {/* Symbol + state */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-white text-lg">{s.symbol}</span>
                        <StateChip state={s.state} direction={s.breakoutDirection} />
                      </div>
                      <span className="text-[10px] text-neutral-500">{toIST(s.lastUpdated)}</span>
                    </div>

                    {/* Range */}
                    {s.resistance > 0 && (
                      <div className="mb-3 bg-neutral-950 rounded-lg p-3">
                        <div className="flex justify-between text-xs font-mono mb-1.5">
                          <span className="text-red-400">▼ S ₹{s.support.toFixed(2)}</span>
                          <span className="text-neutral-500">rolling range</span>
                          <span className="text-emerald-400">▲ R ₹{s.resistance.toFixed(2)}</span>
                        </div>
                        <div className="relative h-2 bg-neutral-800 rounded-full overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-r from-red-500/50 via-yellow-400/50 to-emerald-500/50 rounded-full" />
                        </div>
                        <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
                          <span>PE breakdown below</span>
                          <span>CE breakout above</span>
                        </div>
                      </div>
                    )}

                    {/* Window candles — mini strip */}
                    {s.windowCandles.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] text-neutral-500 mb-1">Window (5 range candles)</div>
                        <div className="flex gap-1 overflow-x-auto pb-1">
                          {s.windowCandles.map((c, i) => (
                            <CandleBar key={i} candle={c} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Activation candle */}
                    {s.activationCandle && (
                      <div>
                        <div className="text-[10px] text-neutral-500 mb-1">Activation candle (breakout check)</div>
                        <CandleBar candle={s.activationCandle} />
                      </div>
                    )}

                    {/* Breakout info */}
                    {s.breakoutAt && s.breakoutDirection && (
                      <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-mono ${s.breakoutDirection === "CE" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                        {s.breakoutDirection === "CE" ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                        {s.breakoutDirection} breakout confirmed at {toIST(s.breakoutAt)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeInnerTab === "ledger" && (
        <div className="space-y-4">
          <StrategyCalendar history={history || []} strategyName="FIRST_5_CANDLE" accentColor="violet" />

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-neutral-800">
              <h2 className="text-base font-bold text-white">5-Candle ORB Trade Ledger</h2>
              <p className="text-xs text-neutral-500 mt-1">NIFTY &amp; BANKNIFTY rolling 5-candle ORB. SL −10% / Target +20% on premium invested.</p>
            </div>

            {activePositions.length === 0 && todayHistory.length === 0 ? (
              <div className="text-center py-20 text-neutral-500">No ORB trades today.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-neutral-950/50 border-b border-neutral-800 text-neutral-400 font-medium">
                    <tr>
                      <th className="px-6 py-4">Buy Time</th>
                      <th className="px-6 py-4">Sell Time</th>
                      <th className="px-6 py-4">Option</th>
                      <th className="px-6 py-4">Action</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Entry / Exit</th>
                      <th className="px-6 py-4">Target / SL</th>
                      <th className="px-6 py-4">Note / Reason</th>
                      <th className="px-6 py-4 text-right">Realized P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {activePositions.map((pos: any, idx: number) => {
                      const livePnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                      const entryStr = pos.entryTime ? new Date(pos.entryTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "--";
                      return (
                        <tr key={`open-${idx}`} className="bg-violet-500/5 hover:bg-violet-500/10 transition-colors">
                          <td className="px-6 py-4 text-xs text-neutral-400 font-mono">{entryStr}</td>
                          <td className="px-6 py-4 text-xs text-neutral-500 font-mono">--</td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-violet-300">{pos.symbol}</div>
                            <div className="text-xs text-neutral-500 font-mono mt-0.5">{pos.tradingSymbol || pos.token}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${pos.type === "CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>BUY {pos.type}</span>
                            <span className="ml-2 text-xs font-mono text-neutral-500">x{pos.qty}</span>
                          </td>
                          <td className="px-6 py-4"><span className="px-2 py-0.5 rounded text-xs bg-violet-500/20 text-violet-400 animate-pulse">OPEN</span></td>
                          <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                            <div>In: <span className="text-neutral-200">₹{pos.entryPrice?.toFixed(2)}</span></div>
                            <div>LTP: <span className="text-violet-300 font-bold animate-pulse">₹{pos.currentLtp?.toFixed(2)}</span></div>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                            <div>T: <span className="text-emerald-400">₹{(pos.entryPrice * 1.20).toFixed(2)}</span></div>
                            <div>SL: <span className="text-rose-400">₹{(pos.entryPrice * 0.90).toFixed(2)}</span></div>
                          </td>
                          <td className="px-6 py-4 text-xs text-neutral-500">Active in Market</td>
                          <td className={`px-6 py-4 text-right font-mono font-bold ${livePnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {livePnl >= 0 ? "+" : ""}₹{livePnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}

                    {todayHistory.map((h: any, idx: number) => {
                      const entryStr = new Date(h.entryTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                      const exitStr  = h.exitTime ? new Date(h.exitTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "--";
                      return (
                        <tr key={`hist-${idx}`} className="hover:bg-neutral-800/20 transition-colors">
                          <td className="px-6 py-4 text-xs text-neutral-400 font-mono">{entryStr}</td>
                          <td className="px-6 py-4 text-xs text-neutral-500 font-mono">{exitStr}</td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-neutral-200">{h.symbol}</div>
                            <div className="text-xs text-neutral-500 font-mono mt-0.5">{h.tradingSymbol || h.token}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${h.type === "CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>BUY {h.type}</span>
                            <span className="ml-2 text-xs font-mono text-neutral-500">x{h.quantity}</span>
                          </td>
                          <td className="px-6 py-4"><span className="px-2 py-0.5 rounded text-xs bg-neutral-800 text-neutral-300">CLOSED</span></td>
                          <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                            <div>In: <span className="text-neutral-200">₹{h.entryPrice?.toFixed(2)}</span></div>
                            {h.exitPrice ? <div>Out: <span className="text-neutral-200">₹{h.exitPrice?.toFixed(2)}</span></div> : null}
                          </td>
                          <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                            <div>T: <span className="text-emerald-400">₹{(h.entryPrice * 1.20).toFixed(2)}</span></div>
                            <div>SL: <span className="text-rose-400">₹{(h.entryPrice * 0.90).toFixed(2)}</span></div>
                          </td>
                          <td className="px-6 py-4 text-xs text-neutral-500 max-w-[200px] truncate" title={h.exitReason || ""}>{h.exitReason || "--"}</td>
                          <td className="px-6 py-4 text-right font-mono font-bold">
                            {h.realizedPnl !== null && h.realizedPnl !== undefined ? (
                              <span className={h.realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                {h.realizedPnl >= 0 ? "+" : ""}₹{h.realizedPnl?.toFixed(2)}
                              </span>
                            ) : <span className="text-neutral-600">--</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
