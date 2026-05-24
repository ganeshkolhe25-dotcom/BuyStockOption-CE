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

// Internal — extends OneMinCandle with volume field for VWAP computation.
// Not exported; used only within checkBreakouts() and the quality-filter helpers.
interface CandleWithVolume extends OneMinCandle {
    volume: number;
}

// Uniform return type for all three quality filters.
interface FilterResult {
    pass: boolean;
    reason: string;
}

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
     *
     * Raw breakout condition (unchanged):
     *   CE: lastCompletedCandle.close > rangeHigh
     *   PE: lastCompletedCandle.close < rangeLow
     *
     * Before firing a signal, three quality filters run in sequence:
     *   1. EMA5 Slope    — EMA5 must be sloping in the breakout direction (last 3 values)
     *   2. VWAP Direction — breakout candle close must be on the right side of intraday VWAP
     *   3. Breakout Strength — candle must clear range by ≥15% of rangeSize AND have body ≥50% of range
     *
     * A rejected candle does NOT lock out future candles. Checking continues
     * every 5 seconds until a qualifying candle closes or the scan window closes.
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

                // Parse today's fully-completed 1-min candles.
                // Also capture volume for VWAP. Shoonya provides volume as 'v' (or 'intv' on some endpoints).
                // Fall back to 1 (equal weight) when absent — VWAP degrades to simple HLC/3 average.
                const completedCandles: CandleWithVolume[] = series
                    .filter(c => c.ssboe && parseInt(c.ssboe) >= openTs && parseInt(c.ssboe) + 60 <= nowSec)
                    .map(c => ({
                        time:    parseInt(c.ssboe),
                        open:    parseFloat(c.into),
                        high:    parseFloat(c.inth),
                        low:     parseFloat(c.intl),
                        close:   parseFloat(c.intc),
                        isGreen: parseFloat(c.intc) >= parseFloat(c.into),
                        volume:  Math.max(1, parseFloat(c.v || c.intv || '0') || 1),
                    }))
                    .sort((a, b) => a.time - b.time);

                if (completedCandles.length === 0) continue;

                const lastCandle = completedCandles[completedCandles.length - 1];

                // Confirmation candle must come AFTER the 2-candle pair that set the range
                if (lastCandle.time <= setup.candle2.time) continue;

                // ── Raw breakout direction ─────────────────────────────────────────────
                const isCe = lastCandle.close > setup.rangeHigh;
                const isPe = lastCandle.close < setup.rangeLow;

                if (!isCe && !isPe) {
                    this.logger.debug(
                        `[2-Candle] ${symbol}: close ₹${lastCandle.close} inside range ` +
                        `₹${setup.rangeLow.toFixed(2)}–₹${setup.rangeHigh.toFixed(2)}, no signal.`
                    );
                    continue;
                }

                const type: 'CE' | 'PE' = isCe ? 'CE' : 'PE';

                // ── Filter 1: EMA5 Slope ───────────────────────────────────────────────
                const emaResult = this.checkEmaSlope(completedCandles, type, symbol);
                if (!emaResult.pass) {
                    this.logger.warn(`⛔ [2-Candle] ${symbol} ${type} REJECTED [EMA5 Slope] — ${emaResult.reason}`);
                    continue;
                }
                this.logger.log(`✅ [2-Candle] ${symbol} ${type} EMA5 OK — ${emaResult.reason}`);

                // ── Filter 2: VWAP Direction ───────────────────────────────────────────
                const vwap = this.computeVwap(completedCandles);
                const vwapResult = this.checkVwapDirection(lastCandle.close, vwap, type, symbol);
                if (!vwapResult.pass) {
                    this.logger.warn(`⛔ [2-Candle] ${symbol} ${type} REJECTED [VWAP] — ${vwapResult.reason}`);
                    continue;
                }
                this.logger.log(`✅ [2-Candle] ${symbol} ${type} VWAP OK — ${vwapResult.reason}`);

                // ── Filter 3: Breakout Candle Strength ────────────────────────────────
                const strengthResult = this.checkBreakoutStrength(lastCandle, setup.rangeHigh, setup.rangeLow, type, symbol);
                if (!strengthResult.pass) {
                    this.logger.warn(`⛔ [2-Candle] ${symbol} ${type} REJECTED [Strength] — ${strengthResult.reason}`);
                    continue;
                }
                this.logger.log(`✅ [2-Candle] ${symbol} ${type} Strength OK — ${strengthResult.reason}`);

                // ── All filters passed — lock in the signal ────────────────────────────
                const entryPrice = lastCandle.close;

                if (isCe) {
                    const slDist = entryPrice - setup.rangeLow;
                    setup.signal           = 'CE';
                    setup.breakoutPrice    = entryPrice;
                    setup.breakoutAt       = Date.now();
                    setup.entryTargetPrice = parseFloat((entryPrice + 2 * slDist).toFixed(2));
                    setup.entrySlPrice     = parseFloat(setup.rangeLow.toFixed(2));
                    triggered.push(setup);
                    this.logger.log(
                        `📈 2-CANDLE CE CONFIRMED: [${symbol}] close ₹${entryPrice} > rangeHigh ₹${setup.rangeHigh.toFixed(2)} ` +
                        `| Target ₹${setup.entryTargetPrice} (2R) | SL ₹${setup.entrySlPrice} | VWAP ₹${vwap.toFixed(2)} ✅`
                    );
                } else {
                    const slDist = setup.rangeHigh - entryPrice;
                    setup.signal           = 'PE';
                    setup.breakoutPrice    = entryPrice;
                    setup.breakoutAt       = Date.now();
                    setup.entryTargetPrice = parseFloat((entryPrice - 2 * slDist).toFixed(2));
                    setup.entrySlPrice     = parseFloat(setup.rangeHigh.toFixed(2));
                    triggered.push(setup);
                    this.logger.log(
                        `📉 2-CANDLE PE CONFIRMED: [${symbol}] close ₹${entryPrice} < rangeLow ₹${setup.rangeLow.toFixed(2)} ` +
                        `| Target ₹${setup.entryTargetPrice} (2R) | SL ₹${setup.entrySlPrice} | VWAP ₹${vwap.toFixed(2)} ✅`
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

    // ── Quality Filter 1: EMA5 Slope ────────────────────────────────────────────

    /**
     * Computes EMA5 for an array of close prices.
     * Seed value: SMA of the first 5 closes. Subsequent values use the standard EMA formula.
     * Indices 0–3 are NaN (insufficient data for the seed window).
     * k = 2 / (5 + 1) = 1/3
     */
    private computeEma5(closes: number[]): number[] {
        const k    = 2 / 6; // smoothing factor for period=5
        const emas = new Array<number>(closes.length).fill(NaN);
        if (closes.length < 5) return emas;

        // Seed: simple average of first 5 candles
        emas[4] = closes.slice(0, 5).reduce((sum, v) => sum + v, 0) / 5;

        for (let i = 5; i < closes.length; i++) {
            emas[i] = closes[i] * k + emas[i - 1] * (1 - k);
        }
        return emas;
    }

    /**
     * EMA5 slope filter — confirms trend is moving in the breakout direction.
     *
     * CE: emaNow > emaPrev1 > emaPrev2  (strictly rising over last 3 EMA values)
     * PE: emaNow < emaPrev1 < emaPrev2  (strictly falling over last 3 EMA values)
     *
     * A flat or counter-trend EMA indicates a choppy market where breakouts commonly fail.
     * Uses all completed candles for EMA accuracy; only the last 3 computed values are tested.
     */
    private checkEmaSlope(candles: CandleWithVolume[], type: 'CE' | 'PE', symbol: string): FilterResult {
        const closes = candles.map(c => c.close);
        const emas   = this.computeEma5(closes);
        const valid  = emas.filter(v => !isNaN(v));

        if (valid.length < 3) {
            return {
                pass:   false,
                reason: `Insufficient EMA5 data — ${valid.length} valid values from ${closes.length} candles (need ≥3)`,
            };
        }

        const emaNow   = valid[valid.length - 1];
        const emaPrev1 = valid[valid.length - 2];
        const emaPrev2 = valid[valid.length - 3];

        this.logger.debug(
            `[EMA5] ${symbol} ${type}: ema[-2]=₹${emaPrev2.toFixed(2)} → ema[-1]=₹${emaPrev1.toFixed(2)} → ema[0]=₹${emaNow.toFixed(2)}`
        );

        if (type === 'CE') {
            if (emaNow > emaPrev1 && emaPrev1 > emaPrev2) {
                return {
                    pass:   true,
                    reason: `EMA5 rising ↑ ₹${emaPrev2.toFixed(2)} → ₹${emaPrev1.toFixed(2)} → ₹${emaNow.toFixed(2)}`,
                };
            }
            return {
                pass:   false,
                reason: `EMA5 not rising for CE — ₹${emaPrev2.toFixed(2)} → ₹${emaPrev1.toFixed(2)} → ₹${emaNow.toFixed(2)} ` +
                        `(step1 rising=${emaPrev1 > emaPrev2}, step2 rising=${emaNow > emaPrev1})`,
            };
        } else {
            if (emaNow < emaPrev1 && emaPrev1 < emaPrev2) {
                return {
                    pass:   true,
                    reason: `EMA5 falling ↓ ₹${emaPrev2.toFixed(2)} → ₹${emaPrev1.toFixed(2)} → ₹${emaNow.toFixed(2)}`,
                };
            }
            return {
                pass:   false,
                reason: `EMA5 not falling for PE — ₹${emaPrev2.toFixed(2)} → ₹${emaPrev1.toFixed(2)} → ₹${emaNow.toFixed(2)} ` +
                        `(step1 falling=${emaPrev1 < emaPrev2}, step2 falling=${emaNow < emaPrev1})`,
            };
        }
    }

    // ── Quality Filter 2: VWAP Direction ────────────────────────────────────────

    /**
     * Computes intraday VWAP from market open using all completed 1-min candles.
     * VWAP = Σ(typicalPrice × volume) / Σ(volume)
     * typicalPrice = (high + low + close) / 3
     *
     * When Shoonya does not provide volume (volume=1 fallback for all candles),
     * this degrades gracefully to a simple equal-weighted HLC/3 rolling average,
     * which still tracks institutional activity direction reasonably well.
     */
    private computeVwap(candles: CandleWithVolume[]): number {
        let sumTpv = 0;
        let sumVol = 0;
        for (const c of candles) {
            const tp = (c.high + c.low + c.close) / 3;
            sumTpv  += tp * c.volume;
            sumVol  += c.volume;
        }
        return sumVol > 0 ? sumTpv / sumVol : 0;
    }

    /**
     * VWAP direction filter — ensures trade aligns with institutional intraday bias.
     *
     * CE: breakout candle close must be strictly ABOVE VWAP (buyers dominant)
     * PE: breakout candle close must be strictly BELOW VWAP (sellers dominant)
     *
     * A breakout against VWAP direction has significantly lower follow-through probability.
     */
    private checkVwapDirection(candleClose: number, vwap: number, type: 'CE' | 'PE', symbol: string): FilterResult {
        if (vwap <= 0) {
            return { pass: false, reason: 'VWAP is 0 — cannot compute from empty candle set' };
        }

        const diffPct = ((candleClose - vwap) / vwap * 100).toFixed(3);

        this.logger.debug(
            `[VWAP] ${symbol} ${type}: close=₹${candleClose.toFixed(2)} | VWAP=₹${vwap.toFixed(2)} | diff=${diffPct}%`
        );

        if (type === 'CE' && candleClose <= vwap) {
            return {
                pass:   false,
                reason: `CE close ₹${candleClose.toFixed(2)} ≤ VWAP ₹${vwap.toFixed(2)} (${diffPct}%) — breakout is below institutional average price`,
            };
        }

        if (type === 'PE' && candleClose >= vwap) {
            return {
                pass:   false,
                reason: `PE close ₹${candleClose.toFixed(2)} ≥ VWAP ₹${vwap.toFixed(2)} (${diffPct}%) — breakdown is above institutional average price`,
            };
        }

        return {
            pass:   true,
            reason: `close ₹${candleClose.toFixed(2)} ${type === 'CE' ? 'above' : 'below'} VWAP ₹${vwap.toFixed(2)} (${diffPct}%)`,
        };
    }

    // ── Quality Filter 3: Breakout Candle Strength ───────────────────────────────

    /**
     * Two independent sub-checks — both must pass:
     *
     * A. Minimum breakout distance (15% of rangeSize):
     *    CE: close > rangeHigh + rangeSize × 0.15
     *    PE: close < rangeLow  − rangeSize × 0.15
     *    Guards against candles that barely graze the level (marginal breakouts).
     *
     * B. Body dominance (body ≥ 50% of candle wick range):
     *    bodySize  = |close - open|
     *    wickRange = high - low
     *    Rejects doji, hammer, inverted-hammer, and long-wick reversal candles.
     *    When wickRange = 0 (perfectly flat candle), treated as full-body (rare).
     *
     * Evaluated cheapest-first (distance check before body check).
     */
    private checkBreakoutStrength(
        candle:    OneMinCandle,
        rangeHigh: number,
        rangeLow:  number,
        type:      'CE' | 'PE',
        symbol:    string,
    ): FilterResult {
        const rangeSize   = rangeHigh - rangeLow;
        const minBreakout = rangeSize * 0.15;
        const bodySize    = Math.abs(candle.close - candle.open);
        const wickRange   = candle.high - candle.low;
        const bodyRatio   = wickRange > 0 ? bodySize / wickRange : 1;

        this.logger.debug(
            `[Strength] ${symbol} ${type}: rangeSize=₹${rangeSize.toFixed(2)} minBreakout=₹${minBreakout.toFixed(2)} | ` +
            `body=₹${bodySize.toFixed(2)} wick=₹${wickRange.toFixed(2)} bodyRatio=${(bodyRatio * 100).toFixed(1)}%`
        );

        // A. Minimum breakout distance
        if (type === 'CE') {
            const breakoutDist = candle.close - rangeHigh;
            if (breakoutDist < minBreakout) {
                return {
                    pass:   false,
                    reason: `CE dist too small — close ₹${candle.close.toFixed(2)} clears rangeHigh ₹${rangeHigh.toFixed(2)} ` +
                            `by ₹${breakoutDist.toFixed(2)}, need ≥₹${minBreakout.toFixed(2)} (15% of rangeSize ₹${rangeSize.toFixed(2)})`,
                };
            }
        } else {
            const breakoutDist = rangeLow - candle.close;
            if (breakoutDist < minBreakout) {
                return {
                    pass:   false,
                    reason: `PE dist too small — close ₹${candle.close.toFixed(2)} clears rangeLow ₹${rangeLow.toFixed(2)} ` +
                            `by ₹${breakoutDist.toFixed(2)}, need ≥₹${minBreakout.toFixed(2)} (15% of rangeSize ₹${rangeSize.toFixed(2)})`,
                };
            }
        }

        // B. Body dominance
        if (bodyRatio < 0.5) {
            return {
                pass:   false,
                reason: `Weak candle body — body ₹${bodySize.toFixed(2)} is ${(bodyRatio * 100).toFixed(1)}% of wick range ₹${wickRange.toFixed(2)} ` +
                        `(need ≥50%). Long-wick candle — likely rejection or indecision.`,
            };
        }

        const breakoutDist = type === 'CE' ? candle.close - rangeHigh : rangeLow - candle.close;
        return {
            pass:   true,
            reason: `dist ₹${breakoutDist.toFixed(2)} ≥ min ₹${minBreakout.toFixed(2)} | body ${(bodyRatio * 100).toFixed(1)}% ≥ 50%`,
        };
    }

    // ── Private helpers ─────────────────────────────────────────────────────────

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
