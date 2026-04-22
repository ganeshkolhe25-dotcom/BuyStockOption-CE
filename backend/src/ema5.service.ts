import { Injectable, Logger } from '@nestjs/common';
import { EMA, ATR, RSI } from 'technicalindicators';

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
        // ATR(14) needs 14 periods + 1 offset candle for alert/activation alignment
        if (closes.length < 16) return { ...NONE, status: 'Not enough candles' };

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

        // ── Dynamic ATR buffer (Item 1) ───────────────────────────────────────
        // 0.1 × ATR(14) scales the entry/SL buffer with each stock's actual volatility
        const atrResult = new ATR({ high: highs, low: lows, close: closes, period: 14 }).getResult();
        const atr    = atrResult.length > 0 ? atrResult[atrResult.length - 1] : 5;
        const buffer = parseFloat((0.1 * atr).toFixed(2));

        // ── RSI(14) confirmation filter (Item 3) ─────────────────────────────
        const rsiResult = new RSI({ values: closes, period: 14 }).getResult();
        const latestRsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;

        // ── Volume surge filter (Item 3) ──────────────────────────────────────
        // Current candle volume must exceed the 10-period average
        const vol = data.volumes ?? [];
        const vol10 = vol.slice(-11, -1);
        const volMa = vol10.length > 0 ? vol10.reduce((a, b) => a + b, 0) / vol10.length : 0;
        const currentVol  = vol.length > 0 ? vol[vol.length - 1] : 0;
        const volumeSurge = volMa > 0 ? currentVol > volMa : true; // fallback: pass if no volume data

        const alertHigh  = highs[alertIdx];
        const alertLow   = lows[alertIdx];
        const alertClose = closes[alertIdx];
        const alertOpen  = data.opens?.[alertIdx] ?? alertClose;
        const alertCandle = { open: alertOpen, high: alertHigh, low: alertLow, close: alertClose };

        const actHigh = highs[activateIdx];
        const actLow  = lows[activateIdx];

        // ── PE Setup: alert candle CLOSES above EMA (wick may cross — close is the signal) ──
        if (alertClose > emaAtAlert) {
            if (actLow < alertLow) {
                // RSI > 60 confirms price is overbought/overstretched above EMA
                if (latestRsi !== null && latestRsi < 60) {
                    return { ...NONE, emaAtAlert: parseFloat(emaAtAlert.toFixed(2)), alertCandle,
                        status: `Blocked: RSI=${latestRsi.toFixed(1)} must be >60 for PE (overbought)` };
                }
                if (!volumeSurge) {
                    return { ...NONE, emaAtAlert: parseFloat(emaAtAlert.toFixed(2)), alertCandle,
                        status: 'Blocked: No volume surge on activation candle (PE)' };
                }
                const entry  = parseFloat((alertLow - buffer).toFixed(2));
                const sl     = parseFloat((alertHigh + buffer).toFixed(2));
                const risk   = parseFloat((sl - entry).toFixed(2));
                const target = parseFloat((entry - 3 * risk).toFixed(2));
                this.logger.debug(
                    `[${data.symbol}] PE: AlertLow=${alertLow} EMA=${emaAtAlert.toFixed(2)} ATR=${atr.toFixed(2)} Buf=${buffer} RSI=${latestRsi?.toFixed(1)} → E=${entry} SL=${sl} T=${target}`
                );
                return {
                    symbol: data.symbol, type: 'PE',
                    entry, sl, target, risk,
                    alertCandle, emaAtAlert: parseFloat(emaAtAlert.toFixed(2)),
                    status: 'EMA Overstretched Above — Bearish Reversal Signal'
                };
            }
        }

        // ── CE Setup: alert candle CLOSES below EMA (wick may cross — close is the signal) ──
        if (alertClose < emaAtAlert) {
            if (actHigh > alertHigh) {
                // RSI < 40 confirms price is oversold/overstretched below EMA
                if (latestRsi !== null && latestRsi > 40) {
                    return { ...NONE, emaAtAlert: parseFloat(emaAtAlert.toFixed(2)), alertCandle,
                        status: `Blocked: RSI=${latestRsi.toFixed(1)} must be <40 for CE (oversold)` };
                }
                if (!volumeSurge) {
                    return { ...NONE, emaAtAlert: parseFloat(emaAtAlert.toFixed(2)), alertCandle,
                        status: 'Blocked: No volume surge on activation candle (CE)' };
                }
                const entry  = parseFloat((alertHigh + buffer).toFixed(2));
                const sl     = parseFloat((alertLow - buffer).toFixed(2));
                const risk   = parseFloat((entry - sl).toFixed(2));
                const target = parseFloat((entry + 3 * risk).toFixed(2));
                this.logger.debug(
                    `[${data.symbol}] CE: AlertHigh=${alertHigh} EMA=${emaAtAlert.toFixed(2)} ATR=${atr.toFixed(2)} Buf=${buffer} RSI=${latestRsi?.toFixed(1)} → E=${entry} SL=${sl} T=${target}`
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
