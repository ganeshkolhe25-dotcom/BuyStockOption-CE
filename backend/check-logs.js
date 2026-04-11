const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const logs = await prisma.tradeHistory.findMany({
      where: { 
        entryTime: { gte: today }
      },
      orderBy: { entryTime: 'desc' }
    });
    console.log(JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
