const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  try {
    const initialFunds = 300000;
    const allClosed = await prisma.tradeHistory.aggregate({
      _sum: { realizedPnl: true },
      where: { status: 'CLOSED' }
    });
    const cumulativeRealized = allClosed._sum.realizedPnl || 0;
    const openTrades = await prisma.tradeHistory.findMany({
      where: { status: 'OPEN' }
    });
    let blockedMargin = 0;
    openTrades.forEach(t => {
      blockedMargin += (t.quantity * t.entryPrice);
    });
    const totalCapital = initialFunds + cumulativeRealized;
    const availableFunds = totalCapital - blockedMargin;
    console.log(JSON.stringify({
      initialFunds,
      cumulativeRealized,
      totalCapital,
      blockedMargin,
      availableFunds
    }, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
