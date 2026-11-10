// Read SEC CompanyFacts files already acquired by the existing SEC client.
// Default: read-only. --backfill-googl adds only the new fields to existing GOOGL rows.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { normalizeCompanyFacts } = require('../apps/api/dist/modules/financials/normalize-company-facts');
const { PrismaClient } = require('@prisma/client');
if (fs.existsSync('apps/api/.env')) process.loadEnvFile('apps/api/.env');
const prisma = new PrismaClient();
const targets = [['googl','0001652044'], ['aapl','0000320193'], ['nvda','0001045810']];
const fields = ['dilutedShares', 'basicShares', 'dilutedSharesGrowth'];
async function main() {
  const report = [];
  for (const [ticker,cik] of targets) {
    const path = `${process.env.SHARES_FACTS_DIR || '/tmp'}/${ticker}-health-companyfacts.json`;
    const raw = JSON.parse(fs.readFileSync(path,'utf8'));
    assert.equal(String(raw.cik).padStart(10,'0'),cik);
    const normalized = normalizeCompanyFacts(raw);
    for (const period of [...normalized.annual,...normalized.quarterly]) {
      for (const key of ['stockRepurchases','dilutedShares','basicShares']) {
        if (period[key] === null) continue;
        const source = period.sources[key];
        if (source.method === 'reported') {
          const item=source.items[0];
          assert.equal(item.start,period.periodStart);
          assert.equal(item.end,period.periodEnd);
          assert.equal(item.val,period[key]);
          assert.equal(item.unit,key === 'stockRepurchases'?'USD':'shares');
          assert.ok(raw.facts['us-gaap'][item.concept.split(':')[1]].units[item.unit].some(x=>x.accn===item.accn&&x.start===item.start&&x.end===item.end&&x.val===item.val));
        }
        if(key !== 'stockRepurchases') assert.equal(source.method,'reported');
      }
      if(period.dilutedSharesGrowth !== null) {
        const [a,b]=period.sources.dilutedSharesGrowth.items;
        assert.equal(a.accn,b.accn);
        assert.ok(Math.abs((a.val/b.val-1)*100-period.dilutedSharesGrowth)<1e-9);
      }
    }
    if (ticker === 'googl' && process.argv.includes('--backfill-googl')) {
      await prisma.$transaction(async tx => {
        const companies=await tx.$queryRaw`SELECT "financialStatus" FROM companies WHERE cik=${cik} FOR UPDATE`;
        assert.equal(companies.length,1,'GOOGL must already exist');
        assert.notEqual(companies[0].financialStatus,'FETCHING','Do not backfill during acquisition');
        for(const [model,periods] of [['annualFinancial',normalized.annual],['quarterlyFinancial',normalized.quarterly]]) {
          for(const period of periods) {
            const where={companyCik_periodEnd:{companyCik:cik,periodEnd:new Date(period.periodEnd)}};
            const existing=await tx[model].findUnique({where});
            if(!existing)continue;
            const sources={...existing.sources};
            for(const key of fields) {
              delete sources[key];
              if(period.sources[key]) sources[key]=period.sources[key];
            }
            await tx[model].update({where,data:{...Object.fromEntries(fields.map(k=>[k,period[k]])),sources}});
          }
        }
      });
    }
    const stored=await prisma.annualFinancial.findMany({where:{companyCik:cik},orderBy:{periodEnd:'desc'},take:10});
    const rows=normalized.annual.map(p=>({year:p.fiscalYear,end:p.periodEnd,stockRepurchases:p.stockRepurchases,dilutedShares:p.dilutedShares,basicShares:p.basicShares,dilutedSharesGrowth:p.dilutedSharesGrowth}));
    report.push({ticker,cacheModified:fs.statSync(path).mtime.toISOString(),annual:rows,quarterly:normalized.quarterly.map(p=>({end:p.periodEnd,dilutedShares:p.dilutedShares,dilutedSharesGrowth:p.dilutedSharesGrowth})),db:stored.map(p=>({end:p.periodEnd.toISOString().slice(0,10),stockRepurchases:Number(p.stockRepurchases),...Object.fromEntries(fields.map(k=>[k,p[k]===null?null:Number(p[k])]))}))});
  }
  console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
