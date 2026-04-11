/**
 * Mock EMA-5 Strategy Backtest — April 10, 2026
 * Fetches real 5-min candles from Shoonya for volatile Nifty-100 stocks
 * and simulates Alert + Activation candle logic as of ~9:35 AM IST.
 */
const axios = require('axios');
const crypto = require('crypto');
const { TOTP } = require('totp-generator');
require('dotenv').config();

// ── Volatile Nifty-100 universe (same as nse.service.ts) ─────────────────────
const VOLATILE_NIFTY100 = [
    'AXISBANK','SBIN','ICICIBANK','HDFCBANK','KOTAKBANK','INDUSINDBK',
    'BAJFINANCE','BAJAJFINSV','IDFCFIRSTB','BANDHANBNK',
    'TATAMOTORS','BAJAJ-AUTO','EICHERMOT','M&M','MARUTI','TVSMOTOR','HEROMOTOCO',
    'TCS','INFY','HCLTECH','TECHM','WIPRO','PERSISTENT',
    'TATASTEEL','JSWSTEEL','HINDALCO','VEDL','COALINDIA','ONGC',
    'LT','HAL','BEL','ADANIENT','ADANIPORTS','SIEMENS','ABB',
    'RELIANCE','BHARTIARTL','NTPC','TITAN','TRENT','DIXON','INDIGO',
    'DRREDDY','SUNPHARMA','CIPLA','APOLLOHOSP',
    'GRASIM','CHOLAFIN','GODREJCP','MUTHOOTFIN','PIIND','NAUKRI'
];

const ENTRY_BUFFER = 1.5;

// ── Simple EMA calculator ─────────────────────────────────────────────────────
function calcEma(values, period) {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    const result = [];
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(ema);
    for (let i = period; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
        result.push(ema);
    }
    return result;
}

// ── EMA-5 Alert + Activation analysis ────────────────────────────────────────
function analyzeEma5(symbol, candles) {
    // candles: [{open,high,low,close}] oldest→newest
    if (candles.length < 10) return null;

    const closes = candles.map(c => c.close);
    const emaResult = calcEma(closes, 5);
    if (emaResult.length < 2) return null;

    const offset = closes.length - emaResult.length;
    const alertIdx    = candles.length - 2;
    const activateIdx = candles.length - 1;
    if (alertIdx < offset) return null;

    const emaAtAlert = emaResult[alertIdx - offset];
    const alert = candles[alertIdx];
    const act   = candles[activateIdx];

    // PE setup: alert candle fully above EMA, activation breaks alert Low
    if (alert.low > emaAtAlert && alert.high > emaAtAlert && act.low < alert.low) {
        const entry  = parseFloat((alert.low  - ENTRY_BUFFER).toFixed(2));
        const sl     = parseFloat((alert.high + ENTRY_BUFFER).toFixed(2));
        const risk   = parseFloat((sl - entry).toFixed(2));
        const target = parseFloat((entry - 3 * risk).toFixed(2));
        return { symbol, type: 'PE', entry, sl, target, risk,
                 emaAtAlert: +emaAtAlert.toFixed(2), alertCandle: alert, activationCandle: act };
    }

    // CE setup: alert candle fully below EMA, activation breaks alert High
    if (alert.high < emaAtAlert && alert.low < emaAtAlert && act.high > alert.high) {
        const entry  = parseFloat((alert.high + ENTRY_BUFFER).toFixed(2));
        const sl     = parseFloat((alert.low  - ENTRY_BUFFER).toFixed(2));
        const risk   = parseFloat((entry - sl).toFixed(2));
        const target = parseFloat((entry + 3 * risk).toFixed(2));
        return { symbol, type: 'CE', entry, sl, target, risk,
                 emaAtAlert: +emaAtAlert.toFixed(2), alertCandle: alert, activationCandle: act };
    }

    return null;
}

// ── Shoonya helpers ──────────────────────────────────────────────────────────
async function authenticate(uid, pwd, factor2, vc, appkey, authEndpoint) {
    const appkeyHash = crypto.createHash('sha256').update(`${uid}|${appkey}`).digest('hex');
    const pwdHash    = crypto.createHash('sha256').update(pwd).digest('hex');
    const otp        = await TOTP.generate(factor2);

    const jData = { apkversion:'1.0.0', uid, pwd: pwdHash, factor2: otp.otp,
                    vc, appkey: appkeyHash, imei:'mock-test', source:'API' };
    const payload = `jData=${JSON.stringify(jData)}`;
    const res = await axios.post(`${authEndpoint}/QuickAuth`, payload,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (res.data.stat !== 'Ok') throw new Error(`Auth failed: ${res.data.emsg}`);
    return res.data.susertoken;
}

async function searchScrip(uid, token, symbol, endpoint) {
    const jData   = { uid, stext: symbol, exch: 'NSE' };
    const payload = `jData=${JSON.stringify(jData)}&jKey=${token}`;
    const res = await axios.post(`${endpoint}/SearchScrip`, payload,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 });
    if (res.data.stat !== 'Ok' || !res.data.values?.length) return null;
    // prefer EQ token
    const eq = res.data.values.find(v => v.exch === 'NSE' && (v.instname === 'EQ' || v.tsym === `${symbol}-EQ`))
            || res.data.values.find(v => v.exch === 'NSE');
    return eq ? eq.token : null;
}

async function getCandles(uid, sessionToken, exchange, scripToken, interval, endpoint) {
    // Fetch ~40 candles (200 minutes of 5-min data covers full morning)
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - 200 * 60;
    const jData = { uid, exch: exchange, token: scripToken,
                    st: String(startTime), et: String(endTime), intrv: interval };
    const payload = `jData=${JSON.stringify(jData)}&jKey=${sessionToken}`;
    const res = await axios.post(`${endpoint}/TPSeries`, payload,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
    if (!res.data || res.data.stat === 'Not_Ok' || !Array.isArray(res.data)) return [];
    return res.data.reverse().map(c => ({
        time:  c.time,
        open:  parseFloat(c.into),
        high:  parseFloat(c.inth),
        low:   parseFloat(c.intl),
        close: parseFloat(c.intc),
        vol:   parseInt(c.v) || 0
    }));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const uid       = (process.env.SHOONYA_UID    || '').trim();
    const pwd       = (process.env.SHOONYA_PWD    || '').trim();
    const factor2   = (process.env.SHOONYA_FACTOR2 || '').trim();
    const vc        = (process.env.SHOONYA_VC      || '').trim();
    const appkey    = (process.env.SHOONYA_APPKEY  || '').trim();
    const endpoint  = process.env.SHOONYA_BASE_URL || 'https://trade.shoonya.com/NorenWClient';
    const authEp    = process.env.SHOONYA_AUTH_URL || 'https://trade.shoonya.com/NorenWClientAPI';

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(' 5 EMA Mock Backtest — April 10, 2026  (Volatile Nifty-100)');
    console.log('════════════════════════════════════════════════════════════\n');

    console.log('🔐 Authenticating with Shoonya...');
    const sessionToken = await authenticate(uid, pwd, factor2, vc, appkey, authEp);
    console.log('✅ Auth OK\n');

    const signals   = [];
    const skipped   = [];
    const noSetup   = [];
    let   processed = 0;

    for (const sym of VOLATILE_NIFTY100) {
        process.stdout.write(`  Scanning ${sym.padEnd(14)}...`);
        try {
            // 1. Resolve NSE token
            const scripToken = await searchScrip(uid, sessionToken, sym, endpoint);
            if (!scripToken) { process.stdout.write(' ⚠️  token not found\n'); skipped.push(sym); continue; }

            // 2. Fetch 5-min candles
            const candles = await getCandles(uid, sessionToken, 'NSE', scripToken, '5', endpoint);
            if (candles.length < 10) { process.stdout.write(` ⚠️  only ${candles.length} candles\n`); skipped.push(sym); continue; }

            // 3. Run strategy
            const signal = analyzeEma5(sym, candles);
            processed++;

            if (signal) {
                signals.push({ ...signal, candleCount: candles.length });
                process.stdout.write(` 🚨 ${signal.type} SIGNAL!\n`);
            } else {
                noSetup.push(sym);
                process.stdout.write(` ─  no setup\n`);
            }

            await sleep(150); // Rate-limit
        } catch (err) {
            process.stdout.write(` ❌ ${err.message}\n`);
            skipped.push(sym);
        }
    }

    // ── Results ───────────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════════');
    console.log(` RESULTS: ${processed} scanned | ${signals.length} signals | ${skipped.length} skipped`);
    console.log('════════════════════════════════════════════════════════════\n');

    if (signals.length === 0) {
        console.log('No Alert+Activation setups found at current candle close.\n');
        return;
    }

    for (const s of signals) {
        const typeIcon = s.type === 'CE' ? '🟢 CE (BULLISH REVERSAL)' : '🔴 PE (BEARISH REVERSAL)';
        console.log(`┌─ ${s.symbol} — ${typeIcon}`);
        console.log(`│  5 EMA at Alert    : ₹${s.emaAtAlert}`);
        console.log(`│  Alert Candle      : O=${s.alertCandle.open}  H=${s.alertCandle.high}  L=${s.alertCandle.low}  C=${s.alertCandle.close}`);
        console.log(`│  Activation Candle : O=${s.activationCandle.open}  H=${s.activationCandle.high}  L=${s.activationCandle.low}  C=${s.activationCandle.close}`);
        console.log(`│  ─────────────────────────────────────────────────`);
        console.log(`│  Entry (+ buffer)  : ₹${s.entry}`);
        console.log(`│  Stop Loss         : ₹${s.sl}`);
        console.log(`│  Target (3R)       : ₹${s.target}`);
        console.log(`│  Risk per share    : ₹${s.risk}`);
        console.log(`│  1:2 Breakeven SL  : ₹${s.type==='CE' ? (s.sl + s.risk).toFixed(2) : (s.sl - s.risk).toFixed(2)}`);
        console.log(`│  Candles fetched   : ${s.candleCount}`);
        console.log(`└──────────────────────────────────────────────────────\n`);
    }

    console.log(`⏰ Time windows active today:`);
    console.log(`   Morning   → 09:30 – 11:00 AM`);
    console.log(`   Afternoon → 01:30 – 03:00 PM`);
    console.log(`\n📋 Skipped (token/data issues): ${skipped.join(', ') || 'none'}`);
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
