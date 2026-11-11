// Uses the compiled web test modules and a verified GOOGL API snapshot.
// No browser automation, updates, SEC calls or AI calls.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createElement}=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
(async()=>{
  const {FinancialAnalysis}=await import('../apps/web/.test-dist/src/analysis/FinancialAnalysis.js');
  const {repurchaseTrend}=await import('../apps/web/.test-dist/src/analysis/ShareholderReturnsChart.js');
  const {FinancialTrendChart}=await import('../apps/web/.test-dist/src/analysis/FinancialTrendChart.js');
  const detail=JSON.parse(fs.readFileSync('/tmp/googl-dividend-detail.json','utf8'));
  assert.equal(detail.cik,'0001652044');
  for(const mode of ['annual','quarterly']){
    const html=renderToStaticMarkup(createElement(FinancialAnalysis,{detail,mode}));
    for(const label of ['Shareholder Returns','股票回购与股份变化趋势','Dividends Per Share Trend','Declared DPS'])assert.ok(html.includes(label),label);
    assert.equal((html.match(/data-metric="dividendsPaid"/g)||[]).length,0);
    assert.equal((html.match(/data-metric="dividendsPerShare"/g)||[]).length,1);
    const start=html.indexOf('data-analysis-module="shareholder-returns"');
    const shareholder=html.slice(start);
    assert.equal((shareholder.match(/<svg/g)||[]).length,2);
    assert.equal((shareholder.match(/data-metric=/g)||[]).length,4);
    assert.ok(!shareholder.includes('Diluted Shares Trend'));
    const cash=html.slice(html.indexOf('data-analysis-module="cash-flow"'),html.indexOf('data-analysis-module="shareholder-returns"'));
    assert.ok(!cash.includes('股票回购与股份变化趋势'));
    assert.ok(!cash.includes('data-metric="dividendsPaid"'));
    for(const selected of ['stockRepurchases','dilutedShares']) {
      const config=repurchaseTrend(selected);
      const chart=renderToStaticMarkup(createElement(FinancialTrendChart,{rows:detail[mode],mode,series:[config],unit:config.unit,title:'股票回购与股份变化趋势'}));
      assert.ok(!chart.includes('NaN'));assert.ok(!chart.includes('Infinity'));
      if(selected==='dilutedShares'){assert.ok(chart.includes('百万股'));assert.ok(!chart.includes(' USD'));}
      else assert.ok(chart.includes('百万美元'));
      fs.writeFileSync(`/tmp/googl-repurchase-${mode}-${selected}.html`,chart);
    }
    const latest=detail[mode][0];
    if(mode==='annual'){
      assert.ok(html.includes('38.33%'));
      assert.ok(!html.includes('data-metric="dilutedShares"')); 
      assert.ok(html.includes('Declared DPS: 0.83'));
      assert.ok(!html.includes('Declared DPS: 0</title>'));
      assert.equal((html.match(/data-analysis-module=/g)||[]).length,4);
    }else{
      assert.ok(html.includes('Declared DPS: 0.22'));
      assert.ok(!html.includes('2025-10-01 至 2025-12-31 · Declared DPS:'));
    }
    fs.writeFileSync(`/tmp/googl-dividends-${mode}.html`,html);
    console.log(`${mode}: rendered actual GOOGL API data, DPS=${latest.dividendsPerShare}, shares=${latest.dilutedShares}; cards, units, charts and null gaps verified`);
  }
})().catch(e=>{console.error(e.message);process.exitCode=1});
