import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { NseService } from './nse.service';
import { ShoonyaService } from './shoonya.service';
import { PaperTradingService, PaperPosition } from './paper.service';
import { PriceGatewayService, PositionPriceUpdate } from './price-gateway.service';


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

    // WS tick freshness window. 5s gives real-time prices while tolerating brief WS gaps.
    private readonly TICK_STALENESS_MS = 5_000;
    // Tokens currently being closed — prevents duplicate exits from concurrent WS + cron paths.
    private readonly closingTokens = new Set<string>();

    private dailyTradesCount = 0;
    private lastHeartbeatTime = new Date().toISOString();
    private pendingLimitOrders = new Map<string, PendingLimitOrder>();
    // 2-Candle: tokens where half-exit at 1:1 has already been done — remaining half is trailing
    private readonly cbHalfExited = new Set<string>();
    // GANN_ANGLE: tokens where half-exit at 5% has already been done — remaining half trails at cost
    private readonly gaPartialBooked = new Set<string>();

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private readonly nseService: NseService,
        private readonly shoonyaService: ShoonyaService,
        private readonly paperTrading: PaperTradingService,
        private readonly priceGateway: PriceGatewayService,
    ) {
        this.logger.log('Sustain Engine Initialized. Heartbeat Worker waiting...');
        // Register WS-driven exit callback. Fires on every NFO tick; we schedule the
        // async evaluation off the WS event loop via setImmediate to stay non-blocking.
        this.shoonyaService.registerOptionTickHandler((token, tick) => {
            setImmediate(() =>
                this.handleInstantOptionTick(token, tick).catch(e =>
                    this.logger.error(`[WS-EXIT] Tick handler error for ${token}: ${e.message}`)
                )
            );
        });
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

        // Skip if symbol already has an open position in the SAME strategy — no intra-strategy duplicates
        // Different strategies can trade the same symbol independently if their own criteria is met
        const openPositions = await this.paperTrading.getPositions();
        if (openPositions.some(p => p.symbol === symbol && p.strategyName === strategyName)) {
            this.logger.log(`BLOCKED [Conflict]: [${symbol}] already has an open ${strategyName} position — skipping.`);
            return;
        }

        // Skip if a pending limit buy is already in-flight for this symbol in the SAME strategy
        // Covers the gap between watchlist removal and limit order fill (up to 2 min for GANN_ANGLE)
        const hasPendingBuy = Array.from(this.pendingLimitOrders.values())
            .some(o => o.symbol === symbol && o.orderType === 'BUY' && o.strategyName === strategyName);
        if (hasPendingBuy) {
            this.logger.log(`BLOCKED [Conflict]: [${symbol}] pending ${strategyName} limit buy already in-flight — skipping.`);
            return;
        }

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
     * 2-Candle breakout buy — bypasses the 30-second watchlist cron for instant execution.
     * Called directly from the 5-second runCandleBreakoutCheck cron in scanner.service.ts.
     * Applies the same open-position and pending-order duplicate guards as addToWatchlist.
     */
    async executeCandleBreakoutDirectly(
        symbol: string,
        ltp: number,
        type: 'CE' | 'PE',
        targetPrice: number,
        slPrice: number,
        triggerPrice: number
    ): Promise<void> {
        const openPositions = await this.paperTrading.getPositions();
        if (openPositions.some(p => p.symbol === symbol && p.strategyName === 'CANDLE_BREAKOUT')) {
            this.logger.log(`BLOCKED [Conflict]: [${symbol}] already has an open CANDLE_BREAKOUT position — skipping.`);
            return;
        }

        const hasPendingBuy = Array.from(this.pendingLimitOrders.values())
            .some(o => o.symbol === symbol && o.orderType === 'BUY' && o.strategyName === 'CANDLE_BREAKOUT');
        if (hasPendingBuy) {
            this.logger.log(`BLOCKED [Conflict]: [${symbol}] pending CANDLE_BREAKOUT limit buy already in-flight — skipping.`);
            return;
        }

        this.logger.log(`🚀 IMMEDIATE [2-CANDLE] SIGNAL: [${symbol}] LTP ₹${ltp} crossed trigger ₹${triggerPrice}. Executing ${type} entry now.`);
        await this.executeOptionTrade(symbol, ltp, type, targetPrice, slPrice, 'CANDLE_BREAKOUT', triggerPrice);
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

                // Strategy flags used throughout this block
                const isEma = entry.strategyName === 'EMA_5';
                const isGannAngle = entry.strategyName === 'GANN_ANGLE';
                const isCandleBreakout = entry.strategyName === 'CANDLE_BREAKOUT';
                const isGann9 = entry.strategyName === 'GANN_9';

                const bufferPct = 0.0005;
                const sustainThreshold = entry.type === 'CE'
                    ? entry.triggerPrice * (1 - bufferPct)
                    : entry.triggerPrice * (1 + bufferPct);

                const isSustaining = entry.type === 'CE'
                    ? ltp >= sustainThreshold
                    : ltp <= sustainThreshold;

                // GANN_9 / GANN_ANGLE / EMA_5: allow free movement during the wait.
                // CANDLE_BREAKOUT: invalidate immediately if LTP moves away.
                if (!isSustaining && !isGann9 && !isGannAngle && !isEma) {
                    const invalidMsg = `Signal Invalidated: LTP ₹${ltp} moved away from ${entry.type} sustain threshold ₹${sustainThreshold.toFixed(2)} (trigger ₹${entry.triggerPrice}) during sustain period.`;
                    this.logger.warn(`❌ [${entry.symbol}] ${invalidMsg}`);
                    this.paperTrading.logFailedTrade(entry.symbol, entry.type, entry.triggerPrice, invalidMsg, entry.strategyName);
                    await this.cacheManager.del(key);
                    updatedKeys = updatedKeys.filter(k => k !== key);
                    continue;
                }

                // CANDLE_BREAKOUT: execute immediately — self-confirming on candle close
                // GANN_ANGLE: 5-minute sustain with 5-min candle close confirmation
                // EMA_5: 3-minute sustain with live LTP confirmation
                // GANN_9: 5-minute sustain with 5-min candle close confirmation
                const sustainMs = isCandleBreakout ? 0 : isEma ? 3 * 60 * 1000 : isGannAngle ? 3 * 60 * 1000 : 5 * 60 * 1000;
                const timeElapsedMs = Date.now() - entry.breakoutTime;

                if (timeElapsedMs >= sustainMs) {
                    if (!isSustaining && !isGann9 && !isGannAngle) {
                        const invalidMsg = `Signal Invalidated at ${Math.round(sustainMs/60000)}-min check: LTP ₹${ltp} not sustaining ${entry.type} threshold ₹${sustainThreshold.toFixed(2)} (trigger ₹${entry.triggerPrice}).`;
                        this.logger.warn(`❌ [${entry.symbol}] ${invalidMsg}`);
                        this.paperTrading.logFailedTrade(entry.symbol, entry.type, entry.triggerPrice, invalidMsg, entry.strategyName);
                        await this.cacheManager.del(key);
                        updatedKeys = updatedKeys.filter(k => k !== key);
                        continue;
                    }

                    if (isGann9) {
                        const candle = await this.getLastCompletedCandle(entry.symbol, '5');
                        if (candle !== null) {
                            const confirmedByCandle = entry.type === 'CE'
                                ? candle.close >= entry.triggerPrice * 1.001
                                : candle.close <= entry.triggerPrice * 0.999;
                            if (!confirmedByCandle) {
                                const msg = `5-min candle close ₹${candle.close} did not confirm ${entry.type} trigger ₹${entry.triggerPrice.toFixed(2)} (±0.1% buffer). Fake breakout — ignored.`;
                                this.logger.warn(`❌ [${entry.symbol}] ${msg}`);
                                this.paperTrading.logFailedTrade(entry.symbol, entry.type, entry.triggerPrice, msg, entry.strategyName);
                                await this.cacheManager.del(key);
                                updatedKeys = updatedKeys.filter(k => k !== key);
                                continue;
                            }
                            const strongCandle = entry.type === 'CE'
                                ? candle.low > entry.triggerPrice
                                : candle.high < entry.triggerPrice;
                            if (!strongCandle) {
                                this.logger.warn(
                                    `⚠️ [${entry.symbol}] Weak candle: ${entry.type === 'CE'
                                        ? `low ₹${candle.low} ≤ trigger ₹${entry.triggerPrice.toFixed(2)}`
                                        : `high ₹${candle.high} ≥ trigger ₹${entry.triggerPrice.toFixed(2)}`
                                    } — wick crosses trigger, lower conviction. Proceeding (close confirmed).`
                                );
                            }
                            this.logger.log(
                                `📊 [${entry.symbol}] CANDLE CONFIRM [${strongCandle ? 'STRONG ✅' : 'WEAK ⚠️'}]: ` +
                                `close ₹${candle.close} | high ₹${candle.high} | low ₹${candle.low} | ` +
                                `trigger ₹${entry.triggerPrice.toFixed(2)} | sustain threshold ₹${sustainThreshold.toFixed(2)}`
                            );
                        } else {
                            this.logger.warn(`[${entry.symbol}] Could not fetch 5-min candle — proceeding with tick confirmation.`);
                        }
                    }

                    if (isGannAngle) {
                        // 5-min candle trigger was already confirmed by the scanner before addToWatchlist.
                        // Here we only check the 3-min candle close to confirm continuation (Nirwana logic).
                        const candle3m = await this.getLastCompletedCandle(entry.symbol, '3');
                        if (candle3m !== null) {
                            const confirmedBy3m = entry.type === 'CE'
                                ? candle3m.close > entry.triggerPrice
                                : candle3m.close < entry.triggerPrice;
                            if (!confirmedBy3m) {
                                const msg = `3-min candle close ₹${candle3m.close} RESET ${entry.type} signal — price back ${entry.type === 'CE' ? 'below' : 'above'} trigger ₹${entry.triggerPrice.toFixed(2)}. Signal cancelled.`;
                                this.logger.warn(`❌ [${entry.symbol}] ${msg}`);
                                this.paperTrading.logFailedTrade(entry.symbol, entry.type, entry.triggerPrice, msg, entry.strategyName);
                                await this.cacheManager.del(key);
                                updatedKeys = updatedKeys.filter(k => k !== key);
                                continue;
                            }
                            this.logger.log(
                                `📊 [${entry.symbol}] GANN_ANGLE 3-MIN CONFIRM ✅: ` +
                                `3m close ₹${candle3m.close} ${entry.type === 'CE' ? '>' : '<'} trigger ₹${entry.triggerPrice.toFixed(2)}`
                            );
                        } else {
                            this.logger.warn(`[${entry.symbol}] 3-min candle unavailable — proceeding with tick confirmation.`);
                        }
                    }

                    const label = isCandleBreakout ? 'IMMEDIATE' : isGannAngle ? '5-MIN' : isEma ? '3-MIN' : '5-MIN';
                    const entryDistPct = isGann9
                        ? ((Math.abs(ltp - entry.triggerPrice) / entry.triggerPrice) * 100).toFixed(2)
                        : null;
                    const triggerInfo = isGann9
                        ? ` | Trigger ₹${entry.triggerPrice.toFixed(2)} → Entry ₹${ltp} (dist ${entryDistPct}%) | Sustain ₹${sustainThreshold.toFixed(2)}`
                        : '';
                    this.logger.log(`🚀 ${label} SIGNAL CONFIRMED FOR [${entry.symbol}] AT ₹${ltp}! Triggering ${entry.type} Option Entry.${triggerInfo}`);

                    // Remove from watchlist so we don't buy it twice
                    await this.cacheManager.del(key);
                    updatedKeys = updatedKeys.filter(k => k !== key);

                    // Proceed to Phase 3: Dynamic Option Selection & Shoonya Execution
                    // We specifically pass `ltp` (Live Market Price) instead of the static initial trigger price
                    await this.executeOptionTrade(entry.symbol, ltp, entry.type, entry.targetPrice, entry.slPrice, entry.strategyName, entry.triggerPrice);
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
    private async executeOptionTrade(symbol: string, cmp: number, type: 'CE' | 'PE', targetPrice: number, slPrice: number, strategyName: string = 'GANN_9', triggerPrice?: number) {
        try {
            // GANN_ANGLE: top-2 ITM by volume (Nirwana logic).
            // All other strategies: standard ATM/ITM via findAtmOption.
            let contract;
            if (strategyName === 'GANN_ANGLE') {
                contract = await this.shoonyaService.findTopItmOptionByVolume(symbol, cmp, type);
            } else {
                const preferITM = strategyName === 'EMA_5';
                contract = await this.shoonyaService.findAtmOption(symbol, cmp, type, preferITM);
            }

            if (!contract) {
                this.logger.warn(`[${symbol}] No F&O option found — skipping this trade.`);
                return;
            }

            // Try to immediately secure the real Live Option Premium directly from Shoonya API
            const optionPremiumInfo = await this.shoonyaService.getOptionQuote(contract.token);

            if (!optionPremiumInfo || optionPremiumInfo.askPrice === 0) {
                this.paperTrading.logFailedTrade(symbol, type, cmp, `Shoonya API Failure: Live premium query failed for ${contract.token}.`);
                return;
            }

            // GANN_ANGLE: override targetPrice to askPrice × 1.10 (+10% premium target).
            // slPrice retains the spot R_67.5/S_67.5 level passed from the scanner —
            // the premium -5% SL is applied dynamically in evaluateExitForPosition.
            if (strategyName === 'GANN_ANGLE') {
                targetPrice = parseFloat((optionPremiumInfo.askPrice * 1.10).toFixed(2));
            }

            // ─────────────────────────────────────────────────────────────────────────
            // GANN_9: all post-entry filters run here before the order is placed.
            // triggerPrice is always present for GANN_9 (passed from watchlist entry).
            // ─────────────────────────────────────────────────────────────────────────
            if (strategyName === 'GANN_9' && triggerPrice !== undefined) {

                // 1. Entry distance filter: reject if price drifted > 0.7% from trigger
                //    Prevents late/chasing entries where R:R and SL calc are already stale
                const entryDistPct = Math.abs(cmp - triggerPrice) / triggerPrice;
                if (entryDistPct > 0.01) {
                    const distMsg = `STRATEGY REJECT (ENTRY DISTANCE): Entry ₹${cmp} is ${(entryDistPct * 100).toFixed(2)}% from trigger ₹${triggerPrice.toFixed(2)} (max 1%)`;
                    this.paperTrading.logFailedTrade(symbol, type, cmp, distMsg, strategyName);
                    this.logger.warn(`❌ [${symbol}] ${distMsg}`);
                    return;
                }

                // 2. POST-ENTRY R:R check — uses actual entry price, not trigger (only this decides the trade)
                const entryRisk   = Math.abs(cmp - slPrice);
                const entryReward = Math.abs(targetPrice - cmp);
                if (entryReward < 2 * entryRisk) {
                    const rrMsg = `STRATEGY REJECT (POST-ENTRY R:R): ${(entryReward / entryRisk).toFixed(1)}:1 < 2:1 at entry ₹${cmp} (SL ₹${slPrice}, Target ₹${targetPrice})`;
                    this.paperTrading.logFailedTrade(symbol, type, cmp, rrMsg, strategyName);
                    this.logger.warn(`❌ [${symbol}] ${rrMsg}`);
                    return;
                }

                // 3. SL distance check: if entry has drifted, SL distance grows → cap at 1% of trigger
                //    Prevents trades where the effective stop loss is abnormally large
                const maxRiskPts = triggerPrice * 0.01;
                if (entryRisk > maxRiskPts) {
                    const slMsg = `STRATEGY REJECT (SL DISTANCE): Entry risk ₹${entryRisk.toFixed(2)} > max ₹${maxRiskPts.toFixed(2)} (1% of trigger ₹${triggerPrice.toFixed(2)})`;
                    this.paperTrading.logFailedTrade(symbol, type, cmp, slMsg, strategyName);
                    this.logger.warn(`❌ [${symbol}] ${slMsg}`);
                    return;
                }

                // 4. Option slippage check: wide bid-ask spread signals illiquid/over-inflated premium
                if (optionPremiumInfo.bidPrice > 0) {
                    const spread = optionPremiumInfo.askPrice - optionPremiumInfo.bidPrice;
                    const spreadPct = spread / optionPremiumInfo.askPrice;
                    if (spreadPct > 0.15) {
                        const slippageMsg = `STRATEGY REJECT (SLIPPAGE): Spread ₹${spread.toFixed(2)} is ${(spreadPct * 100).toFixed(1)}% of ask ₹${optionPremiumInfo.askPrice} (max 15%)`;
                        this.paperTrading.logFailedTrade(symbol, type, cmp, slippageMsg, strategyName);
                        this.logger.warn(`❌ [${symbol}] ${slippageMsg}`);
                        return;
                    }
                }

                // 5. Comprehensive POST-ENTRY setup log (all values in one line for easy audit)
                const preRisk   = Math.abs(triggerPrice - slPrice);
                const preReward = Math.abs(targetPrice - triggerPrice);
                this.logger.log(
                    `📐 [${symbol}] GANN_9 POST-ENTRY SETUP:\n` +
                    `   Trigger ₹${triggerPrice.toFixed(2)} | Entry ₹${cmp} (dist ${(entryDistPct * 100).toFixed(2)}%) | SL ₹${slPrice} | Target ₹${targetPrice}\n` +
                    `   PRE-ENTRY  R:R → Risk ₹${preRisk.toFixed(2)} / Reward ₹${preReward.toFixed(2)} = 1:${(preReward / preRisk).toFixed(1)}\n` +
                    `   POST-ENTRY R:R → Risk ₹${entryRisk.toFixed(2)} / Reward ₹${entryReward.toFixed(2)} = 1:${(entryReward / entryRisk).toFixed(1)}\n` +
                    `   Option: bid ₹${optionPremiumInfo.bidPrice} / ask ₹${optionPremiumInfo.askPrice} | Lot ${contract.lotSize} | Contract ${contract.tradingSymbol}`
                );
            }

            // CANDLE_BREAKOUT: apply lot multiplier from config (NIFTY/BANKNIFTY configured independently)
            // GANN_ANGLE: dynamic lot sizing targeting ~₹30k (Nirwana logic)
            // All other strategies use contract.lotSize directly (1 lot)
            let tradeQty = contract.lotSize;
            if (strategyName === 'GANN_ANGLE') {
                const oneLotVal = contract.lotSize * optionPremiumInfo.askPrice;
                if (oneLotVal < 10000) {
                    // Very cheap option — scale up towards ₹30k, rounded to whole lots
                    const lotsNeeded = Math.round(30000 / (optionPremiumInfo.askPrice * contract.lotSize));
                    tradeQty = Math.max(contract.lotSize, lotsNeeded * contract.lotSize);
                } else if (oneLotVal < 15000) {
                    tradeQty = contract.lotSize * 2; // 2 lots (≈₹20–30k)
                }
                // oneLotVal ≥ 15000: 1 lot (tradeQty unchanged — already set to contract.lotSize)
            }
            if (strategyName === 'CANDLE_BREAKOUT') {
                const cfg = await this.shoonyaService.getConfig();
                const lotMultiplier = symbol === 'NIFTY'
                    ? (cfg.candleNiftyLots || 1)
                    : (cfg.candleBankNiftyLots || 1);
                tradeQty = contract.lotSize * lotMultiplier;
            }

            // 🛑 Lot Price Constraint: Total Investment (Qty * Price) must be <= 40,000
            // GANN_ANGLE and CANDLE_BREAKOUT are exempt — both use config-defined lot counts
            const lotValue = tradeQty * optionPremiumInfo.askPrice;
            if (strategyName !== 'GANN_ANGLE' && strategyName !== 'CANDLE_BREAKOUT' && lotValue > 40000) {
                const failMsg = `STRATEGY REJECT: Lot Value ₹${lotValue.toFixed(2)} exceeds ₹40,000 limit. (Price: ₹${optionPremiumInfo.askPrice}, Qty: ${tradeQty})`;
                this.paperTrading.logFailedTrade(symbol, type, cmp, failMsg);
                this.logger.warn(failMsg);
                return;
            }

            const isSettled = await this.paperTrading.placeBuyOrder(
                symbol,
                contract.token,
                contract.tradingSymbol,
                type,
                tradeQty,
                optionPremiumInfo.askPrice,
                targetPrice,
                slPrice,
                strategyName,
                contract.lotSize
            );

            if (isSettled) {
                this.dailyTradesCount++;
                this.logger.log(`✅ PAPER TRADE SUCCESS: [${symbol}] ${type} Bought at ₹${optionPremiumInfo.askPrice} (Ask Price)`);
                this.shoonyaService.subscribeOptionToken(contract.token);
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

        const freshCE = (price: number, trigger: number) => price >= trigger;
        const freshPE = (price: number, trigger: number) => price <= trigger;

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
                target = levels.previousClose;
            }
            // 2. GAP UP REVERSAL (PE): opened above R1, now crossing back below R1
            else if (openLtp > levels.R1 && freshPE(ltp, levels.R1)) {
                tradeType = 'PE'; trigger = levels.R1;
                target = levels.previousClose;
            }
            // 3. GAP UP R2 CROSSOVER (CE): opened between R1–R2, now crossing above R2
            else if (openLtp > levels.R1 && openLtp <= levels.R2 && freshCE(ltp, levels.R2)) {
                tradeType = 'CE'; trigger = levels.R2;
                target = levels.R3;
            }
            // 4. GAP DOWN S2 CROSSDOWN (PE): opened between S1–S2, now crossing below S2
            else if (openLtp < levels.S1 && openLtp >= levels.S2 && freshPE(ltp, levels.S2)) {
                tradeType = 'PE'; trigger = levels.S2;
                target = levels.S3;
            }
            // 5. STANDARD BREAKOUT (CE): opened below R1, now crossing above R1
            else if (openLtp <= levels.R1 && freshCE(ltp, levels.R1)) {
                tradeType = 'CE'; trigger = levels.R1;
                target = levels.R2;
            }
            // 6. STANDARD BREAKDOWN (PE): opened above S1, now crossing below S1
            else if (openLtp >= levels.S1 && freshPE(ltp, levels.S1)) {
                tradeType = 'PE'; trigger = levels.S1;
                target = levels.S2;
            }

            if (!tradeType || !trigger) continue;

            const SL_BUFFER = 0.002;
            sl = tradeType === 'CE' ? trigger * (1 - SL_BUFFER) : trigger * (1 + SL_BUFFER);

            // Skip if already in watchlist
            const existing = await this.cacheManager.get(`WATCHLIST:${stock.symbol}`);
            if (existing) continue;

            // RDX filter: CE needs rdx > 50 (bullish), PE needs rdx < 50 (bearish)
            const rdx = stock.rdx ?? null;
            if (rdx === null) {
                this.logger.debug(`[${stock.symbol}] GANN_9 blocked: no RDX data available`);
                continue;
            }
            if (tradeType === 'CE' && rdx < 50) {
                this.logger.debug(`[${stock.symbol}] GANN_9 CE blocked: RDX=${rdx.toFixed(1)} < 50`);
                continue;
            }
            if (tradeType === 'PE' && rdx > 50) {
                this.logger.debug(`[${stock.symbol}] GANN_9 PE blocked: RDX=${rdx.toFixed(1)} > 50`);
                continue;
            }

            const ltpBeyondPct = tradeType === 'CE'
                ? (ltp - trigger) / trigger
                : (trigger - ltp) / trigger;
            const riskPts   = Math.abs(trigger - sl);
            const rewardPts = Math.abs(target - trigger);
            this.logger.log(
                `📋 GANN_9 PRE-ENTRY SIGNAL: [${stock.symbol}] ${tradeType} | ` +
                `Trigger ₹${trigger.toFixed(2)} | LTP ₹${ltp} (dist ${(ltpBeyondPct * 100).toFixed(2)}%) | ` +
                `SL ₹${sl.toFixed(2)} | Target ₹${target.toFixed(2)} | ` +
                `Risk ₹${riskPts.toFixed(2)} | Reward ₹${rewardPts.toFixed(2)} | ` +
                `R:R 1:${(rewardPts / riskPts).toFixed(1)} | RDX ${rdx.toFixed(1)}`
            );
            await this.addToWatchlist(stock.symbol, trigger, tradeType, target, sl, 'GANN_9');
        }
    }

    // ─── Shared exit helpers ────────────────────────────────────────────────────

    /** Bid protection: never use a bid that is more than 2% below LTP (abnormal spread). */
    private computeEffectivePrice(bidPrice: number, ltp: number): number {
        return bidPrice > 0 ? Math.max(bidPrice, ltp * 0.98) : ltp;
    }

    /**
     * Called on every NFO option tick from the WS handler (via setImmediate).
     * Performs an instant exit check for the matching active position.
     * Fast path: O(1) position lookup, no REST calls for the option price.
     */
    private async handleInstantOptionTick(
        token: string,
        tick: { ltp: number; bidPrice: number; askPrice: number; timestamp: number }
    ): Promise<void> {
        if (!this.isMarketHours()) return;

        const pos = this.paperTrading.getActivePositionByToken(token);
        if (!pos) return;

        if (this.closingTokens.has(token)) {
            this.logger.debug(`[SKIP] Position already closing: ${token}`);
            return;
        }

        const effectivePrice = this.computeEffectivePrice(tick.bidPrice, tick.ltp);
        const optionInfo = {
            ltp: tick.ltp,
            bidPrice: tick.bidPrice,
            askPrice: tick.askPrice > 0 ? tick.askPrice : tick.ltp,
        };
        this.paperTrading.updatePositionLTP(token, effectivePrice);
        await this.evaluateExitForPosition(pos, effectivePrice, optionInfo, 'WS');
    }

    /**
     * Core exit-evaluation logic shared by the WS-driven path and the 1s cron.
     * All SL/target/premium-stop decisions are made here — no duplicate code.
     *
     * source = 'WS'   → triggered by a live option tick (sub-second latency)
     * source = 'CRON' → triggered by the 1-second safety-net cron
     */
    private async evaluateExitForPosition(
        pos: PaperPosition,
        currentBid: number,
        optionInfo: { ltp: number; askPrice: number; bidPrice: number } | null,
        source: 'WS' | 'CRON'
    ): Promise<void> {
        const exitPrefix = source === 'WS' ? '[WS-EXIT]' : '[CRON-EXIT]';

        // Inner helper — places a limit sell for GANN_ANGLE/CANDLE_BREAKOUT target exits,
        // closes immediately for SL exits and all other strategies.
        // forceImmediate=true bypasses the limit queue (used for hard SL hits).
        const triggerExit = async (reason: string, forceImmediate = false): Promise<void> => {
            if (this.closingTokens.has(pos.token)) {
                this.logger.debug(`[SKIP] Position already closing: ${pos.token}`);
                return;
            }
            const sellKey = `SELL:${pos.token}`;
            if (!forceImmediate && pos.strategyName === 'CANDLE_BREAKOUT') {
                if (this.pendingLimitOrders.has(sellKey)) return; // already pending
                this.closingTokens.add(pos.token);
                const midPrice = parseFloat(((currentBid + (optionInfo?.askPrice ?? currentBid)) / 2).toFixed(2));
                this.pendingLimitOrders.set(sellKey, {
                    symbol: pos.symbol, token: pos.token, tradingSymbol: pos.tradingSymbol ?? '',
                    type: pos.type, qty: pos.qty, midPrice, orderType: 'SELL',
                    placedAt: Date.now(), strategyName: pos.strategyName, exitReason: reason,
                });
                this.logger.log(`📋 CANDLE_BREAKOUT LIMIT SELL: [${pos.symbol}] at mid ₹${midPrice}. Reason: ${reason}`);
            } else {
                this.closingTokens.add(pos.token);
                this.logger.warn(`${exitPrefix} Immediate exit triggered for token: ${pos.token} — ${reason}`);
                await this.paperTrading.closePosition(pos.token, currentBid, reason);
            }
        };

        // ── GANN_ANGLE exits ──────────────────────────────────────────────────────

        // 1. Time exit at 14:45
        if (pos.strategyName === 'GANN_ANGLE') {
            const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
            if (timeStr >= '14:45:00') {
                this.logger.warn(`⏰ [${pos.symbol}] GANN_ANGLE TIME EXIT: ${timeStr} >= 14:45. Closing immediately.`);
                await triggerExit('TIME_EXIT_14:45', true);
                return;
            }
        }

        // 2. Partial booking: book half lots at +5% premium, SL moves to cost/breakeven
        if (pos.strategyName === 'GANN_ANGLE' && pos.entryPrice > 0 && !this.gaPartialBooked.has(pos.token)) {
            const profitPct = (currentBid - pos.entryPrice) / pos.entryPrice;
            if (profitPct >= 0.05) {
                const lotSize   = pos.lotSize ?? 1;
                const totalLots = Math.round(pos.qty / lotSize);
                if (totalLots > 1) {
                    const halfLots = Math.floor(totalLots / 2);
                    const halfQty  = halfLots * lotSize;
                    await this.paperTrading.partialClosePosition(pos.token, halfQty, currentBid, 'PARTIAL_BOOK_5%');
                    this.gaPartialBooked.add(pos.token);
                    this.logger.log(`✂️ [GANN_ANGLE] PARTIAL BOOK 5%: [${pos.symbol}] ${halfQty} units @ ₹${currentBid.toFixed(2)}. SL → cost ₹${pos.entryPrice.toFixed(2)}.`);
                    return; // re-evaluate on next tick with updated position state
                }
            }
        }

        // 3. Premium SL: −5% from entry; after partial booking → cost/breakeven
        if (pos.strategyName === 'GANN_ANGLE' && pos.entryPrice > 0) {
            const premiumSl = this.gaPartialBooked.has(pos.token) ? pos.entryPrice : pos.entryPrice * 0.95;
            if (currentBid <= premiumSl) {
                if (this.closingTokens.has(pos.token)) { this.logger.debug(`[SKIP] Position already closing: ${pos.token}`); return; }
                this.closingTokens.add(pos.token);
                const reason = this.gaPartialBooked.has(pos.token)
                    ? `OPTION PREMIUM STOP (BREAKEVEN): bid ₹${currentBid.toFixed(2)} <= cost ₹${pos.entryPrice.toFixed(2)}`
                    : `OPTION PREMIUM STOP: bid ₹${currentBid.toFixed(2)} <= 95% of entry ₹${pos.entryPrice.toFixed(2)} (loss ${(((pos.entryPrice - currentBid) / pos.entryPrice) * 100).toFixed(1)}%)`;
                this.logger.warn(`🛑 [${pos.symbol}] ${reason}`);
                await this.paperTrading.closePosition(pos.token, currentBid, reason);
                return;
            }
        }

        // 4. Rupee target: exit when total P&L (remaining + partial) ≥ ₹3,000
        if (pos.strategyName === 'GANN_ANGLE' && pos.entryPrice > 0) {
            const totalPnl = (currentBid - pos.entryPrice) * pos.qty + (pos.partialPnl || 0);
            if (totalPnl >= 3000) {
                if (this.closingTokens.has(pos.token)) { this.logger.debug(`[SKIP] Position already closing: ${pos.token}`); return; }
                this.closingTokens.add(pos.token);
                const reason = `TARGET ₹3000 HIT: total P&L ₹${totalPnl.toFixed(0)} (bid ₹${currentBid.toFixed(2)}, entry ₹${pos.entryPrice.toFixed(2)})`;
                this.logger.warn(`🎯 [${pos.symbol}] ${reason}`);
                await this.paperTrading.closePosition(pos.token, currentBid, reason);
                return;
            }
        }

        // 5. Premium target: +10% from entry
        if (pos.strategyName === 'GANN_ANGLE' && pos.entryPrice > 0 && currentBid >= pos.entryPrice * 1.10) {
            if (this.closingTokens.has(pos.token)) { this.logger.debug(`[SKIP] Position already closing: ${pos.token}`); return; }
            this.closingTokens.add(pos.token);
            const reason = `TARGET HIT: option bid ₹${currentBid.toFixed(2)} >= +10% of entry ₹${pos.entryPrice.toFixed(2)}`;
            this.logger.warn(`🎯 [${pos.symbol}] ${reason}`);
            await this.paperTrading.closePosition(pos.token, currentBid, reason);
            return;
        }

        // 6. Spot SL: underlying 5-min candle CLOSE crosses R_67.5 (CE) or S_67.5 (PE)
        // Matches Nirwana: only exits when a 5-min candle has CLOSED past the level,
        // not on an intracandle LTP spike. Cache with 60s TTL to avoid per-second REST calls.
        if (pos.strategyName === 'GANN_ANGLE' && pos.slPrice) {
            const closeCacheKey = `GA_SPOT_CLOSE:${pos.symbol}`;
            let candleClose = await this.cacheManager.get<number>(closeCacheKey);
            if (candleClose === undefined || candleClose === null) {
                candleClose = await this.nseService.getLastCandleClose(pos.symbol, '5');
                if (candleClose) await this.cacheManager.set(closeCacheKey, candleClose, 60000);
            }
            if (candleClose) {
                const spotSlHit = pos.type === 'CE' ? candleClose < pos.slPrice : candleClose > pos.slPrice;
                if (spotSlHit) {
                    if (this.closingTokens.has(pos.token)) { this.logger.debug(`[SKIP] Position already closing: ${pos.token}`); return; }
                    this.closingTokens.add(pos.token);
                    const reason = `SPOT SL HIT: ${pos.symbol} 5m close ₹${candleClose} ${pos.type === 'CE' ? '<' : '>'} R/S_67.5 ₹${pos.slPrice.toFixed(2)}`;
                    this.logger.warn(`🛑 [${pos.symbol}] ${reason}`);
                    await this.paperTrading.closePosition(pos.token, currentBid, reason);
                    return;
                }
            }
        }

        // All GANN_ANGLE exits handled above — skip underlying LTP section
        if (pos.strategyName === 'GANN_ANGLE') return;

        // ── Option premium stop ──────────────────────────────────────────────────
        // GANN_9: exit at 60% of entry (wide stop for structural breakout trades)
        if (pos.strategyName === 'GANN_9' && pos.entryPrice > 0 && currentBid <= pos.entryPrice * 0.60) {
            if (this.closingTokens.has(pos.token)) { this.logger.debug(`[SKIP] Position already closing: ${pos.token}`); return; }
            this.closingTokens.add(pos.token);
            const reason = `OPTION PREMIUM STOP: bid ₹${currentBid} <= 60% of entry ₹${pos.entryPrice} (loss ${(((pos.entryPrice - currentBid) / pos.entryPrice) * 100).toFixed(1)}%). Exiting.`;
            this.logger.warn(`🛑 [${pos.symbol}] ${reason}`);
            this.logger.warn(`${exitPrefix} Immediate exit triggered for token: ${pos.token} — ${reason}`);
            await this.paperTrading.closePosition(pos.token, currentBid, reason);
            return;
        }

        // ── EMA_5: consume touch-exit flag set by scanner on candle close ───────
        if (pos.strategyName === 'EMA_5') {
            const emaExitFlag = await this.cacheManager.get(`EMA5_EXIT:${pos.symbol}`);
            if (emaExitFlag) {
                if (this.closingTokens.has(pos.token)) { this.logger.debug(`[SKIP] Position already closing: ${pos.token}`); return; }
                this.closingTokens.add(pos.token);
                await this.cacheManager.del(`EMA5_EXIT:${pos.symbol}`);
                const reason = 'EMA Touch Exit: Candle closed past 5 EMA';
                this.logger.warn(`📉 EMA TOUCH EXIT: [${pos.symbol}] Closing at Bid ₹${currentBid}`);
                this.logger.warn(`${exitPrefix} Immediate exit triggered for token: ${pos.token} — ${reason}`);
                await this.paperTrading.closePosition(pos.token, currentBid, reason);
                return;
            }
        }

        // ── Underlying SL / Target check ─────────────────────────────────────────
        if (pos.targetPrice && pos.slPrice) {
            // getBatchLTP reads from WS tick cache first (O(1) for subscribed stocks),
            // REST fallback only on cache miss — safe for both WS and CRON callers.
            const ltpMap = await this.nseService.getBatchLTP([pos.symbol]);
            const ltp = ltpMap[pos.symbol] ?? null;
            if (!ltp) return;

            this.paperTrading.updateStockLTP(pos.token, ltp);

            // EMA_5: trail SL to breakeven once 1:2 RR is reached on the underlying
            if (pos.strategyName === 'EMA_5') {
                const totalRange = Math.abs(pos.targetPrice - pos.slPrice);
                const emaRisk    = totalRange / 4;
                const stockEntry = pos.type === 'CE' ? pos.slPrice + emaRisk : pos.slPrice - emaRisk;
                const twoRLevel  = pos.type === 'CE' ? stockEntry + 2 * emaRisk : stockEntry - 2 * emaRisk;
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

            // CANDLE_BREAKOUT: phase 1 → half-exit at 1:1, phase 2 → trail by 0.125%
            if (pos.strategyName === 'CANDLE_BREAKOUT') {
                const phase1Price = parseFloat(((2 * pos.targetPrice! + pos.slPrice!) / 3).toFixed(2));
                if (!this.cbHalfExited.has(pos.token)) {
                    const phase1Hit = pos.type === 'CE' ? ltp >= phase1Price : ltp <= phase1Price;
                    if (phase1Hit) {
                        // Split at lot level, not raw units — 5 lots → exit 2, trail 3
                        const cfg = await this.shoonyaService.getConfig();
                        const configuredLots = pos.symbol === 'NIFTY'
                            ? (cfg.candleNiftyLots || 1)
                            : (cfg.candleBankNiftyLots || 1);
                        const lotSize = Math.round(pos.qty / configuredLots);
                        const halfLots = Math.floor(configuredLots / 2);
                        const halfQty  = halfLots * lotSize;
                        if (halfQty > 0) {
                            await this.paperTrading.partialClosePosition(pos.token, halfQty, currentBid, '1:1 R:R reached');
                            const breakevenUnderlying = parseFloat(((2 * pos.slPrice! + pos.targetPrice!) / 3).toFixed(2));
                            this.paperTrading.updatePositionSL(pos.token, breakevenUnderlying);
                            this.cbHalfExited.add(pos.token);
                            this.logger.log(
                                `✂️  2-CANDLE HALF EXIT: [${pos.symbol}] ${pos.type} 1:1 hit @ underlying ₹${ltp}. ` +
                                `Closed ${halfLots} lots (${halfQty} units) @ option ₹${currentBid.toFixed(2)}. ` +
                                `SL → breakeven ₹${breakevenUnderlying}. Trailing ${configuredLots - halfLots} lots (${pos.qty - halfQty} units).`
                            );
                        }
                    }
                } else {
                    const trailPts    = parseFloat((ltp * 0.00125).toFixed(2));
                    const newTrailSL  = pos.type === 'CE'
                        ? parseFloat((ltp - trailPts).toFixed(2))
                        : parseFloat((ltp + trailPts).toFixed(2));
                    const shouldUpdate = pos.type === 'CE' ? newTrailSL > pos.slPrice! : newTrailSL < pos.slPrice!;
                    if (shouldUpdate) {
                        this.logger.log(`📈 2-CANDLE TRAIL: [${pos.symbol}] ${pos.type} SL ₹${pos.slPrice} → ₹${newTrailSL} (underlying ₹${ltp})`);
                        this.paperTrading.updatePositionSL(pos.token, newTrailSL);
                    }
                }
            }

            if (pos.type === 'CE') {
                if (ltp >= pos.targetPrice) {
                    this.logger.warn(`🎯 TARGET HIT: [${pos.symbol}] Underlying reached ₹${ltp} >= Target ₹${pos.targetPrice}`);
                    await triggerExit(`Target Hit at ₹${ltp}`);
                } else if (ltp < pos.slPrice) {
                    if (pos.strategyName === 'CANDLE_BREAKOUT') {
                        this.logger.warn(`🛑 SL HIT: [${pos.symbol}] ₹${ltp} < SL ₹${pos.slPrice}. Closing at market bid ₹${currentBid}.`);
                        await triggerExit(`SL Broken at ₹${ltp}`, true);
                    } else if (!pos.slTriggerTime) {
                        this.paperTrading.updatePositionSLTrigger(pos.token, Date.now());
                        this.logger.debug(`⚠️ SL BREACH DETECTED: [${pos.symbol}] dropped to ₹${ltp} < SL ₹${pos.slPrice}. Starting SL timer.`);
                    } else {
                        const elapsed = Date.now() - pos.slTriggerTime;
                        const slSustainMs = pos.strategyName === 'EMA_5' ? 60_000 : pos.strategyName === 'GANN_9' ? 3 * 60_000 : 5 * 60_000;
                        const slLabel     = pos.strategyName === 'EMA_5' ? '1m'   : pos.strategyName === 'GANN_9' ? '3m'       : '5m';
                        if (elapsed >= slSustainMs) {
                            this.logger.warn(`🛑 STOP-LOSS HIT: [${pos.symbol}] Sustained below SL ₹${pos.slPrice} for ${slLabel}.`);
                            await triggerExit(`SL Hit at ₹${ltp} (${slLabel} Sustain)`);
                        } else {
                            this.logger.debug(`[${pos.symbol}] SL Breach. Wait ${Math.ceil((slSustainMs - elapsed) / 1000)}s more.`);
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
                    if (pos.strategyName === 'CANDLE_BREAKOUT') {
                        this.logger.warn(`🛑 SL HIT: [${pos.symbol}] ₹${ltp} > SL ₹${pos.slPrice}. Closing at market bid ₹${currentBid}.`);
                        await triggerExit(`SL Broken at ₹${ltp}`, true);
                    } else if (!pos.slTriggerTime) {
                        this.paperTrading.updatePositionSLTrigger(pos.token, Date.now());
                        this.logger.debug(`⚠️ SL BREACH DETECTED: [${pos.symbol}] rose to ₹${ltp} > SL ₹${pos.slPrice}. Starting SL timer.`);
                    } else {
                        const elapsed = Date.now() - pos.slTriggerTime;
                        const slSustainMs = pos.strategyName === 'EMA_5' ? 60_000 : pos.strategyName === 'GANN_9' ? 3 * 60_000 : 5 * 60_000;
                        const slLabel     = pos.strategyName === 'EMA_5' ? '1m'   : pos.strategyName === 'GANN_9' ? '3m'       : '5m';
                        if (elapsed >= slSustainMs) {
                            this.logger.warn(`🛑 STOP-LOSS HIT: [${pos.symbol}] Sustained above SL ₹${pos.slPrice} for ${slLabel}.`);
                            await triggerExit(`SL Hit at ₹${ltp} (${slLabel} Sustain)`);
                        } else {
                            this.logger.debug(`[${pos.symbol}] SL Breach. Wait ${Math.ceil((slSustainMs - elapsed) / 1000)}s more.`);
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

    // ─── 1-second safety-net cron ───────────────────────────────────────────────

    /**
     * Enforce underlying dynamic target and stop loss exits.
     * Runs every 1 second as a safety net alongside the WS-driven instant exits.
     * Uses WS tick for option price (5s freshness window) with REST fallback.
     */
    @Cron('*/1 * * * * *')
    async enforceDynamicExits() {
        if (!this.isMarketHours()) return;
        // NOTE: Never gate dynamic exits on trade limits — closing open positions must always run.

        const summary = await this.paperTrading.getPortfolioSummary();
        const positions = summary.positions;
        if (positions.length === 0) return;

        const priceUpdates: PositionPriceUpdate[] = [];

        for (const pos of positions) {
            if (this.closingTokens.has(pos.token)) {
                this.logger.debug(`[SKIP] Position already closing: ${pos.token}`);
                continue;
            }

            // Fetch option price — WS tick first, REST if stale / absent
            const tick = this.shoonyaService.getOptionTickPrice(pos.token);
            let currentBid = pos.currentLtp;
            let optionInfo: { ltp: number; askPrice: number; bidPrice: number } | null = null;

            if (tick && (Date.now() - tick.timestamp) < this.TICK_STALENESS_MS) {
                currentBid = this.computeEffectivePrice(tick.bidPrice, tick.ltp);
                optionInfo = { ltp: tick.ltp, bidPrice: tick.bidPrice, askPrice: tick.askPrice > 0 ? tick.askPrice : tick.ltp };
                this.paperTrading.updatePositionLTP(pos.token, currentBid);
                this.logger.debug(`[WS] Using tickCache price for token: ${pos.token} (bid ₹${currentBid})`);
            } else {
                optionInfo = await this.shoonyaService.getOptionQuote(pos.token);
                if (tick) {
                    this.logger.debug(`[STALE] Using REST fallback for token: ${pos.token} (tick ${Date.now() - tick.timestamp}ms old)`);
                } else {
                    this.logger.debug(`[REST] Fallback price used for token: ${pos.token} (no WS tick received yet)`);
                }
                if (optionInfo) {
                    currentBid = this.computeEffectivePrice(optionInfo.bidPrice, optionInfo.ltp);
                    this.paperTrading.updatePositionLTP(pos.token, currentBid);
                }
            }

            priceUpdates.push({ token: pos.token, ltp: currentBid, pnl: (currentBid - pos.entryPrice) * pos.qty });
            await this.evaluateExitForPosition(pos, currentBid, optionInfo, 'CRON');
        }

        if (this.priceGateway.hasClients()) {
            this.priceGateway.emitPositionPrices(priceUpdates);
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

            // Prefer WS tick for fill checks; fall back to REST if tick absent or stale
            const orderTick = this.shoonyaService.getOptionTickPrice(order.token);
            let currentLtp: number;
            let currentBid: number;

            if (orderTick && (Date.now() - orderTick.timestamp) < this.TICK_STALENESS_MS) {
                currentLtp = orderTick.ltp;
                currentBid = orderTick.bidPrice > 0 ? orderTick.bidPrice : orderTick.ltp;
                this.logger.debug(`[WS] Using tickCache price for token: ${order.token} (ltp ₹${currentLtp})`);
            } else {
                const optionInfo = await this.shoonyaService.getOptionQuote(order.token);
                if (!optionInfo) continue; // API unavailable — retry next cycle
                this.logger.debug(`[REST] Fallback price used for token: ${order.token}`);
                currentLtp = optionInfo.ltp;
                currentBid = optionInfo.bidPrice > 0 ? optionInfo.bidPrice : currentLtp;
            }

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
                        this.shoonyaService.subscribeOptionToken(order.token);
                    }
                    toDelete.push(key);

                } else if (elapsed >= TWO_MIN_MS) {
                    this.paperTrading.logFailedTrade(
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

    /** EOD: clear half-exit trackers and candle cache so next day starts fresh */
    @Cron('40 15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    clearCandleBreakoutState() {
        this.cbHalfExited.clear();
        this.gaPartialBooked.clear();
        this.logger.log('[EOD] Half-exit trackers cleared for new day.');
    }

    private async getLastCompletedCandle(symbol: string, interval: '1' | '3' | '5' = '5'): Promise<{ close: number; high: number; low: number } | null> {
        const token = this.nseService.getToken(symbol);
        if (!token) return null;
        try {
            const candles = await this.shoonyaService.getTimePriceSeries('NSE', token, interval, 2);
            if (!candles || candles.length < 2) return null;
            const c     = candles[1];
            const close = parseFloat(c?.intc || '0');
            const high  = parseFloat(c?.inth || '0');
            const low   = parseFloat(c?.intl || '0');
            if (close <= 0) return null;
            return { close, high, low };
        } catch (err: any) {
            this.logger.warn(`[${symbol}] ${interval}-min candle fetch failed: ${err.message}`);
            return null;
        }
    }

    private isMarketHours(): boolean {
        const now = new Date();
        const day = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
        if (day === 'Sat' || day === 'Sun') return false;
        const time = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        return time >= '09:00:00' && time <= '15:35:00';
    }
}
