import { GannService } from './gann.service';

describe('GannService.calculateLevels', () => {
    let service: GannService;

    beforeEach(() => {
        service = new GannService();
    });

    // Helper: assert uniform step size between consecutive levels
    function assertUniformStep(levels: ReturnType<GannService['calculateLevels']>) {
        const B = levels.squareRoot;
        expect(levels.R1).toBeCloseTo(levels.previousClose + B, 4);
        expect(levels.R2).toBeCloseTo(levels.previousClose + 2 * B, 4);
        expect(levels.R3).toBeCloseTo(levels.previousClose + 3 * B, 4);
        expect(levels.S1).toBeCloseTo(levels.previousClose - B, 4);
        expect(levels.S2).toBeCloseTo(levels.previousClose - 2 * B, 4);
        expect(levels.S3).toBeCloseTo(levels.previousClose - 3 * B, 4);
    }

    it('levels are symmetric: R1-close == close-S1 == √close', () => {
        const lvl = service.calculateLevels(10000);
        const step = Math.sqrt(10000); // 100
        expect(lvl.R1 - lvl.previousClose).toBeCloseTo(step, 4);
        expect(lvl.previousClose - lvl.S1).toBeCloseTo(step, 4);
    });

    it('step between consecutive R levels is uniform (= √close)', () => {
        const lvl = service.calculateLevels(10000);
        const step = Math.sqrt(10000);
        expect(lvl.R2 - lvl.R1).toBeCloseTo(step, 4);
        expect(lvl.R3 - lvl.R2).toBeCloseTo(step, 4);
        expect(lvl.S1 - lvl.S2).toBeCloseTo(step, 4);
        expect(lvl.S2 - lvl.S3).toBeCloseTo(step, 4);
    });

    it('mid-cap stock ~₹500', () => {
        const lvl = service.calculateLevels(500);
        const B = Math.sqrt(500); // ≈ 22.36
        assertUniformStep(lvl);
        expect(lvl.R1).toBeCloseTo(500 + B, 2);
        expect(lvl.S1).toBeCloseTo(500 - B, 2);
    });

    it('NIFTY range ~₹22000', () => {
        const lvl = service.calculateLevels(22000);
        const B = Math.sqrt(22000); // ≈ 148.32
        assertUniformStep(lvl);
        // R1 should be about 148 points above close — not 22400+ as old (B+1)² formula gave
        expect(lvl.R1).toBeCloseTo(22148.32, 0);
    });

    it('BANKNIFTY range ~₹48000', () => {
        const lvl = service.calculateLevels(48000);
        const B = Math.sqrt(48000); // ≈ 219.09
        assertUniformStep(lvl);
        expect(lvl.R1 - lvl.previousClose).toBeCloseTo(B, 2);
    });

    it('large price ~₹13172 (from spec example)', () => {
        // Spec example: prevClose=13172, B=√13172≈114.77
        // R1 = 13172 + 114.77 ≈ 13286.77  (old formula gave ≈13402)
        const lvl = service.calculateLevels(13172);
        const B = Math.sqrt(13172);
        expect(lvl.squareRoot).toBeCloseTo(B, 4);
        expect(lvl.R1).toBeCloseTo(13172 + B, 2);
        // Verify old (B+1)² formula is NOT being used
        expect(lvl.R1).not.toBeCloseTo(Math.pow(B + 1, 2), 0);
    });

    it('small stock ~₹100', () => {
        const lvl = service.calculateLevels(100);
        // B = 10, so R1=110, R2=120, S1=90, S2=80
        expect(lvl.R1).toBeCloseTo(110, 4);
        expect(lvl.R2).toBeCloseTo(120, 4);
        expect(lvl.R3).toBeCloseTo(130, 4);
        expect(lvl.S1).toBeCloseTo(90, 4);
        expect(lvl.S2).toBeCloseTo(80, 4);
        expect(lvl.S3).toBeCloseTo(70, 4);
    });

    it('squareRoot field equals Math.sqrt(previousClose)', () => {
        [100, 500, 1500, 10000, 22000, 48000].forEach(price => {
            const lvl = service.calculateLevels(price);
            expect(lvl.squareRoot).toBeCloseTo(Math.sqrt(price), 8);
        });
    });
});

describe('GannService.evaluateTradeTriggers', () => {
    let service: GannService;

    beforeEach(() => {
        service = new GannService();
    });

    it('returns R1 threshold when ltp is above R1 only', () => {
        const levels = service.calculateLevels(100); // R1=110, R2=120, R3=130
        const result = service.evaluateTradeTriggers(115, levels);
        expect(result.ceTriggerThreshold).toBe('R1');
        expect(result.peTriggerThreshold).toBeNull();
    });

    it('returns R3 threshold when ltp is above R3', () => {
        const levels = service.calculateLevels(100);
        const result = service.evaluateTradeTriggers(135, levels);
        expect(result.ceTriggerThreshold).toBe('R3');
    });

    it('returns S1 threshold when ltp is below S1', () => {
        const levels = service.calculateLevels(100); // S1=90, S2=80, S3=70
        const result = service.evaluateTradeTriggers(85, levels);
        expect(result.peTriggerThreshold).toBe('S1');
        expect(result.ceTriggerThreshold).toBeNull();
    });

    it('returns null for both when ltp is between S1 and R1', () => {
        const levels = service.calculateLevels(100);
        const result = service.evaluateTradeTriggers(100, levels);
        expect(result.ceTriggerThreshold).toBeNull();
        expect(result.peTriggerThreshold).toBeNull();
    });
});
