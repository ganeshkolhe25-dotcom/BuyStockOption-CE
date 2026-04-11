import { Injectable, Logger } from '@nestjs/common';

export interface GannAngleLevels {
    previousClose: number;
    angle1x2_Up: number;
    angle1x1_Up: number;
    angle2x1_Up: number;
    angle2x1_Dn: number;
    angle1x1_Dn: number;
    angle1x2_Dn: number;
}

@Injectable()
export class GannAngleService {
    private readonly logger = new Logger(GannAngleService.name);

    /**
     * Calculate Gann Angles relative to a starting price (Prev Close)
     * Using square root method: NewPrice = (sqrt(Price) +/- (Step * Time))^2
     */
    calculateAngles(previousClose: number): GannAngleLevels {
        const root = Math.sqrt(previousClose);
        
        // Step represents geometric degree rotations (0.25 = 90 degrees commonly used as intraday structural step)
        const step = 0.25;

        // In terms of price/time geometry:
        // 1x1 = 1 unit price / 1 unit time
        // 2x1 = 2 units price / 1 unit time 
        // 1x2 = 1 unit price / 2 units time

        const calc = (factor: number) => parseFloat(Math.pow(root + factor, 2).toFixed(2));

        const levels: GannAngleLevels = {
            previousClose: previousClose,
            angle1x2_Up: calc(step * 2),    // Sharpest upward angle
            angle1x1_Up: calc(step * 1),    // Balanced upward angle (45 degrees)
            angle2x1_Up: calc(step * 0.5),  // Shallower upward angle
            
            angle2x1_Dn: calc(-step * 0.5), // Shallower downward angle
            angle1x1_Dn: calc(-step * 1),   // Balanced downward angle
            angle1x2_Dn: calc(-step * 2),   // Sharpest downward angle
        };

        return levels;
    }

    /**
     * Determine trend based on current LTP relative to 1x1 angle
     */
    evaluateTrend(ltp: number, levels: GannAngleLevels) {
        if (ltp > levels.angle1x1_Up) return 'BULLISH';
        if (ltp < levels.angle1x1_Dn) return 'BEARISH';
        return 'NEUTRAL';
    }

    /**
     * Generate Actionable Breakdown or Breakout triggers
     */
    generateSignal(ltp: number, levels: GannAngleLevels) {
        const trend = this.evaluateTrend(ltp, levels);
        
        if (trend === 'BULLISH') {
            return {
                type: 'CE',
                entryTrigger: levels.angle1x1_Up,
                target: levels.angle1x2_Up,
                sl: levels.angle2x1_Up,
                status: 'Eligible for CE'
            };
        } else if (trend === 'BEARISH') {
            return {
                type: 'PE',
                entryTrigger: levels.angle1x1_Dn,
                target: levels.angle1x2_Dn,
                sl: levels.angle2x1_Dn,
                status: 'Eligible for PE'
            };
        }
        
        return { type: 'NONE', status: 'Waiting for Angle Breakout' };
    }
}
