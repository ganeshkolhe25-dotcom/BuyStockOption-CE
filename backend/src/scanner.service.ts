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

        // Trade limit is enforced at order placement (placeBuyOrder), not at scan time

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
     * Gann Angle Momentum Cache Builder — Runs every 5 minutes, 9:20–11:30 AM IST (Mon-Fri)
     *
     * Replaces the old "scan + add to watchlist immediately" approach.
     * Now: fetches all 100 stocks, applies a 4-factor momentum filter, computes Gann Angle
     * levels for qualifying stocks, and stores them in GANN_ANGLE_LEVELS cache.
     * The separate 30-second monitorGannAngleLevels cron reads this cache and detects
     * fresh trigger crossings — eliminating both the 5-minute blind spot and chasing entries.
     *
     * 4-Factor Momentum Filter (all derived from the single getMultiQuotes batch call):
     *   1. pChange     > +1.0% (CE) / < -1.0% (PE)  — meaningful overnight move
     *   2. openChange  > 0% (CE) / < 0% (PE)         — still moving in the right direction from open
     *   3. rangePosition > 0.60 (CE) / < 0.40 (PE)   — holding near day's high/low (sustained pressure)
     *   4. dayRangePct > 0.8%                         — stock is actually moving, not drifting sideways
     */
    @Cron('0 */5 9-11 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedGannAngleScan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:20:00' || timeStr > '11:30:00') return;

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gannAngleEnabled) {
            this.logger.warn('Gann Angle Strategy is DISABLED from settings. Skipping levels cache build...');
            return;
        }

        try {
            const stocks = await this.nseService.scanNifty100Quotes();
            const momentumStocks: any[] = [];

            for (const stock of stocks) {
                const ltp       = stock.ltp;
                const prevClose = stock.prevClose || ltp;
                const openPrice = stock.openPrice || ltp;
                const dayHigh   = stock.dayHigh   || ltp;
                const dayLow    = stock.dayLow    || ltp;
                const pChange   = stock.pChange   || 0;

                const openChange     = openPrice > 0 ? ((ltp - openPrice) / openPrice) * 100 : 0;
                const dayRangePct    = prevClose  > 0 ? ((dayHigh - dayLow) / prevClose) * 100 : 0;
                const rangePosition  = (dayHigh - dayLow) > 0 ? (ltp - dayLow) / (dayHigh - dayLow) : 0.5;

                const isCeMomentum = pChange > 1.0 && openChange > 0 && rangePosition > 0.60 && dayRangePct > 0.8;
                const isPeMomentum = pChange < -1.0 && openChange < 0 && rangePosition < 0.40 && dayRangePct > 0.8;

                if (!isCeMomentum && !isPeMomentum) continue;

                const type   = isCeMomentum ? 'CE' : 'PE';
                const levels = this.gannAngleService.calculateAngles(prevClose);
                momentumStocks.push({ symbol: stock.symbol, type, levels });
            }

            // 30-minute TTL — refreshed every 5 min, no need for a longer window
            await this.cacheManager.set('GANN_ANGLE_LEVELS', JSON.stringify(momentumStocks), 1800000);
            this.logger.log(`✅ [${timeStr}] Gann Angle Levels Cache: ${momentumStocks.length}/${stocks.length} high-momentum stocks identified (pChange + openChange + range + volatility filter).`);
        } catch (error) {
            this.logger.error(`Gann Angle Level Cache Build Failed: ${error.message}`);
        }
    }

    /**
     * Gann Angle Level Monitor — Runs every 30 seconds, 9:20–11:30 AM IST (Mon-Fri)
     *
     * Reads the GANN_ANGLE_LEVELS cache (momentum-filtered stocks) and checks if any
     * stock's LTP has FRESHLY crossed its Gann 1x1 angle trigger (within 0.5% above for CE,
     * 0.5% below for PE). When detected, adds to watchlist so the heartbeat can execute
     * immediately (sustainMs = 0 for GANN_ANGLE). This replaces the 5-minute gap with
     * 30-second continuous monitoring using the WS tick cache (zero REST cost).
     */
    @Cron('*/30 * * * * *')
    async monitorGannAngleLevels() {
        if (!this.isMarketHours()) return;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:20:00' || timeStr > '11:30:00') return;

        const cached = await this.cacheManager.get<string>('GANN_ANGLE_LEVELS');
        if (!cached) return;

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gannAngleEnabled) return;

        const momentumStocks: any[] = JSON.parse(cached);
        if (momentumStocks.length === 0) return;

        const todayTraded = await this.paperTrading.getTodayTradedSymbols('GANN_ANGLE');
        const eligibleSymbols = momentumStocks
            .map(s => s.symbol)
            .filter(s => !todayTraded.includes(s));
        if (eligibleSymbols.length === 0) return;

        const ltpMap = await this.nseService.getBatchLTP(eligibleSymbols);

        // Only fire when LTP freshly crosses the trigger — within 0.5% of angle level.
        // Beyond 0.5% means the breakout already happened and entry would be chasing.
        const FRESH_CROSS_PCT = 0.005;

        for (const item of momentumStocks) {
            if (todayTraded.includes(item.symbol)) continue;

            const ltp = ltpMap[item.symbol];
            if (!ltp) continue;

            // Skip if already in watchlist (prevents duplicate entries)
            const existing = await this.cacheManager.get(`WATCHLIST:${item.symbol}`);
            if (existing) continue;

            const levels = item.levels;

            if (item.type === 'CE') {
                // Fresh CE cross: LTP just cleared the 1x1_Up angle, still within 0.5% above it
                const freshCross = ltp >= levels.angle1x1_Up &&
                                   ltp <= levels.angle1x1_Up * (1 + FRESH_CROSS_PCT);
                if (freshCross) {
                    await this.heartbeatService.addToWatchlist(
                        item.symbol, levels.angle1x1_Up, 'CE',
                        levels.angle1x2_Up, levels.angle2x1_Up, 'GANN_ANGLE'
                    );
                    this.logger.log(`📍 [Gann Angle] CE fresh cross: [${item.symbol}] LTP ₹${ltp} at 1x1_Up ₹${levels.angle1x1_Up} → watchlist`);
                }
            } else {
                // Fresh PE cross: LTP just broke below the 1x1_Dn angle, still within 0.5% below it
                const freshCross = ltp <= levels.angle1x1_Dn &&
                                   ltp >= levels.angle1x1_Dn * (1 - FRESH_CROSS_PCT);
                if (freshCross) {
                    await this.heartbeatService.addToWatchlist(
                        item.symbol, levels.angle1x1_Dn, 'PE',
                        levels.angle1x2_Dn, levels.angle2x1_Dn, 'GANN_ANGLE'
                    );
                    this.logger.log(`📍 [Gann Angle] PE fresh cross: [${item.symbol}] LTP ₹${ltp} at 1x1_Dn ₹${levels.angle1x1_Dn} → watchlist`);
                }
            }
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

        // Trade limit is enforced at order placement (placeBuyOrder), not at scan time

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

    private isMarketHours(): boolean {
        const now = new Date();
        const day = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
        if (day === 'Sat' || day === 'Sun') return false;
        const time = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        return time >= '09:00:00' && time <= '15:35:00';
    }

    /**
     * Keep the Scanner Dashboard Top-Right Corner Prices Real-Time!
     */
    @Cron('*/15 * * * * *')
    async syncLiveScannerPrices() {
        if (!this.isMarketHours()) return;
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
