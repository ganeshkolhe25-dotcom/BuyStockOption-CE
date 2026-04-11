import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { NseService } from './nse.service';
import { GannService } from './gann.service';
import { GannAngleService } from './gann-angle.service';
import { Ema5Service } from './ema5.service';
import { HeartbeatService } from './heartbeat.service';
import { PaperTradingService } from './paper.service';
import { PrismaService } from './prisma.service';

@Injectable()
export class ScannerService implements OnModuleInit {
    private readonly logger = new Logger(ScannerService.name);

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private readonly nseService: NseService,
        private readonly gannService: GannService,
        private readonly gannAngleService: GannAngleService,
        private readonly ema5Service: Ema5Service,
        private readonly heartbeatService: HeartbeatService,
        private readonly paperTrading: PaperTradingService,
        private readonly prisma: PrismaService
    ) { }

    async onModuleInit() {
        const cached = await this.cacheManager.get<string>('DAILY_SCAN_RESULTS');
        if (!cached) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

            // Intelligent Catch-Up: If the user boots the bot up midway through the active trading day,
            // we actively trigger a retroactive scan instead of forcing them to wait 24 hours.
            if (timeStr >= '09:20:00' && timeStr <= '15:15:00') {
                this.logger.warn('Bot started late during active market hours. Triggering catch-up scan now...');
                setTimeout(() => {
                    this.automatedMorningScan();
                }, 5000);
            } else {
                this.logger.log('No cached scan results found on startup. Waiting for exactly 9:20 AM IST to run initial market scan.');
            }
        }
    }

    /**
     * Fully Automated Daily Scan at 9:20 AM IST (Monday - Friday)
     */
    @Cron('20 09 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedMorningScan() {
        this.logger.log('⏰ 9:20 AM Auto-Scan Triggered!');

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gann9Enabled) {
            this.logger.warn('Gann Square-9 Strategy is DISABLED directly from settings. Skipping background scan...');
            return;
        }

        if (await this.paperTrading.isTradingHaltedForDay('GANN_9')) {
            this.logger.warn('Gann Square-9 Strategy Halted or Limit Reached. Skipping morning scan.');
            return;
        }

        try {
            const stocks = await this.nseService.scanGainersLosers();
            const processed = [];

            for (const stock of stocks) {
                // Use the actual previous close from Shoonya (item.c). Fall back to
                // the pChange-derived estimate only if the field is missing.
                const pctChange = stock.pChange || 0;
                const prevClose = stock.prevClose || (stock.ltp / (1 + pctChange / 100));

                const levels = this.gannService.calculateLevels(prevClose);

                /* 
                // Gap-Up/Gap-Down Filter: Exclude if stock opened beyond R1 + 50% of squareRoot, or below S1 - 50% of squareRoot
                const maxCeBoundary = levels.R1 + (levels.squareRoot / 2);
                const maxPeBoundary = levels.S1 - (levels.squareRoot / 2);

                if (stock.ltp > maxCeBoundary || stock.ltp < maxPeBoundary) {
                    this.logger.debug(`[${stock.symbol}] Gapped beyond safely tradable boundary (> 50% of sqrt). Skipping...`);
                    continue;
                }
                */

                const snapshotStatus = this.gannService.evaluateTradeTriggers(stock.ltp, levels);

                // We let continuousDailyScanMonitor inside heartbeat.service.ts manage additions
                // so that openLtp boundaries and reversal logics are strictly enforced.

                processed.push({
                    ...stock,
                    // Use actual day open from Shoonya (item.o) so gap-up/gap-down detection
                    // is based on the real 9:15 AM opening price, not the 9:20 AM scan price.
                    openLtp: stock.openPrice || stock.ltp,
                    prevClose,
                    levels,
                    snapshotStatus,
                });
            }

            // Cache the result for the frontend to consume throughout the day
            await this.cacheManager.set('DAILY_SCAN_RESULTS', JSON.stringify({
                status: 'success',
                count: processed.length,
                data: processed,
            }), 43200000); // 12 hours TTL

            this.logger.log(`✅ Morning Scan Complete. Stored ${processed.length} Nifty 200 Setups.`);

            // ── Subscribe all scanned symbols to WS tick feed ──────────────────
            // After this, getBatchLTP() reads from the in-memory tick cache
            // instead of calling REST for every 15-second syncLiveScannerPrices poll.
            try {
                await this.nseService.connectTickFeed();
                this.nseService.subscribeForLiveFeed(processed.map((s: any) => s.symbol));
            } catch (wsErr: any) {
                this.logger.warn(`[WS] Tick feed subscription failed — REST fallback active: ${wsErr.message}`);
            }
        } catch (error) {
            this.logger.error(`Automated Scan Failed: ${error.message}`);
        }
    }

    /**
     * Continuous Gann Angle Structural Scan (NIFTY 100)
     * Runs every 5 minutes from 9:20 AM to 11:30 AM IST (Mon-Fri)
     */
    @Cron('0 */5 9-11 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedGannAngleScan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:20:00' || timeStr > '11:30:00') return;

        this.logger.log(`⏰ [${timeStr}] Gann Angle Continuous Scan Triggered!`);

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gannAngleEnabled) {
            this.logger.warn('Gann Angle Strategy is DISABLED from settings. Skipping...');
            return;
        }

        if (await this.paperTrading.isTradingHaltedForDay('GANN_ANGLE')) {
            this.logger.warn('Gann Angle Strategy Halted or Limit Reached. Skipping scan.');
            return;
        }

        try {
            const stocks = await this.nseService.scanNifty100Quotes();

            // Skip stocks already traded today under this strategy
            const todayTraded = await this.paperTrading.getTodayTradedSymbols('GANN_ANGLE');

            let newSignals = 0;
            for (const stock of stocks) {
                if (todayTraded.includes(stock.symbol)) continue;

                const prevClose = stock.prevClose || (stock.ltp / (1 + (stock.pChange / 100)));
                const levels = this.gannAngleService.calculateAngles(prevClose);
                const signal = this.gannAngleService.generateSignal(stock.ltp, levels);

                if (signal.type === 'CE' && signal.entryTrigger && signal.target && signal.sl) {
                    await this.heartbeatService.addToWatchlist(stock.symbol, signal.entryTrigger, 'CE', signal.target, signal.sl, 'GANN_ANGLE');
                    newSignals++;
                } else if (signal.type === 'PE' && signal.entryTrigger && signal.target && signal.sl) {
                    await this.heartbeatService.addToWatchlist(stock.symbol, signal.entryTrigger, 'PE', signal.target, signal.sl, 'GANN_ANGLE');
                    newSignals++;
                }
            }
            this.logger.log(`✅ Gann Angle Scan: ${stocks.length} stocks checked, ${newSignals} new signals, ${todayTraded.length} skipped (already traded today).`);
        } catch (error) {
            this.logger.error(`Automated Gann Angle Scan Failed: ${error.message}`);
        }
    }

    /**
     * Automated 5 EMA Mean-Reversion Strategy on Volatile NIFTY 100
     * Runs 5 seconds after every 5-minute candle close (Alert+Activation confirmation).
     */
    @Cron('5 */5 9-15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedEma5Scan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:15:00' || timeStr > '15:15:00') return;

        // Active session windows only — skip mid-day chop (11:05 AM – 1:30 PM)
        const inMorningWindow   = timeStr >= '09:30:00' && timeStr <= '11:05:00';
        const inAfternoonWindow = timeStr >= '13:30:00' && timeStr <= '15:05:00';
        if (!inMorningWindow && !inAfternoonWindow) {
            this.logger.debug(`5 EMA: Outside active windows (${timeStr}). Skipping mid-day.`);
            return;
        }

        this.logger.log(`⏰ ${timeStr} 5 EMA Strategy Scan Triggered!`);

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.ema5Enabled) {
            this.logger.warn('5 EMA Strategy is DISABLED from settings. Skipping...');
            return;
        }

        if (await this.paperTrading.isTradingHaltedForDay('EMA_5')) {
            this.logger.warn('5 EMA Strategy Halted or Limit Reached. Skipping...');
            return;
        }

        try {
            const stocks = await this.nseService.scanEma5mUniverse();
            const todayTraded = await this.paperTrading.getTodayTradedSymbols('EMA_5');

            // 1. New signal detection
            let matches = 0;
            for (const stock of stocks) {
                if (todayTraded.includes(stock.symbol)) continue;

                const signal = this.ema5Service.analyzeData(stock);

                if (signal.type === 'CE' || signal.type === 'PE') {
                    matches++;
                    await this.heartbeatService.addToWatchlist(
                        stock.symbol, signal.entry, signal.type,
                        signal.target, signal.sl, 'EMA_5'
                    );
                }
            }

            // 2. EMA Touch Exit: flag open EMA_5 positions whose stock closed past the 5 EMA
            const summary = await this.paperTrading.getPortfolioSummary();
            const ema5Positions = summary.positions.filter(p => p.strategyName === 'EMA_5');
            let exitFlags = 0;
            for (const pos of ema5Positions) {
                const stockData = stocks.find(s => s.symbol === pos.symbol);
                if (!stockData) continue;

                const currentEma = this.ema5Service.getCurrentEma(stockData.closes);
                if (!currentEma) continue;

                const lastClose = stockData.closes[stockData.closes.length - 1];
                // CE reversal trade exits when price closes BELOW EMA (trend resumed down)
                // PE reversal trade exits when price closes ABOVE EMA (trend resumed up)
                const touchExit = (pos.type === 'CE' && lastClose < currentEma) ||
                                  (pos.type === 'PE' && lastClose > currentEma);

                if (touchExit) {
                    exitFlags++;
                    await this.cacheManager.set(`EMA5_EXIT:${pos.symbol}`, '1', 90000); // 90s TTL
                    this.logger.warn(`📉 EMA TOUCH EXIT FLAGGED: [${pos.symbol}] Close ₹${lastClose} crossed 5 EMA ₹${currentEma.toFixed(2)}`);
                }
            }

            this.logger.log(`✅ 5 EMA Scan: ${stocks.length} stocks | ${matches} new setups | ${exitFlags} exit flags.`);
        } catch (error) {
            this.logger.error(`Automated 5 EMA Scan Failed: ${error.message}`);
        }
    }

    /**
     * Helper to retrieve cached setups for the UI Dashboard
     */
    async getLatestScanResults() {
        const cached = await this.cacheManager.get<string>('DAILY_SCAN_RESULTS');
        if (!cached) {
            return { status: 'success', count: 0, data: [] };
        }
        return JSON.parse(cached);
    }

    /**
     * Keep the Scanner Dashboard Top-Right Corner Prices Real-Time!
     */
    @Cron('*/15 * * * * *')
    async syncLiveScannerPrices() {
        const cachedStr = await this.cacheManager.get<string>('DAILY_SCAN_RESULTS');
        if (!cachedStr) return;

        const scan = JSON.parse(cachedStr);
        if (!scan.data || scan.data.length === 0) return;

        const symbols = scan.data.map((s: any) => s.symbol);
        const livePrices = await this.nseService.getBatchLTP(symbols);

        let updated = false;
        for (const stock of scan.data) {
            if (livePrices[stock.symbol] && livePrices[stock.symbol] > 0) {
                stock.ltp = livePrices[stock.symbol];

                // Recalculate pChange dynamically for frontend updates
                const pctChange = ((stock.ltp - stock.prevClose) / stock.prevClose) * 100;
                stock.pChange = parseFloat(pctChange.toFixed(2));

                updated = true;
            }
        }

        if (updated) {
            await this.cacheManager.set('DAILY_SCAN_RESULTS', JSON.stringify({
                status: 'success',
                count: scan.data.length,
                data: scan.data,
            }), 43200000); // Maintain 12hr ttl
        }
    }
}
