import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { NseService, GANN_ANGLE_UNIVERSE } from './nse.service';
import { GannService } from './gann.service';
import { GannAngleService } from './gann-angle.service';
import { Ema5Service } from './ema5.service';
import { HeartbeatService } from './heartbeat.service';
import { PaperTradingService } from './paper.service';
import { PrismaService } from './prisma.service';
import { CandleBreakoutService } from './candle-breakout.service';
import { First5CandleService } from './first5candle.service';

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
        private readonly first5Candle: First5CandleService,
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
     * Gann Angle Warmup — Pre-caches Gann levels for all 51 stocks at 9:20 AM IST (Mon-Fri).
     * Stores computed levels under GANN_ANGLE_LEVELS so the per-minute LTP scan avoids
     * recomputing them on every tick. Uses openPrice for gap-adjusted base if gap ≥ 1%.
     */
    @Cron('20 09 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async warmupGannAngleLevels() {
        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gannAngleEnabled) return;

        try {
            const quotes = await this.nseService.scanGannAngleQuotes();
            const quoteMap = new Map(quotes.map(q => [q.symbol, q]));
            const levelsMap: Record<string, any> = {};

            for (const symbol of GANN_ANGLE_UNIVERSE) {
                const q = quoteMap.get(symbol);
                if (!q || !q.prevClose) continue;

                const levels  = this.gannAngleService.calculateAngles(q.prevClose, q.openPrice);
                const ceInfo  = this.gannAngleService.getEntryLevels(symbol, levels, 'CE');
                const peInfo  = this.gannAngleService.getEntryLevels(symbol, levels, 'PE');

                levelsMap[symbol] = {
                    triggerR:  ceInfo.triggerLevel,
                    upperBand: ceInfo.targetLevel,
                    slCE:      ceInfo.slLevel,
                    triggerS:  peInfo.triggerLevel,
                    lowerBand: peInfo.targetLevel,
                    slPE:      peInfo.slLevel,
                };
            }

            await this.cacheManager.set('GANN_ANGLE_LEVELS', JSON.stringify(levelsMap), 43200000);
            this.logger.log(`✅ [Gann Angle Warmup] Pre-cached levels for ${Object.keys(levelsMap).length} stocks at 9:20 AM.`);
        } catch (error) {
            this.logger.error(`Gann Angle warmup failed: ${error.message}`);
        }
    }

    /**
     * Gann Angle Per-Minute LTP Scan — Nirwana-aligned intracandle trigger detection.
     * Fires at :00 of every minute, 9:30–1:00 PM IST (Mon-Fri).
     *
     * Uses cached Gann levels from GANN_ANGLE_LEVELS (pre-computed at 9:20 AM warmup)
     * and a single batch REST call for all 51 LTPs. Catches angle crossings that occur
     * mid-candle, filling the gap between 5-min candle boundary checks.
     */
    @Cron('0 * 9-14 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async perMinuteGannAngleLtpScan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:30:00' || timeStr > '14:00:00') return;

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gannAngleEnabled) return;

        const tradedCE = await this.paperTrading.getTodayTradedSymbols('GANN_ANGLE', 'CE');
        const tradedPE = await this.paperTrading.getTodayTradedSymbols('GANN_ANGLE', 'PE');

        try {
            // One batch call for live LTPs (also provides prevClose/openPrice for fallback)
            const quotes = await this.nseService.scanGannAngleQuotes();
            const quoteMap = new Map(quotes.map(q => [q.symbol, q]));

            // Use cached Gann levels (warmup at 9:20 AM); fall back to computing inline
            const cachedLevelsStr = await this.cacheManager.get<string>('GANN_ANGLE_LEVELS');
            const cachedLevels: Record<string, any> = cachedLevelsStr ? JSON.parse(cachedLevelsStr) : {};

            let triggered = 0;

            for (const symbol of GANN_ANGLE_UNIVERSE) {
                const ceBlocked = tradedCE.includes(symbol);
                const peBlocked = tradedPE.includes(symbol);
                if (ceBlocked && peBlocked) continue;

                const inQueue = await this.cacheManager.get(`WATCHLIST:${symbol}`);
                if (inQueue) continue;

                const q = quoteMap.get(symbol);
                if (!q || !q.ltp) continue;

                let triggerR: number, upperBand: number, slCE: number;
                let triggerS: number, lowerBand: number, slPE: number;

                if (cachedLevels[symbol]) {
                    ({ triggerR, upperBand, slCE, triggerS, lowerBand, slPE } = cachedLevels[symbol]);
                } else if (q.prevClose) {
                    const levels = this.gannAngleService.calculateAngles(q.prevClose, q.openPrice);
                    const ceInfo = this.gannAngleService.getEntryLevels(symbol, levels, 'CE');
                    const peInfo = this.gannAngleService.getEntryLevels(symbol, levels, 'PE');
                    triggerR = ceInfo.triggerLevel; upperBand = ceInfo.targetLevel; slCE = ceInfo.slLevel;
                    triggerS = peInfo.triggerLevel; lowerBand = peInfo.targetLevel; slPE = peInfo.slLevel;
                } else {
                    continue;
                }

                const ltp = q.ltp;

                if (!ceBlocked && ltp > triggerR && ltp < upperBand) {
                    await this.heartbeatService.addToWatchlist(symbol, triggerR, 'CE', upperBand, slCE, 'GANN_ANGLE');
                    this.logger.log(`📈 [Gann Angle LTP] CE: [${symbol}] LTP ₹${ltp} > R_90 ₹${triggerR.toFixed(2)} | Target R_135 ₹${upperBand.toFixed(2)} → 3-min confirmation`);
                    triggered++;
                }

                if (!peBlocked && ltp < triggerS && ltp > lowerBand) {
                    await this.heartbeatService.addToWatchlist(symbol, triggerS, 'PE', lowerBand, slPE, 'GANN_ANGLE');
                    this.logger.log(`📉 [Gann Angle LTP] PE: [${symbol}] LTP ₹${ltp} < S_90 ₹${triggerS.toFixed(2)} | Target S_135 ₹${lowerBand.toFixed(2)} → 3-min confirmation`);
                    triggered++;
                }
            }

            if (triggered > 0) {
                this.logger.log(`[${timeStr}] Gann Angle per-min LTP scan: ${triggered} new signal(s).`);
            }
        } catch (error) {
            this.logger.error(`Gann Angle per-min LTP scan failed: ${error.message}`);
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
     * Gann Angle 5-min Candle Close Scanner — Nirwana-aligned.
     * Runs every 5 minutes at 9:30–12:45 PM IST (Mon-Fri).
     *
     * For each of the 51 Nirwana stocks:
     *   1. Fetch last completed 5-min candle close.
     *   2. Compute Gann levels (prevClose / openPrice gap-adjusted).
     *   3. CE: candle close > R_90 (and < R_135 — upper band rejection) → 3-min confirmation queue.
     *      PE: candle close < S_90 (and > S_135) → 3-min confirmation queue.
     * No LTP-based pre-filter. No rangePosition / dayRangePct filter.
     * Target and SL are NOT passed here — they are computed from option premium at execution.
     */
    @Cron('5 */5 9-14 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedGannAngleScan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:30:00' || timeStr > '14:00:00') return;

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (config && !config.gannAngleEnabled) {
            this.logger.warn('Gann Angle Strategy is DISABLED. Skipping 5-min candle scan.');
            return;
        }

        // CE and PE tracked independently — a CE trade does NOT block a later PE signal
        const tradedCE = await this.paperTrading.getTodayTradedSymbols('GANN_ANGLE', 'CE');
        const tradedPE = await this.paperTrading.getTodayTradedSymbols('GANN_ANGLE', 'PE');

        let triggered = 0;
        let checked = 0;

        try {
            // One batch call gets prevClose + openPrice for all 51 stocks
            const quotes = await this.nseService.scanGannAngleQuotes();
            const quoteMap = new Map(quotes.map(q => [q.symbol, q]));

            for (const symbol of GANN_ANGLE_UNIVERSE) {
                const ceBlocked = tradedCE.includes(symbol);
                const peBlocked = tradedPE.includes(symbol);
                if (ceBlocked && peBlocked) continue; // both directions done for today

                // Skip if already in the 3-min confirmation queue
                const inQueue = await this.cacheManager.get(`WATCHLIST:${symbol}`);
                if (inQueue) continue;

                const q = quoteMap.get(symbol);
                if (!q || !q.prevClose) continue;

                // Compute Gann levels for this stock
                const levels = this.gannAngleService.calculateAngles(q.prevClose, q.openPrice);
                const entryInfo = this.gannAngleService.getEntryLevels(symbol, levels, 'CE');
                const triggerR  = entryInfo.triggerLevel;
                const upperBand = entryInfo.targetLevel;

                const peInfo    = this.gannAngleService.getEntryLevels(symbol, levels, 'PE');
                const triggerS  = peInfo.triggerLevel;
                const lowerBand = peInfo.targetLevel;

                // Fetch last completed 5-min candle close
                const candleClose = await this.nseService.getLastCandleClose(symbol, '5');
                checked++;
                if (!candleClose) continue;

                // CE trigger: 5-min close crossed above trigger angle, below upper band
                if (!ceBlocked && candleClose > triggerR && candleClose < upperBand) {
                    await this.heartbeatService.addToWatchlist(symbol, triggerR, 'CE', upperBand, entryInfo.slLevel, 'GANN_ANGLE');
                    this.logger.log(
                        `📈 [Gann Angle] CE: [${symbol}] 5m close ₹${candleClose} > R_${entryInfo.angle} ₹${triggerR.toFixed(2)} | Target R_135 ₹${upperBand.toFixed(2)} → 3-min confirmation`
                    );
                    triggered++;
                }

                // PE trigger: independent check — a CE trade earlier today does NOT block this
                if (!peBlocked && candleClose < triggerS && candleClose > lowerBand) {
                    await this.heartbeatService.addToWatchlist(symbol, triggerS, 'PE', lowerBand, peInfo.slLevel, 'GANN_ANGLE');
                    this.logger.log(
                        `📉 [Gann Angle] PE: [${symbol}] 5m close ₹${candleClose} < S_${peInfo.angle} ₹${triggerS.toFixed(2)} | Target S_135 ₹${lowerBand.toFixed(2)} → 3-min confirmation`
                    );
                    triggered++;
                }

                // Small delay to respect Shoonya rate limits on per-stock candle calls
                await new Promise(res => setTimeout(res, 120));
            }

            this.logger.log(`✅ [${timeStr}] Gann Angle 5-min scan: ${checked}/${GANN_ANGLE_UNIVERSE.length} checked | ${triggered} triggered.`);
        } catch (error) {
            this.logger.error(`Gann Angle 5-min Scan Failed: ${error.message}`);
        }
    }

    /**
     * Automated 5 EMA PE (Sell) Strategy — 5-min candles, per original strategy video.
     * Only detects PE signals. CE signals come from the separate 15-min cron below.
     * Runs 5 seconds after every 5-minute candle close.
     * Runs full session (9:15 AM – 3:15 PM) — no mid-day window restriction.
     */
    @Cron('5 */5 9-15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedEma5Scan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:15:00' || timeStr > '15:15:00') return;

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
            const tradedPE = await this.paperTrading.getTodayTradedSymbols('EMA_5', 'PE');

            // PE signal detection only (CE handled by 15-min cron)
            let matches = 0;
            for (const stock of stocks) {
                if (tradedPE.includes(stock.symbol)) continue;

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
            const tradedCE = await this.paperTrading.getTodayTradedSymbols('EMA_5', 'CE');

            // CE signal detection only (PE handled by 5-min cron)
            let matches = 0;
            for (const stock of stocks) {
                if (tradedCE.includes(stock.symbol)) continue;

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
     * Phase 2 — candle-close breakout check (every 5 seconds, 9:18–9:45 AM IST, Mon-Fri).
     * Runs only when at least one PENDING setup exists.
     * Fetches the most recently completed 1-min candle and fires trade only if its
     * CLOSE is outside the range (not a wick spike):
     *   close > rangeHigh → CE entry
     *   close < rangeLow  → PE entry
     */
    @Cron('*/5 * * * * 1-5', { timeZone: 'Asia/Kolkata' })
    async runCandleBreakoutCheck() {
        const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:18:00' || timeStr > '09:45:00') return;

        // Fast exit if no PENDING setups exist
        const pendingSetups = this.candleBreakout.getSetups().filter(s => s.signal === 'PENDING');
        if (pendingSetups.length === 0) return;

        const triggered = await this.candleBreakout.checkBreakouts();

        for (const setup of triggered) {
            try {
                const todayTraded = await this.paperTrading.getTodayTradedSymbols('CANDLE_BREAKOUT');
                if (todayTraded.includes(setup.symbol)) continue;

                // breakoutPrice = close of the confirmation candle = our spot entry reference
                await this.heartbeatService.executeCandleBreakoutDirectly(
                    setup.symbol,
                    setup.breakoutPrice!,
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

    /**
     * First 5-Candle Rolling ORB — fires 5 sec after every 5-min candle close.
     * Active window: 9:40 AM – 12:30 PM IST (Mon-Fri).
     *
     * Rolling window: at each fire, uses the last 5 completed candles as the range
     * and the most recently closed candle as the breakout-check candle.
     * Max 5 trades per symbol per day (any direction). Direction of previous trades
     * is irrelevant — every signal is taken independently until the daily limit is hit.
     */
    @Cron('5 */5 9-12 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async automatedFirst5CandleScan() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:40:00' || timeStr > '12:30:00') return;

        for (const inst of this.first5Candle.getInstruments()) {
            try {
                const signal = await this.first5Candle.scanForBreakout(inst.symbol, inst.token);

                if (signal) {
                    const state = this.first5Candle.getStates().find(s => s.symbol === inst.symbol);
                    const spotLtp = state?.activationCandle?.close ?? 0;
                    if (spotLtp > 0) {
                        await this.heartbeatService.executeFirst5CandleDirectly(inst.symbol, spotLtp, signal);
                        this.first5Candle.markTraded(inst.symbol);
                        const updatedCount = this.first5Candle.getStates().find(s => s.symbol === inst.symbol)?.tradeCount ?? 1;
                        this.logger.log(`✅ [ORB5] ${signal} trade #${updatedCount}/5 placed for ${inst.symbol} at ₹${spotLtp}`);
                    }
                }
            } catch (err: any) {
                this.logger.error(`[ORB5] ${inst.symbol} scan failed: ${err.message}`);
            }
        }
    }

    /** EOD cleanup: clear candle setups so they don't carry over to next day */
    @Cron('35 15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    clearCandleBreakoutSetups() {
        this.candleBreakout.clearAll();
        this.first5Candle.clearAll();
    }
}
