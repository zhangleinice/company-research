// Read-only acceptance: persisted SEC caches, HTTP GET and pure React rendering.
const fs=require('node:fs');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const{createElement}=require('react');const{renderToStaticMarkup}=require('react-dom/server');
process.loadEnvFile('apps/api/.env');const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();
(async()=>{
 const{RevenueTables}=await import('../apps/web/.test-dist/src/RevenueBreakdown.js');
 const output=[];
 for(const [cik,item,expected] of [['0001652044','Google Cloud','58705000000'],['0000320193','iPhone','254098000000'],['0001045810','Data Center','193737000000']]){
  const stored=await db.revenueBreakdownCache.findUniqueOrThrow({where:{companyCik:cik}});
  const response=await fetch(`http://localhost:3000/api/companies/${cik}/revenue-breakdown`);assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.groups,stored.data);
  const proxy=await fetch(`http://localhost:5173/api/companies/${cik}/revenue-breakdown`);assert.equal(proxy.status,200);assert.deepEqual(await proxy.json(),body);
  const row=body.groups.flatMap(g=>g.rows).find(r=>r.name===item);assert.ok(row);assert.equal(row.facts.find(f=>f.fiscalYear===body.fiscalYear).value,expected);
  const html=renderToStaticMarkup(createElement(RevenueTables,{data:body}));assert.equal((html.match(/ant-table-wrapper/g)||[]).length,body.groups.length);assert.ok(html.includes(item));assert.ok(html.includes('百万美元'));assert.ok(html.includes('SEC 原始 10-K'));
  fs.writeFileSync(`/tmp/revenue-${cik}-ui.html`,html);
  output.push({cik,groups:body.groups.length,rows:body.groups.reduce((n,g)=>n+g.rows.length,0),accession:body.accessionNumber,sample:{name:row.name,values:row.facts.map(f=>({year:f.fiscalYear,value:f.value,yoy:f.yoy.value}))}});
 }
 const current=crypto.createHash('sha256').update(JSON.stringify(await db.aiSummary.findMany({orderBy:{id:'asc'}}))).digest('hex');assert.equal(current,fs.readFileSync('/tmp/revenue-ai-hash.txt','utf8'));
 console.log(JSON.stringify({results:output,apiDatabaseAndProxyMatch:true,reactRenderingVerified:true,aiSummariesUnchanged:true},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>db.$disconnect());
