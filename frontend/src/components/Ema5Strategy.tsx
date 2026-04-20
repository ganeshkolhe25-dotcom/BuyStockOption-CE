"use client";

import { useState } from "react";
import axios from "axios";
import { Activity, TrendingUp, TrendingDown, Crosshair, BarChart2, List } from "lucide-react";

export default function Ema5Strategy({ isEnabled, portfolio, history }: { isEnabled?: boolean, portfolio?: any, history?: any[] }) {
  const [squaringOff, setSquaringOff] = useState<string | null>(null);

  const dailyPnl = (() => {
    const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
    const realized = (history || [])
      .filter((h: any) => h.strategyName === 'EMA_5' && h.exitTime &&
        new Date(h.exitTime).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) === today &&
        !(h.exitReason && h.exitReason.includes('Reconciled')))
      .reduce((sum: number, h: any) => sum + (h.realizedPnl || 0), 0);
    const open = (portfolio?.positions || [])
      .filter((p: any) => p.strategyName === 'EMA_5')
      .reduce((sum: number, p: any) => sum + (p.currentLtp - p.entryPrice) * p.qty, 0);
    return realized + open;
  })();

  const handleSquareOff = async (token: string) => {
    try {
      setSquaringOff(token);
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      await axios.post(`${API_URL}/square-off`, { token });
    } catch (err) {
      console.error(err);
      alert("Failed to square off position.");
    } finally {
      setSquaringOff(null);
    }
  };
  const [activeInnerTab, setActiveInnerTab] = useState<'scanner' | 'chart' | 'ledger'>('scanner');

  return (
    <div className="relative space-y-6 animate-in fade-in zoom-in-95 duration-500">

      {/* Power Overlay */}
      {!isEnabled && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center border border-neutral-800 pointer-events-auto">
           <div className="w-16 h-16 rounded-full bg-rose-500/20 text-rose-500 flex items-center justify-center mb-4 border border-rose-500/50 shadow-[0_0_30px_rgba(244,63,94,0.3)]">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
           </div>
           <h2 className="text-2xl font-bold tracking-widest text-white uppercase drop-shadow-md">5 EMA Engine Offline</h2>
           <p className="text-neutral-400 mt-2 max-w-sm text-center text-sm">Activate the 5 EMA Mean Reversion engine securely from the Global Dashboard.</p>
        </div>
      )}

      {/* Header Info */}
      <div className="bg-gradient-to-r from-orange-400/10 via-amber-500/10 to-transparent border border-amber-500/20 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent flex items-center gap-3">
              <Activity className="w-7 h-7 text-amber-500" />
              5 EMA Mean Reversion (5m)
            </h2>
            <p className="text-sm text-neutral-400 mt-1">Alert + Activation candle logic on volatile Nifty 100 stocks. When price overstreches from 5 EMA, a sharp reversal is expected.</p>
          </div>
          <div className="flex gap-3">
             <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
                 <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Risk : Reward</div>
                 <div className="text-emerald-400 font-mono font-bold">1 : 3</div>
             </div>
             <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
                 <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Entry Buffer</div>
                 <div className="text-amber-400 font-mono font-bold">₹ 1.5</div>
             </div>
             <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-center">
                 <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Trail SL</div>
                 <div className="text-sky-400 font-mono font-bold">@ 1:2</div>
             </div>
             <div className={`border px-4 py-2 rounded-xl text-center ${dailyPnl >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                 <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Today&apos;s P&L</div>
                 <div className={`font-mono font-bold ${dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                   {dailyPnl >= 0 ? '+' : ''}₹{dailyPnl.toFixed(2)}
                 </div>
             </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-b border-neutral-800 pb-2">
         <button onClick={() => setActiveInnerTab('scanner')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeInnerTab === 'scanner' ? 'border-amber-500 text-amber-400' : 'border-transparent text-neutral-500 hover:text-white'}`}><Crosshair className="w-4 h-4" /> Market Scanner</button>
         <button onClick={() => setActiveInnerTab('chart')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeInnerTab === 'chart' ? 'border-amber-500 text-amber-400' : 'border-transparent text-neutral-500 hover:text-white'}`}><BarChart2 className="w-4 h-4" /> Live Chart Validation</button>
         <button onClick={() => setActiveInnerTab('ledger')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeInnerTab === 'ledger' ? 'border-amber-500 text-amber-400' : 'border-transparent text-neutral-500 hover:text-white'}`}><List className="w-4 h-4" /> Active Positions & Ledger</button>
      </div>

      {activeInnerTab === 'scanner' && (
         <div className="space-y-6">
         <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 relative overflow-hidden text-center py-10">
             <Activity className="w-16 h-16 text-amber-500/20 mx-auto mb-4" />
             <h2 className="text-lg font-bold text-white mb-2">Automated 5-Minute Scan Running</h2>
             <p className="text-sm text-neutral-400 max-w-lg mx-auto">Scans 53 volatile Nifty 100 stocks via Shoonya live candles every 5 minutes. Looks for a 2-candle Alert + Activation pattern where price reverses sharply back toward the 5 EMA.</p>
             <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <span className="flex items-center gap-2 text-xs font-bold px-3 py-1 bg-neutral-800 rounded-full text-neutral-400"><TrendingDown className="w-3 h-3 text-rose-500" /> PE: Alert fully above EMA → Act breaks Low</span>
                  <span className="flex items-center gap-2 text-xs font-bold px-3 py-1 bg-neutral-800 rounded-full text-neutral-400"><TrendingUp className="w-3 h-3 text-emerald-500" /> CE: Alert fully below EMA → Act breaks High</span>
             </div>
             <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <span className="flex items-center gap-2 text-xs px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400/80">⏰ 09:30 – 11:00 AM</span>
                  <span className="flex items-center gap-2 text-xs px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400/80">⏰ 01:30 – 03:00 PM</span>
                  <span className="flex items-center gap-2 text-xs px-3 py-1 bg-sky-500/10 border border-sky-500/20 rounded-full text-sky-400/80">ITM Strike — Better Delta</span>
             </div>
         </div>

          {/* Integrated Active Trades List for EMA 5 */}
          {portfolio?.positions?.some((p: any) => p.strategyName === 'EMA_5') && (
             <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                   <Activity className="w-4 h-4 text-emerald-400" /> Currently Active EMA 5 Trades
                </h3>
                <div className="space-y-4">
                   {portfolio.positions.filter((p: any) => p.strategyName === 'EMA_5').map((pos: any, idx: number) => {
                      const livePnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                      return (
                        <div key={idx} className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-amber-500/30 transition-all">
                           <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${pos.type === 'CE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                 {pos.type === 'CE' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                              </div>
                              <div>
                                 <div className="font-bold text-white uppercase">{pos.symbol} <span className="text-xs font-mono text-neutral-500 ml-2">{pos.tradingSymbol}</span></div>
                                 <div className="text-xs text-neutral-500">
                                   Entry: ₹{pos.entryPrice} @ {pos.entryTime ? new Date(pos.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'}
                                 </div>
                              </div>
                           </div>
                           <div className="mt-4 md:mt-0 flex items-center gap-6">
                              {pos.slPrice && <div className="text-right">
                                 <div className="text-[10px] text-neutral-500 uppercase font-bold">Stock SL</div>
                                 <div className="text-rose-400 font-mono font-bold">₹{pos.slPrice}</div>
                              </div>}
                              {pos.targetPrice && <div className="text-right">
                                 <div className="text-[10px] text-neutral-500 uppercase font-bold">Stock Target</div>
                                 <div className="text-emerald-400 font-mono font-bold">₹{pos.targetPrice}</div>
                              </div>}
                              <div className="text-right">
                                 <div className="text-[10px] text-neutral-500 uppercase font-bold">Option LTP</div>
                                 <div className="text-white font-mono font-bold animate-pulse">₹{pos.currentLtp}</div>
                              </div>
                              <div className="text-right min-w-[90px]">
                                 <div className="text-[10px] text-neutral-500 uppercase font-bold">PnL</div>
                                 <div className={`font-mono font-bold text-lg ${livePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {livePnl >= 0 ? '+' : ''}₹{livePnl.toFixed(2)}
                                 </div>
                              </div>
                              <button
                                onClick={() => handleSquareOff(pos.token)}
                                disabled={squaringOff === pos.token}
                                className={`px-3 py-1.5 text-xs font-bold rounded ${squaringOff === pos.token ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30'} transition-colors`}
                              >
                                {squaringOff === pos.token ? 'Closing...' : 'Square Off'}
                              </button>
                           </div>
                        </div>
                      );
                   })}
                </div>
             </div>
          )}
          </div>
      )}

      {activeInnerTab === 'chart' && (
         <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 relative overflow-hidden flex flex-col items-center justify-center min-h-[400px]">
             <div className="w-full h-full absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] mix-blend-overlay"></div>
             <BarChart2 className="w-20 h-20 text-neutral-700 mx-auto mb-4" />
             <h3 className="text-xl font-bold text-white mb-2">Advanced Real-Time Charting</h3>
             <p className="text-neutral-500 max-w-sm text-center text-sm">TradingView Lightweight Charts integration module reserved here for visualizing the live 5 EMA crossover dynamically.</p>
             <button className="mt-6 px-4 py-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl text-sm font-bold opacity-50 cursor-not-allowed">
                 Connect Chart Stream
             </button>
         </div>
      )}

      {activeInnerTab === 'ledger' && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-neutral-800">
            <h2 className="text-base font-bold text-white">5 EMA Strategy Ledger</h2>
            <p className="text-xs text-neutral-500 mt-1">Alert+Activation mean-reversion entries. SL/Target stock-level (1:3 R:R). Trailing SL at 1:2.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-neutral-950/50 border-b border-neutral-800 text-neutral-400 font-medium">
                <tr>
                  <th className="px-6 py-4">Buy Time</th>
                  <th className="px-6 py-4">Sell Time</th>
                  <th className="px-6 py-4">Option Token</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Entry / Exit</th>
                  <th className="px-6 py-4">Max Profit / Max DD</th>
                  <th className="px-6 py-4">Note / Reason</th>
                  <th className="px-6 py-4 text-right">Realized P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {(!history || history.filter((h: any) => h.strategyName === 'EMA_5' && !(h.exitReason && h.exitReason.includes('Reconciled'))).length === 0) &&
                 (!portfolio?.positions || portfolio.positions.filter((p: any) => p.strategyName === 'EMA_5').length === 0) ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-neutral-500">No 5 EMA trades executed yet.</td>
                  </tr>
                ) : (
                  <>
                    {/* Open positions */}
                    {portfolio?.positions?.filter((p: any) => p.strategyName === 'EMA_5').map((pos: any, idx: number) => {
                      const livePnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                      const entryStr = pos.entryTime ? new Date(pos.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
                      return (
                        <tr key={`open-${idx}`} className="bg-amber-500/5 hover:bg-amber-500/10 transition-colors">
                          <td className="px-6 py-4 text-xs text-neutral-400 font-mono">{entryStr}</td>
                          <td className="px-6 py-4 text-xs text-neutral-500 font-mono">--</td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-amber-300">{pos.symbol}</div>
                            <div className="text-xs text-neutral-500 font-mono mt-0.5">{pos.tradingSymbol || pos.token}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${pos.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>BUY {pos.type}</span>
                            <span className="ml-2 text-xs font-mono text-neutral-500">x{pos.qty}</span>
                          </td>
                          <td className="px-6 py-4"><span className="px-2 py-0.5 rounded text-xs bg-indigo-500/20 text-indigo-400 animate-pulse">OPEN</span></td>
                          <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                            <div>In: <span className="text-neutral-200">₹{pos.entryPrice}</span></div>
                            <div>LTP: <span className="text-amber-400 font-bold">₹{pos.currentLtp}</span></div>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs">
                            <div className="text-emerald-400">H: ₹{(pos.maxProfit || 0).toFixed(2)}</div>
                            <div className="text-rose-400 mt-0.5">L: ₹{(pos.maxLoss || 0).toFixed(2)}</div>
                          </td>
                          <td className="px-6 py-4 text-xs text-neutral-500">Active in Market</td>
                          <td className={`px-6 py-4 text-right font-mono font-bold ${livePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {livePnl >= 0 ? '+' : ''}₹{livePnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Closed history */}
                    {history?.filter((h: any) => h.strategyName === 'EMA_5' && !(h.exitReason && h.exitReason.includes('Reconciled'))).map((record: any, idx: number) => {
                      const entryStr = new Date(record.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                      const exitStr = record.exitTime ? new Date(record.exitTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
                      return (
                        <tr key={`hist-${idx}`} className="hover:bg-neutral-800/20 transition-colors">
                          <td className="px-6 py-4 text-xs text-neutral-400 font-mono">{entryStr}</td>
                          <td className="px-6 py-4 text-xs text-neutral-500 font-mono">{exitStr}</td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-neutral-200">{record.symbol}</div>
                            <div className="text-xs text-neutral-500 font-mono mt-0.5">{record.tradingSymbol || record.token}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${record.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>BUY {record.type}</span>
                            <span className="ml-2 text-xs font-mono text-neutral-500">x{record.quantity}</span>
                          </td>
                          <td className="px-6 py-4"><span className="px-2 py-0.5 rounded text-xs bg-neutral-800 text-neutral-300">CLOSED</span></td>
                          <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                            <div>In: <span className="text-neutral-200">₹{record.entryPrice?.toFixed(2)}</span></div>
                            {record.exitPrice ? <div>Out: <span className="text-neutral-200">₹{record.exitPrice?.toFixed(2)}</span></div> : null}
                          </td>
                          <td className="px-6 py-4 font-mono text-xs">
                            <div className="text-emerald-400">H: ₹{(record.maxProfit || 0).toFixed(2)}</div>
                            <div className="text-rose-400 mt-0.5">L: ₹{(record.maxLoss || 0).toFixed(2)}</div>
                          </td>
                          <td className="px-6 py-4 text-xs text-neutral-500 max-w-[200px] truncate" title={record.exitReason || ''}>
                            {record.exitReason || '--'}
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-bold">
                            {record.realizedPnl !== null ? (
                              <span className={record.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {record.realizedPnl >= 0 ? '+' : ''}₹{record.realizedPnl?.toFixed(2)}
                              </span>
                            ) : <span className="text-neutral-600">--</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
