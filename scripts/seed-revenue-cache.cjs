// Explicit local SEC-cache import for the three acceptance fixtures. No network/AI.
const fs=require('node:fs');const crypto=require('node:crypto');const assert=require('node:assert/strict');
process.loadEnvFile('apps/api/.env');const{PrismaClient}=require('@prisma/client');const{RevenueService}=require('../apps/api/dist/modules/revenue/revenue.service');
const db=new PrismaClient();const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
(async()=>{
 const before=hash(await db.aiSummary.findMany({orderBy:{id:'asc'}}));
 const noNetwork={getJson:async()=>{throw Error('network forbidden');},getText:async()=>{throw Error('network forbidden');}};
 const service=new RevenueService(db,noNetwork);
 for(const [name,ticker] of [['alphabet','GOOGL'],['apple','AAPL'],['nvidia','NVDA']]){
  const dir='/tmp/revenue-breakdown-validation/'+name;const metadata=JSON.parse(fs.readFileSync(dir+'/metadata.json'));const html=fs.readFileSync(dir+'/filing.htm','utf8');
  await db.company.createMany({data:[{cik:metadata.cik,ticker}],skipDuplicates:true});
  const company=await db.company.findUniqueOrThrow({where:{cik:metadata.cik}});
  const result=await service.ensure(metadata.cik,true,{metadata,html});assert.equal(result.status,'READY');
  assert.deepEqual(await db.company.findUniqueOrThrow({where:{cik:metadata.cik}}),company);
  assert.deepEqual((await service.ensure(metadata.cik)).groups,result.groups);
  console.log(JSON.stringify({name,cik:metadata.cik,groups:result.groups.length,rows:result.groups.reduce((n,g)=>n+g.rows.length,0),accession:result.accessionNumber}));
 }
 assert.equal(hash(await db.aiSummary.findMany({orderBy:{id:'asc'}})),before);console.log('AI summaries unchanged; only revenue cache imported.');
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>db.$disconnect());
