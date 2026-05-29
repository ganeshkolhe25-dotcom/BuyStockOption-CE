"use client";

import { useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Layers,
  Shield,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────── */
/*  Data                                                               */
/* ─────────────────────────────────────────────────────────────────── */

const strategies = [
  {
    id: "orb5",
    name: "ORB5",
    fullName: "Open Range Breakout",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.08)",
    border: "rgba(139,92,246,0.3)",
    icon: <Target size={28} />,
    tagline: "Trade the first move of the day",
    summary:
      "Captures the initial momentum burst by trading breakouts of the Opening Range formed in the first 5 candles (9:15–9:20 AM). Candle-close confirmation eliminates false breakouts.",
    features: [
      "Opening Range formed from first 5 candles (9:15–9:20 AM)",
      "Long CE on breakout above range high, Long PE on breakdown below low",
      "Candle-close confirmation — no premature entries",
      "Up to 5 trades per symbol per day",
      "Nifty 100 universe — all liquid option chains",
    ],
    docs: [
      {
        title: "Entry Rules",
        content:
          "A trade is triggered only after the current candle closes above the Opening Range High (for CE) or below the Opening Range Low (for PE). This prevents whipsaw entries on intra-candle spikes.",
      },
      {
        title: "Position Sizing",
        content:
          "Each trade uses a fixed lot size per symbol. The engine tracks open positions and blocks new entries if the max-trade limit for that symbol is already reached for the day.",
      },
      {
        title: "Exit Logic",
        content:
          "Positions are exited at the configured target or stop-loss, whichever is hit first. End-of-day square-off ensures no overnight exposure.",
      },
      {
        title: "Best Market Conditions",
        content:
          "Performs best on high-volatility days with a clear directional bias — earnings, macro events, or index gap-up/gap-down opens.",
      },
    ],
  },
  {
    id: "ema5",
    name: "2-Candle + EMA5",
    fullName: "Two-Candle Reversal with EMA5 Filter",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.3)",
    icon: <TrendingUp size={28} />,
    tagline: "Reversal entries with trend confirmation",
    summary:
      "Identifies high-quality 2-candle reversal setups filtered by EMA5 trend alignment. Three quality gates reduce false signals and improve win rate on trending stocks.",
    features: [
      "2-candle reversal pattern detection (engulfing / pin bar combos)",
      "EMA5 trend alignment as mandatory quality gate",
      "3-layer quality filter: momentum, volume, trend",
      "PE entries disabled during mid-day chop window",
      "Nifty 100 universe with real-time scanner",
    ],
    docs: [
      {
        title: "Pattern Detection",
        content:
          "The engine scans for 2-candle reversal formations — a strong momentum candle followed by a confirming candle that closes past the midpoint of the first. Both candles must align with EMA5 direction.",
      },
      {
        title: "Quality Filters",
        content:
          "Three filters run sequentially: (1) Momentum — the first candle must exceed an ATR threshold. (2) Volume — above the 10-bar average. (3) Trend — price must be on the correct side of EMA5.",
      },
      {
        title: "Mid-Day Window Restriction",
        content:
          "PE entries are blocked during the mid-day chop window (typically 11:30–13:30) when short-side setups have historically lower reliability. CE entries remain active.",
      },
      {
        title: "Best Market Conditions",
        content:
          "Performs best in trending intraday sessions where EMA5 is sloping cleanly. Avoids range-bound, low-volatility days through its momentum threshold filter.",
      },
    ],
  },
  {
    id: "gann",
    name: "Gann Angle",
    fullName: "Gann Angle Price-Time Analysis",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.3)",
    icon: <BarChart3 size={28} />,
    tagline: "Price-time geometry for precision entries",
    summary:
      "Applies W.D. Gann's angle theory to identify high-probability turning points where price and time intersect. Trades are taken when price reacts off key Gann angle levels.",
    features: [
      "1×1 (45°), 2×1 (63.75°) and 1×2 (26.25°) angle calculation",
      "Dynamic pivot-based angle projection from swing highs/lows",
      "Price-time confluence zones for entry triggers",
      "Trend direction determined by angle slope",
      "Intraday and positional timeframe support",
    ],
    docs: [
      {
        title: "Angle Construction",
        content:
          "Gann angles are drawn from significant swing pivots. The 1×1 angle (one unit of price per one unit of time) is the primary trend line. Prices above it signal bullish strength; below signal bearish bias.",
      },
      {
        title: "Entry Triggers",
        content:
          "A trade is entered when price bounces off or breaks through a key angle level with confirming volume. The 1×1 angle break or retest is the highest-probability setup.",
      },
      {
        title: "Time Cycles",
        content:
          "Gann theory assigns equal weight to time as to price. The engine monitors key time cycles (90, 180, 270, 360 degrees of time) for added confluence with price angle levels.",
      },
      {
        title: "Best Market Conditions",
        content:
          "Most effective in structured trending markets where pivot highs/lows are clearly defined. Avoids highly news-driven, erratic sessions where price-time geometry breaks down.",
      },
    ],
  },
];

const stats = [
  { label: "Strategies", value: "3", icon: <Layers size={20} /> },
  { label: "Universe", value: "Nifty 100", icon: <Activity size={20} /> },
  { label: "Uptime", value: "99.9%", icon: <Clock size={20} /> },
  { label: "Execution", value: "< 200ms", icon: <Zap size={20} /> },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Components                                                         */
/* ─────────────────────────────────────────────────────────────────── */

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-neutral-800/60 backdrop-blur-xl bg-neutral-950/80">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Activity size={16} className="text-white" />
          </div>
          <span className="font-semibold text-white text-sm tracking-tight">
            Gargee Algo Trading
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-neutral-400">
          <a href="#strategies" className="hover:text-white transition-colors">Strategies</a>
          <a href="#docs" className="hover:text-white transition-colors">Documentation</a>
          <a href="#about" className="hover:text-white transition-colors">About</a>
        </div>
        <a
          href="/terminal"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-indigo-500/25"
        >
          Launch App <ExternalLink size={14} />
        </a>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center grid-bg overflow-hidden pt-16">
      {/* Glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-6 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-medium mb-8">
          <Zap size={12} />
          Automated Nifty 100 Options Trading
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 leading-tight">
          Algorithmic Trading,{" "}
          <span className="gradient-text">Engineered for Precision</span>
        </h1>

        <p className="text-lg md:text-xl text-neutral-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          A multi-strategy engine that runs ORB5, 2-Candle+EMA5, and Gann Angle strategies
          simultaneously — fully automated, real-time execution on Nifty 100 options.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="/terminal"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5"
          >
            Launch Trading Terminal <ExternalLink size={16} />
          </a>
          <a
            href="#strategies"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white font-semibold text-sm transition-all"
          >
            Explore Strategies
          </a>
        </div>

        {/* Stats bar */}
        <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-px bg-neutral-800/50 rounded-2xl overflow-hidden border border-neutral-800/50">
          {stats.map((s) => (
            <div key={s.label} className="bg-neutral-950/80 px-6 py-5 flex flex-col items-center gap-2">
              <div className="text-indigo-400">{s.icon}</div>
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="text-xs text-neutral-500 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StrategyCard({ s }: { s: typeof strategies[0] }) {
  return (
    <div
      className="rounded-2xl border p-6 flex flex-col gap-4 hover:scale-[1.02] transition-all duration-300"
      style={{ background: s.bg, borderColor: s.border }}
    >
      <div className="flex items-start justify-between">
        <div className="p-2.5 rounded-xl" style={{ background: `${s.color}22`, color: s.color }}>
          {s.icon}
        </div>
        <span
          className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg"
          style={{ background: `${s.color}22`, color: s.color }}
        >
          {s.name}
        </span>
      </div>
      <div>
        <h3 className="text-xl font-bold text-white mb-1">{s.fullName}</h3>
        <p className="text-sm font-medium" style={{ color: s.color }}>{s.tagline}</p>
      </div>
      <p className="text-sm text-neutral-400 leading-relaxed flex-1">{s.summary}</p>
      <ul className="space-y-2">
        {s.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-neutral-300">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            {f}
          </li>
        ))}
      </ul>
      <a
        href="/terminal"
        className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{
          background: `${s.color}22`,
          color: s.color,
          border: `1px solid ${s.border}`,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.background = `${s.color}33`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.background = `${s.color}22`;
        }}
      >
        Launch {s.name} <ExternalLink size={14} />
      </a>
    </div>
  );
}

function DocAccordion({ docs }: { docs: typeof strategies[0]["docs"]; color: string }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-2">
      {docs.map((d, i) => (
        <div key={i} className="rounded-xl border border-neutral-800 overflow-hidden">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-neutral-800/50 transition-colors"
          >
            <span className="text-sm font-semibold text-white">{d.title}</span>
            {open === i ? (
              <ChevronUp size={16} className="text-neutral-400 flex-shrink-0" />
            ) : (
              <ChevronDown size={16} className="text-neutral-400 flex-shrink-0" />
            )}
          </button>
          {open === i && (
            <div className="px-5 pb-4 text-sm text-neutral-400 leading-relaxed border-t border-neutral-800">
              <p className="pt-3">{d.content}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DocsSection() {
  const [active, setActive] = useState(0);
  const s = strategies[active];

  return (
    <section id="docs" className="py-24 border-t border-neutral-900">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-400 text-xs font-medium mb-4">
            <BookOpen size={12} /> Documentation
          </div>
          <h2 className="text-4xl font-bold text-white">Strategy Deep Dive</h2>
          <p className="mt-4 text-neutral-400 max-w-xl mx-auto">
            Understand the entry rules, filters, and market conditions for each strategy before you start trading.
          </p>
        </div>

        {/* Tab selector */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          {strategies.map((st, i) => (
            <button
              key={st.id}
              onClick={() => setActive(i)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={
                active === i
                  ? { background: `${st.color}22`, color: st.color, border: `1px solid ${st.color}55` }
                  : { background: "transparent", color: "#737373", border: "1px solid #262626" }
              }
            >
              {st.icon && <span style={{ color: active === i ? st.color : "#737373" }}>{st.icon}</span>}
              {st.name}
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Strategy overview */}
          <div
            className="rounded-2xl border p-7 h-full"
            style={{ background: s.bg, borderColor: s.border }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl" style={{ background: `${s.color}22`, color: s.color }}>
                {s.icon}
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">{s.fullName}</h3>
                <p className="text-sm" style={{ color: s.color }}>{s.tagline}</p>
              </div>
            </div>
            <p className="text-neutral-300 text-sm leading-relaxed mb-6">{s.summary}</p>
            <div className="space-y-2.5">
              {s.features.map((f) => (
                <div key={f} className="flex items-start gap-3">
                  <div
                    className="mt-1.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: `${s.color}22` }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                  </div>
                  <span className="text-sm text-neutral-300">{f}</span>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <a
                href="/terminal"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: s.color,
                  color: "#fff",
                  boxShadow: `0 4px 20px ${s.color}44`,
                }}
              >
                Launch {s.name} in Terminal <ExternalLink size={14} />
              </a>
            </div>
          </div>

          {/* Accordion docs */}
          <DocAccordion docs={s.docs} color={s.color} />
        </div>
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section id="about" className="py-24 border-t border-neutral-900">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-400 text-xs font-medium mb-6">
              <Shield size={12} /> About Gargee Algo Trading
            </div>
            <h2 className="text-4xl font-bold text-white mb-6 leading-tight">
              Precision-built for{" "}
              <span className="gradient-text">Indian Options Markets</span>
            </h2>
            <p className="text-neutral-400 leading-relaxed mb-4">
              Gargee Algo Trading is an automated multi-strategy options trading platform purpose-built
              for the Indian equity derivatives market. The engine runs continuously during market hours,
              scanning the entire Nifty 100 universe for high-probability setups across three distinct strategies.
            </p>
            <p className="text-neutral-400 leading-relaxed mb-4">
              Each strategy is independently researched and backtested. Together, they provide diversified
              intraday exposure — momentum-based entries via ORB5, reversal trades via 2-Candle+EMA5,
              and price-time confluence plays via Gann Angle.
            </p>
            <p className="text-neutral-400 leading-relaxed">
              The platform integrates directly with Shoonya (Finvasia) for real-time data and
              order execution, with sub-200ms order placement latency and automatic end-of-day
              square-off to ensure no overnight risk.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: <Zap size={20} />, title: "Real-Time Execution", desc: "Sub-200ms order placement via Shoonya API", color: "#6366f1" },
              { icon: <Shield size={20} />, title: "Risk Controls", desc: "Per-trade stop-loss, daily loss limits, auto square-off", color: "#10b981" },
              { icon: <Activity size={20} />, title: "Live Scanner", desc: "Scans full Nifty 100 universe every candle", color: "#8b5cf6" },
              { icon: <BookOpen size={20} />, title: "Full Transparency", desc: "Live P&L, trade history, and position tracking", color: "#f59e0b" },
              { icon: <BarChart3 size={20} />, title: "Multi-Strategy", desc: "3 independent strategies running simultaneously", color: "#3b82f6" },
              { icon: <Clock size={20} />, title: "Market Hours", desc: "Fully automated 9:15 AM – 3:30 PM IST", color: "#f97316" },
            ].map((item) => (
              <div
                key={item.title}
                className="p-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 hover:border-neutral-700 transition-colors"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: `${item.color}15`, color: item.color }}
                >
                  {item.icon}
                </div>
                <h4 className="text-sm font-semibold text-white mb-1">{item.title}</h4>
                <p className="text-xs text-neutral-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="py-24 border-t border-neutral-900">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <div className="relative rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/40 to-violet-950/30 p-12 overflow-hidden glow-indigo">
          <div className="absolute inset-0 grid-bg opacity-30" />
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto mb-6">
              <Activity size={28} className="text-indigo-400" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Ready to start trading?
            </h2>
            <p className="text-neutral-400 mb-8 leading-relaxed">
              Log in to access the full multi-strategy terminal. Monitor positions, view live P&L,
              configure strategies, and manage your Shoonya account — all in one place.
            </p>
            <a
              href="/terminal"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5 text-base"
            >
              Login & Launch Terminal <ExternalLink size={18} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-neutral-900 py-8">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center">
            <Activity size={12} className="text-white" />
          </div>
          <span className="text-sm text-neutral-500">Gargee Algo Trading</span>
        </div>
        <p className="text-xs text-neutral-600">
          For authorised users only. Algorithmic trading involves risk. Past performance does not guarantee future results.
        </p>
        <div className="flex items-center gap-4 text-xs text-neutral-600">
          <a href="#strategies" className="hover:text-neutral-400 transition-colors">Strategies</a>
          <a href="#docs" className="hover:text-neutral-400 transition-colors">Docs</a>
          <a href="/terminal" className="hover:text-neutral-400 transition-colors">Terminal</a>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950">
      <Navbar />
      <Hero />

      {/* Strategies */}
      <section id="strategies" className="py-24 border-t border-neutral-900">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-400 text-xs font-medium mb-4">
              <Layers size={12} /> Available Strategies
            </div>
            <h2 className="text-4xl font-bold text-white">
              Three Strategies. One Engine.
            </h2>
            <p className="mt-4 text-neutral-400 max-w-xl mx-auto">
              Each strategy runs independently with its own entry logic, risk controls, and
              position management — all monitored from a single terminal.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {strategies.map((s) => (
              <StrategyCard key={s.id} s={s} />
            ))}
          </div>
        </div>
      </section>

      <DocsSection />
      <AboutSection />
      <CTASection />
      <Footer />
    </main>
  );
}
