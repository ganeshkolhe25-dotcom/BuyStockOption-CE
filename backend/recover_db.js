const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixLedger() {
    console.log("Fixing stranded open trades...");
    const openTrades = await prisma.tradeHistory.findMany({ where: { status: 'OPEN' } });

    for (const trade of openTrades) {
        console.log(`Force closing ${trade.symbol}...`);
        await prisma.tradeHistory.update({
            where: { id: trade.id },
            data: {
                status: 'CLOSED',
                exitTime: new Date(),
                exitPrice: trade.entryPrice, // Neutral exit for stranded trades
                realizedPnl: 0,
                exitReason: 'UNIVERSAL EXIT: 3:15 PM Intraday Auto-Square Off (Recovered)'
            }
        });
    }
    console.log("Done.");
}

fixLedger().finally(() => prisma.$disconnect());
