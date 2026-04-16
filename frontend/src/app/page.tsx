"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Activity, AlertCircle, TrendingUp, TrendingDown, Target, Shield, Clock, Briefcase, List, ArrowRight, LayoutDashboard, Settings, Triangle } from "lucide-react";
import DashboardTab from "@/components/DashboardTab";
import GannAngle from "@/components/GannAngle";
import Ema5Strategy from "@/components/Ema5Strategy";

interface StockData {
  symbol: string;
  ltp: number;
  pChange: number;
  prevClose: number;
  adx?: number;
  rsi?: number;
  rdx?: number;
  levels: {
    previousClose: number;
    squareRoot: number;
    R1: number;
    R2: number;
    R3: number;
    S1: number;
    S2: number;
    S3: number;
  };
  snapshotStatus: {
    ceTriggerThreshold: string | null;
    peTriggerThreshold: string | null;
  };
}

export default function Home() {
  const [data, setData] = useState<StockData[]>([]);
  const [portfolio, setPortfolio] = useState<any>({
    dailyTotalPnl: 0,
    cumulativeTotalPnl: 0,
    availableFunds: 100000,
    totalCapital: 100000,
    usedCapital: 0,
    initialFunds: 100000,
    positions: [],
    isHalted: false,
  });
  const [history, setHistory] = useState<any[]>([]);
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'scanner' | 'watchlist' | 'positions' | 'history'>('scanner');
  const [mainTab, setMainTab] = useState<'dashboard' | 'gann9' | 'gannAngle' | 'ema5' | 'shoonya'>('dashboard');
  const [shoonyaConfig, setShoonyaConfig] = useState<any>({ uid: '', pwd: '', factor2: '', vc: '', appkey: '', secretCode: '', webPwd: '', expiryMonth: 'APR', initialFunds: 100000, gann9MaxTrades: 5, gannAngleMaxTrades: 5, ema5MaxTrades: 5, gann9MaxLoss: -10000, gannAngleMaxLoss: -10000, ema5MaxLoss: -10000, gann9MaxProfit: 10000, gannAngleMaxProfit: 10000, ema5MaxProfit: 10000, gann9Enabled: true, gannAngleEnabled: false, ema5Enabled: false });
  const [shoonyaStatus, setShoonyaStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [isExchanging, setIsExchanging] = useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [error, setError] = useState("");
  const [squaringOff, setSquaringOff] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const handleSquareOff = async (token: string) => {
    try {
      setSquaringOff(token);
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      await axios.post(`${API_URL}/square-off`, { token });
      await fetchScan(); // Force immediate refresh to update UI
    } catch (err) {
      console.error(err);
      alert("Failed to square off position manually.");
    } finally {
      setSquaringOff(null);
    }
  };

  const handleForceScan = async () => {
    try {
      setScanning(true);
      setScanMessage('Gann-9 scan started in background...');
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      await axios.post(`${API_URL}/force-scan`);
      setScanMessage('Scan running... refreshing results in ~30s');
      // Poll every 10s for up to 3 minutes
      let attempts = 0;
      const poll = async () => {
        attempts++;
        await fetchScan();
        if (attempts < 18) {
          setTimeout(poll, 10000);
        } else {
          setScanning(false);
          setScanMessage(null);
        }
      };
      setTimeout(poll, 10000);
    } catch (err: any) {
      setScanMessage(`Failed to start scan: ${err.message}`);
      setScanning(false);
    }
  };

  const renderHeatmap = () => {
    if (!history || history.length === 0) return null;

    const slots: Record<string, { trades: number; wins: number; profit: number }> = {};
    const labels = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'];
    labels.forEach(h => { slots[h] = { trades: 0, wins: 0, profit: 0 }; });

    history.forEach(trade => {
      // Exclude openly active trades, or failed/rejected/reconciled trades
      if (trade.status !== 'CLOSED' || trade.realizedPnl === null || trade.quantity === 0 || trade.token === 'FAILED' || (trade.exitReason && trade.exitReason.includes('Reconciled'))) return;
      const hour = new Date(trade.entryTime).getHours();
      let slot = '09:00';
      if (hour >= 10 && hour < 11) slot = '10:00';
      else if (hour >= 11 && hour < 12) slot = '11:00';
      else if (hour >= 12 && hour < 13) slot = '12:00';
      else if (hour >= 13 && hour < 14) slot = '13:00';
      else if (hour >= 14 && hour < 15) slot = '14:00';
      else if (hour >= 15) slot = '15:00';

      slots[slot].trades++;
      if (trade.realizedPnl > 0) slots[slot].wins++;
      slots[slot].profit += trade.realizedPnl;
    });

    return (
      <div className="mb-6 p-4 md:p-6 bg-neutral-900 border border-neutral-800 rounded-2xl">
        <h3 className="text-neutral-400 font-semibold mb-4 text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" /> Hourly Efficiency Heatmap
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {labels.map(label => {
            const data = slots[label];
            const winRate = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : 0;
            const isProfit = data.profit >= 0;
            const intensity = data.trades > 0 ? (isProfit ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-rose-500/20 border-rose-500/30') : 'bg-neutral-950 border-neutral-800';
            const valueColor = data.trades > 0 ? (isProfit ? 'text-emerald-400' : 'text-rose-400') : 'text-neutral-500';

            return (
              <div key={label} className={`p-3 rounded-xl border ${intensity} flex flex-col justify-between transition-colors`}>
                <div className="text-xs text-neutral-400 font-mono mb-2">{label} - {(parseInt(label) + 1).toString().padStart(2, '0')}:00</div>
                <div>
                  <div className={`font-bold font-mono text-sm ${valueColor}`}>₹{data.profit.toFixed(0)}</div>
                  <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
                    {data.trades > 0 ? `${winRate}% Win (${data.wins}/${data.trades})` : 'No Trades'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const fetchScan = async () => {
    try {
      setError("");

      const t = Date.now();
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const [scanRes, portRes, histRes, watchRes] = await Promise.all([
        axios.get(`${API_URL}/scan?t=${t}`),
        axios.get(`${API_URL}/portfolio?t=${t}`),
        axios.get(`${API_URL}/history?t=${t}`),
        axios.get(`${API_URL}/watchlist?t=${t}`)
      ]);

      if (scanRes.data.status === "success") {
        setData(scanRes.data.data);
      } else {
        setError("Failed to fetch data correctly.");
      }

      setPortfolio(portRes.data);
      setHistory(histRes.data);
      setWatchlist(watchRes.data);

    } catch (err: any) {
      setError(err.message || "Could not connect to backend");
    } finally {
      if (isFirstLoad) setIsFirstLoad(false);
    }
  };

  useEffect(() => {
    if (localStorage.getItem("isLoggedIn") === "true") {
      setIsAuthenticated(true);
    }
    setAuthChecking(false);
  }, []);

  const fetchShoonyaConfig = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const res = await axios.get(`${API_URL}/shoonya-config`);
      // Merge exactly what returns from DB with defaults
      setShoonyaConfig((prev: any) => ({
         ...prev,
         ...res.data
      }));
    } catch { }
  };

  const saveShoonyaConfig = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      setShoonyaStatus('Saving...');
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      await axios.post(`${API_URL}/shoonya-config`, shoonyaConfig);
      setShoonyaStatus('Config saved successfully!');
      setTimeout(() => setShoonyaStatus(null), 3000);
    } catch (err) {
      setShoonyaStatus('Failed to save config.');
    }
  };

  const handleResetCapital = async () => {
    if (!window.confirm("⚠️ Are you sure you want to RESET all active positions and restore capital? This will clear all 'OPEN' status trades.")) return;
    try {
      setShoonyaStatus('Resetting capital...');
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      await axios.post(`${API_URL}/reset-capital`);
      setShoonyaStatus('✅ Capital Reset Successfully!');
      fetchScan();
    } catch (err) {
      setShoonyaStatus('❌ Failed to reset capital.');
    }
  };

  const testShoonyaConnection = async () => {
    try {
      setIsTesting(true);
      setShoonyaStatus('Saving config...');
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      await axios.post(`${API_URL}/shoonya-config`, shoonyaConfig);
      setShoonyaStatus('Testing connection...');
      const res = await axios.post(`${API_URL}/shoonya-test`);
      if (res.data.status === 'success') {
        setShoonyaStatus("✅ Connected to Shoonya API Successfully!");
      } else {
        setShoonyaStatus(`⚠️ ${res.data.message || "Setup required in Config."}`);
      }
    } catch (err: any) {
      setShoonyaStatus(`❌ Error: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const exchangeShoonyaAuthCode = async () => {
    if (!authCode.trim()) {
      setShoonyaStatus('❌ Please paste the auth code from getAuthCode.py first.');
      return;
    }
    try {
      setIsExchanging(true);
      setShoonyaStatus('Exchanging auth code for session token...');
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const res = await axios.post(`${API_URL}/shoonya-exchange-code`, { authCode: authCode.trim() });
      if (res.data.status === 'success') {
        setShoonyaStatus('✅ Shoonya connected successfully! Session token saved.');
        setAuthCode('');
      } else {
        setShoonyaStatus(`❌ ${res.data.message}`);
      }
    } catch (err: any) {
      setShoonyaStatus(`❌ Error: ${err.message}`);
    } finally {
      setIsExchanging(false);
    }
  };

  const autoConnectShoonya = async () => {
    try {
      setIsAutoConnecting(true);
      setShoonyaStatus('Saving config, then launching headless browser login... (may take up to 60s)');
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      // Save config first so backend has latest webPwd + credentials
      await axios.post(`${API_URL}/shoonya-config`, shoonyaConfig);
      const res = await axios.post(`${API_URL}/shoonya-auto-connect`, {}, { timeout: 100000 });
      if (res.data.status === 'success') {
        setShoonyaStatus('✅ Auto-connected to Shoonya successfully!');
      } else {
        setShoonyaStatus(`❌ ${res.data.message}`);
      }
    } catch (err: any) {
      setShoonyaStatus(`❌ Error: ${err.message}`);
    } finally {
      setIsAutoConnecting(false);
    }
  };

  const handleToggleStrategy = async (strategy: 'gann9' | 'gannAngle' | 'ema5') => {
    let newConfig = { ...shoonyaConfig };
    if (strategy === 'gann9') {
       newConfig.gann9Enabled = !newConfig.gann9Enabled;
    } else if (strategy === 'ema5') {
       newConfig.ema5Enabled = !newConfig.ema5Enabled;
    } else {
       newConfig.gannAngleEnabled = !newConfig.gannAngleEnabled;
    }
    
    setShoonyaConfig(newConfig);
    
    // Save to backend immediately
    try {
       const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
       await axios.post(`${API_URL}/shoonya-config`, newConfig);
    } catch (e) {
       console.error("Failed to update config globally", e);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    // Initial fetch on mount
    fetchScan();
    fetchShoonyaConfig();

    // Setup 10-second polling for live updates
    const intervalId = setInterval(fetchScan, 10000);

    return () => clearInterval(intervalId);
  }, [isAuthenticated]);

  const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (authUsername === "GaneshK" && authPassword === "GaneshKolhe25") {
      localStorage.setItem("isLoggedIn", "true");
      setIsAuthenticated(true);
      setLoginError("");
    } else {
      setLoginError("Invalid Username or Password");
    }
  };

  // Gann-9 specific PnL (for header pills in the Gann-9 tab — D5)
  const isToday = (d: string) => { if (!d) return false; const t = new Date(d), n = new Date(); return t.getDate() === n.getDate() && t.getMonth() === n.getMonth() && t.getFullYear() === n.getFullYear(); };
  const gann9ActivePos = portfolio?.positions?.filter((p: any) => !p.strategyName || p.strategyName === 'GANN_9') || [];
  const gann9Unrealized = gann9ActivePos.reduce((a: number, p: any) => a + (p.currentLtp - p.entryPrice) * p.qty, 0);
  const gann9DayRealized = history?.filter((h: any) => (!h.strategyName || h.strategyName === 'GANN_9') && isToday(h.exitTime)).reduce((a: number, h: any) => a + (h.realizedPnl || 0), 0) || 0;
  const gann9DayPnl = gann9DayRealized + gann9Unrealized;
  const gann9CumulativePnl = (history?.filter((h: any) => (!h.strategyName || h.strategyName === 'GANN_9')).reduce((a: number, h: any) => a + (h.realizedPnl || 0), 0) || 0) + gann9Unrealized;

  // Set of symbols with active Gann-9 positions today (for "Traded" badge on scanner cards — G2)
  const tradedSymbolsToday = new Set<string>(
    [...(portfolio?.positions?.filter((p: any) => !p.strategyName || p.strategyName === 'GANN_9').map((p: any) => p.symbol) || []),
     ...(history?.filter((h: any) => (!h.strategyName || h.strategyName === 'GANN_9') && isToday(h.entryTime)).map((h: any) => h.symbol) || [])]
  );

  if (authChecking) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-6"></div>;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 selection:bg-indigo-500/30">
        <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-indigo-500"></div>
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
              <Shield className="w-10 h-10 text-indigo-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-br from-white to-neutral-400 bg-clip-text text-transparent text-center mb-2">
            Gann-9 Trader Login
          </h2>
          <p className="text-neutral-500 text-sm text-center mb-8">
            Access secure automated parameters
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1.5 ml-1">Username</label>
              <input
                type="text"
                autoFocus
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                placeholder="Enter your username"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1.5 ml-1">Password</label>
              <input
                type="password"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                placeholder="Enter your password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </div>

            {loginError && (
              <div className="text-rose-400 text-sm font-medium bg-rose-400/10 px-4 py-3 rounded-xl border border-rose-400/20 text-center animate-pulse">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-xl px-4 py-3.5 transition-colors flex items-center justify-center gap-2 mt-4"
            >
              Secure Login <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans flex selection:bg-indigo-500/30 overflow-hidden">
      
      {/* Sidebar - Vertical Tabs */}
      <aside className="hidden md:flex w-64 bg-neutral-900 border-r border-neutral-800 flex-col flex-shrink-0 z-20">
        <div className="p-6 pb-2">
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-br from-white to-neutral-400 bg-clip-text text-transparent">Gargee Trading</h1>
          <div className="text-[10px] text-neutral-500 font-mono mt-1 mb-6">MULTI-STRATEGY ENGINE</div>
        </div>
        
        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto no-scrollbar">
          <button 
            onClick={() => setMainTab('dashboard')} 
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${mainTab === 'dashboard' ? 'bg-indigo-500/10 text-indigo-400 shadow-[inset_2px_0_0_0_#6366f1]' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
          >
            <LayoutDashboard className="w-5 h-5 flex-shrink-0" /> Dashboard View
          </button>
          
          <button 
            onClick={() => setMainTab('gann9')} 
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${mainTab === 'gann9' ? 'bg-emerald-500/10 text-emerald-400 shadow-[inset_2px_0_0_0_#10b981]' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
          >
            <Activity className="w-5 h-5 flex-shrink-0" /> Gann Square-9
          </button>
          
          <button 
            onClick={() => setMainTab('gannAngle')} 
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${mainTab === 'gannAngle' ? 'bg-blue-500/10 text-blue-400 shadow-[inset_2px_0_0_0_#3b82f6]' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
          >
            <Triangle className="w-5 h-5 flex-shrink-0" /> Gann Angle
          </button>
          
          <button 
            onClick={() => setMainTab('ema5')} 
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${mainTab === 'ema5' ? 'bg-amber-500/10 text-amber-400 shadow-[inset_2px_0_0_0_#f59e0b]' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
          >
            <Activity className="w-5 h-5 flex-shrink-0" /> 5 EMA Mean Rev
          </button>

        </nav>
        
        <div className="p-4 border-t border-neutral-800">
           <button 
              onClick={() => setMainTab('shoonya')} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${mainTab === 'shoonya' ? 'bg-purple-500/10 text-purple-400 shadow-[inset_2px_0_0_0_#a855f7]' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
            >
              <Settings className="w-5 h-5 flex-shrink-0" /> Shoonya Setup
            </button>
            <div className="mt-4 flex items-center gap-3 px-4 py-2 opacity-50">
              <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-bold font-mono">GK</div>
              <div>
                <div className="text-xs font-bold text-white uppercase tracking-wider">Ganesh K.</div>
                <div className="text-[10px] text-neutral-500 font-mono">Dev Admin</div>
              </div>
            </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 h-screen overflow-y-auto no-scrollbar relative w-full pb-20 md:pb-0">

        {/* Mobile Bottom Navigation Layout */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-neutral-950/90 backdrop-blur-xl border-t border-neutral-800 z-50 flex items-center justify-between px-2 py-3">
           <button onClick={() => setMainTab('dashboard')} className={`flex-1 flex flex-col items-center gap-1 ${mainTab === 'dashboard' ? 'text-indigo-400' : 'text-neutral-500'}`}>
             <LayoutDashboard className="w-5 h-5" />
             <span className="text-[9px] font-bold">Dash</span>
           </button>
           <button onClick={() => setMainTab('gann9')} className={`flex-1 flex flex-col items-center gap-1 ${mainTab === 'gann9' ? 'text-emerald-400' : 'text-neutral-500'}`}>
             <Activity className="w-5 h-5" />
             <span className="text-[9px] font-bold">Square 9</span>
           </button>
           <button onClick={() => setMainTab('gannAngle')} className={`flex-1 flex flex-col items-center gap-1 ${mainTab === 'gannAngle' ? 'text-blue-400' : 'text-neutral-500'}`}>
             <Triangle className="w-5 h-5" />
             <span className="text-[9px] font-bold">Angle</span>
           </button>
           <button onClick={() => setMainTab('ema5')} className={`flex-1 flex flex-col items-center gap-1 ${mainTab === 'ema5' ? 'text-amber-400' : 'text-neutral-500'}`}>
             <Activity className="w-5 h-5" />
             <span className="text-[9px] font-bold">5 EMA</span>
           </button>
           <button onClick={() => setMainTab('shoonya')} className={`flex-1 flex flex-col items-center gap-1 ${mainTab === 'shoonya' ? 'text-purple-400' : 'text-neutral-500'}`}>
             <Settings className="w-5 h-5" />
             <span className="text-[9px] font-bold">Setup</span>
           </button>
        </div>
        <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8">
        
        {/* Dashboard Strategy View */}
        {mainTab === 'dashboard' && <DashboardTab portfolio={portfolio} history={history} shoonyaConfig={shoonyaConfig} handleToggleStrategy={handleToggleStrategy} handleSquareOff={handleSquareOff} squaringOff={squaringOff} />}

        {/* Gann Angle Strategy View */}
        {mainTab === 'gannAngle' && <GannAngle isEnabled={shoonyaConfig.gannAngleEnabled} portfolio={portfolio} history={history} handleSquareOff={handleSquareOff} squaringOff={squaringOff} />}

        {/* 5 EMA Strategy View */}
        {mainTab === 'ema5' && <Ema5Strategy isEnabled={shoonyaConfig.ema5Enabled} portfolio={portfolio} history={history} />}

        {/* Legacy Gann 9 View */}
        {mainTab === 'gann9' && (
          <div className="space-y-6 md:space-y-8 animate-in fade-in zoom-in-95 duration-500">


        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
              <Activity className="w-8 h-8 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-white to-neutral-400 bg-clip-text text-transparent">
                Gargee Trading Company
              </h1>
              <div className="text-sm font-semibold text-neutral-300 mt-1">Strategy - "Gann-9"</div>
              <div className="text-xs text-neutral-500 mt-0.5 mb-2">Developed by - "Ganesh Kolhe"</div>
              <p className="text-neutral-400 text-sm flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${portfolio.isHalted ? 'bg-rose-400' : 'animate-ping bg-emerald-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${portfolio.isHalted ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                </span>
                {portfolio.isHalted ? 'Trading Halted (Universal Exit Triggered)' : 'Automated Background Scanner Live'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Cumulative PnL Pill — Gann-9 only */}
            <div className={`flex flex-col items-end px-4 py-1.5 bg-neutral-900 border ${portfolio.isHalted ? 'border-rose-500/30' : 'border-neutral-800'} rounded-xl transition-colors`}>
              <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider mb-0.5">Gann-9 Cumul. P&L</span>
              <div className="flex items-baseline gap-2">
                <span className={`text-lg font-mono font-bold ${gann9CumulativePnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {gann9CumulativePnl >= 0 ? "+" : ""}₹{Math.abs(gann9CumulativePnl).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Day PnL Pill — Gann-9 only */}
            <div className={`flex flex-col items-end px-4 py-1.5 bg-neutral-900 border ${portfolio.isHalted ? 'border-rose-500/30' : 'border-neutral-800'} rounded-xl transition-colors`}>
              <div className="flex gap-3 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider mb-0.5">
                <span>Gann-9 Positions: {gann9ActivePos.length}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-neutral-600 font-semibold uppercase tracking-widest hidden sm:inline-block">Day P&L</span>
                <span className={`text-lg font-mono font-bold ${gann9DayPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {gann9DayPnl >= 0 ? "+" : ""}₹{Math.abs(gann9DayPnl).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </header>


        
        {/* Gann 9 Inner Tab Navigation */}
        {mainTab === 'gann9' && (
          <div className="flex flex-row flex-nowrap overflow-x-auto items-center gap-2 border-b border-neutral-800 pb-2 no-scrollbar scroll-smooth">
          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'scanner' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
          >
            <Activity className="w-4 h-4" />
            Scanner Engine
          </button>
          <button
            onClick={() => setActiveTab('watchlist')}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'watchlist' ? 'border-amber-500 text-amber-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
          >
            <Clock className="w-4 h-4" />
            Pending Watchlist
            {watchlist?.length > 0 && (
              <span className="ml-1 bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full text-xs">{watchlist.length}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('positions')}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'positions' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
          >
            <Briefcase className="w-4 h-4" />
            Active Positions
            {portfolio.positions?.length > 0 && (
              <span className="ml-1 bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full text-xs">{portfolio.positions.length}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-blue-500 text-blue-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
          >
            <List className="w-4 h-4" />
            Trade Ledger
          </button>
        </div >
        )}

        {/* Error State */}
        {
          error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )
        }

        {/* Loading Skeletons - Only on First Load */}
        {
          isFirstLoad && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-64 bg-neutral-900/50 rounded-2xl border border-neutral-800/50 animate-pulse"></div>
              ))}
            </div>
          )
        }

        {/* Tab 1: Scanner Data Grid */}
        {
          activeTab === 'scanner' && (
            <>
              {/* Re-run scan button — always visible in Scanner Engine tab */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-500">
                  {data.length > 0 ? `${data.length} stock${data.length !== 1 ? 's' : ''} matching Gann-9 rules` : 'No matches yet'}
                </span>
                <button
                  onClick={handleForceScan}
                  disabled={scanning}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border transition-all ${
                    scanning
                      ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400 cursor-not-allowed'
                      : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 hover:border-indigo-500/60'
                  }`}
                >
                  {scanning ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4" />
                      Re-run Gann-9 Scan
                    </>
                  )}
                </button>
              </div>

              {scanMessage && (
                <div className="mb-4 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 text-sm">
                  {scanMessage}
                </div>
              )}

              {data.length === 0 && !error && !isFirstLoad && (
                <div className="text-center py-20 border border-dashed border-neutral-800 rounded-2xl">
                  <p className="text-neutral-500">No Nifty 200 setup found right now matching rules (5k-30k Price & ADX  &gt; 25).</p>
                  <p className="text-neutral-600 text-xs mt-2">Use "Re-run Gann-9 Scan" above to trigger a fresh scan.</p>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {data.map((stock) => {
                  const isBullish = stock.pChange >= 0;
                  const hasCE = stock.snapshotStatus.ceTriggerThreshold;
                  const hasPE = stock.snapshotStatus.peTriggerThreshold;

                  const isTraded = tradedSymbolsToday.has(stock.symbol);
                  return (
                    <div
                      key={stock.symbol}
                      className={`group relative bg-neutral-900 border rounded-2xl p-6 hover:border-neutral-700 transition-all overflow-hidden ${isTraded ? 'border-indigo-500/30' : 'border-neutral-800'}`}
                    >
                      {/* Background glow based on trend */}
                      <div className={`absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl opacity-10 blur-3xl rounded-full pointer-events-none transition-colors duration-500 ${isBullish ? 'from-emerald-500' : 'from-rose-500'
                        }`}></div>

                      <div className="relative z-10 flex justify-between items-start mb-6">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-2xl font-bold tracking-tight">{stock.symbol}</h2>
                            {isTraded && (
                              <span className="px-2 py-0.5 text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded">TRADED</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-neutral-400 text-sm">Prev Close:</span>
                            <span className="font-mono text-sm">₹{stock.prevClose.toFixed(2)}</span>
                            <span className="text-[10px] text-neutral-600 font-mono border border-neutral-800 px-1.5 py-0.5 rounded">Data: 9:20 AM</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-mono font-medium">₹{stock.ltp.toFixed(2)}</div>
                          <div className={`flex items-center justify-end gap-1 text-sm font-medium ${isBullish ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isBullish ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            {stock.pChange.toFixed(2)}%
                          </div>
                        </div>
                      </div>

                      {/* Gann Levels */}
                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="space-y-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                          <div className="flex items-center gap-2 text-emerald-400 mb-2">
                            <Target className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Resistance</span>
                          </div>
                          <div className="flex justify-between text-sm font-mono">
                            <span className="text-neutral-500">R3</span>
                            <span className="text-neutral-300">₹{stock.levels.R3.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-mono">
                            <span className="text-neutral-500">R2</span>
                            <span className="text-neutral-300">₹{stock.levels.R2.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-mono font-medium">
                            <span className="text-emerald-500">R1</span>
                            <span className="text-emerald-400">₹{stock.levels.R1.toFixed(2)}</span>
                          </div>
                        </div>

                        <div className="space-y-3 p-4 rounded-xl bg-rose-500/5 border border-rose-500/10">
                          <div className="flex items-center gap-2 text-rose-400 mb-2">
                            <Shield className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Support</span>
                          </div>
                          <div className="flex justify-between text-sm font-mono font-medium">
                            <span className="text-rose-500">S1</span>
                            <span className="text-rose-400">₹{stock.levels.S1.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-mono">
                            <span className="text-neutral-500">S2</span>
                            <span className="text-neutral-300">₹{stock.levels.S2.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-mono">
                            <span className="text-neutral-500">S3</span>
                            <span className="text-neutral-300">₹{stock.levels.S3.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Trade Status Engine */}
                      <div className="pt-4 border-t border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">Engine Status</span>
                          {hasCE ? (
                            <span className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium">
                              CE Trigger ({hasCE})
                            </span>
                          ) : hasPE ? (
                            <span className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium">
                              PE Trigger ({hasPE})
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded bg-neutral-800 text-neutral-400 border border-neutral-700 text-xs font-medium flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-pulse"></span>
                              Scanning
                            </span>
                          )}
                        </div>

                        {/* Visual Position Indicator */}
                        <div className="flex flex-col items-end gap-1">
                          <div className="text-xs font-mono text-neutral-400">
                            RSI: <span className="text-neutral-200">{stock.rsi?.toFixed(1) || '--'}</span> | ADX: <span className="text-violet-400 font-bold">{stock.adx?.toFixed(1) || '--'}</span> | RDX: <span className="text-amber-400">{stock.rdx?.toFixed(1) || '--'}</span>
                          </div>
                          <div className="text-[10px] font-mono text-neutral-600">
                            Shoonya Link: <span className={hasCE || hasPE ? "text-emerald-500" : "text-neutral-500"}>{hasCE || hasPE ? "Ready for Live Execution" : "Waiting for Setup"}</span>
                          </div>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            </>
          )
        }

        {/* Tab 2: Pending Watchlist */}
        {
          activeTab === 'watchlist' && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-neutral-950/50 border-b border-neutral-800 text-neutral-400 font-medium">
                    <tr>
                      <th className="px-6 py-4">Symbol</th>
                      <th className="px-6 py-4">Trigger Direction</th>
                      <th className="px-6 py-4 font-mono">Trigger Level</th>
                      <th className="px-6 py-4">Target / SL</th>
                      <th className="px-6 py-4 text-right">Countdown Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {watchlist?.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-neutral-500">
                          No stocks currently pending validation. (Gann: 5-min sustain | EMA_5: 1-min sustain)
                        </td>
                      </tr>
                    ) : (
                      watchlist?.map((item: any) => {
                        const sustainMs = item.strategyName === 'EMA_5' ? 60 * 1000 : 5 * 60 * 1000;
                        const sustainMins = sustainMs / 60000;
                        const elapsed = Date.now() - item.breakoutTime;
                        const minsLeft = Math.max(0, sustainMins - (elapsed / 60000)).toFixed(1);
                        const isComplete = elapsed >= sustainMs;

                        return (
                          <tr key={item.symbol} className="hover:bg-neutral-800/20 transition-colors">
                            <td className="px-6 py-4 font-bold text-neutral-200">
                              {item.symbol}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold border ${item.type === 'CE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                                {item.type} TRIGGER
                              </span>
                            </td>
                            <td className="px-6 py-4 font-mono text-neutral-300">
                              ₹{item.triggerPrice.toFixed(2)}
                            </td>
                            <td className="px-6 py-4 font-mono text-xs">
                              <span className="text-neutral-400 block border-b border-neutral-700 pb-0.5 mb-0.5">T: ₹{item.targetPrice.toFixed(2)}</span>
                              <span className="text-neutral-500 block">SL: ₹{item.slPrice.toFixed(2)}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {isComplete ? (
                                <span className="text-indigo-400 font-bold animate-pulse text-xs uppercase tracking-wider">Executing Trade...</span>
                              ) : (
                                <div className="flex flex-col items-end gap-1">
                                  <span className="text-amber-400 font-mono font-bold text-sm">Wait {minsLeft}m</span>
                                  <div className="w-24 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-500 rounded-full transition-all duration-1000" style={{ width: `${Math.min(100, (elapsed / sustainMs) * 100)}%` }}></div>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card Layout for Watchlist */}
              <div className="block md:hidden divide-y divide-neutral-800">
                {watchlist?.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-neutral-500">No stocks in pending observation queue.</div>
                ) : (
                  watchlist?.map((item: any) => {
                    const sustainMs = item.strategyName === 'EMA_5' ? 60 * 1000 : 5 * 60 * 1000;
                    const sustainMins = sustainMs / 60000;
                    const elapsed = Date.now() - item.breakoutTime;
                    const minsLeft = Math.max(0, sustainMins - (elapsed / 60000)).toFixed(1);
                    const isComplete = elapsed >= sustainMs;
                    return (
                      <div key={item.symbol} className="p-4 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-neutral-200 text-lg">{item.symbol}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold border ${item.type === 'CE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                            {item.type} TRIG
                          </span>
                        </div>
                        <div className="flex justify-between items-center bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                          <div className="font-mono text-sm text-neutral-300">Level: <span className="text-white">₹{item.triggerPrice.toFixed(2)}</span></div>
                          <div className="flex flex-col items-end font-mono text-xs text-neutral-400 gap-1">
                            <span>T: <span className="text-emerald-400">₹{item.targetPrice.toFixed(2)}</span></span>
                            <span>SL: <span className="text-rose-400">₹{item.slPrice.toFixed(2)}</span></span>
                          </div>
                        </div>
                        <div>
                          {isComplete ? (
                            <div className="text-indigo-400 font-bold animate-pulse text-xs uppercase tracking-wider text-center p-2 bg-indigo-500/10 rounded-lg">Executing Trade...</div>
                          ) : (
                            <div className="flex flex-col gap-1.5 p-2 bg-neutral-950 rounded-lg border border-neutral-800">
                              <div className="flex justify-between text-xs text-neutral-400">
                                <span>Validation Wait</span>
                                <span className="text-amber-400 font-mono font-bold">{minsLeft}m</span>
                              </div>
                              <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500 rounded-full transition-all duration-1000" style={{ width: `${Math.min(100, (elapsed / sustainMs) * 100)}%` }}></div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        }

        {/* Tab 3: Active Positions */}
        {
          activeTab === 'positions' && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-neutral-950/50 border-b border-neutral-800 text-neutral-400 font-medium">
                    <tr>
                      <th className="px-6 py-4">Symbol / Option</th>
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Qty</th>
                      <th className="px-6 py-4">Option Entry</th>
                      <th className="px-6 py-4">Stop Loss</th>
                      <th className="px-6 py-4">Target / SL</th>
                      <th className="px-6 py-4">Stock LTP</th>
                      <th className="px-6 py-4">Option LTP</th>
                      <th className="px-6 py-4">Run-up / Drawdown</th>
                      <th className="px-6 py-4 text-right">Unrealized P&L</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {portfolio.positions?.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-6 py-12 text-center text-neutral-500">
                          No active positions right now. Waiting for Gann Engine Trade Signals...
                        </td>
                      </tr>
                    ) : (
                      portfolio.positions?.map((pos: any) => {
                        const uPnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                        return (
                          <tr key={pos.token} className="hover:bg-neutral-800/20 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-bold text-neutral-200">{pos.symbol}</div>
                              <div className="text-xs text-neutral-500 font-mono mt-0.5">{pos.tradingSymbol || pos.token}</div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${pos.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                {pos.type}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-mono">{pos.qty}</td>
                            <td className="px-6 py-4 font-mono text-center">
                              <span className="text-white text-sm font-bold bg-neutral-800 px-2 py-1 rounded">₹{pos.entryPrice.toFixed(2)}</span>
                            </td>
                            <td className="px-6 py-4 font-mono text-center">
                              <span className="text-neutral-400 text-xs uppercase tracking-widest">Stop Loss</span><br />
                              <span className="text-rose-400 font-bold">₹{pos.slPrice?.toFixed(2) || '--'}</span>
                            </td>
                            <td className="px-6 py-4 font-mono text-center">
                              <span className="text-amber-500 font-bold flex items-center justify-center gap-1">🎯 ₹{pos.targetPrice?.toFixed(2) || '--'}</span>
                              <span className="text-rose-500 font-bold mt-1 flex items-center justify-center gap-1">🛑 ₹{pos.slPrice?.toFixed(2) || '--'}</span>
                            </td>
                            <td className="px-6 py-4 font-mono text-center">
                              <span className="text-neutral-200 font-bold bg-neutral-800 px-2 py-1 rounded">₹{pos.stockLtp?.toFixed(2) || '--'}</span>
                            </td>
                            <td className="px-6 py-4 font-mono text-center">
                              <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]">₹{pos.currentLtp.toFixed(2)}</span>
                            </td>
                            <td className="px-6 py-4 font-mono text-xs">
                              <div className="text-emerald-400 font-bold">Max↑ ₹{(pos.maxProfit || 0).toFixed(2)}</div>
                              <div className="text-rose-400 font-bold mt-0.5">Max↓ ₹{(pos.maxLoss || 0).toFixed(2)}</div>
                            </td>
                            <td className="px-6 py-4 text-right font-mono font-bold">
                              <span className={uPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {uPnl >= 0 ? '+' : ''}₹{uPnl.toFixed(2)}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => handleSquareOff(pos.token)}
                                disabled={squaringOff === pos.token}
                                className={`px-3 py-1.5 text-xs font-bold rounded ${squaringOff === pos.token ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30'} transition-colors`}
                              >
                                {squaringOff === pos.token ? 'Closing...' : 'Square Off'}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card Layout for Active Positions */}
              <div className="block md:hidden divide-y divide-neutral-800">
                {portfolio.positions?.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-neutral-500">No active positions right now.</div>
                ) : (
                  portfolio.positions?.map((pos: any) => {
                    const uPnl = (pos.currentLtp - pos.entryPrice) * pos.qty;
                    return (
                      <div key={pos.token} className="p-4 space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-neutral-200 text-lg flex items-center gap-2">
                              {pos.symbol}
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                {pos.type}
                              </span>
                            </div>
                            <div className="text-xs text-neutral-500 font-mono mt-0.5">{pos.tradingSymbol || pos.token}</div>
                          </div>
                          <div className="text-right">
                            <span className={`font-mono font-bold text-lg ${uPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {uPnl >= 0 ? '+' : ''}₹{uPnl.toFixed(2)}
                            </span>
                            <div className="text-xs text-neutral-500 font-mono mt-1">Qty: {pos.qty}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 flex flex-col justify-between">
                            <span className="text-xs text-neutral-500 uppercase tracking-widest mb-1">Option Premium</span>
                            <div className="font-mono text-sm">
                              In: <span className="text-white">₹{pos.entryPrice.toFixed(2)}</span>
                            </div>
                            <div className="font-mono text-sm mt-1">
                              Live: <span className="text-indigo-400 font-bold bg-indigo-500/10 px-1 py-0.5 rounded">₹{pos.currentLtp.toFixed(2)}</span>
                            </div>
                          </div>
                          <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 flex flex-col justify-between">
                            <span className="text-xs text-neutral-500 uppercase tracking-widest mb-1">Stock CMP</span>
                            <div className="font-mono text-sm text-white">₹{pos.stockLtp?.toFixed(2) || '--'}</div>
                            <div className="font-mono text-xs mt-1 text-emerald-400">T: ₹{pos.targetPrice?.toFixed(2) || '--'}</div>
                            <div className="font-mono text-xs text-rose-400">🛑 ₹{pos.slPrice?.toFixed(2) || '--'}</div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleSquareOff(pos.token)}
                          disabled={squaringOff === pos.token}
                          className={`w-full py-2.5 text-sm font-bold rounded-xl ${squaringOff === pos.token ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30'} transition-colors flex justify-center items-center gap-2`}
                        >
                          {squaringOff === pos.token ? 'Closing Transaction...' : 'Manual Square Off'}
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        }

        {/* Tab 3: Trade History Ledger */}
        {
          activeTab === 'history' && (
            <div className="flex flex-col">
              {renderHeatmap()}
              {/* G4: Failed/rejected trade count */}
              {(() => {
                const failedCount = history?.filter((r: any) => r.token === 'FAILED' || r.quantity === 0).length || 0;
                return failedCount > 0 ? (
                  <div className="mb-4 px-4 py-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm text-rose-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span><span className="font-bold">{failedCount}</span> rejected/failed trade{failedCount > 1 ? 's' : ''} today (option token unavailable or margin insufficient) — excluded from ledger below.</span>
                  </div>
                ) : null;
              })()}
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden mt-2">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-neutral-950/50 border-b border-neutral-800 text-neutral-400 font-medium">
                      <tr>
                        <th className="px-6 py-4">Buy Time</th>
                        <th className="px-6 py-4">Sell Time</th>
                        <th className="px-6 py-4">Option Token</th>
                        <th className="px-6 py-4">Action</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Entry/Exit</th>
                        <th className="px-6 py-4">Max Profit / Max DD</th>
                        <th className="px-6 py-4">Note / Reason</th>
                        <th className="px-6 py-4 text-right">Realized P&L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/50">
                      {history?.filter((r: any) => r.quantity > 0 && r.token !== 'FAILED' && !(r.exitReason && r.exitReason.includes('Reconciled'))).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-6 py-12 text-center text-neutral-500">
                            No valid trade history documented in the database yet.
                          </td>
                        </tr>
                      ) : (
                        history?.filter((r: any) => r.quantity > 0 && r.token !== 'FAILED' && !(r.exitReason && r.exitReason.includes('Reconciled'))).map((record: any) => {
                          const timeString = new Date(record.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                          return (
                            <tr key={record.id} className="hover:bg-neutral-800/20 transition-colors">
                              <td className="px-6 py-4 text-xs text-neutral-400 font-mono">
                                {timeString}
                              </td>
                              <td className="px-6 py-4 text-xs text-neutral-500 font-mono">
                                {record.exitTime ? new Date(record.exitTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'}
                              </td>
                              <td className="px-6 py-4">
                                <div className="font-bold text-neutral-200">{record.symbol}</div>
                                <div className="text-xs text-neutral-500 font-mono mt-0.5">{record.tradingSymbol || record.token}</div>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${record.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400' : 'text-rose-400 bg-rose-500/20'}`}>
                                  BUY {record.type}
                                </span>
                                <span className="ml-2 text-xs font-mono text-neutral-500">x{record.quantity}</span>
                              </td>
                              <td className="px-6 py-4">
                                {record.status === 'CLOSED' ? (
                                  <span className="px-2 py-0.5 rounded text-xs bg-neutral-800 text-neutral-300">CLOSED</span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-xs bg-indigo-500/20 text-indigo-400 animate-pulse">OPEN</span>
                                )}
                              </td>
                              <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                                <div>In: <span className="text-neutral-200">₹{record.entryPrice.toFixed(2)}</span></div>
                                {record.exitPrice ? <div>Out: <span className="text-neutral-200">₹{record.exitPrice.toFixed(2)}</span></div> : null}
                              </td>
                              <td className="px-6 py-4 font-mono text-xs">
                                <div className="text-emerald-400">H: ₹{(record.maxProfit || 0).toFixed(2)}</div>
                                <div className="text-rose-400 mt-0.5">L: ₹{(record.maxLoss || 0).toFixed(2)}</div>
                              </td>
                              <td className="px-6 py-4 text-xs text-neutral-500 max-w-[200px] truncate" title={record.exitReason || 'Active in Market'}>
                                {record.exitReason || 'Active in Market'}
                              </td>
                              <td className="px-6 py-4 text-right font-mono font-bold">
                                {record.realizedPnl !== null ? (
                                  <span className={record.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                    {record.realizedPnl >= 0 ? '+' : ''}₹{record.realizedPnl.toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-neutral-600">--</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Layout for Trade History */}
                <div className="block md:hidden divide-y divide-neutral-800">
                  {history?.filter((r: any) => r.quantity > 0 && r.token !== 'FAILED' && !(r.exitReason && r.exitReason.includes('Reconciled'))).length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-neutral-500">No valid trade history documented.</div>
                  ) : (
                    history?.filter((r: any) => r.quantity > 0 && r.token !== 'FAILED' && !(r.exitReason && r.exitReason.includes('Reconciled'))).map((record: any) => {
                      const isProfit = record.realizedPnl !== null && record.realizedPnl >= 0;
                      return (
                        <div key={record.id} className="p-4 flex flex-col gap-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-bold text-neutral-200 text-lg">{record.symbol}</div>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mt-1 inline-block border ${record.type === 'CE' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                                BUY {record.type} x{record.quantity}
                              </span>
                            </div>
                            <div className="text-right">
                              {record.status === 'CLOSED' ? (
                                <span className={`font-mono font-bold text-lg ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {isProfit ? '+' : ''}₹{(record.realizedPnl || 0).toFixed(2)}
                                </span>
                              ) : (
                                <span className="px-2 py-1 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 uppercase border border-indigo-500/20 animate-pulse">Running</span>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                            <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-800 text-neutral-400 flex flex-col justify-center">
                              <div>In: <span className="text-white">₹{record.entryPrice.toFixed(2)}</span></div>
                              {record.exitPrice ? <div>Out: <span className="text-white">₹{record.exitPrice.toFixed(2)}</span></div> : null}
                            </div>
                            <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-800 text-neutral-400 flex flex-col justify-center text-right">
                              <div className="text-emerald-400">High: ₹{(record.maxProfit || 0).toFixed(2)}</div>
                              <div className="text-rose-400">Low: ₹{(record.maxLoss || 0).toFixed(2)}</div>
                            </div>
                          </div>
                          <div className="text-[10px] text-neutral-400 mt-2 flex flex-col gap-1 border-t border-neutral-800 pt-2">
                            <div className="flex justify-between">
                              <span>Buy: {new Date(record.entryTime).toLocaleString('en-IN', { hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                              <span className={record.exitReason?.includes('Target') ? 'text-emerald-400' : record.exitReason?.includes('Stop Loss') ? 'text-rose-400' : 'text-neutral-400'}>{record.exitReason || 'Active in Market'}</span>
                            </div>
                            {record.exitTime && (
                              <div className="flex justify-between text-neutral-500">
                                <span>Sell: {new Date(record.exitTime).toLocaleString('en-IN', { hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )
        }
        </div>
        )}

        {/* Tab 5: Shoonya Setup */}
        {
          mainTab === 'shoonya' && (
            <div className="max-w-2xl mx-auto bg-neutral-900 border border-neutral-800 rounded-2xl p-6 md:p-8">
              <h2 className="text-xl font-bold tracking-tight mb-2">Finvasia Shoonya Connection</h2>
              <p className="text-neutral-500 text-sm mb-6 pb-6 border-b border-neutral-800">Assign the Broker API credentials. Leave blank to fallback to Google Cloud Environment Variables. Once configured, Option Chain parameters will be resolved natively through the API via live connection.</p>

              <form onSubmit={saveShoonyaConfig} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">User ID</label>
                    <input
                      type="text"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 placeholder-neutral-700 outline-none focus:border-purple-500/50"
                      value={shoonyaConfig.uid}
                      placeholder="e.g. FA123456"
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, uid: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">SHA256 Password</label>
                    <div className="relative group">
                       <input
                        type={showPwd ? "text" : "password"}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-4 pr-24 py-2.5 text-neutral-100 placeholder-neutral-700 outline-none focus:border-purple-500/50"
                        value={shoonyaConfig.pwd}
                        placeholder="Enter plain or hashed..."
                        onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, pwd: e.target.value })}
                       />
                       <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <button 
                            type="button" 
                            onClick={() => setShowPwd(!showPwd)}
                            className="p-1.5 hover:bg-neutral-800 rounded-md text-neutral-500 transition-colors"
                            title="Toggle Visibility"
                          >
                            <Activity className={`w-3.5 h-3.5 ${showPwd ? 'text-indigo-400' : ''}`} />
                          </button>
                          <button 
                            type="button" 
                            onClick={async () => {
                               if (shoonyaConfig.pwd && shoonyaConfig.pwd.length < 64) {
                                  // Compute SHA256 locally using WebCrypto
                                  const msgUint8 = new TextEncoder().encode(shoonyaConfig.pwd);
                                  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
                                  const hashArray = Array.from(new Uint8Array(hashBuffer));
                                  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                                  setShoonyaConfig({ ...shoonyaConfig, pwd: hashHex });
                                  setShoonyaStatus("✅ Password hashed successfully!");
                                  setTimeout(() => setShoonyaStatus(null), 2000);
                               }
                            }}
                            className="text-[10px] bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold px-2 py-1.5 border border-indigo-500/20 rounded-md transition-all uppercase tracking-tighter"
                          >
                            Hash It
                          </button>
                       </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">PAN / TOTP Secret</label>
                    <input
                      type="text"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 placeholder-neutral-700 outline-none focus:border-purple-500/50"
                      value={shoonyaConfig.factor2}
                      placeholder="PAN Number or TOTP Key"
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, factor2: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Vendor Code</label>
                    <input
                      type="text"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 placeholder-neutral-700 outline-none focus:border-purple-500/50"
                      value={shoonyaConfig.vc}
                      placeholder="Vendor_Code"
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, vc: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">App Key (API Key)</label>
                    <input
                      type="password"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 placeholder-neutral-700 outline-none focus:border-purple-500/50"
                      value={shoonyaConfig.appkey}
                      placeholder="API Key from Shoonya portal"
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, appkey: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">
                      Secret Code
                      <span className="ml-2 text-[10px] text-purple-400/70 font-normal uppercase tracking-wide">For Auto Connect</span>
                      {shoonyaConfig.secretCodeSet && !shoonyaConfig.secretCode && (
                        <span className="ml-2 text-[10px] text-emerald-500 font-normal">Saved</span>
                      )}
                    </label>
                    <input
                      type="password"
                      className="w-full bg-neutral-950 border border-purple-500/20 rounded-lg px-4 py-2.5 text-neutral-100 placeholder-neutral-600 outline-none focus:border-purple-500/50"
                      value={shoonyaConfig.secretCode || ''}
                      placeholder={shoonyaConfig.secretCodeSet ? '••••••••  (saved — leave blank to keep)' : 'Secret Code from API Key Generation page'}
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, secretCode: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">
                      Web Login Password
                      <span className="ml-2 text-[10px] text-amber-500/70 font-normal uppercase tracking-wide">For Auto Connect</span>
                      {shoonyaConfig.webPwdSet && !shoonyaConfig.webPwd && (
                        <span className="ml-2 text-[10px] text-emerald-500 font-normal">Password saved</span>
                      )}
                    </label>
                    <input
                      type="password"
                      className="w-full bg-neutral-950 border border-amber-500/20 rounded-lg px-4 py-2.5 text-neutral-100 placeholder-neutral-600 outline-none focus:border-amber-500/50"
                      value={shoonyaConfig.webPwd || ''}
                      placeholder={shoonyaConfig.webPwdSet ? '••••••••  (saved — leave blank to keep)' : 'Plain password (not hashed)'}
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, webPwd: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-neutral-800 pt-6 mt-6">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Trading Mode</label>
                    <select
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-semibold"
                      value={shoonyaConfig.tradingMode || 'PAPER'}
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, tradingMode: e.target.value })}
                    >
                      <option value="PAPER">📝 Virtual Paper Trading</option>
                      <option value="LIVE">🔥 Live Execution (Actual Funds)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Maximum Trades (Per Day)</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 font-mono"
                      value={shoonyaConfig.maxTrades || 10}
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, maxTrades: parseInt(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Total Capital (₹)</label>
                    <input
                      type="number"
                      min="1000"
                      step="1000"
                      className="w-full bg-neutral-950 border border-emerald-800/40 rounded-lg px-4 py-2.5 text-emerald-300 placeholder-neutral-700 outline-none focus:border-emerald-500/60 font-mono font-bold"
                      value={shoonyaConfig.initialFunds || 100000}
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, initialFunds: parseFloat(e.target.value) || 100000 })}
                    />
                    <p className="text-[11px] text-neutral-600 mt-1">Saved with &quot;Save Config&quot;. Requires restart to take effect.</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Override Expiry Month</label>
                    <select
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-semibold"
                      value={shoonyaConfig.expiryMonth || 'APR'}
                      onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, expiryMonth: e.target.value })}
                    >
                      <option value="AUTO">🤖 Auto Detection (Recommended)</option>
                      <option value="JAN">January (JAN)</option>
                      <option value="FEB">February (FEB)</option>
                      <option value="MAR">March (MAR)</option>
                      <option value="APR">April (APR)</option>
                      <option value="MAY">May (MAY)</option>
                      <option value="JUN">June (JUN)</option>
                      <option value="JUL">July (JUL)</option>
                      <option value="AUG">August (AUG)</option>
                      <option value="SEP">September (SEP)</option>
                      <option value="OCT">October (OCT)</option>
                      <option value="NOV">November (NOV)</option>
                      <option value="DEC">December (DEC)</option>
                    </select>
                    <p className="text-xs text-neutral-500 mt-1">If the bot is failing to find option contracts with 'Resolution Errors', manually set the active month here.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-neutral-800 pt-6 mt-6">
                  <div className="md:col-span-3">
                     <h3 className="text-md font-bold text-white mb-2">Strategy Threshold Controls</h3>
                     <p className="text-sm text-neutral-500 mb-4">Set maximum daily operations and isolated risk guards per strategy natively.</p>
                  </div>
                  
                  {/* Gann 9 Config */}
                  <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl">
                    <div className="font-bold text-emerald-400 mb-4 border-b border-neutral-800 pb-2">Gann 9 Strategy</div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Config Daily Trades</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 font-mono"
                          value={shoonyaConfig.gann9MaxTrades || 5} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, gann9MaxTrades: parseInt(e.target.value) || 5 })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Allowable Daily Loss (₹)</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 font-mono"
                          value={shoonyaConfig.gann9MaxLoss || -10000} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, gann9MaxLoss: parseFloat(e.target.value) || -10000 })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Config Target Profit (₹)</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-emerald-500/50 font-mono"
                          value={shoonyaConfig.gann9MaxProfit || 10000} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, gann9MaxProfit: parseFloat(e.target.value) || 10000 })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Gann Angle Config */}
                  <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl">
                    <div className="font-bold text-blue-400 mb-4 border-b border-neutral-800 pb-2">Gann Angle Strategy</div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Config Daily Trades</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 font-mono"
                          value={shoonyaConfig.gannAngleMaxTrades || 5} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, gannAngleMaxTrades: parseInt(e.target.value) || 5 })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Allowable Daily Loss (₹)</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 font-mono"
                          value={shoonyaConfig.gannAngleMaxLoss || -10000} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, gannAngleMaxLoss: parseFloat(e.target.value) || -10000 })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Config Target Profit (₹)</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-emerald-500/50 font-mono"
                          value={shoonyaConfig.gannAngleMaxProfit || 10000} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, gannAngleMaxProfit: parseFloat(e.target.value) || 10000 })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 5 EMA Config */}
                  <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl">
                    <div className="font-bold text-amber-500 mb-4 border-b border-neutral-800 pb-2">5 EMA Strategy</div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Config Daily Trades</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 font-mono"
                          value={shoonyaConfig.ema5MaxTrades || 5} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, ema5MaxTrades: parseInt(e.target.value) || 5 })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Allowable Daily Loss (₹)</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-indigo-500/50 font-mono"
                          value={shoonyaConfig.ema5MaxLoss || -10000} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, ema5MaxLoss: parseFloat(e.target.value) || -10000 })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Max Config Target Profit (₹)</label>
                        <input
                          type="number" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-700 outline-none focus:border-emerald-500/50 font-mono"
                          value={shoonyaConfig.ema5MaxProfit || 10000} onChange={(e) => setShoonyaConfig({ ...shoonyaConfig, ema5MaxProfit: parseFloat(e.target.value) || 10000 })}
                        />
                      </div>
                    </div>
                  </div>
                  
                </div>

                {shoonyaStatus && (
                  <div className={`p-3 rounded-lg text-sm border font-medium ${shoonyaStatus.includes('❌') ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                    {shoonyaStatus}
                  </div>
                )}

                <div className="pt-4 flex flex-wrap gap-3">
                  <button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg px-6 py-2.5 transition-colors">
                    Save Config
                  </button>
                  <button
                    type="button"
                    onClick={autoConnectShoonya}
                    disabled={isAutoConnecting}
                    className="bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded-lg px-6 py-2.5 transition-colors disabled:opacity-50"
                  >
                    {isAutoConnecting ? 'Connecting... (up to 60s)' : 'Auto Connect'}
                  </button>
                  <button type="button" onClick={testShoonyaConnection} disabled={isTesting} className="bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-white font-medium rounded-lg px-6 py-2.5 transition-colors disabled:opacity-50">
                    {isTesting ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetCapital}
                    className="border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium rounded-lg px-6 py-2.5 transition-colors"
                  >
                    Reset & Restore Capital
                  </button>
                </div>
              </form>

              {/* OAuth Auth Code Exchange Section */}
              <div className="mt-8 pt-6 border-t border-neutral-800">
                <h3 className="text-base font-semibold text-neutral-200 mb-1">OAuth Auth Code Login</h3>
                <p className="text-neutral-500 text-xs mb-4">
                  If "Test Connection" fails with a 502 error, the broker API is blocking the cloud server IP. Run <span className="font-mono text-amber-400">getAuthCode.py</span> locally on your machine to get a one-time auth code, then paste it below.
                </p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    className="flex-1 bg-neutral-950 border border-amber-500/30 rounded-lg px-4 py-2.5 text-neutral-100 placeholder-neutral-600 outline-none focus:border-amber-500/60 font-mono text-sm"
                    value={authCode}
                    placeholder="Paste auth code from getAuthCode.py output..."
                    onChange={(e) => setAuthCode(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={exchangeShoonyaAuthCode}
                    disabled={isExchanging || !authCode.trim()}
                    className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 font-medium rounded-lg px-5 py-2.5 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {isExchanging ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              </div>
            </div>
          )
        }
        </div>
      </main>
    </div >
  );
}

