import { Test, TestingModule } from '@nestjs/testing';
import { GannAngleService } from './gann-angle.service';

describe('GannAngleService Automation Mock Test', () => {
  let service: GannAngleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GannAngleService],
    }).compile();

    service = module.get<GannAngleService>(GannAngleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('Calculates correctly mathematical structural levels based on 0.25 Grid Factor', () => {
    // Inject mock historical Previous Close for a high-value NIFTY stock (e.g. RELIANCE)
    const mockPreviousClose = 2900; 
    const levels = service.calculateAngles(mockPreviousClose);
    
    expect(levels.previousClose).toBe(2900);
    expect(levels.angle1x1_Up).toBeGreaterThan(mockPreviousClose);
    expect(levels.angle1x1_Dn).toBeLessThan(mockPreviousClose);
    expect(levels.angle1x2_Up).toBeGreaterThan(levels.angle1x1_Up);
    expect(levels.angle1x2_Dn).toBeLessThan(levels.angle1x1_Dn);
  });

  it('Generates a BULLISH CE Signal when LTP strongly breaks above the 1x1 Vector', () => {
    const mockPreviousClose = 2900;
    const levels = service.calculateAngles(mockPreviousClose);
    
    // Simulate current market price surging past the 1x1 angle barrier
    const surgingPrice = levels.angle1x1_Up + 5; 

    const signal = service.generateSignal(surgingPrice, levels);
    expect(signal.type).toBe('CE');
    expect(signal.status).toBe('Eligible for CE');
    expect(signal.entryTrigger).toBe(levels.angle1x1_Up);
    expect(signal.target).toBe(levels.angle1x2_Up); // Primary grid target
    expect(signal.sl).toBe(levels.angle2x1_Up);     // Support trailing
  });

  it('Generates a BEARISH PE Signal when LTP breaks below 1x1 Vector Support', () => {
    const mockPreviousClose = 2900;
    const levels = service.calculateAngles(mockPreviousClose);
    
    // Simulate drop below 1x1 Down angle
    const dumpingPrice = levels.angle1x1_Dn - 5; 

    const signal = service.generateSignal(dumpingPrice, levels);
    expect(signal.type).toBe('PE');
    expect(signal.status).toBe('Eligible for PE');
    expect(signal.entryTrigger).toBe(levels.angle1x1_Dn);
    expect(signal.target).toBe(levels.angle1x2_Dn); 
    expect(signal.sl).toBe(levels.angle2x1_Dn);    
  });

  it('Enforces NEUTRAL WAIT mode if price oscillates inside the internal 1x1 channel bounds', () => {
    const mockPreviousClose = 2900;
    const levels = service.calculateAngles(mockPreviousClose);
    
    // Price trapped exactly between 1x1 UP and 1x1 DOWN
    const rangeBoundPrice = 2900;

    const signal = service.generateSignal(rangeBoundPrice, levels);
    expect(signal.type).toBe('NONE');
    expect(signal.status).toBe('Waiting for Angle Breakout');
  });

});
