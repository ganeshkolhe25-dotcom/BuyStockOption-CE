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
