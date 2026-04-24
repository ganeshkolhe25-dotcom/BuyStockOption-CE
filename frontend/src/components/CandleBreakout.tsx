"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { CandlestickChart, TrendingUp, TrendingDown, Clock, AlertTriangle, Minus } from "lucide-react";
import StrategyCalendar from "./StrategyCalendar";

interface OneMinCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isGreen: boolean;
}

interface CandleSetup {
  symbol: string;
  candle1: OneMinCandle;
  candle2: OneMinCandle;
  rangeHigh: number;
  rangeLow: number;
  foundAt: number;
  signal: "PENDING" | "CE" | "PE";
  breakoutPrice?: number;
  breakoutAt?: number;
  entryTargetPrice?: number;
  entrySlPrice?: number;
}

function toIST(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

function CandleBar({ candle }: { candle: OneMinCandle }) {
  const color = candle.isGreen ? "text-emerald-400" : "text-red-400";
  const bg = candle.isGreen ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30";
  return (
    <div className={`flex flex-col gap-0.5 text-[10px] font-mono px-2 py-1.5 rounded-lg border ${bg}`}>
      <span className={`font-bold ${color}`}>{candle.isGreen ? "🟢" : "🔴"} {toIST(candle.time * 1000)}</span>
      <span className="text-neutral-400">H: <span className="text-white">{candle.high.toFixed(2)}</span></span>
      <span className="text-neutral-400">L: <span className="text-white">{candle.low.toFixed(2)}</span></span>
      <span className="text-neutral-400">O: {candle.open.toFixed(2)} → C: {candle.close.toFixed(2)}</span>
    </div>
  );
}

function TrafficLight({ signal }: { signal: "PENDING" | "CE" | "PE" }) {
  return (
    <div className="flex flex-col gap-1.5 items-center">
      {/* Red */}
      <div className={`w-4 h-4 rounded-full transition-all ${signal === "PE" ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" : "bg-neutral-800"}`} />
      {/* Yellow */}
      <div className={`w-4 h-4 rounded-full transition-all ${signal === "PENDING" ? "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)] animate-pulse" : "bg-neutral-800"}`} />
      {/* Green */}
      <div className={`w-4 h-4 rounded-full transition-all ${signal === "CE" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-neutral-800"}`} />
    </div>
  );
}

export default function CandleBreakout({ portfolio, history, handleSquareOff, squaringOff }: {
  portfolio?: any;
  history?: any[];
  handleSquareOff?: (token: string) => void;
  squaringOff?: string | null;
}) {
  const [setups, setSetups] = useState<CandleSetup[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [activeInnerTab, setActiveInnerTab] = useState<"signals" | "ledger">("signals");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  const fetchSetups = async () => {
    try {
      const res = await axios.get(`${API_URL}/candle-breakout`);
      if (res.data.status === "success") {
        setSetups(res.data.data);
        setLastUpdated(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }));
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSetups();
    const id = setInterval(fetchSetups, 15000);
    return () => clearInterval(id);
  }, []);

  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

  const dailyPnl = (() => {
    const realized = (history || [])
      .filter((h: any) =>
        h.strategyName === "CANDLE_BREAKOUT" &&
        h.exitTime &&
        new Date(h.exitTime).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === today &&
        !(h.exitReason?.includes("Reconciled"))
      )
      .reduce((sum: number, h: any) => sum + (h.realizedPnl || 0), 0);
    const open = (portfolio?.positions || [])
      .filter((p: any) => p.strategyName === "CANDLE_BREAKOUT")
      .reduce((sum: number, p: any) => sum + (p.currentLtp - p.entryPrice) * p.qty, 0);
    return realized + open;
  })();

  const pending = setups.filter(s => s.signal === "PENDING");
  const triggered = setups.filter(s => s.signal !== "PENDING");
  const activePositions = (portfolio?.positions || []).filter((p: any) => p.strategyName === "CANDLE_BREAKOUT");
  const todayHistory = (history || []).filter((h: any) =>
    h.strategyName === "CANDLE_BREAKOUT" &&
    new Date(h.entryTime).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === today
  );

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">

      {/* Header */}
      <div className="bg-gradient-to-r from-orange-400/10 via-yellow-500/10 to-transparent border border-orange-500/20 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent flex items-center gap-3">
              <CandlestickChart className="w-7 h-7 text-orange-400" />
              2-Candle Breakout
            </h2>
            <p className="text-sm text-neutral-400 mt-1">
              1-min chart. Skip 9:15 candle. Find red+green or green+red pair → mark range → trade the breakout.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Window</div>
              <div className="text-orange-400 font-mono font-bold text-sm">9:18–11:30</div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Sustain</div>
              <div className="text-orange-400 font-mono font-bold text-sm">Immediate</div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Day P&L</div>
              <div className={`font-mono font-bold text-sm ${dailyPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                ₹{dailyPnl.toFixed(0)}
              </div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Setups</div>
              <div className="text-yellow-400 font-mono font-bold text-sm">{setups.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Inner tab nav */}
      <div className="flex gap-2 border-b border-neutral-800 pb-2">
        {(["signals", "ledger"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveInnerTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-all capitalize ${activeInnerTab === tab ? "text-orange-400 border-b-2 border-orange-400" : "text-neutral-500 hover:text-neutral-300"}`}>
            {tab === "signals" ? `Signals (${setups.length})` : `Ledger (${activePositions.length + todayHistory.length})`}
          </button>
        ))}
      </div>

      {activeInnerTab === "signals" && (
        <div className="space-y-6">

          {/* Last updated */}
          {lastUpdated && (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Clock className="w-3 h-3" />
              Last updated {lastUpdated} IST · Refreshes every 15s
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-neutral-500">
              <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              Loading setups...
            </div>
          )}

          {/* Active positions — always visible */}
          <div>
            <h3 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${activePositions.length > 0 ? "bg-orange-400 animate-pulse" : "bg-neutral-600"}`} />
              Active Positions ({activePositions.length})
            </h3>
            {activePositions.length === 0 ? (
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 text-center text-sm text-neutral-500">
                No open 2-Candle positions right now. A position will appear here once a breakout is detected and an option is bought.
              </div>
            ) : (
              <div className="space-y-3">
                {activePositions.map((pos: any) => {
                  const pnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                  return (
                    <div key={pos.token} className="bg-neutral-900 border border-orange-500/30 rounded-xl p-4">
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
                        <div><span className="text-neutral-500">Entry</span><div className="font-mono text-white">₹{pos.entryPrice?.toFixed(2)}</div></div>
                        <div><span className="text-neutral-500">LTP</span><div className="font-mono text-white">₹{pos.currentLtp?.toFixed(2)}</div></div>
                        <div><span className="text-neutral-500">Qty</span><div className="font-mono text-white">{pos.qty}</div></div>
                        <div><span className="text-neutral-500">P&L</span><div className={`font-mono font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>₹{pnl.toFixed(0)}</div></div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                        <div><span className="text-neutral-500">Target (stock)</span><div className="font-mono text-emerald-400">₹{pos.targetPrice?.toFixed(2)}</div></div>
                        <div><span className="text-neutral-500">SL (stock)</span><div className="font-mono text-red-400">₹{pos.slPrice?.toFixed(2)}</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Triggered signals */}
          {triggered.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-neutral-300 mb-3">Triggered Today ({triggered.length})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {triggered.map(setup => (
                  <div key={setup.symbol} className={`bg-neutral-900 border rounded-xl p-4 ${setup.signal === "CE" ? "border-emerald-500/30" : "border-red-500/30"}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <TrafficLight signal={setup.signal} />
                        <div>
                          <div className="font-bold text-white">{setup.symbol}</div>
                          <div className={`text-xs font-bold ${setup.signal === "CE" ? "text-emerald-400" : "text-red-400"}`}>
                            {setup.signal === "CE" ? "▲ BULLISH BREAKOUT" : "▼ BEARISH BREAKDOWN"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-xs text-neutral-500">
                        {setup.breakoutAt ? toIST(setup.breakoutAt) : ""}
                      </div>
                    </div>
                    <div className="flex gap-2 mb-3">
                      <CandleBar candle={setup.candle1} />
                      <CandleBar candle={setup.candle2} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-neutral-950 rounded-lg p-2">
                        <div className="text-neutral-500">Range High</div>
                        <div className="font-mono text-white">₹{setup.rangeHigh.toFixed(2)}</div>
                      </div>
                      <div className="bg-neutral-950 rounded-lg p-2">
                        <div className="text-neutral-500">Range Low</div>
                        <div className="font-mono text-white">₹{setup.rangeLow.toFixed(2)}</div>
                      </div>
                      <div className="bg-neutral-950 rounded-lg p-2">
                        <div className="text-neutral-500">Entry LTP</div>
                        <div className="font-mono text-yellow-400">₹{setup.breakoutPrice?.toFixed(2)}</div>
                      </div>
                      <div className="bg-neutral-950 rounded-lg p-2">
                        <div className="text-neutral-500">Target / SL</div>
                        <div className="font-mono">
                          <span className="text-emerald-400">₹{setup.entryTargetPrice?.toFixed(2)}</span>
                          <span className="text-neutral-600"> / </span>
                          <span className="text-red-400">₹{setup.entrySlPrice?.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending setups */}
          {pending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                Watching for Breakout ({pending.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {pending.map(setup => {
                  const rangePct = ((setup.rangeHigh - setup.rangeLow) / setup.rangeLow * 100).toFixed(2);
                  return (
                    <div key={setup.symbol} className="bg-neutral-900 border border-yellow-500/20 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <TrafficLight signal="PENDING" />
                          <div>
                            <div className="font-bold text-white">{setup.symbol}</div>
                            <div className="text-xs text-yellow-400">⏳ Range Set · {rangePct}% wide</div>
                          </div>
                        </div>
                        <div className="text-right text-xs text-neutral-500">{toIST(setup.foundAt)}</div>
                      </div>
                      <div className="flex gap-2 mb-3">
                        <CandleBar candle={setup.candle1} />
                        <CandleBar candle={setup.candle2} />
                      </div>
                      <div className="mt-2 bg-neutral-950 rounded-lg p-3">
                        {/* Mini range bar */}
                        <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                          <span className="text-red-400">▼ ₹{setup.rangeLow.toFixed(2)}</span>
                          <span className="text-neutral-500">range</span>
                          <span className="text-emerald-400">▲ ₹{setup.rangeHigh.toFixed(2)}</span>
                        </div>
                        <div className="relative h-2 bg-neutral-800 rounded-full overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-r from-red-500/50 via-yellow-400/50 to-emerald-500/50 rounded-full" />
                        </div>
                        <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
                          <span>PE entry below</span>
                          <span>CE entry above</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && setups.length === 0 && (
            <div className="text-center py-16 text-neutral-600">
              <CandlestickChart className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <div className="text-sm">No setups detected yet.</div>
              <div className="text-xs mt-1">Scanning begins at 9:18 AM IST. Requires 2 completed 1-min candles after skipping the 9:15 open.</div>
            </div>
          )}
        </div>
      )}

      {activeInnerTab === "ledger" && (
        <div className="space-y-4">
          <StrategyCalendar history={history || []} strategyName="CANDLE_BREAKOUT" accentColor="orange" />

          {/* Open positions */}
          {activePositions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                Open Positions ({activePositions.length})
              </h3>
              <div className="space-y-3">
                {activePositions.map((pos: any) => {
                  const pnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                  const entryIST = new Date(pos.entryTime).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
                  return (
                    <div key={pos.token} className="bg-neutral-900 border border-orange-500/30 rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${pos.type === "CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{pos.type}</span>
                        <div>
                          <div className="font-bold text-white text-sm">{pos.symbol}</div>
                          <div className="text-xs text-neutral-500 font-mono">{pos.tradingSymbol}</div>
                        </div>
                      </div>
                      <div className="text-xs text-neutral-500 text-center hidden md:block">
                        <div>{entryIST} → <span className="text-orange-400">OPEN</span></div>
                        <div className="mt-0.5">LTP ₹{pos.currentLtp?.toFixed(2)}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold font-mono ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>₹{pnl.toFixed(0)}</div>
                        <div className="text-xs text-neutral-500">Qty {pos.qty}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Closed trades */}
          {todayHistory.length === 0 && activePositions.length === 0 ? (
            <div className="text-center py-12 text-neutral-600 text-sm">No 2-Candle trades today.</div>
          ) : todayHistory.length > 0 ? (
            <div>
              {activePositions.length > 0 && (
                <h3 className="text-sm font-semibold text-neutral-300 mb-3">Closed Trades ({todayHistory.length})</h3>
              )}
              <div className="space-y-3">
                {todayHistory.map((h: any, i: number) => {
                  const pnl = h.realizedPnl || 0;
                  const entryIST = new Date(h.entryTime).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
                  const exitIST = h.exitTime ? new Date(h.exitTime).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) : "—";
                  return (
                    <div key={i} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${h.type === "CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{h.type}</span>
                        <div>
                          <div className="font-bold text-white text-sm">{h.symbol}</div>
                          <div className="text-xs text-neutral-500 font-mono">{h.tradingSymbol}</div>
                        </div>
                      </div>
                      <div className="text-xs text-neutral-500 text-center hidden md:block">
                        <div>{entryIST} → {exitIST}</div>
                        <div className="mt-0.5">{h.exitReason?.slice(0, 30)}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold font-mono ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>₹{pnl.toFixed(0)}</div>
                        <div className="text-xs text-neutral-500">Qty {h.quantity}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
