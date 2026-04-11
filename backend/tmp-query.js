const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const history = await prisma.tradeHistory.findMany({
    where: {
      entryTime: { gte: startOfDay }
    },
    orderBy: { entryTime: 'desc' }
  });

  console.log("Today's Trade History/Rejections:");
  console.log(JSON.stringify(history, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
