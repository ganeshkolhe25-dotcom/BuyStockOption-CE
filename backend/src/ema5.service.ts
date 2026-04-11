import { Injectable, Logger } from '@nestjs/common';
import { EMA } from 'technicalindicators';

export interface EMA5Signal {
    symbol: string;
    type: 'CE' | 'PE' | 'NONE';
    entry: number;       // Alert candle Low (PE) or High (CE) — the activation level
    sl: number;          // Alert candle High (PE) or Low (CE)
    target: number;      // 1:3 Risk-Reward target
    risk: number;        // SL distance from entry
    alertCandle: { open: number; high: number; low: number; close: number } | null;
    emaAtAlert: number;
    status: string;
}

/** Buffer added to alert candle High/Low to filter false wicks on entry */
const ENTRY_BUFFER = 1.5;

@Injectable()
export class Ema5Service {
    private readonly logger = new Logger(Ema5Service.name);

    /**
     * 5 EMA Mean-Reversion Strategy — Alert Candle + Activation Candle
     *
     * Concept: When price stretches far from the 5 EMA, a sharp reversal is expected.
     *   This uses a 2-candle confirmation mechanism on 5-minute candles.
     *
     * PE Setup (Sell / Bearish reversal):
     *   Alert Candle   → entire candle (High AND Low) is above the 5 EMA
     *   Activation     → next candle breaks BELOW the Alert Candle's Low
     *   Entry          → Alert Candle Low  (the broken level)
     *   Stop Loss      → Alert Candle High
     *   Target         → Entry − 3 × Risk  (1:3 R:R minimum)
     *
     * CE Setup (Buy / Bullish reversal):
     *   Alert Candle   → entire candle (High AND Low) is below the 5 EMA
     *   Activation     → next candle breaks ABOVE the Alert Candle's High
     *   Entry          → Alert Candle High (the broken level)
     *   Stop Loss      → Alert Candle Low
     *   Target         → Entry + 3 × Risk  (1:3 R:R minimum)
     */
    analyzeData(data: {
        symbol: string;
        closes: number[];
        highs: number[];
        lows: number[];
        opens?: number[];
        volumes?: number[];
    }): EMA5Signal {
        const NONE: EMA5Signal = {
            symbol: data.symbol, type: 'NONE', entry: 0, sl: 0, target: 0,
            risk: 0, alertCandle: null, emaAtAlert: 0, status: 'No setup'
        };

        const { closes, highs, lows } = data;
        if (closes.length < 10) return { ...NONE, status: 'Not enough candles' };

        // Calculate 5 EMA over all available closes
        const emaResult = new EMA({ values: closes, period: 5 }).getResult();
        if (emaResult.length < 2) return { ...NONE, status: 'Not enough EMA data' };

        // emaResult[i] aligns with closes[offset + i]
        const offset = closes.length - emaResult.length;

        // Alert = second-to-last candle; Activation = last (most-recently closed) candle
        const alertIdx    = closes.length - 2;
        const activateIdx = closes.length - 1;

        if (alertIdx < offset) return { ...NONE, status: 'EMA alignment insufficient' };

        const emaAtAlert = emaResult[alertIdx - offset];

        const alertHigh  = highs[alertIdx];
        const alertLow   = lows[alertIdx];
        const alertClose = closes[alertIdx];
        const alertOpen  = data.opens?.[alertIdx] ?? alertClose;
        const alertCandle = { open: alertOpen, high: alertHigh, low: alertLow, close: alertClose };

        const actHigh = highs[activateIdx];
        const actLow  = lows[activateIdx];

        // ── PE Setup: alert candle fully above EMA ────────────────────────────
        if (alertLow > emaAtAlert && alertHigh > emaAtAlert) {
            if (actLow < alertLow) {
                // Activation candle broke below alert Low → enter PE (buffer confirms genuine break)
                const entry  = parseFloat((alertLow - ENTRY_BUFFER).toFixed(2));
                const sl     = parseFloat((alertHigh + ENTRY_BUFFER).toFixed(2));
                const risk   = parseFloat((sl - entry).toFixed(2));
                const target = parseFloat((entry - 3 * risk).toFixed(2));
                this.logger.debug(
                    `[${data.symbol}] PE Alert+Activation: AlertLow=${alertLow} EMA=${emaAtAlert.toFixed(2)} ActLow=${actLow} → Entry=${entry} SL=${sl} Tgt=${target}`
                );
                return {
                    symbol: data.symbol, type: 'PE',
                    entry, sl, target, risk,
                    alertCandle, emaAtAlert: parseFloat(emaAtAlert.toFixed(2)),
                    status: 'EMA Overstretched Above — Bearish Reversal Signal'
                };
            }
        }

        // ── CE Setup: alert candle fully below EMA ────────────────────────────
        if (alertHigh < emaAtAlert && alertLow < emaAtAlert) {
            if (actHigh > alertHigh) {
                // Activation candle broke above alert High → enter CE (buffer confirms genuine break)
                const entry  = parseFloat((alertHigh + ENTRY_BUFFER).toFixed(2));
                const sl     = parseFloat((alertLow - ENTRY_BUFFER).toFixed(2));
                const risk   = parseFloat((entry - sl).toFixed(2));
                const target = parseFloat((entry + 3 * risk).toFixed(2));
                this.logger.debug(
                    `[${data.symbol}] CE Alert+Activation: AlertHigh=${alertHigh} EMA=${emaAtAlert.toFixed(2)} ActHigh=${actHigh} → Entry=${entry} SL=${sl} Tgt=${target}`
                );
                return {
                    symbol: data.symbol, type: 'CE',
                    entry, sl, target, risk,
                    alertCandle, emaAtAlert: parseFloat(emaAtAlert.toFixed(2)),
                    status: 'EMA Overstretched Below — Bullish Reversal Signal'
                };
            }
        }

        return {
            ...NONE,
            emaAtAlert: parseFloat(emaAtAlert.toFixed(2)),
            alertCandle,
            status: 'Waiting for Alert + Activation setup'
        };
    }

    /** Returns the current 5 EMA value from a closes array, or null if insufficient data */
    getCurrentEma(closes: number[]): number | null {
        if (closes.length < 5) return null;
        const result = new EMA({ values: closes, period: 5 }).getResult();
        return result.length ? result[result.length - 1] : null;
    }
}
