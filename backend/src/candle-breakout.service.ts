import { Injectable, Logger } from '@nestjs/common';
import { ShoonyaService } from './shoonya.service';

export interface OneMinCandle {
    time: number;     // unix seconds (ssboe from Shoonya)
    open: number;
    high: number;
    low: number;
    close: number;
    isGreen: boolean; // close >= open
}

export interface CandleSetup {
    symbol: string;
    candle1: OneMinCandle;
    candle2: OneMinCandle;
    rangeHigh: number;           // max(c1.high, c2.high)
    rangeLow: number;            // min(c1.low, c2.low)
    foundAt: number;             // unix ms when pair was detected
    signal: 'PENDING' | 'CE' | 'PE';
    breakoutPrice?: number;      // live LTP at breakout
    breakoutAt?: number;         // unix ms
    entryTargetPrice?: number;   // underlying target for exit
    entrySlPrice?: number;       // underlying SL for exit (rangeLow for CE, rangeHigh for PE)
}

// Only NIFTY and BANKNIFTY — fixed Shoonya NSE tokens
const INSTRUMENTS = [
    { symbol: 'NIFTY',     token: '26000' },
    { symbol: 'BANKNIFTY', token: '26009' },
];

@Injectable()
export class CandleBreakoutService {
    private readonly logger = new Logger(CandleBreakoutService.name);

    // Per-symbol detected 2-candle setup
    private readonly setups = new Map<string, CandleSetup>();

    // Symbols intentionally skipped today due to gap/volatility filters
    private readonly skippedSymbols = new Map<string, string>(); // symbol → reason

    // Called immediately when a breakout fires on a tick
    private onBreakout: ((setup: CandleSetup) => void) | null = null;

    constructor(private readonly shoonya: ShoonyaService) {}

    /**
     * Register the callback that fires the moment a breakout/breakdown is detected
     * on a live WebSocket tick. Called once by ScannerService at startup.
     */
    setBreakoutHandler(handler: (setup: CandleSetup) => void): void {
        this.onBreakout = handler;
    }

    /**
     * Subscribe NIFTY and BANKNIFTY ticks so breakouts fire the instant LTP crosses
     * rangeHigh + 5 (CE) or rangeLow - 5 (PE). Call once after setBreakoutHandler().
     */
    startTickWatch(): void {
        for (const inst of INSTRUMENTS) {
            this.shoonya.registerTickCallback(inst.token, (ltp) => this.onTick(inst.token, ltp));
        }
    }

    private onTick(token: string, ltp: number): void {
        const inst = INSTRUMENTS.find(i => i.token === token);
        if (!inst) return;
        const setup = this.setups.get(inst.symbol);
        if (!setup || setup.signal !== 'PENDING') return;

        const BUFFER = 5; // fixed 5-point buffer (replaces stale 0.1% ≈ 24 pts)

        if (ltp > setup.rangeHigh + BUFFER) {
            const entryPrice = setup.rangeHigh + BUFFER;
            const slDist = entryPrice - setup.rangeLow;
            setup.signal = 'CE';
            setup.breakoutPrice = entryPrice;
            setup.breakoutAt = Date.now();
            setup.entryTargetPrice = parseFloat((entryPrice + 2 * slDist).toFixed(2));
            setup.entrySlPrice = parseFloat(setup.rangeLow.toFixed(2));
            this.logger.log(
                `📈 2-CANDLE CE: [${inst.symbol}] LTP ₹${ltp} > high ₹${setup.rangeHigh.toFixed(2)} + 5pt ` +
                `→ entry ₹${entryPrice} | Target ₹${setup.entryTargetPrice} (2R) | SL ₹${setup.entrySlPrice}`
            );
            if (this.onBreakout) this.onBreakout(setup);
        } else if (ltp < setup.rangeLow - BUFFER) {
            const entryPrice = setup.rangeLow - BUFFER;
            const slDist = setup.rangeHigh - entryPrice;
            setup.signal = 'PE';
            setup.breakoutPrice = entryPrice;
            setup.breakoutAt = Date.now();
            setup.entryTargetPrice = parseFloat((entryPrice - 2 * slDist).toFixed(2));
            setup.entrySlPrice = parseFloat(setup.rangeHigh.toFixed(2));
            this.logger.log(
                `📉 2-CANDLE PE: [${inst.symbol}] LTP ₹${ltp} < low ₹${setup.rangeLow.toFixed(2)} - 5pt ` +
                `→ entry ₹${entryPrice} | Target ₹${setup.entryTargetPrice} (2R) | SL ₹${setup.entrySlPrice}`
            );
            if (this.onBreakout) this.onBreakout(setup);
        }
    }

    /**
     * Scan NIFTY and BANKNIFTY for their 2-candle morning setup.
     * Called every minute by the scanner (9:18–11:30 AM IST).
     * Skips symbols that already have a setup found.
     */
    async scanForSetups(): Promise<void> {
        const pending = INSTRUMENTS.filter(i => !this.setups.has(i.symbol) && !this.skippedSymbols.has(i.symbol));
        if (pending.length === 0) return;

        const openTs = this.getMarketOpenTs();
        this.logger.debug(`[2-Candle] Scanning ${pending.map(i => i.symbol).join(', ')} for setup...`);

        await Promise.all(pending.map(i => this.detectSetup(i.symbol, i.token, openTs)));

        const found = INSTRUMENTS.filter(i => this.setups.has(i.symbol)).length;
        this.logger.debug(`[2-Candle] ${found}/${INSTRUMENTS.length} setups found.`);
    }

    /**
     * Fetch current LTP for all PENDING setups using the NSE exchange (not NFO).
     * NIFTY/BANKNIFTY are index tokens on NSE — getOptionQuote() would use NFO which fails.
     * Reads from the WS tick cache first; falls back to REST GetQuotes with exch=NSE.
     */
    async fetchLtpMap(): Promise<Record<string, number>> {
        const ltpMap: Record<string, number> = {};
        for (const inst of INSTRUMENTS) {
            if (!this.setups.has(inst.symbol)) continue;
            const setup = this.setups.get(inst.symbol)!;
            if (setup.signal !== 'PENDING') continue;

            // WS tick cache (subscribed at startup via nse.service refreshSecurityTokens)
            const tick = this.shoonya.getTickPrice(inst.token);
            if (tick !== null) {
                ltpMap[inst.symbol] = tick;
                continue;
            }

            // REST fallback: correct exchange is NSE, not NFO
            const results = await this.shoonya.getMultiQuotes('NSE', [inst.token]);
            if (results.length > 0 && results[0].lp) {
                ltpMap[inst.symbol] = parseFloat(results[0].lp);
            }
        }
        return ltpMap;
    }

    /**
     * Check all PENDING setups for a breakout/breakdown using the latest LTP map.
     * Returns setups that just triggered (signal changed from PENDING → CE/PE).
     */
    checkBreakouts(ltpMap: Record<string, number>): CandleSetup[] {
        const triggered: CandleSetup[] = [];

        for (const [symbol, setup] of this.setups) {
            if (setup.signal !== 'PENDING') continue;
            const ltp = ltpMap[symbol];
            if (!ltp) continue;

            const buffer = setup.rangeHigh * 0.001; // 0.1% buffer to avoid noise

            if (ltp > setup.rangeHigh + buffer) {
                const slDist = ltp - setup.rangeLow;           // distance from entry to SL
                setup.signal = 'CE';
                setup.breakoutPrice = ltp;
                setup.breakoutAt = Date.now();
                setup.entryTargetPrice = parseFloat((ltp + 2 * slDist).toFixed(2)); // 2:1 R:R target
                setup.entrySlPrice = parseFloat(setup.rangeLow.toFixed(2));          // SL = range low
                triggered.push(setup);
                this.logger.log(
                    `📈 2-CANDLE CE: [${symbol}] ₹${ltp} > range high ₹${setup.rangeHigh.toFixed(2)} ` +
                    `→ SL dist ${slDist.toFixed(1)}pts → Target ₹${setup.entryTargetPrice} (2R) | SL ₹${setup.entrySlPrice}`
                );
            } else if (ltp < setup.rangeLow - buffer) {
                const slDist = setup.rangeHigh - ltp;          // distance from entry to SL
                setup.signal = 'PE';
                setup.breakoutPrice = ltp;
                setup.breakoutAt = Date.now();
                setup.entryTargetPrice = parseFloat((ltp - 2 * slDist).toFixed(2)); // 2:1 R:R target
                setup.entrySlPrice = parseFloat(setup.rangeHigh.toFixed(2));         // SL = range high
                triggered.push(setup);
                this.logger.log(
                    `📉 2-CANDLE PE: [${symbol}] ₹${ltp} < range low ₹${setup.rangeLow.toFixed(2)} ` +
                    `→ SL dist ${slDist.toFixed(1)}pts → Target ₹${setup.entryTargetPrice} (2R) | SL ₹${setup.entrySlPrice}`
                );
            }
        }

        return triggered;
    }

    getSetups(): CandleSetup[] {
        return Array.from(this.setups.values());
    }

    clearAll(): void {
        this.setups.clear();
        this.skippedSymbols.clear();
        this.logger.log('[2-Candle] All setups and skip filters cleared for new day.');
    }

    getSkippedSymbols(): Map<string, string> {
        return this.skippedSymbols;
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private async detectSetup(symbol: string, token: string, openTs: number): Promise<void> {
        try {
            // Fetch today's 1-minute candles
            const series = await this.shoonya.getTimePriceSeries('NSE', token, '1', 1);
            if (!Array.isArray(series) || series.length < 3) return;

            // Parse + filter to today only (ssboe >= 9:15 AM IST today)
            const todayCandles: OneMinCandle[] = series
                .filter(c => c.ssboe && parseInt(c.ssboe) >= openTs)
                .map(c => ({
                    time: parseInt(c.ssboe),
                    open: parseFloat(c.into),
                    high: parseFloat(c.inth),
                    low: parseFloat(c.intl),
                    close: parseFloat(c.intc),
                    isGreen: parseFloat(c.intc) >= parseFloat(c.into),
                }))
                .sort((a, b) => a.time - b.time); // oldest first

            // Need ≥3 candles: first to skip (9:15–9:16) + at least one pair
            if (todayCandles.length < 3) return;

            // ── Gap + volatility filters ──────────────────────────────────────
            const firstCandle = todayCandles[0]; // 9:15 candle
            const firstCandleRange = firstCandle.high - firstCandle.low;

            // Filter 1: 9:15 candle range > 0.40% of open → market opened too chaotic
            const rangeThreshold = parseFloat((firstCandle.open * 0.004).toFixed(2));
            if (firstCandleRange > rangeThreshold) {
                this.skippedSymbols.set(symbol, `9:15 candle range ${firstCandleRange.toFixed(0)}pts > ${rangeThreshold.toFixed(0)} (0.40%)`);
                this.logger.warn(
                    `🚫 [${symbol}] SKIP: 9:15 candle range ₹${firstCandleRange.toFixed(0)}pts > ${rangeThreshold.toFixed(0)}pts (0.40%) — too volatile. No trade today.`
                );
                return;
            }

            // Filter 2: Gap from previous close > 0.80% → big move already done before open
            try {
                const quotes = await this.shoonya.getMultiQuotes('NSE', [token]);
                if (quotes.length > 0 && quotes[0]?.pc) {
                    const prevClose = parseFloat(quotes[0].pc);
                    const gapPts = Math.abs(firstCandle.open - prevClose);
                    const gapThreshold = parseFloat((prevClose * 0.008).toFixed(2));
                    const cautionThreshold = parseFloat((prevClose * 0.004).toFixed(2));
                    if (gapPts > gapThreshold) {
                        this.skippedSymbols.set(symbol, `Gap ${gapPts.toFixed(0)}pts > ${gapThreshold.toFixed(0)} (0.80%) — move already done`);
                        this.logger.warn(
                            `🚫 [${symbol}] SKIP: Gap ₹${gapPts.toFixed(0)}pts > ${gapThreshold.toFixed(0)}pts (0.80%) — big move done before open. No trade today.`
                        );
                        return;
                    } else if (gapPts > cautionThreshold) {
                        this.logger.warn(
                            `⚠️  [${symbol}] Gap ₹${gapPts.toFixed(0)}pts (0.40–0.80% range) — proceed with caution.`
                        );
                    }
                }
            } catch (err: any) {
                this.logger.debug(`[${symbol}] Gap check skipped: ${err.message}`);
            }
            // ─────────────────────────────────────────────────────────────────

            // Skip the very first candle (9:15–9:16 AM — too volatile)
            const validCandles = todayCandles.slice(1);

            // Find first consecutive pair where one is red and the other is green
            for (let i = 0; i < validCandles.length - 1; i++) {
                const c1 = validCandles[i];
                const c2 = validCandles[i + 1];

                // XOR: exactly one must be green, one must be red
                if (c1.isGreen === c2.isGreen) continue;

                // Skip if range too tight (<0.05% = micro-noise) or too wide (>0.50% = SL too far)
                const rangeHigh = Math.max(c1.high, c2.high);
                const rangeLow = Math.min(c1.low, c2.low);
                const rangePct = ((rangeHigh - rangeLow) / rangeLow) * 100;
                if (rangePct < 0.05 || rangePct > 0.50) continue;

                this.setups.set(symbol, {
                    symbol,
                    candle1: c1,
                    candle2: c2,
                    rangeHigh,
                    rangeLow,
                    foundAt: Date.now(),
                    signal: 'PENDING',
                });

                const c1Label = c1.isGreen ? '🟢' : '🔴';
                const c2Label = c2.isGreen ? '🟢' : '🔴';
                this.logger.log(
                    `🕯️  [${symbol}] ${c1Label}+${c2Label} range ₹${rangeLow.toFixed(2)}–₹${rangeHigh.toFixed(2)} ` +
                    `(${rangePct.toFixed(2)}%)`
                );
                break; // use only the first qualifying pair
            }
        } catch (err: any) {
            this.logger.debug(`[2-Candle] ${symbol}: ${err.message}`);
        }
    }

    /** Returns Unix seconds for 9:15 AM IST on today's date */
    private getMarketOpenTs(): number {
        const istDate = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }); // DD/MM/YYYY
        const [day, month, year] = istDate.split('/');
        // 9:15 AM IST = 03:45 AM UTC
        const utc = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T03:45:00Z`);
        return Math.floor(utc.getTime() / 1000);
    }
}
