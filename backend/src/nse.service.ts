import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ADX, RSI, ATR } from 'technicalindicators';
import { ShoonyaService } from './shoonya.service';

export interface NSEStock {
    symbol: string;
    ltp: number;
    pChange: number;
    prevClose?: number;   // Actual previous close from Shoonya (item.c)
    openPrice?: number;   // Actual day open from Shoonya (item.o)
    dayHigh?: number;     // Today's high from Shoonya (item.h)
    dayLow?: number;      // Today's low from Shoonya (item.l)
    adx?: number;
    rsi?: number;
    rdx?: number;
    atr14?: number;
    atr20Avg?: number;
    atrPct?: number;
}

export interface NSE15mData {
    symbol: string;
    closes: number[];
    highs: number[];
    lows: number[];
    opens?: number[];
    volumes: number[];
}

const NIFTY_200_BASKET = [
    "ABB", "ACC", "ADANIENT", "ADANIPORTS", "AMBUJACEM", "APOLLOHOSP",
    "ASIANPAINT", "AUBANK", "AXISBANK", "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV",
    "BANDHANBNK", "BANKBARODA", "BEL", "BHARATFORG", "BHARTIARTL", "BHEL",
    "BPCL", "BRITANNIA", "CANBK", "CHOLAFIN", "CIPLA", "COALINDIA", "COFORGE",
    "COLPAL", "CONCOR", "COROMANDEL", "CROMPTON", "CUMMINSIND", "DABUR",
    "DALBHARAT", "DEEPAKNTR", "DIVISLAB", "DIXON", "DLF", "DRREDDY", "EICHERMOT",
    "ESCORTS", "FEDERALBNK", "GAIL", "GLENMARK", "GMRAIRPORT", "GODREJCP",
    "GODREJPROP", "GRASIM", "GUJGASLTD", "HAL", "HAVELLS", "HCLTECH", "HDFCAMC",
    "HDFCBANK", "HDFCLIFE", "HEROMOTOCO", "HINDALCO", "HINDPETRO", "HINDUNILVR",
    "ICICIBANK", "ICICIGI", "ICICIPRULI", "IDEA", "IDFCFIRSTB", "IEX", "IGL",
    "INDHOTEL", "INDIACEM", "INDIAMART", "INDIGO", "INDUSINDBK", "INDUSTOWER",
    "INFY", "IOC", "IPCALAB", "IRCTC", "ITC", "JINDALSTEL", "JSWSTEEL",
    "JUBLFOOD", "KOTAKBANK", "L&TFH", "LALPATHLAB", "LAURUSLABS", "LICHSGFIN",
    "LT", "LTIM", "LUPIN", "M&M", "M&MFIN", "MANAPPURAM", "MARICO", "MARUTI",
    "MFSL", "MGL", "MOTHERSON", "MPHASIS", "MRF", "MUTHOOTFIN", "NATIONALUM",
    "NAUKRI", "NAVINFLUOR", "NESTLEIND", "NMDC", "NTPC", "OBEROIRLTY", "OFSS",
    "ONGC", "PAGEIND", "PEL", "PERSISTENT", "PETRONET", "PFC", "PIDILITIND",
    "PIIND", "PNB", "POLYCAB", "POWERGRID", "PVRINOX", "RECLTD", "RELIANCE",
    "SAIL", "SBICARD", "SBILIFE", "SBIN", "SHREECEM", "SIEMENS", "SRF",
    "SUNPHARMA", "SUNTV", "SYNGENE", "TATACHEM", "TATACOMM", "TATACONSUM",
    "TMPV", "TMCV", "TATAPOWER", "TATASTEEL", "TCS", "TECHM", "TITAN", "TORNTPHARM",
    "TRENT", "TVSMOTOR", "UBL", "ULTRACEMCO", "UPL", "VEDL", "VOLTAS", "WIPRO",
    "ZEEL", "ZYDUSLIFE"
];

const NIFTY_100_BASKET = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "INFY", "ITC", "SBIN", "LT", "BAJFINANCE", 
    "KOTAKBANK", "AXISBANK", "HAL", "M&M", "HCLTECH", "TMPV", "TMCV", "SUNPHARMA", "NTPC",
    "MARUTI", "ONGC", "TATASTEEL", "POWERGRID", "ASIANPAINT", "BAJAJFINSV", "TITAN", "COALINDIA", "BAJAJ-AUTO",
    "ADANIPORTS", "ADANIENT", "DIXON", "WIPRO", "HINDUNILVR", "DRREDDY", "IOC", "GRASIM", "TECHM", "JSWSTEEL",
    "APOLLOHOSP", "INDUSINDBK", "EICHERMOT", "HDFCLIFE", "BPCL", "BRITANNIA", "CIPLA", "VEDL", "DIVISLAB",
    "HEROMOTOCO", "SHREECEM", "TRENT", "BEL", "CHOLAFIN", "TVSMOTOR", "GAIL", "INDIGO", "AMBUJACEM",
    "PNB", "TORNTPHARM", "ABB", "TATACOMM", "UPL", "BANKBARODA", "BOSCHLTD", "MUTHOOTFIN", "COLPAL", "HAVELLS",
    "AUBANK", "ICICIPRULI", "SRF", "MARICO", "GODREJCP", "ICICIGI", "ASHOKLEY", "TATACHEM",
    "PIIND", "NAUKRI", "BERGEPAINT", "IRCTC", "CUMMINSIND", "OBEROIRLTY", "VOLTAS", "JUBLFOOD",
    "DALBHARAT", "ABBOTINDIA", "ESCORTS", "ZYDUSLIFE", "LALPATHLAB", "COROMANDEL", "PFC",
    "RECLTD", "CONCOR", "IDFCFIRSTB", "BALKRISIND", "PEL"
];

// High-beta, high-ATR Nifty 100 stocks suitable for 5 EMA mean-reversion
const VOLATILE_NIFTY100 = [
    // Banking & Finance (most volatile intraday)
    "AXISBANK", "SBIN", "ICICIBANK", "HDFCBANK", "KOTAKBANK",
    "INDUSINDBK", "BAJFINANCE", "BAJAJFINSV", "IDFCFIRSTB", "BANDHANBNK",
    // Auto (high ATR)
    "TMPV", "TMCV", "BAJAJ-AUTO", "EICHERMOT", "M&M", "MARUTI", "TVSMOTOR", "HEROMOTOCO",
    // IT (liquid and reactive)
    "TCS", "INFY", "HCLTECH", "TECHM", "WIPRO", "PERSISTENT",
    // Metals & Energy
    "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "COALINDIA", "ONGC",
    // Infra / Capital Goods
    "LT", "HAL", "BEL", "ADANIENT", "ADANIPORTS", "SIEMENS", "ABB",
    // Large-cap anchors (always liquid)
    "RELIANCE", "BHARTIARTL", "NTPC",
    // High-beta consumer / pharma
    "TITAN", "TRENT", "DIXON", "INDIGO", "DRREDDY", "SUNPHARMA", "CIPLA", "APOLLOHOSP",
    // Others with consistent intraday range
    "GRASIM", "CHOLAFIN", "GODREJCP", "MUTHOOTFIN", "PIIND", "NAUKRI"
];

@Injectable()
export class NseService implements OnModuleInit {
    private readonly logger = new Logger(NseService.name);
    private tokenMap = new Map<string, string>(); // Symbol -> Token

    constructor(private readonly shoonya: ShoonyaService) {}

    async onModuleInit() {
        // Register callback so ShoonyaService.dailyTokenRefresh() can trigger us
        // immediately after it gets a fresh session, rather than waiting for the 9:10 AM cron
        this.shoonya.registerSessionRefreshHook(() => this.refreshSecurityTokens());
        await this.refreshSecurityTokens();
    }

    /**
     * Proactive Daily Refresh at 9:10 AM — runs AFTER dailyTokenRefresh (9:00 AM)
     * obtains a fresh OAuth session via autoConnect, so the token resolution
     * always uses a valid session key.
     */
    @Cron('10 09 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async refreshSecurityTokens() {
        this.logger.log('NseService Initialized. Starting Token Resolution for NIFTY Stocks...');

        // Use the existing session token if available (loaded from DB at startup),
        // falling back to fresh auth only when no token is in memory.
        // forceReauth() was wiping a valid persisted token then failing on QuickAuth.
        const authed = await this.shoonya.authenticate();
        if (!authed) {
            this.logger.error('Shoonya authentication failed. Skipping token resolution.');
            return;
        }

        const targetSymbols = Array.from(new Set([...NIFTY_100_BASKET, ...NIFTY_200_BASKET]));

        for (let i = 0; i < targetSymbols.length; i += 10) {
            const batch = targetSymbols.slice(i, i + 10);
            await Promise.all(batch.map(async (sym) => {
                const token = await this.shoonya.searchSecurityToken(sym);
                if (token) {
                    this.tokenMap.set(sym, token);
                }
            }));
            await new Promise(res => setTimeout(res, 300));
        }
        this.logger.log(`Resolved and Cached ${this.tokenMap.size} security tokens for NSE.`);

        // Only subscribe index tokens at startup — equity stocks are subscribed selectively
        // after the 9:25 AM morning scan filters them down to ~30-40 momentum stocks.
        // Subscribing all 200 tokens at once exceeds Shoonya's ~100-token WS limit (Issue #217)
        // causing silent drops and an empty tick cache for most stocks.
        this.tokenMap.set('NIFTY', '26000');
        this.tokenMap.set('BANKNIFTY', '26009');
        this.shoonya.subscribeTokens('NSE', ['26000', '26009']);
        this.logger.log('[WS] Subscribed NIFTY(26000) and BANKNIFTY(26009) index tokens. Equity stocks subscribed after morning scan filter.');
    }

    getToken(symbol: string): string | undefined {
        return this.tokenMap.get(symbol);
    }

    getResolvedSymbols(): string[] {
        return Array.from(this.tokenMap.keys());
    }

    /**
     * Unified fetch for LTP and pChange using Shoonya MultiQuote
     */
    async scanNifty100Quotes(): Promise<NSEStock[]> {
        const tokens = NIFTY_100_BASKET.map(sym => this.tokenMap.get(sym)).filter(Boolean) as string[];
        if (tokens.length === 0) return [];

        this.logger.log(`Fetching Batch Quotes for ${tokens.length} Nifty 100 constituents...`);
        const results = await this.shoonya.getMultiQuotes('NSE', tokens);
        const processed: NSEStock[] = [];

        for (const item of results) {
            if (item.lp && item.tsym) {
                const symbol = item.tsym.endsWith('-EQ') ? item.tsym.slice(0, -3) : item.tsym;
                const ltp = parseFloat(item.lp);
                const prevClose = parseFloat(item.c) || ltp;
                const openPrice = parseFloat(item.o) || ltp;
                const pChange = ((ltp - prevClose) / prevClose) * 100;

                processed.push({
                    symbol,
                    ltp,
                    pChange: parseFloat(pChange.toFixed(2)),
                    prevClose,
                    openPrice,
                    dayHigh: parseFloat(item.h) || ltp,
                    dayLow:  parseFloat(item.l) || ltp,
                });
            }
        }
        return processed;
    }

    /**
     * Nifty 200 Scanning for Gann Signal Generation
     */
    async scanGainersLosers(): Promise<NSEStock[]> {
        this.logger.log('Scanning Shoonya for Gann Strategy Movers...');
        
        // Use MultiQuote for all 200 first, then filter and fetch indicators for the top ones
        const tokens = NIFTY_200_BASKET.map(sym => this.tokenMap.get(sym)).filter(Boolean) as string[];
        const quoteResults = await this.shoonya.getMultiQuotes('NSE', tokens);
        
        const candidateSymbols: string[] = [];
        const basicDataMap = new Map<string, any>();

        for (const item of quoteResults) {
            if (item.lp && item.tsym) {
                const ltp = parseFloat(item.lp);
                const prevClose = parseFloat(item.c) || ltp;
                const openPrice = parseFloat(item.o) || ltp;
                const pChange = ((ltp - prevClose) / prevClose) * 100;

                // Core Filter: 500 < LTP < 30000 (covers all Nifty stocks with liquid options)
                if (ltp >= 500 && ltp <= 30000) {
                    const symbol = item.tsym.endsWith('-EQ') ? item.tsym.slice(0, -3) : item.tsym;
                    candidateSymbols.push(symbol);
                    basicDataMap.set(symbol, { ltp, pChange, prevClose, openPrice });
                }
            }
        }

        // Pre-filter: only stocks that moved >= 0.5% qualify for the Gann-9 universe
        const movers = candidateSymbols.filter(sym => Math.abs(basicDataMap.get(sym).pChange) >= 0.5);
        this.logger.log(`Found ${candidateSymbols.length} candidates in price range, ${movers.length} with pChange >= 0.5%. Fetching indicators...`);

        const finalized: NSEStock[] = [];
        for (const sym of movers) {
            const basic = basicDataMap.get(sym);
            const indicators = await this.fetchIndicatorsFromShoonya(sym);

            if (indicators) {
                // ATR expansion filter: current ATR(14) must exceed its 20-day average
                // confirming the breakout has more energy than usual
                if (indicators.atr14 <= indicators.atr20Avg) {
                    this.logger.debug(`[Gann-9] ${sym} skipped: ATR ${indicators.atr14} not above 20-day avg ${indicators.atr20Avg}`);
                    continue;
                }
                finalized.push({
                    symbol: sym,
                    ltp: basic.ltp,
                    pChange: basic.pChange,
                    prevClose: basic.prevClose,
                    openPrice: basic.openPrice,
                    ...indicators
                });
            } else {
                // TPSeries unavailable — derive rdx proxy from pChange so the RDX guard
                // in continuousDailyScanMonitor doesn't block all trades on rate-limited days.
                // pChange > 1.5% → bullish proxy (CE rdx = 58 > 55 threshold)
                // pChange < -1.5% → bearish proxy (PE rdx = 42 < 45 threshold)
                // Otherwise neutral (rdx = 50 → blocked by guard, stock shows in UI but won't trade)
                const pChange = basic.pChange;
                const proxyRdx = pChange > 1.5 ? 58 : pChange < -1.5 ? 42 : 50;
                this.logger.warn(`[Scan] TPSeries unavailable for ${sym} — proxy rdx=${proxyRdx} from pChange ${pChange.toFixed(2)}%`);
                finalized.push({
                    symbol: sym,
                    ltp: basic.ltp,
                    pChange: basic.pChange,
                    prevClose: basic.prevClose,
                    openPrice: basic.openPrice,
                    adx: 0,
                    rsi: 50,
                    rdx: proxyRdx
                });
            }
            await new Promise(res => setTimeout(res, 150));
        }

        return finalized;
    }

    /**
     * 5 EMA 15-Minute Universe Scan (Shoonya Driven)
     */
    async scanEma15mUniverse(): Promise<NSE15mData[]> {
        this.logger.log('Fetching 15m Shoonya Candles for EMA strategy...');
        const processed: NSE15mData[] = [];

        // Batch processing to respect TPS
        for (const sym of NIFTY_100_BASKET) {
            const token = this.tokenMap.get(sym);
            if (!token) continue;

            const candles = await this.shoonya.getTimePriceSeries('NSE', token, '15', 3);
            if (candles.length > 20) {
                const closes = candles.map(c => parseFloat(c.intc)).reverse();
                const highs = candles.map(c => parseFloat(c.inth)).reverse();
                const lows = candles.map(c => parseFloat(c.intl)).reverse();
                const volumes = candles.map(c => parseFloat(c.v)).reverse();

                processed.push({
                    symbol: sym,
                    closes,
                    highs,
                    lows,
                    volumes
                });
            }
            // Throttle candle fetching
            await new Promise(res => setTimeout(res, 100));
        }

        return processed;
    }

    /**
     * 5 EMA CE Universe Scan — fetches 15-min candles for the given symbol list.
     * Used by the 15-min CE cron to detect buy setups per the original 5 EMA strategy
     * (video: buy setups on 15-min chart, sell setups on 5-min chart).
     */
    async scanEma5_15mUniverse(symbols?: string[]): Promise<NSE15mData[]> {
        const targetSymbols = symbols ?? VOLATILE_NIFTY100;
        this.logger.log(`Fetching 15-min Shoonya Candles for ${targetSymbols.length} EMA universe stocks (CE scan)...`);
        const processed: NSE15mData[] = [];

        for (const sym of targetSymbols) {
            const token = this.tokenMap.get(sym);
            if (!token) continue;

            // 3 days ensures enough 15-min candles for EMA(5) to stabilize
            const candles = await this.shoonya.getTimePriceSeries('NSE', token, '15', 3);
            if (candles.length > 10) {
                const closes  = candles.map(c => parseFloat(c.intc)).reverse();
                const highs   = candles.map(c => parseFloat(c.inth)).reverse();
                const lows    = candles.map(c => parseFloat(c.intl)).reverse();
                const opens   = candles.map(c => parseFloat(c.into)).reverse();
                const volumes = candles.map(c => parseFloat(c.v)).reverse();

                processed.push({ symbol: sym, closes, highs, lows, opens, volumes });
            }
            await new Promise(res => setTimeout(res, 100));
        }

        this.logger.log(`15-min EMA CE scan: fetched candles for ${processed.length}/${targetSymbols.length} stocks.`);
        return processed;
    }

    /**
     * Morning universe builder for 5 EMA.
     * Scans all Nifty 100 stocks, applies price filter (₹500–₹40,000) then daily ADX ≥ 18.
     * Called once at 9:20 AM; result cached as EMA5_UNIVERSE for the rest of the day.
     */
    async buildEma5Universe(): Promise<string[]> {
        this.logger.log('[5 EMA] Building morning universe from Nifty 100 (price + ADX filter)...');

        const tokens = NIFTY_100_BASKET.map(sym => this.tokenMap.get(sym)).filter(Boolean) as string[];
        const quotes = await this.shoonya.getMultiQuotes('NSE', tokens);

        const priceFiltered: string[] = [];
        for (const item of quotes) {
            if (!item.lp || !item.tsym) continue;
            const ltp = parseFloat(item.lp);
            if (ltp >= 500 && ltp <= 40000) {
                const sym = item.tsym.endsWith('-EQ') ? item.tsym.slice(0, -3) : item.tsym;
                priceFiltered.push(sym);
            }
        }

        this.logger.log(`[5 EMA] ${priceFiltered.length}/${NIFTY_100_BASKET.length} pass price filter (₹500–₹40,000). Fetching indicators...`);

        const universe: string[] = [];
        for (const sym of priceFiltered) {
            const indicators = await this.fetchIndicatorsFromShoonya(sym);
            if (indicators) {
                const isRangebound  = indicators.adx < 25;
                const hasRange      = indicators.atrPct > 1.5;
                const isOverstretched = indicators.rsi > 70 || indicators.rsi < 30;
                if (isRangebound && hasRange && isOverstretched) {
                    universe.push(sym);
                    this.logger.debug(`[5 EMA] ${sym} ✅ ADX=${indicators.adx} ATR%=${indicators.atrPct.toFixed(2)} RSI=${indicators.rsi}`);
                }
            }
            await new Promise(res => setTimeout(res, 150));
        }

        this.logger.log(`[5 EMA] Universe ready: ${universe.length} mean-reversion stocks (ADX<25, ATR%>1.5%, RSI extreme) from Nifty 100.`);
        return universe;
    }

    /**
     * 5 EMA Mean-Reversion Universe Scan — fetches 5-min candles for the given symbol list.
     * Uses the ADX-filtered morning universe when provided; falls back to VOLATILE_NIFTY100.
     */
    async scanEma5mUniverse(symbols?: string[]): Promise<NSE15mData[]> {
        const targetSymbols = symbols ?? VOLATILE_NIFTY100;
        this.logger.log(`Fetching 5-min Shoonya Candles for ${targetSymbols.length} EMA universe stocks...`);
        const processed: NSE15mData[] = [];

        for (const sym of targetSymbols) {
            const token = this.tokenMap.get(sym);
            if (!token) continue;

            // 2 days covers today's session fully even at market open
            const candles = await this.shoonya.getTimePriceSeries('NSE', token, '5', 2);
            if (candles.length > 15) {
                const closes  = candles.map(c => parseFloat(c.intc)).reverse();
                const highs   = candles.map(c => parseFloat(c.inth)).reverse();
                const lows    = candles.map(c => parseFloat(c.intl)).reverse();
                const opens   = candles.map(c => parseFloat(c.into)).reverse();
                const volumes = candles.map(c => parseFloat(c.v)).reverse();

                processed.push({ symbol: sym, closes, highs, lows, opens, volumes });
            }
            await new Promise(res => setTimeout(res, 100));
        }

        this.logger.log(`5-min EMA scan: fetched candles for ${processed.length}/${targetSymbols.length} stocks.`);
        return processed;
    }

    private async fetchIndicatorsFromShoonya(symbol: string) {
        const token = this.tokenMap.get(symbol);
        if (!token) return null;

        const candles = await this.shoonya.getTimePriceSeries('NSE', token, 'D', 30);
        if (candles.length < 20) return null;

        const cList = candles.map(c => parseFloat(c.intc)).reverse();
        const hList = candles.map(c => parseFloat(c.inth)).reverse();
        const lList = candles.map(c => parseFloat(c.intl)).reverse();

        const adxInput = { high: hList, low: lList, close: cList, period: 14 };
        const adxResult = new ADX(adxInput).getResult();
        const latestAdx = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;

        const rsiInput = { values: cList, period: 14 };
        const rsiResult = new RSI(rsiInput).getResult();
        const latestRsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : 0;

        const atrResult = new ATR({ high: hList, low: lList, close: cList, period: 14 }).getResult();
        const latestAtr14 = atrResult.length > 0 ? atrResult[atrResult.length - 1] : 0;
        const atr20Values = atrResult.slice(-20);
        const atr20Avg = atr20Values.length > 0 ? atr20Values.reduce((a: number, b: number) => a + b, 0) / atr20Values.length : latestAtr14;
        const latestClose = cList[cList.length - 1];
        const atrPct = latestClose > 0 ? (latestAtr14 / latestClose) * 100 : 0;

        const rdx = latestRsi + (latestAdx - 20) / 5;

        return {
            adx: parseFloat(latestAdx.toFixed(2)),
            rsi: parseFloat(latestRsi.toFixed(2)),
            rdx: parseFloat(rdx.toFixed(2)),
            atr14: parseFloat(latestAtr14.toFixed(2)),
            atr20Avg: parseFloat(atr20Avg.toFixed(2)),
            atrPct: parseFloat(atrPct.toFixed(3)),
        };
    }

    async getLiveLTP(symbol: string): Promise<number | null> {
        const token = this.tokenMap.get(symbol);
        if (!token) {
            // Fallback: search if not in map
            const newToken = await this.shoonya.searchSecurityToken(symbol);
            if (newToken) {
                this.tokenMap.set(symbol, newToken);
                return this.getLiveLTP(symbol);
            }
            return null;
        }

        // Must use NSE exchange for equity tokens — getOptionQuote hardcodes NFO and would return null
        const results = await this.shoonya.getMultiQuotes('NSE', [token]);
        const lp = results[0]?.lp;
        return lp ? parseFloat(lp) : null;
    }

    /**
     * Returns LTP + actual previous close for a single equity stock.
     * Used by the Gann Angle manual analysis endpoint.
     */
    async getStockQuoteWithPrevClose(symbol: string): Promise<{ ltp: number; prevClose: number } | null> {
        const token = this.tokenMap.get(symbol) || await this.shoonya.searchSecurityToken(symbol);
        if (!token) return null;

        const config = await this.shoonya.getConfig();
        if (!config.uid || !this.shoonya['sessionToken']) await this.shoonya.authenticate();

        try {
            const results = await this.shoonya.getMultiQuotes('NSE', [token]);
            const item = results[0];
            if (item?.lp) {
                const ltp = parseFloat(item.lp);
                const prevClose = parseFloat(item.c) || ltp;
                return { ltp, prevClose };
            }
        } catch { }

        // Fallback to LTP-only
        const ltp = await this.getLiveLTP(symbol);
        return ltp ? { ltp, prevClose: ltp } : null;
    }

    /**
     * Batch LTP fetch — reads from the WS tick cache first for zero-latency prices.
     * Only falls back to REST GetQuotes for symbols not yet in the tick cache
     * (e.g. before the morning scan subscribes them, or after a WS reconnect gap).
     */
    async getBatchLTP(symbols: string[]): Promise<Record<string, number>> {
        const priceMap: Record<string, number> = {};
        const restSymbols: string[] = [];

        // Resolve tokens for any symbols missing from tokenMap (happens on container restart).
        // Run all resolutions in parallel — each takes one SearchScrip call, done once per symbol per process lifetime.
        const unknownSyms = symbols.filter(s => !this.tokenMap.get(s));
        if (unknownSyms.length > 0) {
            const resolved = await Promise.all(
                unknownSyms.map(async sym => ({
                    sym,
                    token: await this.shoonya.searchSecurityToken(sym)
                }))
            );
            const newTokens: string[] = [];
            for (const { sym, token } of resolved) {
                if (token) {
                    this.tokenMap.set(sym, token);
                    newTokens.push(token);
                }
            }
            // Subscribe newly resolved tokens to WS tick feed so next cycle reads from cache
            if (newTokens.length > 0) {
                this.shoonya.subscribeTokens('NSE', newTokens);
                this.logger.log(`[TokenMap] Resolved & subscribed ${newTokens.length}/${unknownSyms.length} missing symbols to tick feed.`);
            }
        }

        for (const sym of symbols) {
            const token = this.tokenMap.get(sym);
            if (!token) continue;
            const tick = this.shoonya.getTickPrice(token);
            if (tick !== null) {
                priceMap[sym] = tick;
            } else {
                restSymbols.push(sym);
            }
        }

        // REST fallback for symbols not yet in the tick cache
        if (restSymbols.length > 0) {
            const restTokens = restSymbols.map(s => this.tokenMap.get(s)).filter(Boolean) as string[];
            const results = await this.shoonya.getMultiQuotes('NSE', restTokens);
            for (const item of results) {
                if (item.lp && item.tsym) {
                    priceMap[item.tsym.endsWith('-EQ') ? item.tsym.slice(0, -3) : item.tsym] = parseFloat(item.lp);
                }
            }
            this.logger.debug(`[WS] getBatchLTP: ${symbols.length - restSymbols.length} from tick cache, ${restSymbols.length} via REST.`);
        }

        return priceMap;
    }

    /** Open (or no-op if already open) the Shoonya tick feed WebSocket */
    async connectTickFeed(): Promise<void> {
        await this.shoonya.connectTickFeed();
    }

    /**
     * Subscribe a list of stock symbols to the WS tick feed.
     * Converts symbols → NSE tokens using the resolved tokenMap.
     * Safe to call before the connection handshake completes — keys are buffered.
     */
    subscribeForLiveFeed(symbols: string[]): void {
        const tokens = symbols.map(s => this.tokenMap.get(s)).filter(Boolean) as string[];
        if (tokens.length === 0) return;
        this.shoonya.subscribeTokens('NSE', tokens);
        this.logger.log(`[WS] Subscribed live feed for ${tokens.length}/${symbols.length} resolved symbols.`);
    }

    /** Debug endpoint: raw GetQuotes response for a symbol */
    async debugGetQuote(symbol: string): Promise<any> {
        const token = this.tokenMap.get(symbol);
        const results = token ? await this.shoonya.getMultiQuotes('NSE', [token]) : [];
        return {
            symbol,
            tokenMapSize: this.tokenMap.size,
            token: token || null,
            quoteResult: results[0] || null,
        };
    }
}
