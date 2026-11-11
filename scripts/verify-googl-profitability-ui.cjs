// Read-only GOOGL API snapshot rendering; no network, refresh, or AI calls.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createElement}=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
(async()=>{
  const {FinancialAnalysis}=await import('../apps/web/.test-dist/src/analysis/FinancialAnalysis.js');
  const {FinancialTrendChart}=await import('../apps/web/.test-dist/src/analysis/FinancialTrendChart.js');
  const {profitabilitySeries}=await import('../apps/web/.test-dist/src/analysis/ProfitabilityCharts.js');
  const {analysisValue,formatAnalysisValue}=await import('../apps/web/.test-dist/src/analysis/financial-analysis.js');
  const detail=JSON.parse(fs.readFileSync('/tmp/googl-dividend-detail.json','utf8'));assert.equal(detail.cik,'0001652044');
  const before=JSON.stringify(detail);
  for(const mode of ['annual','quarterly']){
    const html=renderToStaticMarkup(createElement(FinancialAnalysis,{detail,mode}));
    const section=html.slice(html.indexOf('data-analysis-module="profitability"'),html.indexOf('data-analysis-module="cash-flow"'));
    assert.equal((section.match(/data-metric=/g)||[]).length,4);assert.equal((section.match(/<svg/g)||[]).length,1);
    assert.ok(!section.includes('ant-col-xl-12'));assert.ok(!section.includes('利润历史变化'));
    for(const key of ['grossProfit','operatingIncome','netIncome','roa'])assert.ok(!section.includes(`data-metric="${key}"`));
    const values={};
    for(const key of ['grossMargin','operatingMargin','netMargin','roe']){
      assert.ok(section.includes(`data-metric="${key}"`));
      const value=analysisValue(detail[mode][0],key,mode);values[key]=value;
      assert.ok(section.includes(formatAnalysisValue(value,'percent')));
    }
    for(const selected of ['all','gross','operating','net']){
      const series=profitabilitySeries(selected);
      const chart=renderToStaticMarkup(createElement(FinancialTrendChart,{rows:detail[mode],mode,series,unit:'percent',title:'利润率历史趋势'}));
      const count=detail[mode].reduce((n,row)=>n+series.filter(s=>analysisValue(row,s.key,mode)!==null).length,0);
      assert.equal((chart.match(/<circle/g)||[]).length,count);
      assert.ok(!chart.includes('USD'));assert.ok(!chart.includes('NaN'));assert.ok(!chart.includes('Infinity'));assert.ok(!chart.includes('—'));
    }
    fs.writeFileSync(`/tmp/googl-profitability-${mode}.html`,section);
    console.log(JSON.stringify({mode,periods:detail[mode].length,latest:values,cards:4,charts:1,selectorsVerified:4}));
  }
  assert.equal(JSON.stringify(detail),before);
})().catch(e=>{console.error(e.stack);process.exitCode=1});
