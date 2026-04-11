import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NseService } from './nse.service';
import { ScannerService } from './scanner.service';
import { HeartbeatService } from './heartbeat.service';
import { Logger } from '@nestjs/common';
import { ShoonyaService } from './shoonya.service';
import { PaperTradingService } from './paper.service';

const logger = new Logger('MockSimulator');

async function runSimulation() {
    logger.log('Starting Local Mock Testing Suite...');

    // Disable cron jobs in the app module if possible, but NestFactory creates the app.
    // We will just execute methods manually.
    const app = await NestFactory.createApplicationContext(AppModule);

    const nseService = app.get(NseService);
    const scannerService = app.get(ScannerService);
    const heartbeatService = app.get(HeartbeatService);
    const shoonyaService = app.get(ShoonyaService);
    const paperTrading = app.get(PaperTradingService);

    // MOCK: Prevent shoonya from failing by giving dummy options
    shoonyaService.findAtmOption = async (symbol, triggerPrice, type) => {
        return {
            strike: triggerPrice,
            type: type,
            symbol: symbol,
            token: `MOCK_${symbol}_${type}`,
            tradingSymbol: `MOCK_${symbol}_OPT`,
            ltp: 100,
            delta: 0.5,
            lotSize: 50
        };
    };

    shoonyaService.getOptionQuote = async (token) => {
        return { ltp: 105, askPrice: 105, bidPrice: 100 };
    };

    // MOCK DATA 
    // RELIANCE Prev: 3000, sqrt: ~54.77. 
    // S1=2945.22, S2=2890.45, S3=2835.68
    // TCS Prev: 4000, sqrt: ~63.24. S1=3936.75

    // Simulate Gap Down between S1 and S2 for RELIANCE (Must be > 2917 to pass 50% boundary)
    // Simulate Gap Down under S1 for TCS (Must be > 3905 to pass boundary)
    nseService.scanGainersLosers = async () => [
        { symbol: 'RELIANCE', ltp: 2925, pChange: -2.5, prevClose: 3000 },
        { symbol: 'TCS', ltp: 3915, pChange: -2.125, prevClose: 4000 }
    ];

    logger.log('--- PHASE 1: 9:20 AM SCAN ---');
    await scannerService.automatedMorningScan();

    // MOCK TICK 1: Prices start to reverse
    logger.log('--- PHASE 2: Market Reversal (Crossing Levels) ---');
    let ltpMap: Record<string, number> = {
        'RELIANCE': 2888, // Crosses DOWN through S2 (2890.45) -> Triggers PE S2 Crossdown
        'TCS': 3938       // Crosses UP through S1 (3936.75) -> Triggers CE Reversal
    };

    nseService.getLiveLTP = async (symbol) => ltpMap[symbol];

    const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function () {
        return '10:30:00';
    };

    await heartbeatService.continuousDailyScanMonitor();

    // Restore
    Date.prototype.toLocaleTimeString = originalToLocaleTimeString;

    logger.log('--- PHASE 3: Validating Watchlist (Simulating 5 Min Sustain) ---');
    // We physically modify the memory cache to simulate 5 mins passing
    // Since we don't have direct memory cache access here cleanly, we will call processHeartbeatWatchlist
    // but first we need to let the cache hold the items. 
    // They were just added. Let's see if we can manipulate the breakoutTime.
    const CACHE_MANAGER = app.get('CACHE_MANAGER');
    const keysStr = await CACHE_MANAGER.get('WATCHLIST_KEYS');
    if (keysStr) {
        const keys = JSON.parse(keysStr);
        for (const key of keys) {
            const raw = await CACHE_MANAGER.get(key);
            if (raw) {
                const entry = JSON.parse(raw);
                entry.breakoutTime = Date.now() - (6 * 60 * 1000); // Shift time back 6 minutes
                await CACHE_MANAGER.set(key, JSON.stringify(entry));
            }
        }
    }

    // Now call Heartbeat processor, it should buy!
    await heartbeatService.processHeartbeatWatchlist();

    logger.log('--- PHASE 4: Validating Portfolio and PnL Tracking ---');
    const summary = await paperTrading.getPortfolioSummary();
    logger.log('Live Positions Hosted: ' + summary.positions.length);
    summary.positions.forEach(p => {
        logger.log(`- ${p.symbol} ${p.type} @ Entry: ${p.entryPrice}`);
    });

    logger.log('Mock Testing Completed successfully.');
    process.exit(0);
}

runSimulation();
