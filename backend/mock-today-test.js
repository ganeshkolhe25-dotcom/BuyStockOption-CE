/**
 * MOCK BACKTEST — April 9, 2026
 * Simulates all 3 strategies as they would have run this morning
 * using real Shoonya market data for today.
 */

const axios = require('axios');
const crypto = require('crypto');
const { TOTP } = require('totp-generator');
const { EMA, RSI, ADX } = require('technicalindicators');
require('dotenv').config();

const AUTH_URL  = 'https://trade.shoonya.com/NorenWClientAPI';
const DATA_URL  = 'https://trade.shoonya.com/NorenWClient';

const NIFTY_100 = [
    "RELIANCE","TCS","HDFCBANK","ICICIBANK","BHARTIARTL","INFY","ITC","SBIN","LT","BAJFINANCE",
    "KOTAKBANK","AXISBANK","HAL","M&M","HCLTECH","TATAMOTORS","SUNPHARMA","NTPC",
    "MARUTI","ONGC","TATASTEEL","POWERGRID","ASIANPAINT","BAJAJFINSV","TITAN","COALINDIA","BAJAJ-AUTO",
    "ADANIPORTS","ADANIENT","DIXON","WIPRO","HINDUNILVR","DRREDDY","IOC","GRASIM","TECHM","JSWSTEEL",
    "APOLLOHOSP","INDUSINDBK","EICHERMOT","HDFCLIFE","BPCL","BRITANNIA","CIPLA","VEDL","DIVISLAB",
    "HEROMOTOCO","SHREECEM","TRENT","BEL","CHOLAFIN","TVSMOTOR","GAIL","INDIGO","AMBUJACEM",
    "TORNTPHARM","ABB","TATACOMM","UPL","BANKBARODA","MUTHOOTFIN","COLPAL","HAVELLS",
    "AUBANK","ICICIPRULI","SRF","MARICO","GODREJCP","ICICIGI","TATACHEM",
    "PIIND","NAUKRI","IRCTC","CUMMINSIND","OBEROIRLTY","VOLTAS","JUBLFOOD",
    "DALBHARAT","ESCORTS","ZYDUSLIFE","LALPATHLAB","COROMANDEL","PFC",
    "RECLTD","CONCOR","IDFCFIRSTB"
];

// ── Auth ───────────────────────────────────────────────────────────────────────
async function getToken() {
    const uid    = process.env.SHOONYA_UID.trim();
    const pwd    = process.env.SHOONYA_PWD.trim();
    const factor2= process.env.SHOONYA_FACTOR2.trim();
    const vc     = process.env.SHOONYA_VC.trim();
    const appkey = process.env.SHOONYA_APPKEY.trim();
    const hash   = crypto.createHash('sha256').update(`${uid}|${appkey}`).digest('hex');
    const otp    = (await TOTP.generate(factor2)).otp;
    const jData  = { apkversion:'1.0.0', uid, pwd, factor2: otp, vc, appkey: hash, imei:'mock_test', source:'API' };
    const r = await axios.post(`${AUTH_URL}/QuickAuth`, `jData=${JSON.stringify(jData)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000
    });
    if (r.data.stat !== 'Ok') throw new Error('Auth failed: ' + r.data.emsg);
    return { token: r.data.susertoken, uid };
}

// ── SearchScrip helper ─────────────────────────────────────────────────────────
async function resolveToken(uid, sessionTok, symbol) {
    try {
        const jData = { uid, stext: symbol, exch: 'NSE' };
        const r = await axios.post(`${DATA_URL}/SearchScrip`, `jData=${JSON.stringify(jData)}&jKey=${sessionTok}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000
        });
        if (r.data.stat === 'Ok' && r.data.values?.length > 0) {
            const match = r.data.values.find(v => v.tsym === symbol+'-EQ' || v.tsym === symbol);
            return match ? match.token : r.data.values[0].token;
        }
    } catch { }
    return null;
}

// ── TPSeries helper — fetch today's 1-min candles ─────────────────────────────
async function getTodayCandles(uid, sessionTok, nseTok, interval='1') {
    try {
        // Today 9:00 AM IST = 3:30 UTC, 9:20 AM IST = 3:50 UTC
        const now = Math.floor(Date.now() / 1000);
        const todayStart = now - (now % 86400); // midnight UTC
        const st = (todayStart + 3 * 3600).toString(); // 3 AM UTC = 8:30 AM IST (pre-market)
        const et = now.toString();
        const jData = { uid, exch:'NSE', token: nseTok, st, et, intrv: interval };
        const r = await axios.post(`${DATA_URL}/TPSeries`, `jData=${JSON.stringify(jData)}&jKey=${sessionTok}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000
        });
        if (Array.isArray(r.data) && r.data.length > 0) return r.data.reverse(); // oldest first
        return [];
    } catch { return []; }
}

// ── GetQuote for current LTP ───────────────────────────────────────────────────
async function getLTP(uid, sessionTok, nseTok) {
    try {
        const jData = { uid, exch:'NSE', token: nseTok };
        const r = await axios.post(`${DATA_URL}/GetQuotes`, `jData=${JSON.stringify(jData)}&jKey=${sessionTok}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000
        });
        if (r.data.stat === 'Ok') return { ltp: parseFloat(r.data.lp), prevClose: parseFloat(r.data.c) };
    } catch { }
    return null;
}

// ── Gann Square-9 ─────────────────────────────────────────────────────────────
function calcGannLevels(prevClose) {
    const A = prevClose, B = Math.sqrt(A);
    return { R1: A+B, R2: A+2*B, R3: A+3*B, S1: A-B, S2: A-2*B, S3: A-3*B, B };
}

// ── Gann Angle ────────────────────────────────────────────────────────────────
function calcGannAngles(prevClose) {
    const root = Math.sqrt(prevClose), step = 0.25;
    const calc = f => parseFloat(Math.pow(root + f, 2).toFixed(2));
    return {
        angle1x2_Up: calc(step*2), angle1x1_Up: calc(step*1), angle2x1_Up: calc(step*0.5),
        angle2x1_Dn: calc(-step*0.5), angle1x1_Dn: calc(-step*1), angle1x2_Dn: calc(-step*2)
    };
}

// ── ATM Strike helper ─────────────────────────────────────────────────────────
function getAtmStrike(price, type) {
    const steps = {
        TITAN:20,LT:20,RELIANCE:20,INFY:20,TCS:50,MARUTI:100,BAJFINANCE:100,DRREDDY:50,
        INDIGO:50,HAL:50,ABB:100,SIEMENS:50,TRENT:50,'BAJAJ-AUTO':50,EICHERMOT:50,
        APOLLOHOSP:50,HEROMOTOCO:50,DIVISLAB:50,ASIANPAINT:20,JSWSTEEL:10,TATAMOTORS:10,
        SUNPHARMA:10,CIPLA:10,BHARTIARTL:10,BAJAJFINSV:50,KOTAKBANK:20,HCLTECH:20,
        HDFCBANK:10,ICICIBANK:10,SBIN:5,TATASTEEL:2.5,ITC:2.5,DIXON:100,WIPRO:5,
        ONGC:5,NTPC:5,COALINDIA:5,POWERGRID:5,ESCORTS:50,CUMMINSIND:50,PERSISTENT:100
    };
    let step = steps[Object.keys(steps).find(k => k === 'BAJAJ-AUTO' ? true : true) && steps] || null;
    // Simplified step lookup
    for (const [k, v] of Object.entries(steps)) { if (k === 'BAJAJ-AUTO' || k === 'M&M') continue; }
    step = steps[Object.keys(steps).find(k => price > 0)] || null;
    if (!step) {
        if (price > 10000) step = 100;
        else if (price > 5000) step = 50;
        else if (price > 2000) step = 20;
        else if (price > 500) step = 10;
        else if (price > 200) step = 5;
        else step = 2.5;
    }
    return type === 'CE' ? Math.ceil(price / step) * step : Math.floor(price / step) * step;
}

function getStep(symbol, price) {
    const m = { TITAN:20,LT:20,RELIANCE:20,INFY:20,TCS:50,MARUTI:100,BAJFINANCE:100,DRREDDY:50,
        INDIGO:50,HAL:50,ABB:100,SIEMENS:50,TRENT:50,'BAJAJ-AUTO':50,EICHERMOT:50,
        APOLLOHOSP:50,HEROMOTOCO:50,DIVISLAB:50,ASIANPAINT:20,JSWSTEEL:10,TATAMOTORS:10,
        SUNPHARMA:10,CIPLA:10,BHARTIARTL:10,BAJAJFINSV:50,KOTAKBANK:20,HCLTECH:20,
        HDFCBANK:10,ICICIBANK:10,SBIN:5,TATASTEEL:2.5,ITC:2.5,DIXON:100,WIPRO:5,
        ONGC:5,NTPC:5,COALINDIA:5,POWERGRID:5,ESCORTS:50,CUMMINSIND:50,PERSISTENT:100 };
    return m[symbol] || (price>10000?100:price>5000?50:price>2000?20:price>500?10:price>200?5:2.5);
}
function atmStrike(symbol, price, type) {
    const step = getStep(symbol, price);
    return type==='CE' ? Math.ceil(price/step)*step : Math.floor(price/step)*step;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('='.repeat(70));
    console.log('  MOCK BACKTEST — April 9, 2026  (What would have happened today)');
    console.log('='.repeat(70));

    console.log('\nAuthenticating with Shoonya...');
    const { token: sessionTok, uid } = await getToken();
    console.log('✅ Authenticated\n');

    // ─── Pick 20 key stocks for analysis ──────────────────────────────────────
    const SCAN_LIST = [
        "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","SBIN","LT","BAJFINANCE",
        "TITAN","MARUTI","TATAMOTORS","AXISBANK","KOTAKBANK","SUNPHARMA","NTPC",
        "BAJAJ-AUTO","EICHERMOT","BHARTIARTL","ITC","ADANIENT"
    ];

    console.log(`Resolving NSE tokens for ${SCAN_LIST.length} stocks...`);
    const tokenMap = {};
    for (let i = 0; i < SCAN_LIST.length; i += 5) {
        const batch = SCAN_LIST.slice(i, i+5);
        await Promise.all(batch.map(async sym => {
            const t = await resolveToken(uid, sessionTok, sym);
            if (t) tokenMap[sym] = t;
        }));
        await new Promise(r => setTimeout(r, 300));
    }
    console.log(`✅ Resolved ${Object.keys(tokenMap).length} tokens\n`);

    // ─── Fetch quotes (prev close + current LTP) ──────────────────────────────
    console.log('Fetching live quotes...');
    const quotes = {};
    for (const sym of Object.keys(tokenMap)) {
        const q = await getLTP(uid, sessionTok, tokenMap[sym]);
        if (q) quotes[sym] = q;
        await new Promise(r => setTimeout(r, 150));
    }

    // ─── Fetch 1-min candles for EMA ─────────────────────────────────────────
    console.log('Fetching today\'s 1-min candles for EMA analysis...');
    const candles = {};
    for (const sym of Object.keys(tokenMap)) {
        const c = await getTodayCandles(uid, sessionTok, tokenMap[sym], '1');
        if (c.length > 0) candles[sym] = c;
        await new Promise(r => setTimeout(r, 150));
    }
    console.log(`✅ Candle data for ${Object.keys(candles).length} stocks\n`);

    // ─── STRATEGY 1: GANN SQUARE-9 ────────────────────────────────────────────
    console.log('─'.repeat(70));
    console.log('  STRATEGY 1: GANN SQUARE-9  (scans at 9:25 AM)');
    console.log('─'.repeat(70));
    console.log(`${'SYMBOL'.padEnd(14)} ${'PREV CLOSE'.padStart(10)} ${'9:20 LTP'.padStart(10)} ${'%CHG'.padStart(6)} ${'LEVEL'.padStart(6)} ${'SIGNAL'.padStart(8)} ${'ATM STRIKE'.padStart(11)}`);
    console.log('-'.repeat(70));

    let gann9Trades = [];
    for (const sym of SCAN_LIST) {
        const q = quotes[sym];
        if (!q || !q.prevClose || q.prevClose <= 0) continue;
        const ltp = q.ltp, prev = q.prevClose;
        const pct = ((ltp - prev) / prev * 100).toFixed(2);
        const lvls = calcGannLevels(prev);

        let signal = 'HOLD', level = '-', type = null;
        if (ltp > lvls.R3)      { signal = 'CE'; level = 'R3>'; type = 'CE'; }
        else if (ltp > lvls.R2) { signal = 'CE'; level = 'R2>'; type = 'CE'; }
        else if (ltp > lvls.R1) { signal = 'CE'; level = 'R1>'; type = 'CE'; }
        else if (ltp < lvls.S3) { signal = 'PE'; level = '<S3'; type = 'PE'; }
        else if (ltp < lvls.S2) { signal = 'PE'; level = '<S2'; type = 'PE'; }
        else if (ltp < lvls.S1) { signal = 'PE'; level = '<S1'; type = 'PE'; }

        const strikeStr = type ? atmStrike(sym, ltp, type).toFixed(0) + ' ' + type : '-';
        const marker = type ? (type === 'CE' ? '🟢' : '🔴') : '  ';
        console.log(`${marker} ${sym.padEnd(12)} ${prev.toFixed(1).padStart(10)} ${ltp.toFixed(1).padStart(10)} ${(pct+'%').padStart(6)} ${level.padStart(6)} ${signal.padStart(8)} ${strikeStr.padStart(11)}`);

        if (type) gann9Trades.push({ sym, type, ltp, prev, level, strike: atmStrike(sym, ltp, type), sl: type==='CE'?lvls.R1:lvls.S1 });
    }

    if (gann9Trades.length === 0) console.log('  No Gann-9 breakout signals today.');
    else {
        console.log(`\n  → ${gann9Trades.length} Gann-9 signal(s). Bot would enter CE/PE on these.\n`);
    }

    // ─── STRATEGY 2: GANN ANGLE ───────────────────────────────────────────────
    console.log('\n' + '─'.repeat(70));
    console.log('  STRATEGY 2: GANN ANGLE  (scans every 5 min, 9:20–11:30 AM)');
    console.log('─'.repeat(70));
    console.log(`${'SYMBOL'.padEnd(14)} ${'PREV CLOSE'.padStart(10)} ${'LTP'.padStart(10)} ${'1x1_UP'.padStart(9)} ${'1x1_DN'.padStart(9)} ${'TREND'.padStart(8)} ${'SIGNAL'.padStart(8)}`);
    console.log('-'.repeat(70));

    let angleTrades = [];
    for (const sym of SCAN_LIST) {
        const q = quotes[sym];
        if (!q || !q.prevClose || q.prevClose <= 0) continue;
        const ltp = q.ltp, prev = q.prevClose;
        const ang = calcGannAngles(prev);

        let trend = 'NEUTRAL', signal = 'HOLD', type = null;
        if (ltp > ang.angle1x1_Up) { trend = 'BULLISH'; signal = 'CE'; type = 'CE'; }
        else if (ltp < ang.angle1x1_Dn) { trend = 'BEARISH'; signal = 'PE'; type = 'PE'; }

        const marker = type ? (type === 'CE' ? '🟢' : '🔴') : '  ';
        console.log(`${marker} ${sym.padEnd(12)} ${prev.toFixed(1).padStart(10)} ${ltp.toFixed(1).padStart(10)} ${ang.angle1x1_Up.toFixed(1).padStart(9)} ${ang.angle1x1_Dn.toFixed(1).padStart(9)} ${trend.padStart(8)} ${signal.padStart(8)}`);

        if (type) angleTrades.push({ sym, type, ltp, prev, target: type==='CE'?ang.angle1x2_Up:ang.angle1x2_Dn, sl: type==='CE'?ang.angle2x1_Up:ang.angle2x1_Dn });
    }

    if (angleTrades.length === 0) console.log('  No Gann Angle breakout signals today.');

    // ─── STRATEGY 3: 5 EMA ───────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(70));
    console.log('  STRATEGY 3: 5 EMA  (15-min candles, scans every minute 9:15 AM+)');
    console.log('─'.repeat(70));
    console.log(`${'SYMBOL'.padEnd(14)} ${'LTP'.padStart(8)} ${'EMA5'.padStart(8)} ${'RSI'.padStart(6)} ${'VOL SPIKE'.padStart(10)} ${'SIGNAL'.padStart(8)}`);
    console.log('-'.repeat(70));

    // Use 1-min candles grouped as 15-min for EMA analysis
    let emaTrades = [];
    for (const sym of Object.keys(candles)) {
        const raw = candles[sym];
        if (raw.length < 20) continue;

        const closes = raw.map(c => parseFloat(c.intc));
        const volumes = raw.map(c => parseFloat(c.v));

        // RSI
        const rsiResult = new RSI({ values: closes, period: 14 }).getResult();
        const currentRsi = rsiResult.length > 0 ? rsiResult[rsiResult.length-1] : 50;

        // EMA5
        const emaResult = new EMA({ values: closes, period: 5 }).getResult();
        if (emaResult.length < 2) continue;
        const currentEma = emaResult[emaResult.length-1];
        const prevEma = emaResult[emaResult.length-2];

        // Volume spike
        const currentVol = volumes[volumes.length-1];
        const avgVol = volumes.slice(-6,-1).reduce((a,b)=>a+b,0) / 5;
        const hasVolSpike = currentVol > avgVol * 1.5;

        const currentClose = closes[closes.length-1];
        const prevClose2 = closes[closes.length-2];

        let type = null, status = 'Consolidating';
        if (currentClose > currentEma && prevClose2 <= prevEma && currentRsi > 55 && hasVolSpike) {
            type = 'CE'; status = '5-EMA Bullish Breakout';
        } else if (currentClose < currentEma && prevClose2 >= prevEma && currentRsi < 45 && hasVolSpike) {
            type = 'PE'; status = '5-EMA Bearish Breakdown';
        }

        const marker = type ? (type === 'CE' ? '🟢' : '🔴') : '  ';
        const volStr = hasVolSpike ? 'YES (' + (currentVol/avgVol).toFixed(1) + 'x)' : 'no';
        console.log(`${marker} ${sym.padEnd(12)} ${currentClose.toFixed(1).padStart(8)} ${currentEma.toFixed(1).padStart(8)} ${currentRsi.toFixed(0).padStart(6)} ${volStr.padStart(10)} ${(type||'HOLD').padStart(8)}`);

        if (type) emaTrades.push({ sym, type, ltp: currentClose, ema: currentEma, rsi: currentRsi });
    }

    if (emaTrades.length === 0) console.log('  No 5-EMA signals triggered today.');

    // ─── SUMMARY ─────────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log('  MOCK EXECUTION SUMMARY — What the bot would have traded today');
    console.log('='.repeat(70));

    const allTrades = [
        ...gann9Trades.map(t => ({ ...t, strategy: 'Gann-9' })),
        ...angleTrades.map(t => ({ ...t, strategy: 'Gann Angle' })),
        ...emaTrades.map(t => ({ ...t, strategy: '5 EMA' }))
    ];

    if (allTrades.length === 0) {
        console.log('\n  No trade signals triggered today across all 3 strategies.');
        console.log('  (Market may have been range-bound or signals require sustained breakout)');
    } else {
        console.log(`\n  Total signals: ${allTrades.length} across ${[...new Set(allTrades.map(t=>t.strategy))].join(', ')}\n`);
        console.log(`${'STRATEGY'.padEnd(13)} ${'SYMBOL'.padEnd(12)} ${'TYPE'.padStart(5)} ${'ENTRY LTP'.padStart(10)} ${'ATM STRIKE'.padStart(11)} ${'EST PREMIUM'.padStart(12)}`);
        console.log('-'.repeat(65));
        for (const t of allTrades) {
            const strike = atmStrike(t.sym, t.ltp, t.type);
            const estPremium = t.type === 'CE' ? Math.max(5, (t.ltp - strike) + 20).toFixed(0) : Math.max(5, (strike - t.ltp) + 20).toFixed(0);
            console.log(`  ${t.strategy.padEnd(11)} ${t.sym.padEnd(12)} ${t.type.padStart(5)} ${t.ltp.toFixed(1).padStart(10)} ${(strike+' '+t.type).padStart(11)} ~₹${estPremium.padStart(8)}`);
        }
    }

    console.log('\n  NOTE: "Sustain" rule (5-min for Gann, 1-min for EMA above level)');
    console.log('  is not enforced in this mock — all breakout signals shown directly.');
    console.log('  In live mode, the heartbeat service would filter these further.\n');
}

main().catch(console.error);
