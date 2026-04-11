const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const startOfDay = new Date('2026-03-20T00:00:00.000Z');
    const endOfDay = new Date('2026-03-20T23:59:59.999Z');

    const history = await prisma.tradeHistory.findMany({
        where: {
            symbol: 'LT',
            entryTime: {
                gte: startOfDay,
                lte: endOfDay
            }
        },
        orderBy: { entryTime: 'asc' }
    });

    console.log("LT Trades on 20th March 2026:");
    console.log(JSON.stringify(history, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
