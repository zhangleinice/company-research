// Read-only DB/API audit. --verify additionally calls cache-only initialization twice.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {parse}=require('dotenv');
const {PrismaClient}=require('@prisma/client');
const env=parse(fs.readFileSync('apps/api/.env'));
const db=new PrismaClient({datasourceUrl:env.DATABASE_URL});
const cik='0001652044';
const url=`http://localhost:3000/api/companies/${cik}`;
const counts=()=>{
  try {return fs.readFileSync('/tmp/company-update-live.log','utf8').split('\n').filter(x=>x.startsWith('UPSTREAM_COUNTS')).at(-1);}
  catch {return null;}
};
async function api(path='',method='GET'){
  const response=await fetch(url+path,{method});
  assert(response.ok,`API ${response.status}`);return response.json();
}
async function main(){
  const company=await db.company.findUniqueOrThrow({where:{cik}});
  const task=await db.aiTask.findUnique({where:{id:`${cik}:update`}});
  const summaries=await db.aiSummary.findMany({where:{companyCik:cik,promptVersion:'sec-research-v2'},orderBy:{section:'asc'}});
  const details=await api();
  console.log(JSON.stringify({company:{isFavorite:company.isFavorite,lastFetchedAt:company.lastFetchedAt,financialStatus:company.financialStatus},task:task&&{status:task.status,progress:task.progress},summaries:summaries.map(s=>({section:s.section,accession:s.accessionNumber,updatedAt:s.updatedAt,usage:s.usage,evidenceCount:s.summaryJson.groups.flatMap(g=>g.findings.flatMap(f=>f.evidence)).length}))},null,2));
  if(!process.argv.includes('--verify'))return;
  assert.equal(task.status,'READY');assert.equal(summaries.length,2);
  assert.equal(company.financialStatus,'READY');
  for(const summary of summaries){
    const stage=task.progress.stages[summary.section];assert.equal(stage.status,'SUCCESS');
    assert(summary.updatedAt>=new Date(task.progress.stages.filing.updatedAt));
    const cached=await api(`/ai/${summary.section}`);assert.deepEqual(cached.summary.summaryJson,summary.summaryJson);
  }
  const annual=await db.annualFinancial.findFirst({where:{companyCik:cik},orderBy:{periodEnd:'desc'}});
  for(const key of ['cash','totalDebt','netDebt','currentAssets','currentLiabilities','equity','currentRatio','debtToEquity']){
    assert(Math.abs(Number(annual[key])-details.annual[0][key])<0.000001,`DB/API mismatch: ${key}`);
  }
  const before=counts();
  for(let i=0;i<2;i++){
    const detail=await api();assert.equal(detail.lastFetchedAt,details.lastFetchedAt);
    const init=await api('/updates/initialize','POST');assert.equal(init.status,'READY');
    for(const summary of summaries) assert.equal((await api(`/ai/${summary.section}`)).summary.updatedAt,summary.updatedAt.toISOString());
  }
  assert.equal(counts(),before,'Cached visits caused upstream requests');
  console.log('PASS: DB/API financials and summaries match, evidence retained; repeat reads/initialization add zero upstream calls.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
