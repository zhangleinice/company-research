// GOOGL-only, read-only validation. No refresh endpoints, SEC requests, or AI calls.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PrismaClient}=require('@prisma/client');
const {createElement}=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
if(fs.existsSync('apps/api/.env'))process.loadEnvFile('apps/api/.env');
const db=new PrismaClient();
const cik='0001652044';
(async()=>{
  const before=await db.company.findUniqueOrThrow({where:{cik}});
  assert.equal(before.financialStatus,'READY','Validation requires a ready cache; never acquire new facts');
  const summariesBefore=JSON.stringify(await db.aiSummary.findMany({where:{companyCik:cik},orderBy:{id:'asc'}}));
  const tasksBefore=JSON.stringify(await db.aiTask.findMany({where:{companyCik:cik},orderBy:{id:'asc'}}));
  const response=await fetch('http://localhost:3000/api/companies/GOOGL');assert.equal(response.status,200);
  const detail=await response.json();assert.equal(detail.cik,cik);
  const raw=JSON.parse(fs.readFileSync('/tmp/googl-health-companyfacts.json','utf8'));
  const {FinancialAnalysis}=await import('../apps/web/.test-dist/src/analysis/FinancialAnalysis.js');
  const {FinancialTrendChart}=await import('../apps/web/.test-dist/src/analysis/FinancialTrendChart.js');
  const {cashFlowSeries}=await import('../apps/web/.test-dist/src/analysis/CashFlowCharts.js');
  const {healthSeries}=await import('../apps/web/.test-dist/src/analysis/FinancialHealthChart.js');
  const output={cik,periodsVerified:0,annual:null,quarterly:null};
  for(const [mode,model] of [['annual','annualFinancial'],['quarterly','quarterlyFinancial']]){
    const rows=await db[model].findMany({where:{companyCik:cik},orderBy:{periodEnd:'desc'},take:10});
    for(const row of rows){
      const end=row.periodEnd.toISOString().slice(0,10);
      const api=detail[mode].find(x=>x.periodEnd===end);assert.ok(api);
      for(const key of ['operatingCashFlow','capex','fcf','cash','marketableSecurities','totalDebt','currentRatio','debtToEquity'])assert.equal(api[key],row[key]===null?null:Number(row[key]));
      for(const key of ['cash','marketableSecurities']){
        if(api[key]===null)continue;
        const item=row.sources[key].items[0];assert.equal(item.end,end);assert.ok(!item.start);assert.equal(item.unit,'USD');
        assert.ok(raw.facts['us-gaap'][item.concept.split(':')[1]].units.USD.some(x=>!x.start&&x.end===end&&x.accn===item.accn&&x.val===item.val));
      }
      if(api.cashAndShortTermSecurities!==null){
        const proof=row.sources.verifiedLiquidAssets;assert.equal(proof.method,'reconciled_reported_total');
        assert.equal(proof.cash,api.cash);assert.equal(proof.securities,api.marketableSecurities);
        assert.equal(proof.amount,api.cash+api.marketableSecurities);assert.equal(api.cashAndShortTermSecurities,proof.amount);
        const cash=row.sources.cash.items[0],securities=row.sources.marketableSecurities.items[0],combined=proof.items[0];
        assert.equal(cash.accn,securities.accn);assert.equal(cash.accn,combined.accn);
        assert.equal(combined.end,end);assert.equal(combined.unit,'USD');
        assert.ok(raw.facts['us-gaap'][combined.concept.split(':')[1]].units.USD.some(x=>!x.start&&x.end===end&&x.accn===combined.accn&&x.val===combined.val));
      }
      if(api.operatingCashFlow !== null && api.capex !== null)assert.equal(api.fcf,api.operatingCashFlow-api.capex);
      output.periodsVerified++;
    }
    const full=renderToStaticMarkup(createElement(FinancialAnalysis,{detail,mode}));
    const combined=full.slice(full.indexOf('data-analysis-module="cash-flow"'),full.indexOf('data-analysis-module="shareholder-returns"'));
    assert.equal((combined.match(/data-metric=/g)||[]).length,7);assert.equal((combined.match(/<svg/g)||[]).length,2);
    assert.ok(!full.includes('data-analysis-module="financial-health"'));
    const start=combined.indexOf('data-financial-region="financial-health"');
    const html=combined.slice(start,combined.indexOf('</section>',start));
    assert.equal((html.match(/data-metric=/g)||[]).length,4);assert.equal((html.match(/<svg/g)||[]).length,0);
    for(const key of ['cashAndShortTermSecurities','totalDebt','currentRatio','debtToEquity'])assert.ok(html.includes(`data-metric="${key}"`));
    for(const key of ['cash','marketableSecurities','currentAssets','currentLiabilities','netDebt','netDebtAfterLiquidAssets'])assert.ok(!html.includes(`data-metric="${key}"`));
    for(const selected of ['all','cash','marketableSecurities','totalDebt']){
      const chart=renderToStaticMarkup(createElement(FinancialTrendChart,{rows:detail[mode],mode,series:healthSeries(selected),title:'现金储备与有息债务历史趋势（亿美元）',unit:'money',moneyDivisor:1e8,moneyUnit:'亿美元',periodKind:'instant'}));
      assert.ok(!chart.includes('NaN'));assert.ok(!chart.includes('Infinity'));
      assert.equal(healthSeries(selected).length,selected==='all'?3:1);
      fs.writeFileSync(`/tmp/googl-health-${mode}-${selected}.html`,chart);
    }
    for(const selected of ['all','operatingCashFlow','capex','fcf']) {
      const chart=renderToStaticMarkup(createElement(FinancialTrendChart,{rows:detail[mode],mode,series:cashFlowSeries(selected),title:'OCF / CapEx / FCF 历史趋势（亿美元）',unit:'money',moneyDivisor:1e8,moneyUnit:'亿美元'}));
      assert.ok(!chart.includes('NaN'));assert.ok(!chart.includes('Infinity'));
      assert.equal(cashFlowSeries(selected).length,selected==='all'?3:1);
    }
    const latest=detail[mode][0];output[mode]={periodEnd:latest.periodEnd,operatingCashFlow:latest.operatingCashFlow,capex:latest.capex,fcf:latest.fcf,cash:latest.cash,marketableSecurities:latest.marketableSecurities,verifiedCombined:latest.cashAndShortTermSecurities,totalDebt:latest.totalDebt,currentRatio:latest.currentRatio,debtToEquity:latest.debtToEquity};
  }
  assert.equal(JSON.stringify(before),JSON.stringify(await db.company.findUniqueOrThrow({where:{cik}})));
  assert.equal(summariesBefore,JSON.stringify(await db.aiSummary.findMany({where:{companyCik:cik},orderBy:{id:'asc'}})));
  assert.equal(tasksBefore,JSON.stringify(await db.aiTask.findMany({where:{companyCik:cik},orderBy:{id:'asc'}})));
  console.log(JSON.stringify({...output,companyFavoritesAndAiUnchanged:true},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>db.$disconnect());
