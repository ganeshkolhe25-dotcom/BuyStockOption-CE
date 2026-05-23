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

    constructor(private readonly shoonya: ShoonyaService) {}

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
     * Check all PENDING setups for a candle-CLOSE confirmed breakout.
     * Fetches the most recently completed 1-min candle and checks its CLOSE price
     * (not wick/LTP) against the range boundaries.
     *
     * A signal fires only when:
     *   CE: lastCompletedCandle.close > rangeHigh  (body committed above range)
     *   PE: lastCompletedCandle.close < rangeLow   (body committed below range)
     *
     * The confirmation candle must come AFTER the 2-candle pair that set the range.
     * Wick spikes that reverse before the minute closes will NOT trigger a trade.
     *
     * Returns setups that just triggered (signal changed from PENDING → CE/PE).
     */
    async checkBreakouts(): Promise<CandleSetup[]> {
        const triggered: CandleSetup[] = [];
        const nowSec = Math.floor(Date.now() / 1000);
        const openTs = this.getMarketOpenTs();

        for (const [symbol, setup] of this.setups) {
            if (setup.signal !== 'PENDING') continue;

            const inst = INSTRUMENTS.find(i => i.symbol === symbol);
            if (!inst) continue;

            try {
                const series = await this.shoonya.getTimePriceSeries('NSE', inst.token, '1', 1);
                if (!Array.isArray(series) || series.length === 0) continue;

                // Keep only today's fully completed candles (time + 60 seconds <= now)
                const completedCandles: OneMinCandle[] = series
                    .filter(c => c.ssboe && parseInt(c.ssboe) >= openTs && parseInt(c.ssboe) + 60 <= nowSec)
                    .map(c => ({
                        time:    parseInt(c.ssboe),
                        open:    parseFloat(c.into),
                        high:    parseFloat(c.inth),
                        low:     parseFloat(c.intl),
                        close:   parseFloat(c.intc),
                        isGreen: parseFloat(c.intc) >= parseFloat(c.into),
                    }))
                    .sort((a, b) => a.time - b.time);

                if (completedCandles.length === 0) continue;

                const lastCandle = completedCandles[completedCandles.length - 1];

                // Confirmation candle must come after the pair that set the range
                if (lastCandle.time <= setup.candle2.time) continue;

                if (lastCandle.close > setup.rangeHigh) {
                    const entryPrice = lastCandle.close;
                    const slDist = entryPrice - setup.rangeLow;
                    setup.signal = 'CE';
                    setup.breakoutPrice = entryPrice;
                    setup.breakoutAt = Date.now();
                    setup.entryTargetPrice = parseFloat((entryPrice + 2 * slDist).toFixed(2));
                    setup.entrySlPrice = parseFloat(setup.rangeLow.toFixed(2));
                    triggered.push(setup);
                    this.logger.log(
                        `📈 2-CANDLE CE: [${symbol}] candle CLOSED ₹${entryPrice} > high ₹${setup.rangeHigh.toFixed(2)} ` +
                        `→ Target ₹${setup.entryTargetPrice} (2R) | SL ₹${setup.entrySlPrice}`
                    );
                } else if (lastCandle.close < setup.rangeLow) {
                    const entryPrice = lastCandle.close;
                    const slDist = setup.rangeHigh - entryPrice;
                    setup.signal = 'PE';
                    setup.breakoutPrice = entryPrice;
                    setup.breakoutAt = Date.now();
                    setup.entryTargetPrice = parseFloat((entryPrice - 2 * slDist).toFixed(2));
                    setup.entrySlPrice = parseFloat(setup.rangeHigh.toFixed(2));
                    triggered.push(setup);
                    this.logger.log(
                        `📉 2-CANDLE PE: [${symbol}] candle CLOSED ₹${entryPrice} < low ₹${setup.rangeLow.toFixed(2)} ` +
                        `→ Target ₹${setup.entryTargetPrice} (2R) | SL ₹${setup.entrySlPrice}`
                    );
                } else {
                    this.logger.debug(
                        `[2-Candle] ${symbol}: close ₹${lastCandle.close} inside range ` +
                        `₹${setup.rangeLow.toFixed(2)}–₹${setup.rangeHigh.toFixed(2)}, no signal.`
                    );
                }
            } catch (err: any) {
                this.logger.debug(`[2-Candle] ${symbol}: checkBreakouts error — ${err.message}`);
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

            // Need ≥2 candles: first to skip (9:15–9:16) + at least one pair
            if (todayCandles.length < 2) return;

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
