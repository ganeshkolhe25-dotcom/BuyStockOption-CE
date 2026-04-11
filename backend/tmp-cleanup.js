const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.tradeHistory.updateMany({
    where: { status: 'OPEN' },
    data: { status: 'CLOSED', exitReason: 'System Cleanup from Duplicate execution', exitPrice: 0, realizedPnl: 0 }
}).then(c => console.log('Fixed:', c)).finally(() => prisma.$disconnect());
