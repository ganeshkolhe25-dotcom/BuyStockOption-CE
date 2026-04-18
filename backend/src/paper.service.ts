import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { ShoonyaService } from './shoonya.service';

export interface PaperPosition {
    symbol: string;
    token: string;
    tradingSymbol?: string;
    type: 'CE' | 'PE';
    qty: number;
    entryPrice: number;
    currentLtp: number;
    dbEntryId?: string; // Links the live position to the SQLite database
    targetPrice?: number;
    slPrice?: number;
    slTriggerTime?: number;
    stockLtp: number;
    maxProfit: number;
    maxLoss: number;
    strategyName?: string;
}

@Injectable()
export class PaperTradingService implements OnModuleInit {
    private readonly logger = new Logger(PaperTradingService.name);

    private initialFunds = 100000; // Default 1 Lakh — overridden by DB value on init
    private DEFAULT_MAX_LOSS = -10000; // Risk Guard Limit per strategy
    private haltedStrategies = new Set<string>();

    private activePositions: Map<string, PaperPosition> = new Map();

    constructor(
        private readonly prisma: PrismaService,
        private readonly shoonyaService: ShoonyaService,
    ) { }

    async getPositions() {
        return this.prisma.tradeHistory.findMany({ where: { status: 'OPEN' } });
    }

    async onModuleInit() {
        try {
            // On restart, reconcile any OPEN trades that had been active.
            // We preserve the last known entryPrice as both entry and exit so P&L is 0 (unknown exit),
            // but we only do this for trades older than 15 minutes — trades placed in the last 15 mins
            // are likely from a same-session restart (e.g. health-check cold start) and should stay OPEN.
            const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
            const orphaned = await this.prisma.tradeHistory.findMany({
                where: { status: 'OPEN', entryTime: { lt: fifteenMinsAgo } }
            });

            if (orphaned.length > 0) {
                for (const trade of orphaned) {
                    let exitPrice: number | null = null;
                    let exitReason = 'Reconciled: Position open at system restart — exit price unknown.';

                    // Attempt live bid price so P&L is meaningful, not null
                    try {
                        const quote = await this.shoonyaService.getOptionQuote(trade.token);
                        if (quote && quote.bidPrice > 0) {
                            exitPrice = quote.bidPrice;
                            exitReason = `Reconciled: Closed at live bid ₹${exitPrice} on system restart.`;
                        }
                    } catch { /* fall through to null P&L */ }

                    const realizedPnl = exitPrice !== null
                        ? parseFloat(((exitPrice - trade.entryPrice) * trade.quantity).toFixed(2))
                        : null;

                    await this.prisma.tradeHistory.update({
                        where: { id: trade.id },
                        data: { status: 'CLOSED', exitReason, exitTime: new Date(), exitPrice, realizedPnl }
                    });
                }
                this.logger.warn(`Reconciled ${orphaned.length} orphaned OPEN trade(s) from previous session.`);
            }
        } catch (e) {
            this.logger.error('Failed to cleanup orphaned trades on init', e);
        }

        // ── Restore halt state + initialFunds from DB across restarts ──
        try {
            const config = await this.prisma.shoonyaConfig.findFirst();
            if (config) {
                if (config.gann9Halted)     this.haltedStrategies.add('GANN_9');
                if (config.gannAngleHalted) this.haltedStrategies.add('GANN_ANGLE');
                if (config.ema5Halted)      this.haltedStrategies.add('EMA_5');
                if (this.haltedStrategies.size > 0) {
                    this.logger.warn(`⚠️ Halt state restored from DB: [${Array.from(this.haltedStrategies).join(', ')}]`);
                }
                if (config.initialFunds && config.initialFunds > 0) {
                    this.initialFunds = config.initialFunds;
                    this.logger.log(`💰 Capital restored from DB: ₹${this.initialFunds.toLocaleString()}`);
                }
            }
        } catch (e) {
            this.logger.error('Failed to restore halt state from DB on init', e);
        }
    }

    /**
     * Store failed trades into the Ledger directly (e.g. Broken API, Missing Options)
     */
    async logFailedTrade(symbol: string, type: string, triggerPrice: number, reason: string, strategyName?: string) {
        await this.prisma.tradeHistory.create({
            data: {
                symbol,
                token: "FAILED",
                type: type as "CE" | "PE",
                quantity: 0,
                entryPrice: triggerPrice,
                status: 'REJECTED',   // REJECTED is excluded from isTradingHaltedForDay count
                isPaperTrade: true,
                exitReason: reason,
                exitTime: new Date(),
                realizedPnl: 0,
                strategyName: strategyName || 'UNKNOWN'
            }
        });
        this.logger.error(`Trade Rejected for [${symbol}] ${type}. Reason: ${reason}`);
    }

    /**
     * Executes a paper-traded Buy Order for Options
     */
    async placeBuyOrder(symbol: string, token: string, tradingSymbol: string, type: 'CE' | 'PE', qty: number, price: number, targetPrice?: number, slPrice?: number, strategyName?: string) {
        if (this.isTradingHalted) {
            const msg = `Market Close: Universal exit triggered. No new orders.`;
            await this.logFailedTrade(symbol, type, price, msg, strategyName);
            this.logger.warn(`TRADE REJECTED: ${msg}`);
            return false;
        }

        // Enforce per-day trade count limits at order placement (not at scan time)
        if (await this.isTradingHaltedForDay(strategyName)) {
            const msg = `Daily trade limit reached for ${strategyName || 'overall'}. Signal missed.`;
            await this.logFailedTrade(symbol, type, price, msg, strategyName);
            this.logger.warn(`TRADE REJECTED: ${msg} [${symbol}]`);
            return false;
        }

        const requiredMargin = qty * price;

        const summary = await this.getPortfolioSummary();

        // Guard: max 3 concurrent open positions per strategy to prevent capital concentration.
        // E.g., if 5 GANN_9 signals fire in the same minute, only 3 will be accepted.
        if (strategyName) {
            const openCountForStrategy = summary.positions.filter(
                (p: any) => p.strategyName === strategyName
            ).length;
            const MAX_CONCURRENT = 3;
            if (openCountForStrategy >= MAX_CONCURRENT) {
                const msg = `STRATEGY REJECT: ${strategyName} already has ${openCountForStrategy} open positions (max ${MAX_CONCURRENT} concurrent).`;
                await this.logFailedTrade(symbol, type, price, msg);
                this.logger.warn(msg);
                return false;
            }
        }

        if (requiredMargin > summary.availableFunds) {
            const errorMsg = `PAPER REJECTED: Insufficient Funds. Need ₹${requiredMargin.toFixed(2)}, Available: ₹${summary.availableFunds.toFixed(2)}`;
            await this.logFailedTrade(symbol, type, price, errorMsg);
            this.logger.error(errorMsg);
            return false;
        }

        // Immediately persist the open trade into SQLite Database Memory
        const dbRecord = await this.prisma.tradeHistory.create({
            data: {
                symbol,
                token,
                tradingSymbol,
                type,
                quantity: qty,
                entryPrice: price,
                status: 'OPEN',
                isPaperTrade: true,
                strategyName: strategyName || 'Default'
            }
        });

        this.activePositions.set(token, {
            symbol,
            token,
            tradingSymbol,
            type,
            qty,
            entryPrice: price,
            currentLtp: price, // Initial LTP = Entry
            dbEntryId: dbRecord.id,
            targetPrice,
            slPrice,
            stockLtp: 0,
            maxProfit: 0,
            maxLoss: 0,
            strategyName: strategyName || 'Default'
        } as any); // Cast to any temporarily to avoid interface mismatch if not updated

        this.logger.log(`✅ PAPER SETTLED: Bought ${qty} shares of [${symbol}] ${type} Token ${token} (${tradingSymbol}) at ₹${price}.`);
        return true;
    }

    /**
     * Updates the Options LTP
     */
    updatePositionLTP(token: string, newLtp: number) {
        const position = this.activePositions.get(token);
        if (position) {
            position.currentLtp = newLtp;
            const currentPnl = (newLtp - position.entryPrice) * position.qty;
            if (currentPnl > position.maxProfit) position.maxProfit = currentPnl;
            if (currentPnl < position.maxLoss) position.maxLoss = currentPnl;
            this.activePositions.set(token, position);
        }
    }

    /**
     * Updates the underlying Stock's real-time LTP
     */
    updateStockLTP(token: string, stockLtp: number) {
        const position = this.activePositions.get(token);
        if (position) {
            position.stockLtp = stockLtp;
            this.activePositions.set(token, position);
        }
    }

    /**
     * Moves the stock-level SL for a position (e.g. trail to breakeven)
     */
    updatePositionSL(token: string, newSL: number) {
        const position = this.activePositions.get(token);
        if (position) {
            position.slPrice = newSL;
            position.slTriggerTime = undefined; // Reset any active breach timer
            this.activePositions.set(token, position);
        }
    }

    /**
     * Updates the SL Trigger time when a position breaches its SL
     */
    updatePositionSLTrigger(token: string, triggerTime?: number) {
        const position = this.activePositions.get(token);
        if (position) {
            position.slTriggerTime = triggerTime;
            this.activePositions.set(token, position);
        }
    }

    /**
     * Close a specific position and settle funds (Persists to SQLite Database)
     */
    async closePosition(token: string, exitPrice: number, reason: string = 'Target/SL Hit') {
        const position = this.activePositions.get(token);
        if (!position) return;

        // For Option Buying, Profit = (Exit Price - Entry Price) * Qty
        const pnl = (exitPrice - position.entryPrice) * position.qty;

        // Update database explicitly indicating the trade is over
        if (position.dbEntryId) {
            await this.prisma.tradeHistory.update({
                where: { id: position.dbEntryId },
                data: {
                    exitPrice: exitPrice,
                    realizedPnl: parseFloat(pnl.toFixed(2)),
                    maxProfit: parseFloat(position.maxProfit.toFixed(2)),
                    maxLoss: parseFloat(position.maxLoss.toFixed(2)),
                    exitTime: new Date(),
                    exitReason: reason,
                    status: 'CLOSED'
                }
            });
        }

        this.activePositions.delete(token);

        this.logger.log(`🔒 POSITION CLOSED: [${position.symbol}] ${position.type} closed at ₹${exitPrice}. P&L: ₹${pnl.toFixed(2)}. Reason: ${reason}`);
    }

    /**
     * Calculate Live Unrealized P&L
     */
    getLiveUnrealizedPnl(): number {
        let unrealized = 0;
        for (const pos of this.activePositions.values()) {
            unrealized += (pos.currentLtp - pos.entryPrice) * pos.qty;
        }
        return unrealized;
    }

    /**
     * Helper to get list of unique symbols traded today
     */
    async getTodayTradedSymbols(strategyName?: string): Promise<string[]> {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const filter: any = {
            entryTime: { gte: startOfDay },
            isPaperTrade: true
        };

        if (strategyName) {
            filter.strategyName = strategyName;
        }

        const trades = await this.prisma.tradeHistory.findMany({
            where: filter,
            select: { symbol: true }
        });

        return Array.from(new Set(trades.map(t => t.symbol)));
    }

    /**
     * Get summary for the Dashboard
     */
    async getPortfolioSummary() {
        const unrealized = this.getLiveUnrealizedPnl();

        // Always read initialFunds fresh from DB so config changes reflect immediately without restart
        const cfg = await this.prisma.shoonyaConfig.findFirst();
        const initialFunds = (cfg?.initialFunds && cfg.initialFunds > 0) ? cfg.initialFunds : this.initialFunds;
        this.initialFunds = initialFunds; // keep in-memory in sync for margin checks

        // Get all OPEN trades from database to calculate exact margin blocked
        const openTrades = await this.prisma.tradeHistory.findMany({ where: { status: 'OPEN' } });
        let blockedMargin = 0;
        openTrades.forEach(t => { blockedMargin += (t.quantity * t.entryPrice); });

        // Calculate today's realized PnL natively
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const todayClosedTrades = await this.prisma.tradeHistory.aggregate({
            _sum: { realizedPnl: true },
            where: { status: 'CLOSED', exitTime: { gte: startOfDay } }
        });
        const dailyRealizedPnl = todayClosedTrades._sum.realizedPnl || 0;

        const dailyTotalPnl = dailyRealizedPnl + unrealized;

        // Fetch cumulative PNL from DB
        const allClosedTrades = await this.prisma.tradeHistory.aggregate({
            _sum: { realizedPnl: true },
            where: { status: 'CLOSED' }
        });
        const cumulativeRealized = allClosedTrades._sum.realizedPnl || 0;
        const cumulativeTotalPnl = cumulativeRealized + unrealized;

        // Available Capital = Initial + All Time Realized Profit - Margin blocked in active trades
        const dynamicallyCalculatedAvailableFunds = initialFunds + cumulativeRealized - blockedMargin;

        // Fetch daily grouped PNL for the ledger
        const dailyStatsRaw = await this.prisma.tradeHistory.findMany({
            where: { status: 'CLOSED' },
            select: { exitTime: true, realizedPnl: true },
            orderBy: { exitTime: 'desc' },
            take: 1000
        });

        const dailyLedger: Record<string, number> = {};
        dailyStatsRaw.forEach(t => {
            if (t.exitTime) {
                const dateKey = t.exitTime.toISOString().split('T')[0];
                dailyLedger[dateKey] = (dailyLedger[dateKey] || 0) + (t.realizedPnl || 0);
            }
        });

        return {
            initialFunds: initialFunds,
            totalCapital: initialFunds + cumulativeRealized,
            usedCapital: blockedMargin,
            availableFunds: dynamicallyCalculatedAvailableFunds,
            dailyRealizedPnl: dailyRealizedPnl,
            dailyTotalPnl: dailyTotalPnl,
            cumulativeTotalPnl: cumulativeTotalPnl,
            unrealizedPnl: unrealized,
            activePositionsCount: this.activePositions.size,
            isHalted: this.isTradingHalted,
            isRiskGuardHalted: dailyTotalPnl <= this.DEFAULT_MAX_LOSS,
            haltedStrategies: Array.from(this.haltedStrategies),
            positions: Array.from(this.activePositions.values()),
            dailyLedger: Object.entries(dailyLedger).map(([date, pnl]) => ({ date, pnl })).slice(0, 7) // Last 7 days
        };
    }

    /** Refresh in-memory initialFunds from DB — called after config save so margin checks are current */
    async syncCapital(): Promise<void> {
        const cfg = await this.prisma.shoonyaConfig.findFirst();
        if (cfg?.initialFunds && cfg.initialFunds > 0) {
            this.initialFunds = cfg.initialFunds;
            this.logger.log(`💰 Capital synced from config: ₹${this.initialFunds.toLocaleString()}`);
        }
    }

    private isTradingHalted = false;

    /**
     * Check if Universal Exit triggered a halt system-wide or per-strategy
     * Also checks if the DAILY MAX TRADES limit has been reached for this strategy.
     */
    async isTradingHaltedForDay(strategyName?: string): Promise<boolean> {
        if (this.isTradingHalted) return true;
        if (strategyName && this.haltedStrategies.has(strategyName)) return true;

        const config = await this.prisma.shoonyaConfig.findFirst();
        if (!config) return false;

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        if (strategyName) {
            const count = await this.prisma.tradeHistory.count({
                where: {
                    strategyName: strategyName,
                    entryTime: { gte: startOfDay },
                    status: { not: 'REJECTED' },
                    token: { not: 'FAILED' }  // exclude logFailedTrade records
                }
            });

            let limit = config.maxTrades; // Default
            if (strategyName === 'GANN_ANGLE') limit = config.gannAngleMaxTrades;
            else if (strategyName === 'EMA_5') limit = config.ema5MaxTrades;
            else if (strategyName === 'GANN_9') limit = config.gann9MaxTrades;

            if (count >= limit) {
                this.logger.debug(`[${strategyName}] Limit Reached: ${count}/${limit} trades taken today.`);
                return true;
            }
        } else {
            // Overall Check
            const count = await this.prisma.tradeHistory.count({
                where: {
                    entryTime: { gte: startOfDay },
                    status: { not: 'REJECTED' },
                    token: { not: 'FAILED' }  // exclude logFailedTrade records
                }
            });
            if (count >= config.maxTrades) {
                this.logger.debug(`Overall Max Trades (${config.maxTrades}) reached. Halted.`);
                return true;
            }
        }

        return false;
    }

    /**
     * Expose Shoonya config to other services (e.g. HeartbeatService) without injecting Prisma everywhere
     */
    async getStrategyConfig() {
        return this.prisma.shoonyaConfig.findFirst();
    }

    /**
     * Get specific loss limit from DB or fallback
     */
    private async getStrategyLossLimit(strategyName: string) {
       const config = await this.prisma.shoonyaConfig.findFirst();
       if (!config) return this.DEFAULT_MAX_LOSS;
       if (strategyName === 'GANN_9') return config.gann9MaxLoss;
       if (strategyName === 'GANN_ANGLE') return config.gannAngleMaxLoss;
       if (strategyName === 'EMA_5') return config.ema5MaxLoss;
       return this.DEFAULT_MAX_LOSS;
    }

    /**
     * Get specific profit limit from DB or fallback
     */
    private async getStrategyProfitLimit(strategyName: string) {
       const config = await this.prisma.shoonyaConfig.findFirst();
       if (!config) return Math.abs(this.DEFAULT_MAX_LOSS) * 2;
       if (strategyName === 'GANN_9') return config.gann9MaxProfit;
       if (strategyName === 'GANN_ANGLE') return config.gannAngleMaxProfit;
       if (strategyName === 'EMA_5') return config.ema5MaxProfit;
       return Math.abs(this.DEFAULT_MAX_LOSS) * 2;
    }

    /** Persist a strategy halt to DB so it survives server restarts */
    private async persistStrategyHalt(strategy: string): Promise<void> {
        const field = strategy === 'GANN_9' ? { gann9Halted: true }
            : strategy === 'GANN_ANGLE'     ? { gannAngleHalted: true }
            :                                 { ema5Halted: true };
        await this.prisma.shoonyaConfig.updateMany({ data: field });
    }

    /**
     * Daily Reset Cron at 9:00 AM IST (Before Market Open)
     */
    @Cron('0 09 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async resetDailyPortfolio() {
        this.logger.log('🌅 Resetting Paper Portfolio for the new Trading Day.');
        this.isTradingHalted = false;
        this.haltedStrategies.clear();
        await this.prisma.shoonyaConfig.updateMany({
            data: { gann9Halted: false, gannAngleHalted: false, ema5Halted: false }
        });
    }

    /**
     * Universal Exit Monitor - Checks Every 10 Seconds
     * Triggers if 3:15 PM is hit
     */
    @Cron('*/10 * * * * *')
    async monitorUniversalExit() {
        if (this.isTradingHalted || this.activePositions.size === 0) return;

        const now = new Date();
        const mtkTimeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }); // e.g., "15:00:00"

        // 1. Time-Based Exit at 3:15 PM (Intraday Auto-Square Off)
        // Note: 15:15:00 is exactly 3:15 PM IST.
        // It stays active until midnight so late restarts still square off positions.
        if (mtkTimeStr >= '15:15:00') {
            const exitReason = 'UNIVERSAL EXIT: 3:15 PM Intraday Auto-Square Off';
            this.logger.warn(`🔔 ${exitReason}`);
            for (const pos of Array.from(this.activePositions.values())) {
                await this.closePosition(pos.token, pos.currentLtp, exitReason);
            }
            return;
        }

        // 2. Strategy-Based Risk Guard (-10k default per strategy)
        const strategies = ['GANN_9', 'GANN_ANGLE', 'EMA_5'];
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        for (const strategy of strategies) {
           let strategyPnl = 0;
           // Add unrealized PnL for strategy
           for (const pos of this.activePositions.values()) {
              if ((pos.strategyName || 'GANN_9') === strategy) {
                 strategyPnl += (pos.currentLtp - pos.entryPrice) * pos.qty;
              }
           }
           // Add realized PnL
           const closedTrades = await this.prisma.tradeHistory.aggregate({
               _sum: { realizedPnl: true },
               where: { status: 'CLOSED', exitTime: { gte: startOfDay }, strategyName: strategy }
           });
           strategyPnl += (closedTrades._sum.realizedPnl || 0);

           const lossLimit = await this.getStrategyLossLimit(strategy);
           const profitLimit = await this.getStrategyProfitLimit(strategy);
           
           if (strategyPnl <= lossLimit && !this.haltedStrategies.has(strategy)) {
               this.logger.warn(`🛑 TRIGGERING STRATEGY UNIVERSAL EXIT! Reason: ${strategy} Loss Exceeded ${lossLimit} threshold. (Current: ₹${strategyPnl.toFixed(2)})`);
               this.haltedStrategies.add(strategy);
               await this.persistStrategyHalt(strategy); // Survive server restart

               // Liquidate ONLY this strategy's active positions
               const positions = Array.from(this.activePositions.values()).filter(p => (p.strategyName || 'GANN_9') === strategy);
               for (const pos of positions) {
                   await this.closePosition(pos.token, pos.currentLtp, `RISK GUARD TRIGGERED: ${strategy} Loss Hit`);
               }
           } else if (strategyPnl >= profitLimit && !this.haltedStrategies.has(strategy)) {
               this.logger.warn(`🎯 TRIGGERING STRATEGY UNIVERSAL EXIT! Reason: ${strategy} Profit Exceeded ${profitLimit} Target. Locking in Day Profits! (Current: ₹${strategyPnl.toFixed(2)})`);
               this.haltedStrategies.add(strategy);
               await this.persistStrategyHalt(strategy); // Survive server restart

               // Liquidate ONLY this strategy's active positions to lock in the wins
               const positions = Array.from(this.activePositions.values()).filter(p => (p.strategyName || 'GANN_9') === strategy);
               for (const pos of positions) {
                   await this.closePosition(pos.token, pos.currentLtp, `PROFIT LOCK TRIGGERED: ${strategy} Target Hit`);
               }
           }
        }
    }
    /**
     * Clear all ghost trades and reset available margin to 300k
     */
    async resetAllPositionsForCapital() {
        this.logger.warn('⚠️ RESET SIGNAL RECEIVED: Clearing all active and open trades to restore capital.');
        
        // 1. Clear In-Memory
        this.activePositions.clear();

        // 2. Mark all OPEN in DB as closed/reconciled
        await this.prisma.tradeHistory.updateMany({
            where: { status: 'OPEN' },
            data: {
                status: 'CLOSED',
                exitReason: 'Manual Capital Reset',
                exitTime: new Date(),
                realizedPnl: 0
            }
        });

        this.isTradingHalted = false;
        return true;
    }
}
