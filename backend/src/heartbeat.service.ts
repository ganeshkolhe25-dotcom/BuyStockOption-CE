import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { NseService } from './nse.service';
import { ShoonyaService } from './shoonya.service';
import { PaperTradingService } from './paper.service';


export interface WatchlistEntry {
    symbol: string;
    triggerPrice: number;
    breakoutTime: number; // Timestamp of when the R1/S1 was first crossed
    type: 'CE' | 'PE';
    targetPrice: number;
    slPrice: number;
    strategyName?: string;
}

export interface PendingLimitOrder {
    symbol: string;
    token: string;
    tradingSymbol: string;
    type: 'CE' | 'PE';
    qty: number;
    midPrice: number;
    orderType: 'BUY' | 'SELL';
    placedAt: number;
    targetPrice?: number;
    slPrice?: number;
    strategyName: string;
    exitReason?: string;
}

@Injectable()
export class HeartbeatService {
    private readonly logger = new Logger(HeartbeatService.name);
    // Use NestJS built-in memory cache to replace external Redis for local evaluation

    private dailyTradesCount = 0;
    private lastHeartbeatTime = new Date().toISOString();
    private pendingLimitOrders = new Map<string, PendingLimitOrder>();

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private readonly nseService: NseService,
        private readonly shoonyaService: ShoonyaService,
        private readonly paperTrading: PaperTradingService
    ) {
        this.logger.log('Sustain Engine Initialized. Heartbeat Worker waiting...');
    }

    getEngineStats() {
        return {
            tradesCount: this.dailyTradesCount,
            lastHeartbeat: this.lastHeartbeatTime
        };
    }

    /**
     * Add a stock to the active Breakout Watchlist
     * Starts the 5-minute countdown for sustainment checks.
     */
    async addToWatchlist(symbol: string, triggerPrice: number, type: 'CE' | 'PE', targetPrice: number, slPrice: number, strategyName: string = 'GANN_9') {
        // NOTE: Do NOT check trade limits here — watchlist is observation only.
        // The limit is enforced at order placement time in executeOptionTrade().
        const key = `WATCHLIST:${symbol}`;
        const existing = await this.cacheManager.get(key);

        if (existing) {
            this.logger.debug(`[${symbol}] Already in Watchlist. Waiting for 5m Sustain.`);
            return;
        }

        const entry: WatchlistEntry = {
            symbol,
            triggerPrice,
            breakoutTime: Date.now(),
            type,
            targetPrice,
            slPrice,
            strategyName
        };

        // Store with a TTL of 1 hour (3600000 ms in cache-manager)
        await this.cacheManager.set(key, JSON.stringify(entry), 3600000);

        // Update the key array so the Heartbeat Worker finds it
        let activeKeysStr = await this.cacheManager.get<string>('WATCHLIST_KEYS');
        let keys: string[] = activeKeysStr ? JSON.parse(activeKeysStr) : [];
        if (!keys.includes(key)) {
            keys.push(key);
            await this.cacheManager.set('WATCHLIST_KEYS', JSON.stringify(keys), 3600000);
        }

        this.logger.log(`🚨 BREAKOUT DETECTED: [${symbol}] crossed ${type} trigger ₹${triggerPrice}. Added to 5-Min Sustain Watchlist!`);
    }

    /**
     * The Heartbeat Worker - Runs automatically every 30 Seconds
     * Iterates through the active watchlist, validates Live LTP, 
     * and executes trades if 5 uninterrupted minutes have passed.
     */
    @Cron(CronExpression.EVERY_30_SECONDS)
    async processHeartbeatWatchlist() {
        if (!this.isMarketHours()) return;
        // NOTE: Do NOT gate on trade limits here — we still want to sustain-check and
        // show entries in the watchlist UI even when the daily limit is reached.
        // The limit is enforced inside executeOptionTrade() at actual order placement.
        try {
            // Memory Cache Manager doesn't natively expose 'keys()' in recent versions easily
            // For the purpose of tracking the watchlist, we iterate through an index list or we can just fetch known keys.
            // Let's implement a secondary key for the active list.
            let activeKeysStr = await this.cacheManager.get<string>('WATCHLIST_KEYS');
            let keys: string[] = activeKeysStr ? JSON.parse(activeKeysStr) : [];

            if (keys.length === 0) return;

            this.lastHeartbeatTime = new Date().toISOString();
            this.logger.debug(`[Heartbeat Worker] Validating ${keys.length} Active Breakout(s)...`);

            // Parse all entries first, then fetch all LTPs in a single batch call
            // (avoids N individual REST calls that hit Shoonya rate limits / 504s)
            const entries: { key: string; entry: WatchlistEntry }[] = [];
            for (const key of keys) {
                const raw = await this.cacheManager.get<string>(key);
                if (raw) entries.push({ key, entry: JSON.parse(raw) });
            }

            const symbols = entries.map(e => e.entry.symbol);
            const ltpMap = symbols.length > 0 ? await this.nseService.getBatchLTP(symbols) : {};

            let updatedKeys = [...keys];

            for (const { key, entry } of entries) {
                const ltp = ltpMap[entry.symbol];
                if (!ltp) {
                    this.logger.warn(`Could not fetch Live LTP for ${entry.symbol}. Skipping this cycle.`);
                    continue;
                }

                // EMA_5 uses a wider 0.3% buffer (pullback after crossover is normal)
                // Gann strategies use tight 0.05% buffer
                const isEma = entry.strategyName === 'EMA_5';
                const isGannAngle = entry.strategyName === 'GANN_ANGLE';
                const bufferPct = isEma ? 0.003 : 0.0005;
                const buffer = entry.triggerPrice * bufferPct;

                let isSustaining = false;
                if (entry.type === 'CE') {
                    isSustaining = ltp >= (entry.triggerPrice - buffer);
                } else {
                    isSustaining = ltp <= (entry.triggerPrice + buffer);
                }

                if (!isSustaining) {
                    const invalidMsg = `Signal Invalidated: LTP ₹${ltp} moved away from ${entry.type} trigger ₹${entry.triggerPrice} during sustain period.`;
                    this.logger.warn(`❌ [${entry.symbol}] ${invalidMsg}`);
                    await this.paperTrading.logFailedTrade(entry.symbol, entry.type, entry.triggerPrice, invalidMsg, entry.strategyName);
                    await this.cacheManager.del(key);
                    updatedKeys = updatedKeys.filter(k => k !== key);
                    continue;
                }

                // GANN_ANGLE: execute immediately — the 5-min scan interval itself is the confirmation
                // EMA_5: 1-minute sustain (candle close + RSI + volume already confirms)
                // GANN_9: 5-minute sustain (breakout level needs momentum confirmation)
                const sustainMs = isGannAngle ? 0 : isEma ? 1 * 60 * 1000 : 5 * 60 * 1000;
                const timeElapsedMs = Date.now() - entry.breakoutTime;

                if (timeElapsedMs >= sustainMs) {
                    const label = isGannAngle ? 'IMMEDIATE' : isEma ? '1-MIN' : '5-MIN';
                    this.logger.log(`🚀 ${label} SIGNAL CONFIRMED FOR [${entry.symbol}] AT ₹${ltp}! Triggering ${entry.type} Option Entry.`);

                    // Remove from watchlist so we don't buy it twice
                    await this.cacheManager.del(key);
                    updatedKeys = updatedKeys.filter(k => k !== key);

                    // Proceed to Phase 3: Dynamic Option Selection & Shoonya Execution
                    // We specifically pass `ltp` (Live Market Price) instead of the static initial trigger price
                    await this.executeOptionTrade(entry.symbol, ltp, entry.type, entry.targetPrice, entry.slPrice, entry.strategyName);
                } else {
                    const minsLeft = ((sustainMs - timeElapsedMs) / 60000).toFixed(1);
                    this.logger.debug(`[${entry.symbol}] Sustaining smoothly at ₹${ltp}. T-Minus ${minsLeft} minutes to Target Execution.`);
                }
            }

            // Re-sync Active keys list
            await this.cacheManager.set('WATCHLIST_KEYS', JSON.stringify(updatedKeys), 3600000);

        } catch (error) {
            this.logger.error(`Heartbeat Worker Encountered Error: ${error.message}`);
        }
    }

    /**
     * Pipeline the Verified setup directly to the Broker Module
     */
    private async executeOptionTrade(symbol: string, cmp: number, type: 'CE' | 'PE', targetPrice: number, slPrice: number, strategyName: string = 'GANN_9') {
        try {
            let contract = null;
            let attempts = 0;

            const preferITM = strategyName === 'EMA_5'; // ITM = better Delta + less decay for mean-reversion
            while (!contract && attempts < 3) {
                contract = await this.shoonyaService.findAtmOption(symbol, cmp, type, preferITM);
                if (!contract) {
                    attempts++;
                    if (attempts < 3) {
                        this.logger.warn(`Shoonya Option Chain failed for ${symbol}. Retrying attempt ${attempts + 1}/3...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }

            if (!contract) {
                await this.paperTrading.logFailedTrade(symbol, type, cmp, 'Shoonya API Failure: Could not resolve Option Token after 3 attempts.');
                return;
            }

            // Try to immediately secure the real Live Option Premium directly from Shoonya API
            const optionPremiumInfo = await this.shoonyaService.getOptionQuote(contract.token);

            if (!optionPremiumInfo || optionPremiumInfo.askPrice === 0) {
                await this.paperTrading.logFailedTrade(symbol, type, cmp, `Shoonya API Failure: Live premium query failed for ${contract.token}.`);
                return;
            }

            // GANN_ANGLE: place a limit buy order at mid price (bid+ask)/2
            // Actual fill is checked every 15s for up to 2 minutes, then discarded if unfilled
            if (strategyName === 'GANN_ANGLE') {
                const midPrice = parseFloat(((optionPremiumInfo.bidPrice + optionPremiumInfo.askPrice) / 2).toFixed(2));
                const lotValue = contract.lotSize * midPrice;
                if (lotValue > 40000) {
                    const failMsg = `STRATEGY REJECT: Lot Value ₹${lotValue.toFixed(2)} exceeds ₹40,000 limit. (Mid: ₹${midPrice}, Qty: ${contract.lotSize})`;
                    await this.paperTrading.logFailedTrade(symbol, type, cmp, failMsg);
                    this.logger.warn(failMsg);
                    return;
                }
                const orderKey = `BUY:${contract.token}`;
                if (!this.pendingLimitOrders.has(orderKey)) {
                    this.pendingLimitOrders.set(orderKey, {
                        symbol, token: contract.token, tradingSymbol: contract.tradingSymbol,
                        type, qty: contract.lotSize, midPrice, orderType: 'BUY',
                        placedAt: Date.now(), targetPrice, slPrice, strategyName
                    });
                    this.logger.log(`📋 GANN_ANGLE LIMIT BUY: [${symbol}] ${type} at mid ₹${midPrice} (bid ₹${optionPremiumInfo.bidPrice} / ask ₹${optionPremiumInfo.askPrice}). 2-min fill window.`);
                }
                return;
            }

            // GANN_9 / EMA_5: execute immediately at Ask Price (existing behaviour)
            // 🛑 Lot Price Constraint: Total Investment (Qty * Price) must be <= 40,000
            const lotValue = contract.lotSize * optionPremiumInfo.askPrice;
            if (lotValue > 40000) {
                const failMsg = `STRATEGY REJECT: Lot Value ₹${lotValue.toFixed(2)} exceeds ₹40,000 limit. (Price: ₹${optionPremiumInfo.askPrice}, Qty: ${contract.lotSize})`;
                await this.paperTrading.logFailedTrade(symbol, type, cmp, failMsg);
                this.logger.warn(failMsg);
                return;
            }

            const isSettled = await this.paperTrading.placeBuyOrder(
                symbol,
                contract.token,
                contract.tradingSymbol,
                type,
                contract.lotSize,
                optionPremiumInfo.askPrice,
                targetPrice,
                slPrice,
                strategyName
            );

            if (isSettled) {
                this.dailyTradesCount++;
                this.logger.log(`✅ PAPER TRADE SUCCESS: [${symbol}] ${type} Bought at ₹${optionPremiumInfo.askPrice} (Ask Price)`);
            }

            // The periodic Universal Monitor handles exits

        } catch (e) {
            this.logger.error(`Paper Trade Execution Failed for [${symbol}]: ${e.message}`);
        }
    }

    /**
     * Check the cached 9:20 AM Setup List 5 seconds after each 5-minute candle close.
     * Fires at 9:00:05, 9:05:05 … 14:55:05, 15:00:05 IST (Mon-Fri).
     * Checking at candle close boundaries means the LTP we compare against each trigger
     * is the just-closed candle's close price — preventing wick-induced false signals.
     */
    @Cron('5 */5 9-15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async continuousDailyScanMonitor() {
        // NOTE: Scanning always runs regardless of trade limits — stocks should appear
        // in the watchlist even if the daily trade limit is reached. The limit is only
        // enforced at order placement in executeOptionTrade().

        // Respect the gann9Enabled toggle — if disabled mid-day, stop scanning immediately
        const config = await this.paperTrading.getStrategyConfig();
        if (config && !config.gann9Enabled) {
            this.logger.debug('Gann Square-9 is DISABLED from settings. Skipping continuous scan.');
            return;
        }

        // Stop all new scanning after 2:45 PM
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr > '14:45:00') return;

        const cachedStr = await this.cacheManager.get<string>('DAILY_SCAN_RESULTS');
        if (!cachedStr) return;

        const scan = JSON.parse(cachedStr);
        if (!scan.data || scan.data.length === 0) return;

        // Skip those we already traded today (Only ONE entry per stock per day allowed)
        const todayTraded = await this.paperTrading.getTodayTradedSymbols('GANN_9');

        for (const stock of scan.data) {
            if (todayTraded.includes(stock.symbol)) continue;

            const ltp = await this.nseService.getLiveLTP(stock.symbol);
            if (!ltp) continue;

            const levels = stock.levels;
            const openLtp = stock.openLtp;
            let ceTrigger = null;
            let peTrigger = null;
            let target = 0;
            let sl = 0;
            let tradeType: 'CE' | 'PE' | null = null;

            // We only want to add it to the Watchlist if it is *currently crossing* the trigger.
            // 0.30% tolerance: at ₹2000 this = ₹6 buffer. Tighter than 0.80% to avoid premature entries.
            const isCrossing = (price: number, trigger: number) => Math.abs((price - trigger) / trigger) * 100 < 0.30;

            // 1. GAP DOWN REVERSAL (CE Buy)
            // If stock opens gap down (below S1) and moves upside crossing S1
            if (openLtp < levels.S1 && ltp > levels.S1 && isCrossing(ltp, levels.S1)) {
                ceTrigger = levels.S1;
                target = levels.previousClose;
                sl = levels.S1; // SL is the trigger level itself
                tradeType = 'CE';
            }
            // 2. GAP UP REVERSAL (PE Buy)
            // If stock opens gap up (above R1) and moves downside crossing R1
            else if (openLtp > levels.R1 && ltp < levels.R1 && isCrossing(ltp, levels.R1)) {
                peTrigger = levels.R1;
                target = levels.previousClose;
                sl = levels.R1; // SL is the trigger level itself
                tradeType = 'PE';
            }
            // 3. GAP UP R2 CROSSOVER (CE Buy) 
            else if (openLtp > levels.R1 && openLtp <= levels.R2 && ltp > levels.R2 && ltp < levels.R3 && isCrossing(ltp, levels.R2)) {
                ceTrigger = levels.R2;
                target = levels.R3;
                sl = levels.R2; // SL is the trigger level itself
                tradeType = 'CE';
            }
            // 4. GAP DOWN S2 CROSSDOWN (PE Buy) 
            else if (openLtp < levels.S1 && openLtp >= levels.S2 && ltp < levels.S2 && ltp > levels.S3 && isCrossing(ltp, levels.S2)) {
                peTrigger = levels.S2;
                target = levels.S3;
                sl = levels.S2; // SL is the trigger level itself
                tradeType = 'PE';
            }
            // 5. STANDARD BREAKOUT (CE Buy)
            else if (openLtp <= levels.R1 && ltp > levels.R1 && ltp < levels.R2 && isCrossing(ltp, levels.R1)) {
                ceTrigger = levels.R1;
                target = levels.R2;
                sl = levels.R1; // SL is the trigger level itself
                tradeType = 'CE';
            }
            // 6. STANDARD BREAKDOWN (PE Buy)
            else if (openLtp >= levels.S1 && ltp < levels.S1 && ltp > levels.S2 && isCrossing(ltp, levels.S1)) {
                peTrigger = levels.S1;
                target = levels.S2;
                sl = levels.S1; // SL is the trigger level itself
                tradeType = 'PE';
            }

            // Check if it's already in the watchlist before aggressively adding it
            const existing = await this.cacheManager.get(`WATCHLIST:${stock.symbol}`);
            if (existing) continue;

            // ── RDX filter (Item 2): require trend momentum for GANN_9 entries ──
            // RDX = RSI + (ADX − 20) / 5 — higher = stronger bullish trend, lower = bearish
            // CE: rdx > 55 confirms upward momentum; PE: rdx < 45 confirms downward momentum
            if (stock.rdx !== undefined) {
                if (tradeType === 'CE' && stock.rdx < 55) {
                    this.logger.debug(`[${stock.symbol}] GANN_9 CE blocked: RDX=${stock.rdx.toFixed(1)} < 55`);
                    continue;
                }
                if (tradeType === 'PE' && stock.rdx > 45) {
                    this.logger.debug(`[${stock.symbol}] GANN_9 PE blocked: RDX=${stock.rdx.toFixed(1)} > 45`);
                    continue;
                }
            }

            if (tradeType === 'CE' && ceTrigger) {
                await this.addToWatchlist(stock.symbol, ceTrigger, 'CE', target, sl, 'GANN_9');
            } else if (tradeType === 'PE' && peTrigger) {
                await this.addToWatchlist(stock.symbol, peTrigger, 'PE', target, sl, 'GANN_9');
            }
        }
    }

    /**
     * Enforce underlying dynamic target and stop loss exits.
     */
    @Cron('*/15 * * * * *')
    async enforceDynamicExits() {
        if (!this.isMarketHours()) return;
        // NOTE: Never gate dynamic exits on trade limits — closing open positions must always run.

        const summary = await this.paperTrading.getPortfolioSummary();
        const positions = summary.positions;
        if (positions.length === 0) return;

        for (const pos of positions) {

            // 1. Fetch Option Premium Quote
            const optionInfo = await this.shoonyaService.getOptionQuote(pos.token);
            let currentBid = pos.currentLtp;

            if (optionInfo) {
                currentBid = optionInfo.bidPrice > 0 ? optionInfo.bidPrice : optionInfo.ltp;
                
                // CRITICAL: We update the system with the REALIZABLE price (Bid) for all PnL and logic checks
                // but we can also store the LTP for chart visualization if needed.
                this.paperTrading.updatePositionLTP(pos.token, currentBid);
                // Optionally log LTP specifically if needed, but Bid is the "Liquid" price.
            }

            // EMA_5: consume touch-exit flag set by scanner on candle close
            if (pos.strategyName === 'EMA_5') {
                const emaExitFlag = await this.cacheManager.get(`EMA5_EXIT:${pos.symbol}`);
                if (emaExitFlag) {
                    await this.cacheManager.del(`EMA5_EXIT:${pos.symbol}`);
                    this.logger.warn(`📉 EMA TOUCH EXIT: [${pos.symbol}] Closing at Bid ₹${currentBid}`);
                    await this.paperTrading.closePosition(pos.token, currentBid, 'EMA Touch Exit: Candle closed past 5 EMA');
                    continue;
                }
            }

            if (pos.targetPrice && pos.slPrice) {
                const ltp = await this.nseService.getLiveLTP(pos.symbol);
                if (!ltp) continue;

                // 2. Fetch the Underlying Stock LTP for exact status display
                this.paperTrading.updateStockLTP(pos.token, ltp);

                // EMA_5: trail SL to breakeven once 1:2 RR is reached on the underlying
                if (pos.strategyName === 'EMA_5') {
                    // target - sl spans 4× risk (entry ± 3R with sl on the other side of entry ∓ 1R)
                    const totalRange = Math.abs(pos.targetPrice - pos.slPrice);
                    const emaRisk    = totalRange / 4;
                    // Reconstruct stock entry from SL + risk
                    const stockEntry = pos.type === 'CE' ? pos.slPrice + emaRisk : pos.slPrice - emaRisk;
                    const twoRLevel  = pos.type === 'CE' ? stockEntry + 2 * emaRisk : stockEntry - 2 * emaRisk;
                    // Only trail once (check if SL is still at its original side of entry)
                    const alreadyTrailed = pos.type === 'CE' ? pos.slPrice >= stockEntry - 1 : pos.slPrice <= stockEntry + 1;

                    if (!alreadyTrailed) {
                        const reachedTwoR = pos.type === 'CE' ? ltp >= twoRLevel : ltp <= twoRLevel;
                        if (reachedTwoR) {
                            const be = parseFloat(stockEntry.toFixed(2));
                            this.logger.log(`🔒 TRAILING SL: [${pos.symbol}] 1:2 RR reached. SL moved → Breakeven ₹${be}`);
                            this.paperTrading.updatePositionSL(pos.token, be);
                        }
                    }
                }

                // Helper: place a mid-price limit sell for GANN_ANGLE, or close immediately for others
                const triggerExit = async (reason: string) => {
                    const sellKey = `SELL:${pos.token}`;
                    if (pos.strategyName === 'GANN_ANGLE') {
                        if (this.pendingLimitOrders.has(sellKey)) return; // already pending
                        const midPrice = parseFloat(((currentBid + (optionInfo?.askPrice ?? currentBid)) / 2).toFixed(2));
                        this.pendingLimitOrders.set(sellKey, {
                            symbol: pos.symbol, token: pos.token, tradingSymbol: pos.tradingSymbol ?? '',
                            type: pos.type, qty: pos.qty, midPrice, orderType: 'SELL',
                            placedAt: Date.now(), strategyName: pos.strategyName, exitReason: reason
                        });
                        this.logger.log(`📋 GANN_ANGLE LIMIT SELL: [${pos.symbol}] at mid ₹${midPrice}. Reason: ${reason}`);
                    } else {
                        await this.paperTrading.closePosition(pos.token, currentBid, reason);
                    }
                };

                if (pos.type === 'CE') {
                    if (ltp >= pos.targetPrice) {
                        this.logger.warn(`🎯 TARGET HIT: [${pos.symbol}] Underlying reached ₹${ltp} >= Target ₹${pos.targetPrice}`);
                        await triggerExit(`Target Hit at ₹${ltp}`);
                    } else if (ltp < pos.slPrice) {
                        if (!pos.slTriggerTime) {
                            const now = Date.now();
                            this.paperTrading.updatePositionSLTrigger(pos.token, now);
                            this.logger.debug(`⚠️ SL BREACH DETECTED: [${pos.symbol}] dropped to ₹${ltp} < SL ₹${pos.slPrice}. Starting SL timer.`);
                        } else {
                            const elapsed = Date.now() - pos.slTriggerTime;
                            const slSustainMs = pos.strategyName === 'EMA_5' ? 60 * 1000 : 5 * 60 * 1000;
                            const slLabel = pos.strategyName === 'EMA_5' ? '1m' : '5m';
                            if (elapsed >= slSustainMs) {
                                this.logger.warn(`🛑 STOP-LOSS HIT: [${pos.symbol}] Sustained below SL ₹${pos.slPrice} for ${slLabel}.`);
                                await triggerExit(`SL Hit at ₹${ltp} (${slLabel} Sustain)`);
                            } else {
                                const secsLeft = Math.ceil((slSustainMs - elapsed) / 1000);
                                this.logger.debug(`[${pos.symbol}] SL Breach. Wait ${secsLeft}s more for SL Execution.`);
                            }
                        }
                    } else {
                        if (pos.slTriggerTime) {
                            this.logger.log(`✅ SL RECOVERY: [${pos.symbol}] recovered to ₹${ltp} >= SL ₹${pos.slPrice}. Cancelling SL timer.`);
                            this.paperTrading.updatePositionSLTrigger(pos.token, undefined);
                        }
                    }
                } else { // PE
                    if (ltp <= pos.targetPrice) {
                        this.logger.warn(`🎯 TARGET HIT: [${pos.symbol}] Underlying reached ₹${ltp} <= Target ₹${pos.targetPrice}`);
                        await triggerExit(`Target Hit at ₹${ltp}`);
                    } else if (ltp > pos.slPrice) {
                        if (!pos.slTriggerTime) {
                            const now = Date.now();
                            this.paperTrading.updatePositionSLTrigger(pos.token, now);
                            this.logger.debug(`⚠️ SL BREACH DETECTED: [${pos.symbol}] rose to ₹${ltp} > SL ₹${pos.slPrice}. Starting SL timer.`);
                        } else {
                            const elapsed = Date.now() - pos.slTriggerTime;
                            const slSustainMs = pos.strategyName === 'EMA_5' ? 60 * 1000 : 5 * 60 * 1000;
                            const slLabel = pos.strategyName === 'EMA_5' ? '1m' : '5m';
                            if (elapsed >= slSustainMs) {
                                this.logger.warn(`🛑 STOP-LOSS HIT: [${pos.symbol}] Sustained above SL ₹${pos.slPrice} for ${slLabel}.`);
                                await triggerExit(`SL Hit at ₹${ltp} (${slLabel} Sustain)`);
                            } else {
                                const secsLeft = Math.ceil((slSustainMs - elapsed) / 1000);
                                this.logger.debug(`[${pos.symbol}] SL Breach. Wait ${secsLeft}s more for SL Execution.`);
                            }
                        }
                    } else {
                        if (pos.slTriggerTime) {
                            this.logger.log(`✅ SL RECOVERY: [${pos.symbol}] recovered to ₹${ltp} <= SL ₹${pos.slPrice}. Cancelling SL timer.`);
                            this.paperTrading.updatePositionSLTrigger(pos.token, undefined);
                        }
                    }
                }
            }
        }
    }

    /**
     * Process GANN_ANGLE pending limit orders every 15 seconds.
     * BUY:  fills when LTP ≤ midPrice. Discards after 2 minutes unfilled.
     * SELL: fills when LTP ≥ midPrice. Falls back to market bid after 2 minutes.
     */
    @Cron('*/15 * * * * *')
    async processPendingLimitOrders() {
        if (!this.isMarketHours()) return;
        if (this.pendingLimitOrders.size === 0) return;

        const TWO_MIN_MS = 2 * 60 * 1000;
        const toDelete: string[] = [];

        for (const [key, order] of this.pendingLimitOrders.entries()) {
            const elapsed = Date.now() - order.placedAt;
            const optionInfo = await this.shoonyaService.getOptionQuote(order.token);

            if (!optionInfo) continue; // API unavailable — retry next cycle

            const currentLtp = optionInfo.ltp;
            const currentBid = optionInfo.bidPrice > 0 ? optionInfo.bidPrice : currentLtp;

            if (order.orderType === 'BUY') {
                // Fill condition: market LTP has come down to (or below) our mid price limit
                const filled = currentLtp <= order.midPrice;

                if (filled) {
                    const isSettled = await this.paperTrading.placeBuyOrder(
                        order.symbol, order.token, order.tradingSymbol,
                        order.type, order.qty, order.midPrice,
                        order.targetPrice, order.slPrice, order.strategyName
                    );
                    if (isSettled) {
                        this.dailyTradesCount++;
                        this.logger.log(`✅ GANN_ANGLE LIMIT BUY FILLED: [${order.symbol}] ${order.type} at mid ₹${order.midPrice}`);
                    }
                    toDelete.push(key);

                } else if (elapsed >= TWO_MIN_MS) {
                    await this.paperTrading.logFailedTrade(
                        order.symbol, order.type, order.midPrice,
                        `GANN_ANGLE Limit Buy expired: LTP ₹${currentLtp} did not reach mid ₹${order.midPrice} within 2 minutes. Order discarded.`
                    );
                    this.logger.warn(`🗑️ GANN_ANGLE LIMIT BUY DISCARDED: [${order.symbol}] mid ₹${order.midPrice} unfilled after 2 min (LTP ₹${currentLtp}).`);
                    toDelete.push(key);

                } else {
                    const secsLeft = Math.ceil((TWO_MIN_MS - elapsed) / 1000);
                    this.logger.debug(`[${order.symbol}] GANN_ANGLE BUY pending — mid ₹${order.midPrice}, LTP ₹${currentLtp}. ${secsLeft}s left.`);
                }

            } else if (order.orderType === 'SELL') {
                // Fill condition: LTP has risen to (or above) our mid price limit
                const filled = currentLtp >= order.midPrice;

                if (filled) {
                    await this.paperTrading.closePosition(order.token, order.midPrice, `${order.exitReason} — Limit Sell filled at mid ₹${order.midPrice}`);
                    this.logger.log(`✅ GANN_ANGLE LIMIT SELL FILLED: [${order.symbol}] at mid ₹${order.midPrice}`);
                    toDelete.push(key);

                } else if (elapsed >= TWO_MIN_MS) {
                    // Sell timeout — fill at current market bid to ensure position is closed
                    await this.paperTrading.closePosition(order.token, currentBid, `${order.exitReason} — Limit Sell timed out, filled at market bid ₹${currentBid}`);
                    this.logger.warn(`⏱️ GANN_ANGLE LIMIT SELL TIMEOUT: [${order.symbol}] filled at market bid ₹${currentBid} after 2 min.`);
                    toDelete.push(key);

                } else {
                    const secsLeft = Math.ceil((TWO_MIN_MS - elapsed) / 1000);
                    this.logger.debug(`[${order.symbol}] GANN_ANGLE SELL pending — mid ₹${order.midPrice}, LTP ₹${currentLtp}. ${secsLeft}s left.`);
                }
            }
        }

        toDelete.forEach(k => this.pendingLimitOrders.delete(k));
    }

    /**
     * Expose the live Active Watchlist for the Dashboard UI
     */
    async getActiveWatchlist(): Promise<WatchlistEntry[]> {
        let activeKeysStr = await this.cacheManager.get<string>('WATCHLIST_KEYS');
        let keys: string[] = activeKeysStr ? JSON.parse(activeKeysStr) : [];
        if (keys.length === 0) return [];

        const watchlist: WatchlistEntry[] = [];
        for (const key of keys) {
            const raw = await this.cacheManager.get<string>(key);
            if (raw) {
                watchlist.push(JSON.parse(raw) as WatchlistEntry);
            }
        }
        return watchlist;
    }

    private isMarketHours(): boolean {
        const now = new Date();
        const day = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
        if (day === 'Sat' || day === 'Sun') return false;
        const time = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        return time >= '09:00:00' && time <= '15:35:00';
    }
}
