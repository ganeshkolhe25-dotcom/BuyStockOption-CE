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
import { CandleBreakoutService } from './candle-breakout.service';

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
        private readonly prisma: PrismaService,
        private readonly candleBreakout: CandleBreakoutService,
    ) { }

    async onModuleInit() {
        const cached = await this.cacheManager.get<string>('DAILY_SCAN_RESULTS');
        if (!cached) {
            const now = new Date();
            const day = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
            const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
            const isWeekday = day !== 'Sat' && day !== 'Sun';

            // Intelligent Catch-Up: If the user boots the bot up midway through the active trading day,
            // we actively trigger a retroactive scan instead of forcing them to wait 24 hours.
            if (isWeekday && timeStr >= '09:25:00' && timeStr <= '15:15:00') {
                this.logger.warn('Bot started late during active market hours. Triggering catch-up scan now...');
                setTimeout(() => {
                    this.automatedMorningScan();
                }, 5000);
            } else {
                this.logger.log('No cached scan results found on startup. Waiting for 9:25 AM IST to run initial market scan.');
            }
        }
    }

    /**
     * Fully Automated Daily Scan at 9:20 AM IST (Monday - Friday)
     */
    @Cron('25 09 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedMorningScan() {
        this.logger.log('⏰ 9:25 AM Auto-Scan Triggered!');

        const config = await this.prisma.shoonyaConfig.findFirst();

        // ── Gann-9 scan ────────────────────────────────────────────────────────
        if (!config || config.gann9Enabled) {
            try {
                const stocks = await this.nseService.scanGainersLosers();
                const processed = [];

                for (const stock of stocks) {
                    const pctChange = stock.pChange || 0;
                    const prevClose = stock.prevClose || (stock.ltp / (1 + pctChange / 100));
                    const levels = this.gannService.calculateLevels(prevClose);
                    const snapshotStatus = this.gannService.evaluateTradeTriggers(stock.ltp, levels);

                    processed.push({
                        ...stock,
                        openLtp: stock.openPrice || stock.ltp,
                        prevClose,
                        levels,
                        snapshotStatus,
                    });
                }

                await this.cacheManager.set('DAILY_SCAN_RESULTS', JSON.stringify({
                    status: 'success',
                    count: processed.length,
                    data: processed,
                }), 43200000);

                this.logger.log(`✅ Gann-9 Morning Scan Complete. Stored ${processed.length} Nifty 200 Setups.`);

                try {
                    await this.nseService.connectTickFeed();
                    this.nseService.subscribeForLiveFeed(processed.map((s: any) => s.symbol));
                } catch (wsErr: any) {
                    this.logger.warn(`[WS] Tick feed subscription failed — REST fallback active: ${wsErr.message}`);
                }
            } catch (error) {
                this.logger.error(`Gann-9 Morning Scan Failed: ${error.message}`);
            }
        } else {
            this.logger.warn('Gann Square-9 is DISABLED from settings. Skipping Gann-9 scan.');
        }

        // ── 5 EMA morning universe build (runs regardless of Gann-9 toggle) ──
        if (!config || config.ema5Enabled) {
            try {
                const universe = await this.nseService.buildEma5Universe();
                await this.cacheManager.set('EMA5_UNIVERSE', JSON.stringify(universe), 43200000);
                this.logger.log(`✅ 5 EMA Universe cached: ${universe.length} stocks (ADX<25, ATR%>1.5%, RSI extreme).`);

                // Subscribe filtered EMA universe to WS — these are the only stocks
                // the 5-EMA scanner will monitor intraday, keeping total subscriptions < 100
                if (universe.length > 0) {
                    this.nseService.subscribeForLiveFeed(universe);
                    this.logger.log(`[WS] Subscribed ${universe.length} EMA universe stocks to tick feed.`);
                }
            } catch (err: any) {
                this.logger.warn(`[5 EMA] Universe build failed — will fall back to static list: ${err.message}`);
            }
        } else {
            this.logger.warn('5 EMA is DISABLED from settings. Skipping EMA universe build.');
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

                // Price filter: options must be liquid and tradeable
                if (ltp < 500 || ltp > 40000) continue;

                // dayRangePct > 1.2% acts as intraday ATR proxy — confirms the stock
                // has enough expansion to make the 1x1 angle cross profitable
                const isCeMomentum = pChange > 1.0 && openChange > 0 && rangePosition > 0.60 && dayRangePct > 1.2;
                const isPeMomentum = pChange < -1.0 && openChange < 0 && rangePosition < 0.40 && dayRangePct > 1.2;

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
     * Automated 5 EMA PE (Sell) Strategy — 5-min candles, per original strategy video.
     * Only detects PE signals. CE signals come from the separate 15-min cron below.
     * Runs 5 seconds after every 5-minute candle close.
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
            this.logger.debug(`5 EMA PE: Outside active windows (${timeStr}). Skipping.`);
            return;
        }

        this.logger.log(`⏰ ${timeStr} 5 EMA PE Scan (5-min) Triggered!`);

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.ema5Enabled) {
            this.logger.warn('5 EMA Strategy is DISABLED from settings. Skipping...');
            return;
        }

        try {
            const universeStr = await this.cacheManager.get<string>('EMA5_UNIVERSE');
            const universe: string[] | undefined = universeStr ? JSON.parse(universeStr) : undefined;
            if (universe) {
                this.logger.log(`[5 EMA PE] Using morning universe: ${universe.length} ADX-filtered stocks.`);
            } else {
                this.logger.warn('[5 EMA PE] No morning universe cached — falling back to static VOLATILE_NIFTY100 list.');
            }
            const stocks = await this.nseService.scanEma5mUniverse(universe);
            const todayTraded = await this.paperTrading.getTodayTradedSymbols('EMA_5');

            // PE signal detection only (CE handled by 15-min cron)
            let matches = 0;
            for (const stock of stocks) {
                if (todayTraded.includes(stock.symbol)) continue;

                const signal = this.ema5Service.analyzeData(stock);

                if (signal.type === 'PE') {
                    matches++;
                    await this.heartbeatService.addToWatchlist(
                        stock.symbol, signal.entry, 'PE',
                        signal.target, signal.sl, 'EMA_5'
                    );
                }
            }

            // EMA Touch Exit for PE positions: exit when 5-min close crosses above 5 EMA
            const summary = await this.paperTrading.getPortfolioSummary();
            const pePositions = summary.positions.filter(p => p.strategyName === 'EMA_5' && p.type === 'PE');
            let exitFlags = 0;
            for (const pos of pePositions) {
                const stockData = stocks.find(s => s.symbol === pos.symbol);
                if (!stockData) continue;

                const currentEma = this.ema5Service.getCurrentEma(stockData.closes);
                if (!currentEma) continue;

                const lastClose = stockData.closes[stockData.closes.length - 1];
                if (lastClose > currentEma) {
                    exitFlags++;
                    await this.cacheManager.set(`EMA5_EXIT:${pos.symbol}`, '1', 90000);
                    this.logger.warn(`📉 EMA PE EXIT FLAGGED: [${pos.symbol}] Close ₹${lastClose} crossed above 5 EMA ₹${currentEma.toFixed(2)}`);
                }
            }

            this.logger.log(`✅ 5 EMA PE Scan (5-min): ${stocks.length} stocks | ${matches} PE setups | ${exitFlags} exit flags.`);
        } catch (error) {
            this.logger.error(`Automated 5 EMA PE Scan Failed: ${error.message}`);
        }
    }

    /**
     * Automated 5 EMA CE (Buy) Strategy — 15-min candles, per original strategy video.
     * Only detects CE signals. Runs 5 seconds after every 15-min candle close.
     * Active windows: 9:30–11:05 AM and 1:30–3:05 PM IST.
     */
    @Cron('5 */15 9-15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedEma5_15mCeScan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

        const inMorningWindow   = timeStr >= '09:30:00' && timeStr <= '11:05:00';
        const inAfternoonWindow = timeStr >= '13:30:00' && timeStr <= '15:05:00';
        if (!inMorningWindow && !inAfternoonWindow) {
            this.logger.debug(`5 EMA CE: Outside active windows (${timeStr}). Skipping.`);
            return;
        }

        this.logger.log(`⏰ ${timeStr} 5 EMA CE Scan (15-min) Triggered!`);

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.ema5Enabled) return;

        try {
            const universeStr = await this.cacheManager.get<string>('EMA5_UNIVERSE');
            const universe: string[] | undefined = universeStr ? JSON.parse(universeStr) : undefined;
            const stocks = await this.nseService.scanEma5_15mUniverse(universe);
            const todayTraded = await this.paperTrading.getTodayTradedSymbols('EMA_5');

            // CE signal detection only (PE handled by 5-min cron)
            let matches = 0;
            for (const stock of stocks) {
                if (todayTraded.includes(stock.symbol)) continue;

                const signal = this.ema5Service.analyzeData(stock);

                if (signal.type === 'CE') {
                    matches++;
                    await this.heartbeatService.addToWatchlist(
                        stock.symbol, signal.entry, 'CE',
                        signal.target, signal.sl, 'EMA_5'
                    );
                }
            }

            // EMA Touch Exit for CE positions: exit when 15-min close crosses below 5 EMA
            const summary = await this.paperTrading.getPortfolioSummary();
            const cePositions = summary.positions.filter(p => p.strategyName === 'EMA_5' && p.type === 'CE');
            let exitFlags = 0;
            for (const pos of cePositions) {
                const stockData = stocks.find(s => s.symbol === pos.symbol);
                if (!stockData) continue;

                const currentEma = this.ema5Service.getCurrentEma(stockData.closes);
                if (!currentEma) continue;

                const lastClose = stockData.closes[stockData.closes.length - 1];
                if (lastClose < currentEma) {
                    exitFlags++;
                    await this.cacheManager.set(`EMA5_EXIT:${pos.symbol}`, '1', 90000);
                    this.logger.warn(`📈 EMA CE EXIT FLAGGED: [${pos.symbol}] Close ₹${lastClose} crossed below 5 EMA ₹${currentEma.toFixed(2)} (15-min)`);
                }
            }

            this.logger.log(`✅ 5 EMA CE Scan (15-min): ${stocks.length} stocks | ${matches} CE setups | ${exitFlags} exit flags.`);
        } catch (error) {
            this.logger.error(`Automated 5 EMA CE Scan (15-min) Failed: ${error.message}`);
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

    /**
     * Phase 1 — pair detection (every minute, 9:18–9:45 AM IST, Mon-Fri).
     * Fetches 1-min candles and stores the first valid red+green pair as PENDING.
     * Stops scanning once both NIFTY and BANKNIFTY have a setup.
     */
    @Cron('0 * * * * 1-5', { timeZone: 'Asia/Kolkata' })
    async runCandleBreakoutScan() {
        const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:18:00' || timeStr > '09:45:00') return;

        await this.candleBreakout.scanForSetups();
    }

    /**
     * Phase 2 — breakout check (every 15 seconds, 9:18–9:45 AM IST, Mon-Fri).
     * Runs only when at least one PENDING setup exists.
     * Fetches live NIFTY/BANKNIFTY LTP via REST and fires trade if:
     *   LTP > rangeHigh + 5 → CE entry at rangeHigh + 5
     *   LTP < rangeLow  - 5 → PE entry at rangeLow  - 5
     */
    @Cron('*/15 * * * * 1-5', { timeZone: 'Asia/Kolkata' })
    async runCandleBreakoutCheck() {
        const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:18:00' || timeStr > '09:45:00') return;

        // Fast exit if no PENDING setups exist
        const pendingSetups = this.candleBreakout.getSetups().filter(s => s.signal === 'PENDING');
        if (pendingSetups.length === 0) return;

        const ltpMap = await this.candleBreakout.fetchLtpMap();
        const triggered = this.candleBreakout.checkBreakouts(ltpMap);

        for (const setup of triggered) {
            try {
                const todayTraded = await this.paperTrading.getTodayTradedSymbols('CANDLE_BREAKOUT');
                if (todayTraded.includes(setup.symbol)) continue;

                await this.heartbeatService.addToWatchlist(
                    setup.symbol,
                    setup.breakoutPrice!,
                    setup.signal as 'CE' | 'PE',
                    setup.entryTargetPrice!,
                    setup.entrySlPrice!,
                    'CANDLE_BREAKOUT',
                );
            } catch (err: any) {
                this.logger.error(`[2-Candle] Trade execution failed for ${setup.symbol}: ${err.message}`);
            }
        }
    }

    /** EOD cleanup: clear candle setups so they don't carry over to next day */
    @Cron('35 15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    clearCandleBreakoutSetups() {
        this.candleBreakout.clearAll();
    }
}
