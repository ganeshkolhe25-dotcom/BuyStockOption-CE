import { Injectable, Logger } from '@nestjs/common';
import { ShoonyaService } from './shoonya.service';
import { NseService } from './nse.service';

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

@Injectable()
export class CandleBreakoutService {
    private readonly logger = new Logger(CandleBreakoutService.name);

    // Per-symbol detected 2-candle setup
    private readonly setups = new Map<string, CandleSetup>();

    constructor(
        private readonly shoonya: ShoonyaService,
        private readonly nseService: NseService,
    ) {}

    /**
     * Scan all resolved NSE symbols for their 2-candle morning setup.
     * Called every minute by the scanner (9:18–11:30 AM IST).
     * Skips symbols that already have a setup found.
     */
    async scanForSetups(): Promise<void> {
        const allSymbols = this.nseService.getResolvedSymbols();
        if (allSymbols.length === 0) return;

        // Filter to stocks not yet set up and in a tradeable price range
        const pending = allSymbols.filter(sym => !this.setups.has(sym));
        if (pending.length === 0) return;

        const openTs = this.getMarketOpenTs();
        this.logger.debug(`[2-Candle] Scanning ${pending.length} symbols for setup...`);

        // Batch in groups of 5 with 400 ms delay to respect API rate limits
        for (let i = 0; i < pending.length; i += 5) {
            const batch = pending.slice(i, i + 5);
            await Promise.all(batch.map(sym => this.detectSetup(sym, openTs)));
            if (i + 5 < pending.length) {
                await new Promise(r => setTimeout(r, 400));
            }
        }

        const found = allSymbols.filter(sym => this.setups.has(sym)).length;
        this.logger.debug(`[2-Candle] ${found}/${allSymbols.length} setups found so far.`);
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
                const range = setup.rangeHigh - setup.rangeLow;
                setup.signal = 'CE';
                setup.breakoutPrice = ltp;
                setup.breakoutAt = Date.now();
                setup.entryTargetPrice = parseFloat((setup.rangeHigh + range).toFixed(2));
                setup.entrySlPrice = parseFloat(setup.rangeLow.toFixed(2));
                triggered.push(setup);
                this.logger.log(
                    `📈 2-CANDLE CE: [${symbol}] ₹${ltp} > range high ₹${setup.rangeHigh.toFixed(2)} ` +
                    `→ Target ₹${setup.entryTargetPrice} | SL ₹${setup.entrySlPrice}`
                );
            } else if (ltp < setup.rangeLow - buffer) {
                const range = setup.rangeHigh - setup.rangeLow;
                setup.signal = 'PE';
                setup.breakoutPrice = ltp;
                setup.breakoutAt = Date.now();
                setup.entryTargetPrice = parseFloat((setup.rangeLow - range).toFixed(2));
                setup.entrySlPrice = parseFloat(setup.rangeHigh.toFixed(2));
                triggered.push(setup);
                this.logger.log(
                    `📉 2-CANDLE PE: [${symbol}] ₹${ltp} < range low ₹${setup.rangeLow.toFixed(2)} ` +
                    `→ Target ₹${setup.entryTargetPrice} | SL ₹${setup.entrySlPrice}`
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
        this.logger.log('[2-Candle] All setups cleared for new day.');
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private async detectSetup(symbol: string, openTs: number): Promise<void> {
        try {
            const token = this.nseService.getToken(symbol);
            if (!token) return;

            // Fetch today's 1-minute candles (daysLimit=1 to include today, filter by openTs)
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

            // Skip the very first candle (9:15–9:16 AM — too volatile)
            const validCandles = todayCandles.slice(1);

            // Find first consecutive pair where one is red and the other is green
            for (let i = 0; i < validCandles.length - 1; i++) {
                const c1 = validCandles[i];
                const c2 = validCandles[i + 1];

                // XOR: exactly one must be green, one must be red
                if (c1.isGreen === c2.isGreen) continue;

                // Skip if range is too small (<0.1%) or too large (>3%) — noise / gap
                const rangeHigh = Math.max(c1.high, c2.high);
                const rangeLow = Math.min(c1.low, c2.low);
                const rangePct = ((rangeHigh - rangeLow) / rangeLow) * 100;
                if (rangePct < 0.1 || rangePct > 3.0) continue;

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
