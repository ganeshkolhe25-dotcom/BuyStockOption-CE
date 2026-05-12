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
                this.logger.log(`✅ 5 EMA Universe cached: ${universe.length} stocks (ADX<30, ATR%>1.5%, RSI extreme).`);

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
     * Gann-9 Dynamic Universe Refresh — Runs every 10 minutes, 9:35 AM–2:30 PM IST (Mon-Fri).
     *
     * The 9:25 AM scan only captures stocks that had >= 0.5% pChange at that moment.
     * Stocks that break out later in the day are missed entirely.
     * This refresh re-scans the same CUSTOM_TRADING_UNIVERSE and adds any new movers
     * that were not present in the initial universe — without overwriting existing entries
     * (Gann levels are computed from prevClose which is static for the day).
     */
    @Cron('0 */10 9-14 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async refreshGann9Universe() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        // Skip the 9:25 AM initial scan window; also stop by 2:30 PM (too late to enter new trades)
        if (timeStr < '09:35:00' || timeStr > '14:30:00') return;

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gann9Enabled) return;

        const cachedStr = await this.cacheManager.get<string>('DAILY_SCAN_RESULTS');
        if (!cachedStr) return; // No initial scan yet — skip

        const scan = JSON.parse(cachedStr);
        const existingSymbols = new Set<string>((scan.data || []).map((s: any) => s.symbol));

        try {
            const freshStocks = await this.nseService.scanGainersLosers();
            const newEntries: any[] = [];

            for (const stock of freshStocks) {
                if (existingSymbols.has(stock.symbol)) continue; // Already tracked — skip

                const prevClose = stock.prevClose || stock.ltp;
                const levels = this.gannService.calculateLevels(prevClose);
                const snapshotStatus = this.gannService.evaluateTradeTriggers(stock.ltp, levels);

                newEntries.push({
                    ...stock,
                    openLtp: stock.openPrice || stock.ltp,
                    prevClose,
                    levels,
                    snapshotStatus,
                });
            }

            if (newEntries.length === 0) {
                this.logger.log(`[Gann-9 Refresh] ${timeStr} — No new movers. All qualifying stocks already tracked (${existingSymbols.size} in universe).`);
                return;
            }

            const merged = [...(scan.data || []), ...newEntries];
            await this.cacheManager.set('DAILY_SCAN_RESULTS', JSON.stringify({
                status: 'success',
                count: merged.length,
                data: merged,
            }), 43200000);

            const newNames = newEntries.map(s => `${s.symbol} ${s.pChange >= 0 ? '+' : ''}${s.pChange.toFixed(1)}%`).join(', ');
            this.logger.log(`[Gann-9 Refresh] ${timeStr} — +${newEntries.length} new stocks added: [${newNames}] | Total universe: ${merged.length}`);
        } catch (err: any) {
            this.logger.error(`[Gann-9 Refresh] Failed: ${err.message}`);
        }
    }

    /**
     * 5 EMA Dynamic Universe Refresh — Runs every 10 minutes, 9:35 AM–2:30 PM IST (Mon-Fri).
     *
     * The 9:25 AM scan only captures stocks whose ADX/ATR/RSI qualifies at that moment.
     * Stocks that become overstretched (RSI extreme) or rangebound later in the day are missed.
     * This refresh re-runs buildEma5Universe() and merges any new qualifying stocks
     * into EMA5_UNIVERSE without overwriting existing entries.
     */
    @Cron('0 */15 9-14 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async refreshEma5Universe() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:35:00' || timeStr > '14:30:00') return;

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.ema5Enabled) return;

        const cachedStr = await this.cacheManager.get<string>('EMA5_UNIVERSE');
        if (!cachedStr) return; // No initial scan yet — skip

        const existing: string[] = JSON.parse(cachedStr);
        const existingSet = new Set<string>(existing);

        try {
            const fresh = await this.nseService.buildEma5Universe();
            const newSymbols = fresh.filter(sym => !existingSet.has(sym));

            if (newSymbols.length === 0) {
                this.logger.log(`[5 EMA Refresh] ${timeStr} — No new qualifying stocks. Universe unchanged (${existing.length} stocks).`);
                return;
            }

            const merged = [...existing, ...newSymbols];
            await this.cacheManager.set('EMA5_UNIVERSE', JSON.stringify(merged), 43200000);

            this.nseService.subscribeForLiveFeed(newSymbols);

            this.logger.log(`[5 EMA Refresh] ${timeStr} — +${newSymbols.length} new stocks added: [${newSymbols.join(', ')}] | Total universe: ${merged.length}`);
        } catch (err: any) {
            this.logger.error(`[5 EMA Refresh] Failed: ${err.message}`);
        }
    }

    /**
     * Gann Angle Momentum Cache Builder — Runs every 5 minutes, 9:30–12:45 PM IST (Mon-Fri)
     *
     * Fetches all Nifty 100 stocks, applies a 2-factor filter, computes Gann Angle
     * levels for qualifying stocks, and stores them in GANN_ANGLE_LEVELS cache.
     * The separate 30-second monitorGannAngleLevels cron reads this cache and detects
     * angle crossings.
     *
     * Filter (derived from the single getMultiQuotes batch call):
     *   1. rangePosition > 0.60 (CE) / < 0.40 (PE) — holding near day's high/low
     *   2. dayRangePct > 1.2%                       — meaningful intraday expansion
     */
    @Cron('0 */5 9-12 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedGannAngleScan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:30:00' || timeStr > '12:45:00') return;

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gannAngleEnabled) {
            this.logger.warn('Gann Angle Strategy is DISABLED from settings. Skipping levels cache build...');
            return;
        }

        try {
            const stocks = await this.nseService.scanNifty100Quotes();
            const momentumStocks: any[] = [];

            for (const stock of stocks) {
                const ltp = stock.ltp;
                const prevClose = stock.prevClose || ltp;
                const dayHigh = stock.dayHigh || ltp;
                const dayLow = stock.dayLow || ltp;

                const dayRangePct = prevClose > 0 ? ((dayHigh - dayLow) / prevClose) * 100 : 0;
                const rangePosition = (dayHigh - dayLow) > 0 ? (ltp - dayLow) / (dayHigh - dayLow) : 0.5;

                const isCeMomentum = rangePosition > 0.60 && dayRangePct > 1.2;
                const isPeMomentum = rangePosition < 0.40 && dayRangePct > 1.2;

                if (!isCeMomentum && !isPeMomentum) continue;

                const type = isCeMomentum ? 'CE' : 'PE';
                const levels = this.gannAngleService.calculateAngles(prevClose, stock.openPrice);
                momentumStocks.push({ symbol: stock.symbol, type, levels });
            }

            await this.cacheManager.set('GANN_ANGLE_LEVELS', JSON.stringify(momentumStocks), 1800000);
            this.logger.log(`✅ [${timeStr}] Gann Angle Levels Cache: ${momentumStocks.length}/${stocks.length} stocks qualified (range position + day range filter).`);
        } catch (error) {
            this.logger.error(`Gann Angle Level Cache Build Failed: ${error.message}`);
        }
    }

    /**
     * Gann Angle Level Monitor — Runs every 30 seconds, 9:30–12:45 PM IST (Mon-Fri)
     *
     * Reads the GANN_ANGLE_LEVELS cache and detects R_90 / S_90 angle crossings.
     * Adds qualifying stocks to the watchlist for 5-min candle close confirmation.
     * CE: triggers at R_90, target R_135, SL R_67.5. Rejects if LTP ≥ R_135 (too late).
     * PE: triggers at S_90, target S_135, SL S_67.5. Rejects if LTP ≤ S_135 (too deep).
     */
    @Cron('*/30 * * * * *')
    async monitorGannAngleLevels() {
        if (!this.isMarketHours()) return;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:30:00' || timeStr > '12:45:00') return;

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

        for (const item of momentumStocks) {
            if (todayTraded.includes(item.symbol)) continue;

            const ltp = ltpMap[item.symbol];
            if (!ltp) continue;

            const levels = item.levels;

            if (item.type === 'CE') {
                if (ltp >= levels.R_90) {
                    if (ltp >= levels.R_135) {
                        // Upper band rejection: price already at/above target — risk too high
                        this.logger.debug(`[Gann Angle] CE SKIP: [${item.symbol}] LTP ₹${ltp} ≥ R_135 ₹${levels.R_135} — upper band, risk too high`);
                    } else {
                        await this.heartbeatService.addToWatchlist(
                            item.symbol, levels.R_90, 'CE',
                            levels.R_135, levels.R_67_5, 'GANN_ANGLE'
                        );
                        this.logger.log(`📍 [Gann Angle] CE cross R_90: [${item.symbol}] LTP ₹${ltp} ≥ R_90 ₹${levels.R_90} → watchlist (T:₹${levels.R_135} SL:₹${levels.R_67_5})`);
                    }
                }
            } else {
                if (ltp <= levels.S_90) {
                    if (ltp <= levels.S_135) {
                        // Lower band rejection: price already at/below target — risk too high
                        this.logger.debug(`[Gann Angle] PE SKIP: [${item.symbol}] LTP ₹${ltp} ≤ S_135 ₹${levels.S_135} — lower band, risk too high`);
                    } else {
                        await this.heartbeatService.addToWatchlist(
                            item.symbol, levels.S_90, 'PE',
                            levels.S_135, levels.S_67_5, 'GANN_ANGLE'
                        );
                        this.logger.log(`📍 [Gann Angle] PE cross S_90: [${item.symbol}] LTP ₹${ltp} ≤ S_90 ₹${levels.S_90} → watchlist (T:₹${levels.S_135} SL:₹${levels.S_67_5})`);
                    }
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

        // Active session windows only — skip mid-day chop (11:30 AM – 1:30 PM)
        const inMorningWindow = timeStr >= '09:30:00' && timeStr <= '11:30:00';
        const inAfternoonWindow = timeStr >= '13:30:00' && timeStr <= '15:15:00';
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
     * Active windows: 9:30–11:30 AM and 1:30–3:15 PM IST.
     */
    @Cron('5 */15 9-15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedEma5_15mCeScan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

        // Time window restriction removed — CE scan now runs full session like PE scan (9:15–3:15 PM).
        // Previous morning/afternoon windows (9:30–11:30, 13:30–15:15) were blocking valid setups.
        if (timeStr < '09:15:00' || timeStr > '15:15:00') return;

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
     * Phase 2 — breakout check (every 5 seconds, 9:18–9:45 AM IST, Mon-Fri).
     * Runs only when at least one PENDING setup exists.
     * Fetches live NIFTY/BANKNIFTY LTP via REST and fires trade if:
     *   LTP > rangeHigh + 1 → CE entry (direct buy, no watchlist delay)
     *   LTP < rangeLow  - 1 → PE entry (direct buy, no watchlist delay)
     */
    @Cron('*/5 * * * * 1-5', { timeZone: 'Asia/Kolkata' })
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

                const ltp = ltpMap[setup.symbol] ?? setup.breakoutPrice!;
                await this.heartbeatService.executeCandleBreakoutDirectly(
                    setup.symbol,
                    ltp,
                    setup.signal as 'CE' | 'PE',
                    setup.entryTargetPrice!,
                    setup.entrySlPrice!,
                    setup.breakoutPrice!,
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
