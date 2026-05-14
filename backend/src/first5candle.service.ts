import { Injectable, Logger } from '@nestjs/common';
import { ShoonyaService } from './shoonya.service';

export interface FiveMinCandle {
    time: number;       // unix seconds (ssboe)
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    isBullish: boolean; // close >= open
}

export interface Orb5State {
    symbol: string;
    resistance: number;          // max high of the 5 window candles
    support: number;             // min low  of the 5 window candles
    windowCandles: FiveMinCandle[];  // the 5 range-defining candles
    activationCandle: FiveMinCandle | null; // candle whose close is checked for breakout
    state: 'WAITING' | 'WATCHING' | 'TRADED' | 'EXPIRED';
    breakoutDirection?: 'CE' | 'PE';
    breakoutAt?: number;  // unix ms
    tradedAt?: number;    // unix ms
    lastUpdated: number;  // unix ms
}

// Fixed to NIFTY and BANKNIFTY only — NSE index tokens
const INSTRUMENTS = [
    { symbol: 'NIFTY',     token: '26000' },
    { symbol: 'BANKNIFTY', token: '26009' },
];

const BODY_FILTER_PCT = 50; // breakout candle body must be >= 50% of its high-low range

@Injectable()
export class First5CandleService {
    private readonly logger = new Logger(First5CandleService.name);
    private readonly states = new Map<string, Orb5State>();

    constructor(private readonly shoonya: ShoonyaService) {}

    /**
     * Rolling ORB scan — called every 5 min by scanner cron (9:40 AM – 12:30 PM IST).
     *
     * Rolling window logic:
     *   - Fetch all of today's completed 5-min candles, sort oldest-first.
     *   - Require ≥ 6 candles.
     *   - windowCandles = candles[-6 .. -2]  (the 5 range candles)
     *   - activation    = candles[-1]         (the breakout-check candle)
     *   - resistance = max(window highs), support = min(window lows)
     *
     * Filters on activation candle (all three must pass):
     *   1. Candle body ≥ 50% of the high-low range
     *   2. Volume > average volume of the 5 window candles
     *   3. CE: close > resistance AND bullish
     *      PE: close < support  AND bearish
     *
     * Returns 'CE', 'PE', or null.
     */
    async scanForBreakout(symbol: string, token: string): Promise<'CE' | 'PE' | null> {
        try {
            // Never scan a symbol that already traded today
            const existing = this.states.get(symbol);
            if (existing?.state === 'TRADED') return null;

            const openTs = this.getMarketOpenTs();
            const series = await this.shoonya.getTimePriceSeries('NSE', token, '5', 1);
            if (!Array.isArray(series) || series.length === 0) {
                this.setWaiting(symbol);
                return null;
            }

            // Filter to today's candles only and sort oldest-first
            const candles: FiveMinCandle[] = series
                .filter(c => c.ssboe && parseInt(c.ssboe) >= openTs)
                .map(c => ({
                    time:      parseInt(c.ssboe),
                    open:      parseFloat(c.into),
                    high:      parseFloat(c.inth),
                    low:       parseFloat(c.intl),
                    close:     parseFloat(c.intc),
                    volume:    parseFloat(c.v || c.intv || '0'),
                    isBullish: parseFloat(c.intc) >= parseFloat(c.into),
                }))
                .sort((a, b) => a.time - b.time);

            if (candles.length < 6) {
                this.setWaiting(symbol);
                return null;
            }

            const activation    = candles[candles.length - 1];
            const windowCandles = candles.slice(candles.length - 6, candles.length - 1); // exactly 5

            const resistance = parseFloat(Math.max(...windowCandles.map(c => c.high)).toFixed(2));
            const support    = parseFloat(Math.min(...windowCandles.map(c => c.low)).toFixed(2));

            // Update state with the latest window (WATCHING = range is live and we're checking)
            this.upsertState(symbol, 'WATCHING', windowCandles, activation, resistance, support);

            // ── Filter 1: candle body ≥ 50% of range ────────────────────────────────
            const range = activation.high - activation.low;
            if (range <= 0) {
                this.logger.debug(`[ORB5] ${symbol}: zero-range activation candle, skip.`);
                return null;
            }
            const bodyPct = (Math.abs(activation.close - activation.open) / range) * 100;
            if (bodyPct < BODY_FILTER_PCT) {
                this.logger.debug(`[ORB5] ${symbol}: body ${bodyPct.toFixed(1)}% < 50%. Skip.`);
                return null;
            }

            // ── Filter 2: volume > average of window candles ─────────────────────────
            const windowAvgVol = windowCandles.reduce((s, c) => s + c.volume, 0) / windowCandles.length;
            if (windowAvgVol > 0 && activation.volume <= windowAvgVol) {
                this.logger.debug(
                    `[ORB5] ${symbol}: vol ${activation.volume.toFixed(0)} ≤ avg ${windowAvgVol.toFixed(0)}. Skip.`
                );
                return null;
            }

            // ── Signal detection ─────────────────────────────────────────────────────
            if (activation.close > resistance && activation.isBullish) {
                this.logger.log(
                    `📈 [ORB5] CE: [${symbol}] close ₹${activation.close} > R ₹${resistance} ` +
                    `| body ${bodyPct.toFixed(1)}% | vol ${activation.volume.toFixed(0)} vs avg ${windowAvgVol.toFixed(0)}`
                );
                this.markBreakout(symbol, 'CE');
                return 'CE';
            }

            if (activation.close < support && !activation.isBullish) {
                this.logger.log(
                    `📉 [ORB5] PE: [${symbol}] close ₹${activation.close} < S ₹${support} ` +
                    `| body ${bodyPct.toFixed(1)}% | vol ${activation.volume.toFixed(0)} vs avg ${windowAvgVol.toFixed(0)}`
                );
                this.markBreakout(symbol, 'PE');
                return 'PE';
            }

            this.logger.debug(
                `[ORB5] ${symbol}: no break. Close ₹${activation.close} | R ₹${resistance} | S ₹${support}`
            );
            return null;

        } catch (err: any) {
            this.logger.error(`[ORB5] ${symbol}: scan error — ${err.message}`);
            return null;
        }
    }

    /** Called by scanner after a trade is placed — locks symbol for the day */
    markTraded(symbol: string): void {
        const s = this.states.get(symbol);
        if (s) {
            s.state    = 'TRADED';
            s.tradedAt = Date.now();
            s.lastUpdated = Date.now();
        }
    }

    getStates(): Orb5State[] {
        return Array.from(this.states.values());
    }

    getInstruments() {
        return INSTRUMENTS;
    }

    clearAll(): void {
        this.states.clear();
        this.logger.log('[ORB5] Daily states cleared for new session.');
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private setWaiting(symbol: string): void {
        const s = this.states.get(symbol);
        if (s?.state === 'TRADED') return;
        this.states.set(symbol, {
            symbol,
            resistance: 0,
            support:    0,
            windowCandles: [],
            activationCandle: null,
            state: 'WAITING',
            lastUpdated: Date.now(),
        });
    }

    private upsertState(
        symbol: string,
        state: Orb5State['state'],
        windowCandles: FiveMinCandle[],
        activationCandle: FiveMinCandle,
        resistance: number,
        support: number,
    ): void {
        const s = this.states.get(symbol);
        if (s?.state === 'TRADED') return;
        this.states.set(symbol, {
            symbol,
            resistance,
            support,
            windowCandles,
            activationCandle,
            state,
            breakoutDirection: s?.breakoutDirection,
            breakoutAt:        s?.breakoutAt,
            tradedAt:          s?.tradedAt,
            lastUpdated:       Date.now(),
        });
    }

    private markBreakout(symbol: string, direction: 'CE' | 'PE'): void {
        const s = this.states.get(symbol);
        if (s) {
            s.breakoutDirection = direction;
            s.breakoutAt        = Date.now();
            s.lastUpdated       = Date.now();
        }
    }

    /** Unix seconds for 9:15 AM IST on today's date (same as CandleBreakoutService) */
    private getMarketOpenTs(): number {
        const istDate = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }); // DD/MM/YYYY
        const [day, month, year] = istDate.split('/');
        const utc = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T03:45:00Z`);
        return Math.floor(utc.getTime() / 1000);
    }
}
