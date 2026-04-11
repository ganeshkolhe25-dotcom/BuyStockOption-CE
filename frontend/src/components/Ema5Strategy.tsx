"use client";

import { useState } from "react";
import axios from "axios";
import { Activity, TrendingUp, TrendingDown, Crosshair, BarChart2, List } from "lucide-react";

export default function Ema5Strategy({ isEnabled, portfolio, history }: { isEnabled?: boolean, portfolio?: any, history?: any[] }) {
  const [squaringOff, setSquaringOff] = useState<string | null>(null);

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
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
      
      {/* Power Overlay */}
      {!isEnabled && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center border border-neutral-800 pointer-events-auto mt-[180px]">
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
         <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 relative overflow-hidden">
            <h2 className="text-xl font-bold text-white mb-4">5 EMA Strategy Ledger</h2>
            <p className="text-sm text-neutral-400 mb-6">Live and Historical Option executions from the 5-Min Alert+Activation Mean Reversion engine. SL/Target are stock-level (1:3 R:R). Trailing SL activates at 1:2.</p>
            
            <div className="overflow-x-auto">
                 <table className="w-full text-sm text-left text-neutral-400">
                   <thead className="text-xs uppercase bg-neutral-950/50 border-b border-neutral-800 text-neutral-500">
                     <tr>
                        <th className="px-6 py-4">Structure</th>
                        <th className="px-6 py-4">Symbol</th>
                        <th className="px-6 py-4">Type (CE/PE)</th>
                        <th className="px-6 py-4 text-center">Option Premium</th>
                        <th className="px-6 py-4 text-right">Net P&L</th>
                     </tr>
                   </thead>
                   <tbody>
                      {(!history || history.filter(h => h.strategyName === 'EMA_5').length === 0) && (!portfolio?.positions || portfolio.positions.filter((p: any) => p.strategyName === 'EMA_5').length === 0) ? (
                      <tr className="border-b border-neutral-800/50 bg-neutral-900/20">
                         <td className="px-6 py-4 text-neutral-600" colSpan={7} style={{textAlign: 'center'}}>No 5 EMA Option Trades have been executed yet...</td>
                      </tr>
                      ) : (
                        <>
                           {/* Active Positions Block */}
                           {portfolio?.positions?.filter((p: any) => p.strategyName === 'EMA_5').map((pos: any, idx: number) => {
                               const livePnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                               return (
                                 <tr key={`act-${idx}`} className="border-b border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors">
                                   <td className="px-6 py-4 whitespace-nowrap">
                                      <span className="px-2 py-1 text-[10px] bg-amber-500/20 text-amber-400 rounded border border-amber-500/30 font-bold tracking-wider">LIVESTREAM</span>
                                   </td>
                                   <td className="px-6 py-4 font-bold text-amber-300">{pos.symbol} <span className="text-[10px] bg-neutral-800 px-1 py-0.5 rounded text-neutral-400 ml-2">{pos.tradingSymbol}</span></td>
                                   <td className="px-6 py-4 font-bold text-white">{pos.type}</td>
                                   <td className="px-6 py-4 font-mono text-center">
                                       <span className="text-neutral-400 line-through mr-2">Entry: ₹{pos.entryPrice}</span>
                                       <span className="text-amber-400 font-bold text-lg animate-pulse">₹{pos.currentLtp}</span>
                                   </td>
                                   <td className={`px-6 py-4 font-bold text-right font-mono text-lg ${livePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {livePnl >= 0 ? '+' : ''}₹{livePnl.toFixed(2)}
                                   </td>
                                 </tr>
                               );
                           })}

                           {/* Historical Positions Block */}
                           {history?.filter(h => h.strategyName === 'EMA_5').map((record: any, idx: number) => {
                              const isWin = record.realizedPnl > 0;
                              return (
                                 <tr key={`hist-${idx}`} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors">
                                   <td className="px-6 py-4 whitespace-nowrap">{new Date(record.entryTime).toLocaleString()}</td>
                                   <td className="px-6 py-4 text-white font-medium">{record.symbol}</td>
                                   <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-[10px] font-bold ${record.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{record.type}</span></td>
                                   <td className="px-6 py-4 font-mono text-center">₹{record.entryPrice} <span className="text-xs text-neutral-600">[{record.quantity} Qty]</span></td>
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

         </div>
      )}

    </div>
  );
}
