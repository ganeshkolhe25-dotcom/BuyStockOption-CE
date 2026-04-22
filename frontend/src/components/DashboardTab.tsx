
"use client";

import { Activity, TrendingUp, DollarSign, Briefcase, Power, AlertTriangle } from "lucide-react";

export default function Dashboard({ portfolio, history, shoonyaConfig, handleToggleStrategy, handleSquareOff, squaringOff }: { portfolio: any, history: any[], shoonyaConfig: any, handleToggleStrategy: (s: 'gann9' | 'gannAngle' | 'ema5') => void, handleSquareOff?: (token: string) => void, squaringOff?: string | null }) {

  const isToday = (dateString: string) => {
    if (!dateString) return false;
    const date = new Date(dateString);
    const today = new Date();
    return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  };

  // Gann Square-9
  const gann9Active = portfolio?.positions?.filter((p: any) => !p.strategyName || p.strategyName === 'GANN_9') || [];
  const gann9Unrealized = gann9Active.reduce((acc: number, curr: any) => acc + ((curr.currentLtp - curr.entryPrice) * curr.qty), 0);
  const notReconciled = (h: any) => !(h.exitReason && h.exitReason.includes('Reconciled'));
  const gann9DayRealized = history?.filter((h: any) => (!h.strategyName || h.strategyName === 'GANN_9') && isToday(h.exitTime) && notReconciled(h)).reduce((acc: number, curr: any) => acc + (curr.realizedPnl || 0), 0) || 0;
  const gann9DayPnl = gann9DayRealized + gann9Unrealized;
  const gann9CumulativePnl = (history?.filter((h: any) => (!h.strategyName || h.strategyName === 'GANN_9') && notReconciled(h)).reduce((acc: number, curr: any) => acc + (curr.realizedPnl || 0), 0) || 0) + gann9Unrealized;
  const gann9Used = gann9Active.reduce((acc: number, curr: any) => acc + (curr.entryPrice * curr.qty), 0) || 0;

  // Gann Angle
  const gannAngleActive = portfolio?.positions?.filter((p: any) => p.strategyName === 'GANN_ANGLE') || [];
  const gannAngleUnrealized = gannAngleActive.reduce((acc: number, curr: any) => acc + ((curr.currentLtp - curr.entryPrice) * curr.qty), 0);
  const gannAngleDayRealized = history?.filter((h: any) => h.strategyName === 'GANN_ANGLE' && isToday(h.exitTime) && notReconciled(h)).reduce((acc: number, curr: any) => acc + (curr.realizedPnl || 0), 0) || 0;
  const gannAngleDayPnl = gannAngleDayRealized + gannAngleUnrealized;
  const gannAngleCumulativePnl = (history?.filter((h: any) => h.strategyName === 'GANN_ANGLE' && notReconciled(h)).reduce((acc: number, curr: any) => acc + (curr.realizedPnl || 0), 0) || 0) + gannAngleUnrealized;
  const gannAngleUsed = gannAngleActive.reduce((acc: number, curr: any) => acc + (curr.entryPrice * curr.qty), 0) || 0;

  // 5 EMA
  const ema5Active = portfolio?.positions?.filter((p: any) => p.strategyName === 'EMA_5') || [];
  const emaUnrealized = ema5Active.reduce((acc: number, curr: any) => acc + ((curr.currentLtp - curr.entryPrice) * curr.qty), 0);
  const ema5DayRealized = history?.filter((h: any) => h.strategyName === 'EMA_5' && isToday(h.exitTime) && notReconciled(h)).reduce((acc: number, curr: any) => acc + (curr.realizedPnl || 0), 0) || 0;
  const ema5DayPnl = ema5DayRealized + emaUnrealized;
  const ema5CumulativePnl = (history?.filter((h: any) => h.strategyName === 'EMA_5' && notReconciled(h)).reduce((acc: number, curr: any) => acc + (curr.realizedPnl || 0), 0) || 0) + emaUnrealized;
  const ema5Used = ema5Active.reduce((acc: number, curr: any) => acc + (curr.entryPrice * curr.qty), 0) || 0;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Portfolio Overview ── */}
      <h2 className="text-base font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">Global Portfolio Overview</h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 relative overflow-hidden group transition-colors">
          <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <DollarSign className="w-10 h-10 absolute -right-1 -bottom-1 text-neutral-800/50" />
          <div className="text-xs font-semibold text-neutral-400 mb-1">Total Capital</div>
          <div className="text-lg font-bold text-white font-mono">₹{portfolio.totalCapital?.toFixed(2) || '0.00'}</div>
          <div className="text-[10px] text-emerald-500 mt-1">Base: ₹{portfolio.initialFunds}</div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 relative overflow-hidden group">
          <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <Briefcase className="w-10 h-10 absolute -right-1 -bottom-1 text-neutral-800/50" />
          <div className="text-xs font-semibold text-neutral-400 mb-1">Available Funds</div>
          <div className="text-lg font-bold text-white font-mono">₹{(portfolio.availableFunds || 0).toFixed(2)}</div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 relative overflow-hidden group">
          <div className="absolute inset-0 bg-amber-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <Activity className="w-10 h-10 absolute -right-1 -bottom-1 text-neutral-800/50" />
          <div className="text-xs font-semibold text-neutral-400 mb-1">Used Capital</div>
          <div className="text-lg font-bold text-white font-mono">₹{(portfolio.usedCapital || 0).toFixed(2)}</div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 relative overflow-hidden group">
          <div className={`absolute inset-0 transition-opacity ${portfolio.cumulativeTotalPnl >= 0 ? 'bg-emerald-500/5' : 'bg-rose-500/5'} opacity-0 group-hover:opacity-100`}></div>
          <TrendingUp className="w-10 h-10 absolute -right-1 -bottom-1 text-neutral-800/50" />
          <div className="text-xs font-semibold text-neutral-400 mb-1">Net Cumulative P&L</div>
          <div className={`text-lg font-bold font-mono ${portfolio.cumulativeTotalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {portfolio.cumulativeTotalPnl >= 0 ? '+' : ''}₹{(portfolio.cumulativeTotalPnl || 0).toFixed(2)}
          </div>
        </div>
      </div>

      {/* ── Strategy Performance — 3-col on md+, 1-col on mobile ── */}
      <h2 className="text-base font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Strategy Performance</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

        {/* Gann Square-9 */}
        <div className={`bg-gradient-to-br from-neutral-900 to-neutral-950 border rounded-xl p-4 hover:border-emerald-500/30 transition-colors ${portfolio?.haltedStrategies?.includes('GANN_9') ? 'border-amber-500/40' : 'border-neutral-800'}`}>
          {portfolio?.haltedStrategies?.includes('GANN_9') && (
            <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 font-semibold">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" /> Daily limit reached. No new trades.
            </div>
          )}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]"></div>
            <span className="text-sm font-bold">Gann Square-9</span>
            <button
              onClick={() => handleToggleStrategy('gann9')}
              className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${shoonyaConfig?.gann9Enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}
            >
              <Power className="w-2.5 h-2.5" />
              {shoonyaConfig?.gann9Enabled ? "RUNNING" : "STOPPED"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Day P&L</div>
              <div className={`text-base font-bold font-mono ${gann9DayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {gann9DayPnl >= 0 ? '+' : ''}₹{gann9DayPnl.toFixed(2)}
              </div>
            </div>
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Used Margin</div>
              <div className="text-base font-bold font-mono text-neutral-400">₹{gann9Used.toFixed(2)}</div>
            </div>
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800 col-span-2">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Cumulative P&L</div>
              <div className={`text-lg font-bold font-mono ${gann9CumulativePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {gann9CumulativePnl >= 0 ? '+' : ''}₹{gann9CumulativePnl.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* Gann Angle */}
        <div className={`bg-gradient-to-br from-neutral-900 to-neutral-950 border rounded-xl p-4 relative ${portfolio?.haltedStrategies?.includes('GANN_ANGLE') ? 'border-amber-500/40' : 'border-neutral-800'}`}>
          <div className="absolute top-3 right-3 bg-indigo-500/20 text-indigo-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/30">BETA</div>
          {portfolio?.haltedStrategies?.includes('GANN_ANGLE') && (
            <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 font-semibold">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" /> Daily limit reached. No new trades.
            </div>
          )}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.8)]"></div>
            <span className="text-sm font-bold">Gann Angle</span>
            <button
              onClick={() => handleToggleStrategy('gannAngle')}
              className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${shoonyaConfig?.gannAngleEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}
            >
              <Power className="w-2.5 h-2.5" />
              {shoonyaConfig?.gannAngleEnabled ? "RUNNING" : "STOPPED"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Day P&L</div>
              <div className={`text-base font-bold font-mono ${gannAngleDayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {gannAngleDayPnl >= 0 ? '+' : ''}₹{gannAngleDayPnl.toFixed(2)}
              </div>
            </div>
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Used Margin</div>
              <div className="text-base font-bold font-mono text-neutral-400">₹{gannAngleUsed.toFixed(2)}</div>
            </div>
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800 col-span-2">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Cumulative P&L</div>
              <div className={`text-lg font-bold font-mono ${gannAngleCumulativePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {gannAngleCumulativePnl >= 0 ? '+' : ''}₹{gannAngleCumulativePnl.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* 5 EMA */}
        <div className={`bg-gradient-to-br from-neutral-900 to-neutral-950 border rounded-xl p-4 relative ${portfolio?.haltedStrategies?.includes('EMA_5') ? 'border-amber-500/40' : 'border-neutral-800'}`}>
          <div className="absolute top-3 right-3 bg-amber-500/20 text-amber-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-500/30">BETA</div>
          {portfolio?.haltedStrategies?.includes('EMA_5') && (
            <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 font-semibold">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" /> Daily limit reached. No new trades.
            </div>
          )}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)]"></div>
            <span className="text-sm font-bold">5 EMA Mean Rev</span>
            <button
              onClick={() => handleToggleStrategy('ema5')}
              className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${shoonyaConfig?.ema5Enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}
            >
              <Power className="w-2.5 h-2.5" />
              {shoonyaConfig?.ema5Enabled ? "RUNNING" : "STOPPED"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Day P&L</div>
              <div className={`text-base font-bold font-mono ${ema5DayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {ema5DayPnl >= 0 ? '+' : ''}₹{ema5DayPnl.toFixed(2)}
              </div>
            </div>
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Used Margin</div>
              <div className="text-base font-bold font-mono text-neutral-400">₹{ema5Used.toFixed(2)}</div>
            </div>
            <div className="bg-neutral-800/30 rounded-lg p-3 border border-neutral-800 col-span-2">
              <div className="text-[10px] text-neutral-500 font-semibold mb-0.5">Cumulative P&L</div>
              <div className={`text-lg font-bold font-mono ${ema5CumulativePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {ema5CumulativePnl >= 0 ? '+' : ''}₹{ema5CumulativePnl.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Unified Active Positions — capped height, scrolls internally ── */}
      <h2 className="text-base font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
        Active Positions
        {portfolio?.positions?.length > 0 && (
          <span className="ml-2 text-xs font-mono text-neutral-500">({portfolio.positions.length} open)</span>
        )}
      </h2>
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[160px] no-scrollbar">
          <table className="w-full text-left text-xs whitespace-nowrap text-neutral-400">
            <thead className="sticky top-0 bg-neutral-950 border-b border-neutral-800 text-neutral-500 font-medium uppercase">
              <tr>
                <th className="px-4 py-2.5">Strategy</th>
                <th className="px-4 py-2.5">Symbol / Contract</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-center">Entry <span className="text-[9px] text-neutral-600">(Qty)</span></th>
                <th className="px-4 py-2.5 text-center">Target / SL</th>
                <th className="px-4 py-2.5 text-center">Live LTP</th>
                <th className="px-4 py-2.5 text-right">P&L</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/50">
              {!portfolio?.positions || portfolio.positions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-neutral-500 text-xs">
                    No active trades across any strategy right now.
                  </td>
                </tr>
              ) : (
                portfolio.positions.map((pos: any, idx: number) => {
                  const livePnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                  const isGannAngle = pos.strategyName === 'GANN_ANGLE';
                  return (
                    <tr key={`master-${idx}`} className="hover:bg-neutral-800/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${isGannAngle ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : pos.strategyName === 'EMA_5' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                          {pos.strategyName || 'GANN_9'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-bold text-neutral-200 text-xs">{pos.symbol}</div>
                        <div className="text-[10px] text-neutral-500 font-mono">{pos.tradingSymbol || pos.token}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{pos.type}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-center">
                        <span className="text-white font-bold bg-neutral-800 px-1.5 py-0.5 rounded text-xs">₹{pos.entryPrice.toFixed(2)}</span>
                        <div className="text-[10px] text-neutral-500 mt-0.5">[{pos.qty}]</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-center text-[10px]">
                        <div className="text-amber-500 font-bold">🎯 ₹{pos.targetPrice?.toFixed(2) || '--'}</div>
                        <div className="text-rose-500 font-bold">🛑 ₹{pos.slPrice?.toFixed(2) || '--'}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-center">
                        <span className="text-blue-400 animate-pulse font-bold text-xs">₹{pos.currentLtp}</span>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono font-bold text-xs ${livePnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {livePnl >= 0 ? "+" : ""}₹{livePnl.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {handleSquareOff && (
                          <button
                            onClick={() => handleSquareOff(pos.token)}
                            disabled={squaringOff === pos.token}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${squaringOff === pos.token ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30'}`}
                          >
                            {squaringOff === pos.token ? 'Closing…' : 'Square Off'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
