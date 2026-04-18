const {PrismaClient} = require('/app/node_modules/@prisma/client');
const c = new PrismaClient();
c.shoonyaConfig.findFirst()
  .then(r => console.log(JSON.stringify({vc: r.vc, uid: r.uid, appkey: r.appkey, expiryMonth: r.expiryMonth})))
  .finally(() => c.$disconnect());
