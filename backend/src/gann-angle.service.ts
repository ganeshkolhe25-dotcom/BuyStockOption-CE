import { Injectable, Logger } from '@nestjs/common';

export interface GannAngleLevels {
    basePrice: number;   // prevClose or openPrice (if gap ≥1%)
    R_22_5: number;
    R_45:   number;
    R_67_5: number;
    R_90:   number;
    R_135:  number;
    S_22_5: number;
    S_45:   number;
    S_67_5: number;
    S_90:   number;
    S_135:  number;
}

export interface GannEntryLevels {
    triggerLevel: number;
    targetLevel:  number;
    slLevel:      number;
    angle:        45 | 90;
}

// Stocks that use 45° trigger instead of 90°.
// Entry at R_45/S_45, target R_90/S_90, SL R_22.5/S_22.5.
// Populate when identified from backtesting.
const TRIGGER_45_STOCKS = new Set<string>([]);

@Injectable()
export class GannAngleService {
    private readonly logger = new Logger(GannAngleService.name);

    /**
     * Calculate Gann Angle levels using the degree-based square-root formula.
     * R/S(deg) = (√basePrice ± deg/180)²
     *
     * CE Setup: Enter on R_90 cross, SL at R_67.5, Target at R_135
     * PE Setup: Enter on S_90 cross, SL at S_67.5, Target at S_135
     *
     * Gap detection: if today's open gaps ≥1% above/below prevClose, use
     * openPrice as the base so all levels shift to the actual day's anchor.
     */
    calculateAngles(prevClose: number, openPrice?: number): GannAngleLevels {
        // Use openPrice as base if gap ≥ 1% up or down
        let basePrice = prevClose;
        if (openPrice && prevClose > 0) {
            if (openPrice >= prevClose * 1.01 || openPrice <= prevClose * 0.99) {
                basePrice = openPrice;
            }
        }

        const root = Math.sqrt(basePrice);
        const calc = (deg: number, dir: 1 | -1) =>
            parseFloat(Math.pow(root + dir * (deg / 180), 2).toFixed(2));

        return {
            basePrice,
            R_22_5: calc(22.5,  1),
            R_45:   calc(45,    1),
            R_67_5: calc(67.5,  1),
            R_90:   calc(90,    1),
            R_135:  calc(135,   1),
            S_22_5: calc(22.5, -1),
            S_45:   calc(45,   -1),
            S_67_5: calc(67.5, -1),
            S_90:   calc(90,   -1),
            S_135:  calc(135,  -1),
        };
    }

    /** Returns 45 for stocks in the 45° list, 90 for all others */
    getTriggerAngle(symbol: string): 45 | 90 {
        return TRIGGER_45_STOCKS.has(symbol) ? 45 : 90;
    }

    /**
     * Returns entry/target/SL levels for a symbol based on its trigger angle.
     * CE: trigger R_90 (or R_45), target R_135 (or R_90), SL R_67.5 (or R_22.5)
     * PE: same logic on the support side.
     * Note: for Nirwana-aligned GANN_ANGLE, target/SL are overridden to premium % at
     * execution time; these spot levels are kept only as reference / for logging.
     */
    getEntryLevels(symbol: string, levels: GannAngleLevels, type: 'CE' | 'PE'): GannEntryLevels {
        const angle = this.getTriggerAngle(symbol);
        if (type === 'CE') {
            return angle === 45
                ? { triggerLevel: levels.R_45,  targetLevel: levels.R_90,  slLevel: levels.R_22_5, angle }
                : { triggerLevel: levels.R_90,  targetLevel: levels.R_135, slLevel: levels.R_67_5, angle };
        } else {
            return angle === 45
                ? { triggerLevel: levels.S_45,  targetLevel: levels.S_90,  slLevel: levels.S_22_5, angle }
                : { triggerLevel: levels.S_90,  targetLevel: levels.S_135, slLevel: levels.S_67_5, angle };
        }
    }

    /** Returns trend based on R_90 / S_90 structural levels */
    evaluateTrend(ltp: number, levels: GannAngleLevels) {
        if (ltp > levels.R_90) return 'BULLISH';
        if (ltp < levels.S_90) return 'BEARISH';
        return 'NEUTRAL';
    }

    /** Generates entry signal: CE enters at R_90 with target R_135, SL R_67.5 */
    generateSignal(ltp: number, levels: GannAngleLevels) {
        const trend = this.evaluateTrend(ltp, levels);

        if (trend === 'BULLISH') {
            return {
                type: 'CE',
                entryTrigger: levels.R_90,
                target: levels.R_135,
                sl: levels.R_67_5,
                status: 'Eligible for CE'
            };
        } else if (trend === 'BEARISH') {
            return {
                type: 'PE',
                entryTrigger: levels.S_90,
                target: levels.S_135,
                sl: levels.S_67_5,
                status: 'Eligible for PE'
            };
        }

        return { type: 'NONE', status: 'Waiting for Angle Breakout' };
    }
}
