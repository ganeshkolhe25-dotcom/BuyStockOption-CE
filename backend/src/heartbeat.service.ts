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
                const isCandleBreakout = entry.strategyName === 'CANDLE_BREAKOUT';
                const bufferPct = isEma ? 0.003 : 0.0005;
                const buffer = entry.triggerPrice * bufferPct;

                let isSustaining = false;
                if (entry.type === 'CE') {
                    isSustaining = ltp >= (entry.triggerPrice - buffer);
                } else {
                    isSustaining = ltp <= (entry.triggerPrice + buffer);
                }

                const isGann9 = entry.strategyName === 'GANN_9';

                // GANN_9: allow free movement during the 3-min wait — only check at the final mark.
                // EMA_5 / GANN_ANGLE / CANDLE_BREAKOUT: invalidate immediately if LTP moves away.
                if (!isSustaining && !isGann9) {
                    const invalidMsg = `Signal Invalidated: LTP ₹${ltp} moved away from ${entry.type} trigger ₹${entry.triggerPrice} during sustain period.`;
                    this.logger.warn(`❌ [${entry.symbol}] ${invalidMsg}`);
                    await this.paperTrading.logFailedTrade(entry.symbol, entry.type, entry.triggerPrice, invalidMsg, entry.strategyName);
                    await this.cacheManager.del(key);
                    updatedKeys = updatedKeys.filter(k => k !== key);
                    continue;
                }

                // GANN_ANGLE / CANDLE_BREAKOUT: execute immediately — breakout is self-confirming
                // EMA_5: 1-minute sustain (candle close + RSI + volume already confirms)
                // GANN_9: 3-minute single final check (allows dips/recoveries within the window)
                const sustainMs = (isGannAngle || isCandleBreakout) ? 0 : isEma ? 1 * 60 * 1000 : 3 * 60 * 1000;
                const timeElapsedMs = Date.now() - entry.breakoutTime;

                if (timeElapsedMs >= sustainMs) {
                    // Final check at sustain mark — kill if not sustaining (applies to all strategies)
                    if (!isSustaining) {
                        const invalidMsg = `Signal Invalidated at 3-min check: LTP ₹${ltp} not sustaining ${entry.type} trigger ₹${entry.triggerPrice}.`;
                        this.logger.warn(`❌ [${entry.symbol}] ${invalidMsg}`);
                        await this.paperTrading.logFailedTrade(entry.symbol, entry.type, entry.triggerPrice, invalidMsg, entry.strategyName);
                        await this.cacheManager.del(key);
                        updatedKeys = updatedKeys.filter(k => k !== key);
                        continue;
                    }
                    const label = (isGannAngle || isCandleBreakout) ? 'IMMEDIATE' : isEma ? '1-MIN' : '3-MIN';
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
            const preferITM = strategyName === 'EMA_5'; // ITM = better Delta + less decay for mean-reversion
            const contract = await this.shoonyaService.findAtmOption(symbol, cmp, type, preferITM);

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

            // GANN_ANGLE / CANDLE_BREAKOUT: place a limit buy order at mid price (bid+ask)/2
            // Actual fill is checked every 15s for up to 2 minutes, then discarded if unfilled
            if (strategyName === 'GANN_ANGLE' || strategyName === 'CANDLE_BREAKOUT') {
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
     * Gann-9 Level Monitor — runs every 30 seconds, 9:20 AM – 2:45 PM IST (Mon-Fri).
     *
     * Replaces the old 5-min candle-boundary cron. Changes:
     *   1. 30-second polling eliminates the 4-min 55-sec blind spot.
     *   2. getBatchLTP() reads from WS tick cache (zero REST per stock).
     *   3. Directional 0.5% fresh-cross window — CE only fires above trigger,
     *      PE only fires below trigger, preventing pre-cross false entries.
     *   4. Proper SL levels — previous Gann level, not the trigger itself.
     *   5. RDX guard always enforced — no bypass when rdx is undefined.
     */
    @Cron('*/30 * * * * *')
    async continuousDailyScanMonitor() {
        if (!this.isMarketHours()) return;

        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        if (timeStr < '09:20:00' || timeStr > '14:45:00') return;

        // Respect the gann9Enabled toggle — if disabled mid-day, stop scanning immediately
        const config = await this.paperTrading.getStrategyConfig();
        if (config && !config.gann9Enabled) {
            this.logger.debug('Gann Square-9 is DISABLED from settings. Skipping continuous scan.');
            return;
        }

        const cachedStr = await this.cacheManager.get<string>('DAILY_SCAN_RESULTS');
        if (!cachedStr) return;

        const scan = JSON.parse(cachedStr);
        if (!scan.data || scan.data.length === 0) return;

        const todayTraded = await this.paperTrading.getTodayTradedSymbols('GANN_9');
        const eligibleStocks = scan.data.filter((s: any) => !todayTraded.includes(s.symbol));
        if (eligibleStocks.length === 0) return;

        // Single batch LTP call — reads WS tick cache, falls back to one REST batch
        const ltpMap = await this.nseService.getBatchLTP(eligibleStocks.map((s: any) => s.symbol));

        // Directional fresh-cross detectors — 0.5% window on the correct side only
        const freshCE = (price: number, trigger: number) => price >= trigger && price <= trigger * 1.005;
        const freshPE = (price: number, trigger: number) => price <= trigger && price >= trigger * 0.995;

        for (const stock of eligibleStocks) {
            const ltp = ltpMap[stock.symbol];
            if (!ltp) continue;

            const levels = stock.levels;
            const openLtp = stock.openLtp;
            let trigger: number | null = null;
            let target = 0;
            let sl = 0;
            let tradeType: 'CE' | 'PE' | null = null;

            // 1. GAP DOWN REVERSAL (CE): opened below S1, now crossing back above S1
            if (openLtp < levels.S1 && freshCE(ltp, levels.S1)) {
                tradeType = 'CE'; trigger = levels.S1;
                target = levels.previousClose; sl = levels.S1;
            }
            // 2. GAP UP REVERSAL (PE): opened above R1, now crossing back below R1
            else if (openLtp > levels.R1 && freshPE(ltp, levels.R1)) {
                tradeType = 'PE'; trigger = levels.R1;
                target = levels.previousClose; sl = levels.R1;
            }
            // 3. GAP UP R2 CROSSOVER (CE): opened between R1–R2, now crossing above R2
            else if (openLtp > levels.R1 && openLtp <= levels.R2 && freshCE(ltp, levels.R2)) {
                tradeType = 'CE'; trigger = levels.R2;
                target = levels.R3; sl = levels.R2;
            }
            // 4. GAP DOWN S2 CROSSDOWN (PE): opened between S1–S2, now crossing below S2
            else if (openLtp < levels.S1 && openLtp >= levels.S2 && freshPE(ltp, levels.S2)) {
                tradeType = 'PE'; trigger = levels.S2;
                target = levels.S3; sl = levels.S2;
            }
            // 5. STANDARD BREAKOUT (CE): opened below R1, now crossing above R1
            else if (openLtp <= levels.R1 && freshCE(ltp, levels.R1)) {
                tradeType = 'CE'; trigger = levels.R1;
                target = levels.R2; sl = levels.R1;
            }
            // 6. STANDARD BREAKDOWN (PE): opened above S1, now crossing below S1
            else if (openLtp >= levels.S1 && freshPE(ltp, levels.S1)) {
                tradeType = 'PE'; trigger = levels.S1;
                target = levels.S2; sl = levels.S1;
            }

            if (!tradeType || !trigger) continue;

            // Skip if already in watchlist
            const existing = await this.cacheManager.get(`WATCHLIST:${stock.symbol}`);
            if (existing) continue;

            // RDX filter: always enforced — block trade if no candle data (rdx undefined = no confirmation)
            // RDX = RSI + (ADX − 20) / 5: CE needs rdx > 55 (bullish momentum), PE needs rdx < 45 (bearish)
            const rdx = stock.rdx ?? null;
            if (rdx === null) {
                this.logger.debug(`[${stock.symbol}] GANN_9 blocked: no RDX data available`);
                continue;
            }
            if (tradeType === 'CE' && rdx < 55) {
                this.logger.debug(`[${stock.symbol}] GANN_9 CE blocked: RDX=${rdx.toFixed(1)} < 55`);
                continue;
            }
            if (tradeType === 'PE' && rdx > 45) {
                this.logger.debug(`[${stock.symbol}] GANN_9 PE blocked: RDX=${rdx.toFixed(1)} > 45`);
                continue;
            }

            await this.addToWatchlist(stock.symbol, trigger, tradeType, target, sl, 'GANN_9');
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

                // Helper: place a mid-price limit sell for GANN_ANGLE/CANDLE_BREAKOUT, or close immediately
                const triggerExit = async (reason: string) => {
                    const sellKey = `SELL:${pos.token}`;
                    if (pos.strategyName === 'GANN_ANGLE' || pos.strategyName === 'CANDLE_BREAKOUT') {
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
                        if (pos.strategyName === 'GANN_ANGLE' || pos.strategyName === 'CANDLE_BREAKOUT') {
                            this.logger.warn(`🛑 SL HIT: [${pos.symbol}] ₹${ltp} < SL ₹${pos.slPrice}. Exiting immediately.`);
                            await triggerExit(`SL Broken at ₹${ltp}`);
                        } else if (!pos.slTriggerTime) {
                            const now = Date.now();
                            this.paperTrading.updatePositionSLTrigger(pos.token, now);
                            this.logger.debug(`⚠️ SL BREACH DETECTED: [${pos.symbol}] dropped to ₹${ltp} < SL ₹${pos.slPrice}. Starting SL timer.`);
                        } else {
                            const elapsed = Date.now() - pos.slTriggerTime;
                            const slSustainMs = pos.strategyName === 'EMA_5' ? 60 * 1000 : pos.strategyName === 'GANN_9' ? 3 * 60 * 1000 : 5 * 60 * 1000;
                            const slLabel = pos.strategyName === 'EMA_5' ? '1m' : pos.strategyName === 'GANN_9' ? '3m' : '5m';
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
                        if (pos.strategyName === 'GANN_ANGLE' || pos.strategyName === 'CANDLE_BREAKOUT') {
                            this.logger.warn(`🛑 SL HIT: [${pos.symbol}] ₹${ltp} > SL ₹${pos.slPrice}. Exiting immediately.`);
                            await triggerExit(`SL Broken at ₹${ltp}`);
                        } else if (!pos.slTriggerTime) {
                            const now = Date.now();
                            this.paperTrading.updatePositionSLTrigger(pos.token, now);
                            this.logger.debug(`⚠️ SL BREACH DETECTED: [${pos.symbol}] rose to ₹${ltp} > SL ₹${pos.slPrice}. Starting SL timer.`);
                        } else {
                            const elapsed = Date.now() - pos.slTriggerTime;
                            const slSustainMs = pos.strategyName === 'EMA_5' ? 60 * 1000 : pos.strategyName === 'GANN_9' ? 3 * 60 * 1000 : 5 * 60 * 1000;
                            const slLabel = pos.strategyName === 'EMA_5' ? '1m' : pos.strategyName === 'GANN_9' ? '3m' : '5m';
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
