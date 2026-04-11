import { Injectable, Logger } from '@nestjs/common';

export interface GannLevels {
    previousClose: number;
    squareRoot: number;
    R1: number;
    R2: number;
    R3: number;
    S1: number;
    S2: number;
    S3: number;
}

@Injectable()
export class GannService {
    private readonly logger = new Logger(GannService.name);

    /**
     * Calculate Gann Square of 9 Levels based on Custom Formula
     * @param previousClose The previous day's close price (A)
     * @returns GannLevels resistance and support levels
     */
    calculateLevels(previousClose: number): GannLevels {
        // Formula Requirements
        // A = Previous Day Close
        // B = sqrt(A)
        // R1 = A + B, R2 = A + 2B, R3 = A + 3B
        // S1 = A - B, S2 = A - 2B, S3 = A - 3B

        const A = previousClose;
        const B = Math.sqrt(A);

        const levels: GannLevels = {
            previousClose: A,
            squareRoot: B,
            R1: A + B,
            R2: A + 2 * B,
            R3: A + 3 * B,
            S1: A - B,
            S2: A - 2 * B,
            S3: A - 3 * B,
        };

        this.logger.debug(`Calculated Gann Levels for Prev Close ${A}: R1=${levels.R1.toFixed(2)}, S1=${levels.S1.toFixed(2)}`);
        return levels;
    }

    /**
     * Evaluate if conditions are met for a CE or PE trade.
     * CE Entry: if LTP > R1 (or R2/R3) and stays above for 5 mins
     * PE Entry: if LTP < S1 (or S2/S3) OR crosses down through R1/R2/R3
     */
    evaluateTradeTriggers(ltp: number, levels: GannLevels) {
        // We would pair this with a heartbeat and state management (e.g. Redis)
        // to track the "sustain" rule for 5 minutes.
        // For now, these baseline checks return the current snapshot state.

        const isAboveR1 = ltp > levels.R1;
        const isAboveR2 = ltp > levels.R2;
        const isAboveR3 = ltp > levels.R3;

        const isBelowS1 = ltp < levels.S1;
        const isBelowS2 = ltp < levels.S2;
        const isBelowS3 = ltp < levels.S3;

        // A complete evaluation requires historical data context (5 min sustain)
        return {
            ceTriggerThreshold: isAboveR3 ? 'R3' : isAboveR2 ? 'R2' : isAboveR1 ? 'R1' : null,
            peTriggerThreshold: isBelowS3 ? 'S3' : isBelowS2 ? 'S2' : isBelowS1 ? 'S1' : null,
        };
    }

    /**
     * Calculate RDX (Custom Combo of RSI + ADX)
     * Formula: RDX = RSI + (ADX - 20) / 5
     * @param rsi Standard RSI(14) buffer value
     * @param adx Standard ADX(14) buffer value
     */
    calculateRDX(rsi: number, adx: number): number {
        const rdx = rsi + (adx - 20) / 5;
        return rdx;
    }
}
