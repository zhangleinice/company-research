// Uses the compiled web test modules and a verified GOOGL API snapshot.
// No browser automation, updates, SEC calls or AI calls.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createElement}=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
(async()=>{
  const {FinancialAnalysis}=await import('../apps/web/.test-dist/src/analysis/FinancialAnalysis.js');
  const detail=JSON.parse(fs.readFileSync('/tmp/googl-dividend-detail.json','utf8'));
  assert.equal(detail.cik,'0001652044');
  for(const mode of ['annual','quarterly']){
    const html=renderToStaticMarkup(createElement(FinancialAnalysis,{detail,mode}));
    for(const label of ['Shareholder Returns','Stock Repurchases Trend','Dividends Per Share Trend','Diluted Shares Trend','Declared DPS'])assert.ok(html.includes(label),label);
    assert.equal((html.match(/data-metric="dividendsPaid"/g)||[]).length,1);
    assert.equal((html.match(/data-metric="dividendsPerShare"/g)||[]).length,1);
    const start=html.indexOf('data-analysis-module="shareholder-returns"');
    const shareholder=html.slice(start);
    assert.equal((shareholder.match(/<svg/g)||[]).length,3);
    const cash=html.slice(html.indexOf('data-analysis-module="cash-flow"'),html.indexOf('data-analysis-module="financial-health"'));
    assert.ok(!cash.includes('Stock Repurchases Trend'));
    assert.ok(!cash.includes('data-metric="dividendsPaid"'));
    const latest=detail[mode][0];
    if(mode==='annual'){
      assert.ok(html.includes('38.33%'));
      assert.ok(html.includes('12,230'));
      assert.ok(html.includes('Declared DPS: 0.83'));
      assert.ok(!html.includes('Declared DPS: 0</title>'));
      assert.equal((html.match(/data-analysis-module=/g)||[]).length,5);
    }else{
      assert.ok(html.includes('Declared DPS: 0.22'));
      assert.ok(!html.includes('2025-10-01 至 2025-12-31 · Declared DPS:'));
    }
    fs.writeFileSync(`/tmp/googl-dividends-${mode}.html`,html);
    console.log(`${mode}: rendered actual GOOGL API data, DPS=${latest.dividendsPerShare}, shares=${latest.dilutedShares}; cards, units, charts and null gaps verified`);
  }
})().catch(e=>{console.error(e.message);process.exitCode=1});
