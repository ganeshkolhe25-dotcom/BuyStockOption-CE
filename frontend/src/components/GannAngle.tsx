"use client";

import { useState } from "react";
import axios from "axios";
import { Search, TrendingUp, TrendingDown, Crosshair, AlertTriangle, Lock, Clock } from "lucide-react";

const NIFTY_100 = [
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "INFY", "ITC", "SBI", "L&T", "BAJFINANCE",
  "KOTAKBANK", "AXISBANK", "HAL", "M&M", "HCLTECH", "TATAMOTORS", "SUNPHARMA", "NTPC", "TATAPOWER",
  "MARUTI", "ONGC", "TATASTEEL", "POWERGRID", "ASIANPAINT", "BAJAJFINSV", "TITAN", "COALINDIA", "BAJAJ-AUTO",
  "ADANIPORTS", "ADANIENT", "DIXON", "WIPRO", "HINDUNILVR", "DRREDDY", "IOC", "GRASIM", "TECHM", "JSWSTEEL",
  "APOLLOHOSP", "INDUSINDBK", "EICHERMOT", "HDFCLIFE", "BPCL", "BRITANNIA", "CIPLA", "VEDL", "DIVISLAB",
  "HEROMOTOCO", "SHREECEM", "TRENT", "BEL", "CHOLAFIN", "TVSMOTOR", "GAIL", "ZOMATO", "INDIGO", "AMBUJACEM",
  "PNB", "TORNTPHARM", "ABB", "TATACOMM", "UPL", "BANKBARODA", "BOSCHLTD", "MUTHOOTFIN", "COLPAL", "HAVELLS",
  "AUBANK", "ICICIPRULI", "SRF", "MARICO", "GODREJCP", "ICICIGI", "ASHOKLEY", "LODHA", "TATACHEM", "MCDOWELL-N",
  "PIIND", "NAUKRI", "BERGEPAINT", "IRCTC", "CUMMINSIND", "TIINDIA", "OBEROIRLTY", "VOLTAS", "JUBLFOOD",
  "DALBHARAT", "ABBOTINDIA", "ESCORTS", "ZYDUSLIFE", "LALPATHLAB", "ALKEM", "ASTRAL", "COROMANDEL", "PFC",
  "RECLTD", "CONCOR", "IDFCFIRSTB", "BALKRISIND", "PEL"
];

export default function GannAngle({ isEnabled, portfolio, history, handleSquareOff, squaringOff, watchlist }: { isEnabled?: boolean, portfolio?: any, history?: any[], handleSquareOff?: (token: string) => void, squaringOff?: string | null, watchlist?: any[] }) {
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [activeInnerTab, setActiveInnerTab] = useState<'analysis' | 'ledger'>('analysis');

  const handleSearch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!symbol) return;
    setLoading(true);
    setError("");
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const res = await axios.get(`${API_URL}/gann-angle/${symbol.toUpperCase()}`);
      if (res.data.status === 'success') {
        setData(res.data);
      } else {
        setError(res.data.message || "Failed to fetch Gann Angle data");
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Error fetching data for the symbol");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
      
      <div className="flex gap-2 border-b border-neutral-800 pb-2">
         <button 
            onClick={() => setActiveInnerTab('analysis')}
            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeInnerTab === 'analysis' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
         >
            NIFTY 100 Analysis Scanner
         </button>
         <button 
            onClick={() => setActiveInnerTab('ledger')}
            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeInnerTab === 'ledger' ? 'border-blue-500 text-blue-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
         >
            Trade Ledger (Historical)
         </button>
      </div>

      {activeInnerTab === 'analysis' && (
      <div className="space-y-6">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 relative">
        {!isEnabled && (
           <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-2xl border border-rose-500/20">
              <div className="text-center">
                 <Lock className="w-12 h-12 text-rose-500 mx-auto mb-3 opacity-50" />
                 <h3 className="text-xl font-bold text-neutral-300">Strategy Disabled</h3>
                 <p className="text-sm text-neutral-500">Enable Gann Angle engine from the Dashboard tab.</p>
              </div>
           </div>
        )}
        
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h2 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Gann Angle Analysis</h2>
          {/* A5: Active time window badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-[11px] text-indigo-400 font-semibold">
            <Clock className="w-3 h-3" /> Active Window: 9:20 AM – 11:30 AM IST
          </div>
        </div>
        <p className="text-sm text-neutral-400 mb-6">Select a NIFTY 100 stock symbol to calculate structural trend based on 1x1, 2x1, and 1x2 geometric angles.</p>
        
        <form onSubmit={handleSearch} className="flex gap-4">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input 
              type="text" 
              list="nifty100-list"
              placeholder="Search NIFTY 100: e.g. RELIANCE, TCS, INFY" 
              value={symbol}
              disabled={!isEnabled}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl py-3 pl-12 pr-4 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all uppercase placeholder:normal-case font-mono disabled:opacity-50"
            />
            <datalist id="nifty100-list">
              {NIFTY_100.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <button 
            type="submit" 
            disabled={loading || !isEnabled}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium px-8 rounded-xl transition-all"
          >
            {loading ? "Calculating..." : "Analyze"}
          </button>
        </form>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <p>{error}</p>
        </div>
      )}

      {data && data.levels && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Signal Panel */}
          <div className="lg:col-span-1 bg-neutral-900 border border-neutral-800 rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Crosshair className="w-32 h-32" />
            </div>
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">Signal Status</h3>
            <div className="text-3xl font-bold mb-1">{data.symbol}</div>
            <div className="text-neutral-500 font-mono mb-6">LTP: ₹{data.ltp}</div>

            <div className={`p-4 rounded-xl border ${data.signal.type === 'CE' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : data.signal.type === 'PE' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-neutral-800/50 border-neutral-700 text-neutral-300'}`}>
              <div className="flex items-center gap-2 font-bold mb-2 text-lg">
                {data.signal.type === 'CE' ? <TrendingUp /> : data.signal.type === 'PE' ? <TrendingDown /> : <AlertTriangle />}
                {data.signal.status}
              </div>
              {data.signal.type !== 'NONE' && (
                <div className="space-y-2 mt-4 text-sm font-mono">
                  <div className="flex justify-between">
                    <span>Entry {data.signal.type === 'CE' ? 'Above' : 'Below'} (1x1):</span>
                    <span className="font-bold text-white">₹{data.signal.entryTrigger}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Target (1x2 Angle):</span>
                    <span className="font-bold text-emerald-400">₹{data.signal.target}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Stop Loss (2x1 Angle):</span>
                    <span className="font-bold text-rose-400">₹{data.signal.sl}</span>
                  </div>
                </div>
              )}
            </div>

             <div className="mt-4 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <h4 className="text-xs font-bold text-indigo-400 uppercase mb-2">Trade Execution Rules</h4>
                <ul className="text-xs text-indigo-200/70 space-y-1 list-disc pl-4">
                  <li>Entry: LTP sustains above/below 1x1 angle for 5 min</li>
                  <li>Target: 1x2 angle (steeper angle in trend direction)</li>
                  <li>Stop Loss: 2x1 angle (shallower angle, trend support)</li>
                  <li>Window: 9:20 AM – 11:30 AM IST only</li>
                  <li>Daily Max Loss Block: ₹10,000 per strategy</li>
                </ul>
             </div>
          </div>

          {/* Angles Chart Representation */}
          <div className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-6">Gann Angle Geometry</h3>
            
            <div className="relative pt-4 pb-8 h-64 border-l border-b border-neutral-800 ml-12">
               <div className="absolute -left-12 top-0 text-xs text-emerald-500 font-mono">₹{data.levels.angle1x2_Up}</div>
               <div className="absolute -left-12 top-1/4 text-xs text-emerald-500/70 font-mono">₹{data.levels.angle1x1_Up}</div>
               <div className="absolute -left-12 top-1/2 -mt-3 text-xs text-neutral-400 font-mono">₹{data.levels.previousClose}</div>
               <div className="absolute -left-12 bottom-1/4 text-xs text-rose-500/70 font-mono">₹{data.levels.angle1x1_Dn}</div>
               <div className="absolute -left-12 bottom-0 text-xs text-rose-500 font-mono">₹{data.levels.angle1x2_Dn}</div>

               {/* 1x2 UP */}
               <div className="absolute border-t border-emerald-500/20 w-full top-0"></div>
               <div className="absolute left-4 top-[-10px] text-[10px] text-emerald-500 bg-neutral-900 px-1">1x2 Angle (Major Resistance)</div>

               {/* 1x1 UP */}
               <div className="absolute border-t border-emerald-500/10 w-full top-1/4"></div>
               <div className="absolute left-4 top-[calc(25%-10px)] text-[10px] text-emerald-500/70 bg-neutral-900 px-1">1x1 Angle (Bullish Trendline)</div>

               {/* 1x1 DN */}
               <div className="absolute border-t border-rose-500/10 w-full bottom-1/4"></div>
               <div className="absolute left-4 top-[calc(75%-10px)] text-[10px] text-rose-500/70 bg-neutral-900 px-1">1x1 Angle (Bearish Trendline)</div>

               {/* 1x2 DN */}
               <div className="absolute border-t border-rose-500/20 w-full bottom-0"></div>
               <div className="absolute left-4 top-[calc(100%-10px)] text-[10px] text-rose-500 bg-neutral-900 px-1">1x2 Angle (Major Support)</div>

               {/* LTP MARKER */}
               <div 
                 className="absolute w-full h-[2px] bg-indigo-500 z-10 flex items-center shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-1000"
                 style={{ 
                   top: data.ltp >= data.levels.angle1x2_Up ? '0%' : 
                        data.ltp <= data.levels.angle1x2_Dn ? '100%' :
                        `${100 - ((data.ltp - data.levels.angle1x2_Dn) / (data.levels.angle1x2_Up - data.levels.angle1x2_Dn)) * 100}%`
                  }}
               >
                 <div className="absolute -right-2 top-1/2 -mt-1 w-2 h-2 rounded-full bg-white shadow-[0_0_8px_white] animate-pulse"></div>
                 <div className="absolute right-2 -mt-5 bg-indigo-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">LTP: ₹{data.ltp}</div>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending Signals — Gann Angle entries awaiting immediate execution */}
      {activeInnerTab === 'analysis' && (() => {
        const pending = (watchlist || []).filter((w: any) => w.strategyName === 'GANN_ANGLE');
        if (pending.length === 0) return null;
        return (
          <div className="bg-neutral-900 border border-amber-500/20 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Pending Gann Angle Signals
              <span className="ml-auto px-2 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded">{pending.length} Queued</span>
            </h3>
            <div className="space-y-2">
              {pending.map((item: any) => {
                const elapsed = Date.now() - item.breakoutTime;
                const isReady = elapsed >= 0;
                return (
                  <div key={item.symbol} className="flex items-center justify-between px-4 py-3 rounded-xl bg-neutral-950 border border-neutral-800">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-white">{item.symbol}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold border ${item.type === 'CE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                        {item.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-xs font-mono text-neutral-400">
                      <span>Trigger: <span className="text-white">₹{item.triggerPrice?.toFixed(2)}</span></span>
                      <span>T: <span className="text-emerald-400">₹{item.targetPrice?.toFixed(2)}</span></span>
                      <span>SL: <span className="text-rose-400">₹{item.slPrice?.toFixed(2)}</span></span>
                      {isReady && <span className="text-indigo-400 font-bold animate-pulse uppercase tracking-wider">Executing...</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Active Trades — always visible under NIFTY 100 Analysis Scanner */}
      {activeInnerTab === 'analysis' && (
         <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4 flex items-center gap-2">
               <TrendingUp className="w-4 h-4 text-indigo-400" /> Active Gann Angle Trades
               <span className="ml-auto px-2 py-0.5 text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded">
                  {portfolio?.positions?.filter((p: any) => p.strategyName === 'GANN_ANGLE').length || 0} Running
               </span>
            </h3>

            {(!portfolio?.positions || portfolio.positions.filter((p: any) => p.strategyName === 'GANN_ANGLE').length === 0) ? (
               <div className="flex flex-col items-center justify-center py-10 border border-dashed border-neutral-800 rounded-xl text-neutral-600 gap-2">
                  <TrendingUp className="w-8 h-8 opacity-30" />
                  <p className="text-sm">No active Gann Angle trades running right now.</p>
                  <p className="text-xs">Trades will appear here automatically once the engine detects a valid 1x1 angle breakout.</p>
               </div>
            ) : (
               <div className="space-y-3">
                  {portfolio.positions.filter((p: any) => p.strategyName === 'GANN_ANGLE').map((pos: any, idx: number) => {
                     const livePnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                     return (
                       <div key={idx} className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-indigo-500/30 transition-all">
                          <div className="flex items-center gap-4">
                             <div className={`p-2 rounded-lg ${pos.type === 'CE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                {pos.type === 'CE' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                             </div>
                             <div>
                                <div className="font-bold text-white">{pos.symbol} <span className="text-xs font-mono text-neutral-500 ml-2">{pos.tradingSymbol}</span></div>
                                <div className="text-xs text-neutral-500">Entry: ₹{pos.entryPrice} @ {pos.entryTime ? new Date(pos.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Today'}</div>
                                <div className="text-xs text-neutral-600 mt-0.5 font-mono">Target: <span className="text-amber-500">₹{pos.targetPrice?.toFixed(2)}</span> &nbsp;|&nbsp; SL: <span className="text-rose-500">₹{pos.slPrice?.toFixed(2)}</span></div>
                             </div>
                          </div>
                          <div className="mt-4 md:mt-0 flex items-center gap-6">
                             <div className="text-right">
                                <div className="text-[10px] text-neutral-500 uppercase font-bold">Option LTP</div>
                                <div className="text-white font-mono font-bold animate-pulse">₹{pos.currentLtp}</div>
                             </div>
                             <div className="text-right">
                                <div className="text-[10px] text-neutral-500 uppercase font-bold">Qty</div>
                                <div className="text-neutral-300 font-mono font-bold">{pos.qty}</div>
                             </div>
                             <div className="text-right min-w-[100px]">
                                <div className="text-[10px] text-neutral-500 uppercase font-bold">Running P&L</div>
                                <div className={`font-mono font-bold text-lg ${livePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                   {livePnl >= 0 ? '+' : ''}₹{livePnl.toFixed(2)}
                                </div>
                             </div>
                             {handleSquareOff && (
                               <button
                                 onClick={() => handleSquareOff(pos.token)}
                                 disabled={squaringOff === pos.token}
                                 className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${squaringOff === pos.token ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30'}`}
                               >
                                 {squaringOff === pos.token ? 'Closing...' : 'Square Off'}
                               </button>
                             )}
                          </div>
                       </div>
                     );
                  })}
               </div>
            )}
         </div>
      )}
      </div>
      )}

      {activeInnerTab === 'ledger' && (
         <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 relative overflow-hidden">
            <h2 className="text-xl font-bold text-white mb-4">Gann Angle Ledger</h2>
            <p className="text-sm text-neutral-400 mb-6">Live and Historical Option executions generated strictly by the NIFTY 100 Gann Angle geometry module.</p>
            
            {(!history || history.filter(h => h.strategyName === 'GANN_ANGLE').length === 0) && (!portfolio?.positions || portfolio.positions.filter((p: any) => p.strategyName === 'GANN_ANGLE').length === 0) && !isEnabled ? (
               <div className="text-center py-20 border border-dashed border-neutral-800 rounded-2xl text-neutral-500">
                  Engine disabled. No trade history yet.
               </div>
            ) : (
               <div className="overflow-x-auto">
                 <table className="w-full text-sm text-left text-neutral-400">
                   <thead className="text-xs uppercase bg-neutral-950/50 border-b border-neutral-800 text-neutral-500">
                     <tr>
                        <th className="px-6 py-4">Date/Time</th>
                        <th className="px-6 py-4">Symbol</th>
                        <th className="px-6 py-4">Structure</th>
                        <th className="px-6 py-4">Type (CE/PE)</th>
                        <th className="px-6 py-4">Entry</th>
                        <th className="px-6 py-4">Exit</th>
                        <th className="px-6 py-4 text-right">Net P&L</th>
                     </tr>
                   </thead>
                   <tbody>
                      {(!history || history.filter(h => h.strategyName === 'GANN_ANGLE').length === 0) && (!portfolio?.positions || portfolio.positions.filter((p: any) => p.strategyName === 'GANN_ANGLE').length === 0) ? (
                      <tr className="border-b border-neutral-800/50 bg-neutral-900/20">
                         <td className="px-6 py-4 text-neutral-600" colSpan={7} style={{textAlign: 'center'}}>No Gann Angle Option Trades have been executed yet...</td>
                      </tr>
                      ) : (
                        <>
                           {/* Active Positions Block */}
                           {portfolio?.positions?.filter((p: any) => p.strategyName === 'GANN_ANGLE').map((pos: any, idx: number) => {
                               const livePnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                               return (
                                 <tr key={`act-${idx}`} className="border-b border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors">
                                   <td className="px-6 py-4 whitespace-nowrap">
                                      <span className="px-2 py-1 text-[10px] bg-blue-500/20 text-blue-400 rounded border border-blue-500/30">LIVESTREAM</span>
                                   </td>
                                   <td className="px-6 py-4 font-bold text-indigo-300">{pos.symbol} <span className="text-[10px] bg-neutral-800 px-1 py-0.5 rounded text-neutral-400 ml-2">{pos.tradingSymbol}</span></td>
                                   <td className="px-6 py-4">GANN_ANGLE</td>
                                   <td className="px-6 py-4 font-bold text-white">{pos.type}</td>
                                   <td className="px-6 py-4 font-mono text-neutral-300">₹{pos.entryPrice} <span className="text-xs text-neutral-500">[{pos.qty} Qty]</span></td>
                                   <td className="px-6 py-4 font-mono">
                                       <span className="text-blue-400 animate-pulse">Live: ₹{pos.currentLtp}</span>
                                   </td>
                                   <td className={`px-6 py-4 font-bold text-right font-mono ${livePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {livePnl >= 0 ? '+' : ''}₹{livePnl.toFixed(2)}
                                   </td>
                                 </tr>
                               );
                           })}

                           {/* Historical Positions Block */}
                           {history?.filter(h => h.strategyName === 'GANN_ANGLE').map((record: any, idx: number) => {
                              const isWin = record.realizedPnl > 0;
                              return (
                                 <tr key={`hist-${idx}`} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors">
                                   <td className="px-6 py-4 whitespace-nowrap">{new Date(record.entryTime).toLocaleString()}</td>
                                   <td className="px-6 py-4 text-white font-medium">{record.symbol}</td>
                                   <td className="px-6 py-4">GANN_ANGLE</td>
                                   <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-[10px] font-bold ${record.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{record.type}</span></td>
                                   <td className="px-6 py-4 font-mono">₹{record.entryPrice} <span className="text-xs text-neutral-600">[{record.quantity} Qty]</span></td>
                                   <td className="px-6 py-4 font-mono text-neutral-400">₹{record.exitPrice || 'N/A'}</td>
                                   <td className={`px-6 py-4 font-bold text-right font-mono ${isWin ? 'text-emerald-500' : 'text-rose-500'}`}>
                                      {isWin ? '+' : ''}₹{record.realizedPnl?.toFixed(2) || '0.00'}
                                   </td>
                                 </tr>
                              );
                           })}
                        </>
                      )}
                   </tbody>
                 </table>
               </div>
            )}
         </div>
      )}
    </div>
  );
}
