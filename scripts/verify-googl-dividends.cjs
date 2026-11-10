// GOOGL only. No SEC/AI requests or complete company updates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { normalizeCompanyFacts } = require('../apps/api/dist/modules/financials/normalize-company-facts');
if(fs.existsSync('apps/api/.env'))process.loadEnvFile('apps/api/.env');
const db=new PrismaClient();
const cik='0001652044';
const fields=['stockRepurchases','dividendsPaid','dividendsPerShare','dpsGrowth','dilutedShares','basicShares','dilutedSharesGrowth'];
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const untouched=row=>{
  const copy={...row,sources:{...row.sources}};
  for(const field of fields){delete copy[field];delete copy.sources[field];}
  return digest(copy);
};
async function main(){
  const path=process.env.GOOGL_FACTS_PATH || '/tmp/googl-health-companyfacts.json';
  const raw=JSON.parse(fs.readFileSync(path,'utf8'));
  assert.equal(String(raw.cik).padStart(10,'0'),cik);
  const parsed=normalizeCompanyFacts(raw);
  const annual2025=parsed.annual.find(p=>p.fiscalYear===2025);
  assert.equal(annual2025.dividendsPerShare,.83);
  assert.ok(Math.abs(annual2025.dpsGrowth-38.3333333333)<1e-7);
  assert.equal(annual2025.dilutedShares,12230000000);
  assert.equal(annual2025.stockRepurchases,45709000000);
  assert.equal(annual2025.dividendsPaid,10049000000);
  for(const p of [...parsed.annual,...parsed.quarterly]) {
    for(const k of ['stockRepurchases','dividendsPaid','dividendsPerShare','dilutedShares']) {
      if(p[k]===null)continue;
      const source=p.sources[k];
      assert.ok(source && ['reported','ytd_difference'].includes(source.method));
      for(const item of source.items) assert.ok(raw.facts['us-gaap'][item.concept.split(':')[1]].units[item.unit].some(x=>x.accn===item.accn&&x.start===item.start&&x.end===item.end&&x.val===item.val));
    }
  }
  assert.equal(parsed.annual.find(p=>p.fiscalYear===2024).dividendsPerShare,.6);
  assert.equal(parsed.annual.find(p=>p.fiscalYear===2023).dividendsPerShare,null);
  assert.equal(parsed.annual.find(p=>p.fiscalYear===2024).dpsGrowth,null);
  const summariesBefore=await db.aiSummary.findMany({where:{companyCik:cik},orderBy:{id:'asc'}});
  const companyBefore=await db.company.findUniqueOrThrow({where:{cik}});
  const taskBefore=await db.aiTask.findMany({where:{companyCik:cik},orderBy:{id:'asc'}});
  if(process.argv.includes('--backfill')){
    await db.$transaction(async tx=>{
      const rows=await tx.$queryRaw`SELECT "financialStatus" FROM companies WHERE cik=${cik} FOR UPDATE`;
      assert.notEqual(rows[0].financialStatus,'FETCHING');
      for(const [model,periods] of [['annualFinancial',parsed.annual],['quarterlyFinancial',parsed.quarterly]]){
        for(const p of periods){
          const where={companyCik_periodEnd:{companyCik:cik,periodEnd:new Date(p.periodEnd)}};
          const before=await tx[model].findUnique({where});
          if(!before)continue;
          const sources={...before.sources};
          for(const field of fields){delete sources[field];if(p.sources[field])sources[field]=p.sources[field];}
          const after=await tx[model].update({where,data:{...Object.fromEntries(fields.map(k=>[k,p[k]])),sources}});
          assert.equal(untouched(before),untouched(after),'Other financial fields must remain unchanged');
        }
      }
    });
  }
  const output={cik,cacheModified:fs.statSync(path).mtime.toISOString(),annual:[],quarterly:[],apiVerified:false};
  for(const [model,key] of [['annualFinancial','annual'],['quarterlyFinancial','quarterly']]){
    const stored=await db[model].findMany({where:{companyCik:cik},orderBy:{periodEnd:'desc'},take:10});
    for(const p of stored){
      const expected=parsed[key].find(x=>x.periodEnd===p.periodEnd.toISOString().slice(0,10));
      if(!expected)continue;
      for(const field of fields){
        const actual=p[field]===null?null:Number(p[field]);
        if(expected[field]===null)assert.equal(actual,null);
        else assert.ok(Math.abs(actual-expected[field])<1e-7,`${key} ${field} DB mismatch`);
      }
      output[key].push({end:expected.periodEnd,...Object.fromEntries(fields.map(k=>[k,expected[k]]))});
    }
  }
  if(process.argv.includes('--verify-api')){
    const response=await fetch('http://localhost:3000/api/companies/GOOGL');
    assert.equal(response.status,200);const body=await response.json();assert.equal(body.cik,cik);
    for(const key of ['annual','quarterly'])for(const expected of output[key]){
      const p=body[key].find(x=>x.periodEnd===expected.end);assert.ok(p);
      for(const field of fields){if(expected[field]===null)assert.equal(p[field],null);else assert.ok(Math.abs(p[field]-expected[field])<1e-7,`API ${key} ${field} mismatch`);}
    }
    const proxyResponse=await fetch('http://localhost:5173/api/companies/GOOGL');
    assert.equal(proxyResponse.status,200);
    assert.deepEqual(await proxyResponse.json(),body,'Vite proxy must return the same GOOGL cached data');
    output.apiVerified=true;output.proxyVerified=true;
    fs.writeFileSync('/tmp/googl-dividend-detail.json',JSON.stringify(body));
  }
  assert.equal(digest(summariesBefore),digest(await db.aiSummary.findMany({where:{companyCik:cik},orderBy:{id:'asc'}})),'AI summaries changed');
  assert.equal(digest(taskBefore),digest(await db.aiTask.findMany({where:{companyCik:cik},orderBy:{id:'asc'}})),'AI tasks changed');
  assert.equal(digest(companyBefore),digest(await db.company.findUniqueOrThrow({where:{cik}})),'Company/favorite state changed');
  output.aiSummariesUnchanged=true;output.otherFinancialFieldsUnchanged=true;
  console.log(JSON.stringify(output,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
