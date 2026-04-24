"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

interface Props {
  history: any[];
  strategyName: string | string[];   // e.g. 'CANDLE_BREAKOUT' or ['GANN_9', null]
  accentColor: "orange" | "indigo" | "emerald" | "amber" | "blue";
}

const ACCENT = {
  orange:  { text: "text-orange-400",  border: "border-orange-500/30",  bg: "bg-orange-500/15" },
  indigo:  { text: "text-indigo-400",  border: "border-indigo-500/30",  bg: "bg-indigo-500/15" },
  emerald: { text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/15" },
  amber:   { text: "text-amber-400",   border: "border-amber-500/30",   bg: "bg-amber-500/15" },
  blue:    { text: "text-blue-400",    border: "border-blue-500/30",    bg: "bg-blue-500/15" },
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function matchesStrategy(record: any, strategyName: string | string[]): boolean {
  if (Array.isArray(strategyName)) {
    return strategyName.some(s => s === null ? (!record.strategyName || record.strategyName === 'GANN_9') : record.strategyName === s);
  }
  return record.strategyName === strategyName;
}

export default function StrategyCalendar({ history, strategyName, accentColor }: Props) {
  const now = new Date();
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed

  const accent = ACCENT[accentColor];

  // Build daily P&L map for displayed month
  const dailyPnl: Record<string, number> = {};
  const dailyCount: Record<string, number> = {};

  for (const r of history || []) {
    if (!matchesStrategy(r, strategyName)) continue;
    if (!r.exitTime || r.exitReason?.includes("Reconciled")) continue;
    const d = new Date(r.exitTime).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }); // DD/MM/YYYY
    const [dd, mm, yyyy] = d.split("/");
    if (parseInt(yyyy) !== viewYear || parseInt(mm) - 1 !== viewMonth) continue;
    const key = dd;
    dailyPnl[key]   = (dailyPnl[key]   || 0) + (r.realizedPnl || 0);
    dailyCount[key] = (dailyCount[key] || 0) + 1;
  }

  // Calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const monthTotal = Object.values(dailyPnl).reduce((a, b) => a + b, 0);
  const tradingDays = Object.keys(dailyPnl).length;
  const profitDays  = Object.values(dailyPnl).filter(v => v > 0).length;
  const lossDays    = Object.values(dailyPnl).filter(v => v < 0).length;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const todayKey = now.getFullYear() === viewYear && now.getMonth() === viewMonth
    ? String(now.getDate()).padStart(2, "0")
    : null;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className={`w-4 h-4 ${accent.text}`} />
          <span className={`text-sm font-bold ${accent.text}`}>Monthly P&L Calendar</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-all">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-white w-24 text-center">
            {MONTHS[viewMonth]} {viewYear}
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-all">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs font-mono">
        <span className={`px-3 py-1 rounded-full border ${monthTotal >= 0 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
          Month: {monthTotal >= 0 ? "+" : ""}₹{monthTotal.toFixed(0)}
        </span>
        <span className="px-3 py-1 rounded-full border border-neutral-700 text-neutral-400">
          {tradingDays} trading day{tradingDays !== 1 ? "s" : ""}
        </span>
        {tradingDays > 0 && (
          <>
            <span className="px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              {profitDays}W
            </span>
            <span className="px-3 py-1 rounded-full border border-red-500/20 bg-red-500/10 text-red-400">
              {lossDays}L
            </span>
          </>
        )}
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-bold text-neutral-600 uppercase py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day === null) return <div key={idx} />;
          const key = String(day).padStart(2, "0");
          const pnl = dailyPnl[key];
          const count = dailyCount[key] || 0;
          const isToday = key === todayKey;

          let cellBg = "bg-neutral-950 border border-neutral-800";
          let pnlColor = "text-neutral-600";

          if (pnl !== undefined) {
            if (pnl > 0) {
              cellBg = "bg-emerald-500/10 border border-emerald-500/25";
              pnlColor = "text-emerald-400";
            } else if (pnl < 0) {
              cellBg = "bg-red-500/10 border border-red-500/25";
              pnlColor = "text-red-400";
            } else {
              cellBg = "bg-neutral-800 border border-neutral-700";
              pnlColor = "text-neutral-400";
            }
          }

          return (
            <div
              key={idx}
              className={`rounded-lg p-1 min-h-[52px] flex flex-col justify-between ${cellBg} ${isToday ? "ring-1 ring-yellow-400/60" : ""}`}
            >
              <span className={`text-[11px] font-bold ${isToday ? "text-yellow-400" : "text-neutral-400"}`}>
                {day}
              </span>
              {pnl !== undefined ? (
                <>
                  <span className={`text-[10px] font-mono font-bold leading-tight ${pnlColor}`}>
                    {pnl >= 0 ? "+" : ""}₹{Math.abs(pnl) >= 1000 ? (pnl / 1000).toFixed(1) + "k" : pnl.toFixed(0)}
                  </span>
                  <span className="text-[9px] text-neutral-600">{count}t</span>
                </>
              ) : (
                <span className="text-[9px] text-neutral-800">–</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
