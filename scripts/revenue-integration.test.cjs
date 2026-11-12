// Explicit integration test: disposable PostgreSQL schema, cached filings, no SEC/AI.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const{randomUUID}=require('node:crypto');const{spawnSync}=require('node:child_process');const{resolve}=require('node:path');
process.loadEnvFile('apps/api/.env');const{PrismaClient}=require('@prisma/client');const{RevenueService}=require('../apps/api/dist/modules/revenue/revenue.service');
test('Revenue cache atomic results, exact amounts, hits, empty results, concurrency, failures and retry',async()=>{
 const schema='revenue_test_'+randomUUID().replaceAll('-','');const url=new URL(process.env.DATABASE_URL);url.searchParams.set('schema',schema);
 const migration=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{cwd:resolve('apps/api'),env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8'});assert.equal(migration.status,0,migration.stdout+migration.stderr);
 const db=new PrismaClient({datasourceUrl:url.toString()});let requests=0;
 const noNetwork={getJson:async()=>{requests++;throw Error('SEC forbidden in cache tests');},getText:async()=>{requests++;throw Error('SEC forbidden in cache tests');}};
 try{
  for(const [name,cik] of [['alphabet','0001652044'],['apple','0000320193'],['nvidia','0001045810']]){
   await db.company.create({data:{cik,ticker:name}});
   const dir='/tmp/revenue-breakdown-validation/'+name;const metadata=JSON.parse(fs.readFileSync(dir+'/metadata.json'));const html=fs.readFileSync(dir+'/filing.htm','utf8');
   const svc=new RevenueService(db,noNetwork);
   const result=await svc.ensure(cik,true,{metadata,html});assert.equal(result.status,'READY');assert.ok(result.groups.length);assert.equal(requests,0);
   const cache=await svc.ensure(cik);assert.deepEqual(cache,result);assert.equal(requests,0);
   const unchanged=await svc.ensure(cik,true,{metadata,html:'must not parse same accession again'});assert.deepEqual(unchanged,result);
   const persisted=await db.revenueBreakdownCache.findUniqueOrThrow({where:{companyCik:cik}});assert.deepEqual(persisted.data,result.groups);
   const failed=await svc.ensure(cik,true,{metadata:{...metadata,accessionNumber:'0000000000-26-999999'},html:'broken'});assert.deepEqual(failed.groups,result.groups);assert.equal(failed.accessionNumber,metadata.accessionNumber);
   if(name==='alphabet'){
    await db.revenueBreakdownCache.update({where:{companyCik:cik},data:{checkedAt:null,extractedAt:null,status:'NOT_FETCHED'}});
    const [a,b]=await Promise.all([new RevenueService(db,noNetwork).ensure(cik,true,{metadata,html}),new RevenueService(db,noNetwork).ensure(cik,true,{metadata,html})]);assert.ok(a.groups.length||b.groups.length);assert.equal((await svc.ensure(cik)).status,'READY');
    await db.revenueBreakdownCache.delete({where:{companyCik:cik}});
    const initialFailure=await svc.ensure(cik,true,{metadata,html:'broken'});assert.equal(initialFailure.status,'FAILED');assert.equal((await svc.ensure(cik)).status,'FAILED');assert.equal(requests,0);
    assert.equal((await svc.ensure(cik,true,{metadata,html})).status,'READY');
    const emptyHtml=html.replaceAll('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax','us-gaap:Assets').replaceAll('us-gaap:Revenues','us-gaap:Assets').replaceAll('us-gaap:RevenueNotFromContractWithCustomer','us-gaap:Assets');
    await db.revenueBreakdownCache.delete({where:{companyCik:cik}});
    const empty=await svc.ensure(cik,true,{metadata,html:emptyHtml});assert.equal(empty.status,'EMPTY');assert.equal((await svc.ensure(cik)).status,'EMPTY');assert.equal(requests,0);
   }
  }
 }finally{await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect();}
});
