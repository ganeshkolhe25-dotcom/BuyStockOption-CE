const { PrismaClient } = require('/app/node_modules/@prisma/client');
const p = new PrismaClient();
p.tradeHistory.deleteMany({ where: { strategyName: null } })
  .then(r => console.log('DELETED:', r.count))
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => p.$disconnect());
