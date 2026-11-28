// Offline research only: no database, business services, AI or valuation calculations.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = process.env.DCF_CACHE_DIR || '/tmp/dcf-companyfacts-coverage';
const samples = [
  'GOOGL',
  'AAPL',
  'MSFT',
  'KO',
  'WMT',
  'AMZN',
  'NVDA',
  'TSLA',
  'XOM',
  'CAT',
];
const mappings = {
  Revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
  ],
  EBIT: ['OperatingIncomeLoss'],
  Tax: ['IncomeTaxExpenseBenefit'],
  DA: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'],
  CapEx: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  OCF: ['NetCashProvidedByUsedInOperatingActivities'],
};
const nwcTags = [
  'AccountsReceivableNetCurrent',
  'InventoryNet',
  'PrepaidExpenseCurrent',
  'OtherAssetsCurrent',
  'AccountsPayableCurrent',
  'AccruedLiabilitiesCurrent',
  'OtherLiabilitiesCurrent',
  'ContractWithCustomerLiabilityCurrent',
  'AssetsCurrent',
  'LiabilitiesCurrent',
];
const day = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1;
const next = (d) =>
  new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
function latest(xs) {
  return [...xs].sort(
    (a, b) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn),
  )[0];
}
function inspect(ticker, extraTags = []) {
  const raw = JSON.parse(
      fs.readFileSync(path.join(dir, `${ticker}-facts.json`)),
    ),
    sub = JSON.parse(
      fs.readFileSync(path.join(dir, `${ticker}-submissions.json`)),
    );
  assert.equal(String(raw.cik), String(Number(sub.cik)));
  const rec = sub.filings.recent;
  const filings = rec.form
    .flatMap((form, i) =>
      /^10-[KQ](\/A)?$/.test(form) && rec.reportDate[i]
        ? [
            {
              form,
              end: rec.reportDate[i],
              filed: rec.filingDate[i],
              accn: rec.accessionNumber[i],
              url: `https://www.sec.gov/Archives/edgar/data/${Number(raw.cik)}/${rec.accessionNumber[i].replaceAll('-', '')}/${rec.primaryDocument[i]}`,
            },
          ]
        : [],
    )
    .sort(
      (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
    );
  const filing = filings[0];
  const source = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(raw.cik).padStart(10, '0')}.json`;
  function facts(tag, unit = 'USD', ns = 'us-gaap') {
    return (raw.facts[ns]?.[tag]?.units[unit] || []).filter(
      (f) =>
        Number.isFinite(f.val) &&
        f.filed <= filing.filed &&
        /^(10-K|10-Q)(\/A)?$/.test(f.form) &&
        f.end <= filing.end,
    );
  }
  function ref(tag, f, ns = 'us-gaap', unit = 'USD') {
    return {
      concept: `${ns}:${tag}`,
      unit,
      ...f,
      companyFactsUrl: source,
      filingUrl: `https://www.sec.gov/Archives/edgar/data/${Number(raw.cik)}/${f.accn.replaceAll('-', '')}/${f.accn}-index.html`,
    };
  }
  function exact(tag, start, end, accn) {
    const xs = facts(tag).filter(
      (f) => f.start === start && f.end === end && (!accn || f.accn === accn),
    );
    const f = latest(xs);
    if (
      f &&
      xs.some(
        (x) => x.accn === f.accn && x.filed === f.filed && x.val !== f.val,
      )
    )
      return null;
    return f ? ref(tag, f) : null;
  }
  const allRevenue = mappings.Revenue.flatMap((tag) => facts(tag));
  const annual = allRevenue
    .filter(
      (f) =>
        f.start &&
        day(f.start, f.end) >= 330 &&
        day(f.start, f.end) <= 400 &&
        /^10-K/.test(f.form) &&
        f.end < filing.end,
    )
    .sort(
      (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
    )[0];
  const annualNow = allRevenue.find(
    (f) =>
      f.accn === filing.accn &&
      f.start &&
      day(f.start, f.end) >= 330 &&
      day(f.start, f.end) <= 400 &&
      f.end === filing.end,
  );
  const yearStart = annualNow?.start || (annual ? next(annual.end) : null);
  function ttm(tag) {
    if (!yearStart) return null;
    const current = exact(tag, yearStart, filing.end, filing.accn);
    if (!current) return null;
    if (annualNow)
      return {
        value: current.val,
        method: 'annual_is_TTM',
        start: yearStart,
        end: filing.end,
        items: [current],
      };
    if (!annual) return null;
    const fy = exact(tag, annual.start, annual.end);
    if (!fy) return null;
    const previous = latest(
      facts(tag).filter(
        (f) =>
          f.accn === filing.accn &&
          f.start === annual.start &&
          f.end < annual.end &&
          day(f.end, filing.end) >= 330 &&
          day(f.end, filing.end) <= 400 &&
          Math.abs(day(f.start, f.end) - day(yearStart, filing.end)) <= 8,
      ),
    );
    if (!previous) return null;
    const prior = ref(tag, previous);
    return {
      value: fy.val + current.val - prior.val,
      method: 'FY+currentYTD-priorComparableYTD',
      start: next(prior.end),
      end: filing.end,
      items: [fy, current, prior],
    };
  }
  function history(tags) {
    return tags.map((tag) => {
      const xs = facts(tag);
      return {
        tag,
        definition: raw.facts['us-gaap']?.[tag]?.description ?? null,
        historical: xs.length > 0,
        latestEnd: xs.length
          ? xs
              .map((x) => x.end)
              .sort()
              .at(-1)
          : null,
        latestFiling: latest(xs)?.accn ?? null,
      };
    });
  }
  function choose(tags) {
    for (const tag of tags) {
      const r = ttm(tag);
      if (r) return r;
    }
    return null;
  }
  const metrics = {};
  for (const [key, tags] of Object.entries(mappings)) {
    const r = choose(tags);
    metrics[key] = {
      status: r ? '可用' : '缺失',
      value: r?.value ?? null,
      calculation: r,
      attempts: history(tags),
      reason: r
        ? null
        : '最新申报的同标签年度/YTD/可比YTD端点不完整；历史值不替代最新TTM',
    };
  }
  if (!metrics.DA.calculation) {
    const depreciation = choose(['Depreciation']),
      amortization = choose([
        'AmortizationOfIntangibleAssets',
        'FiniteLivedIntangibleAssetsAmortizationExpense',
      ]);
    metrics.DA.candidates = {
      depreciation,
      amortization,
      otherAttempts: history([
        'Depreciation',
        'AmortizationOfIntangibleAssets',
        'FiniteLivedIntangibleAssetsAmortizationExpense',
        'DepreciationAmortizationAndAccretionNet',
        'FinanceLeaseRightOfUseAssetAmortization',
        'CapitalizedComputerSoftwareAmortization',
      ]),
    };
    const broad = choose(['DepreciationAmortizationAndAccretionNet']);
    metrics.DA.candidates.depreciationAmortizationAndAccretionNet = broad;
    if (depreciation || amortization || broad) {
      metrics.DA.status = '部分可用';
      metrics.DA.reason =
        '折旧/部分摊销TTM存在，但完整性、生产性/软件/租赁摊销及潜在重叠未经核对；不批准为完整D&A';
    }
  }
  if (!metrics.CapEx.calculation) {
    const wider = choose(['PaymentsToAcquireProductiveAssets']);
    metrics.CapEx.widerCandidate = wider;
    metrics.CapEx.attempts.push(
      ...history([
        'PaymentsToAcquireProductiveAssets',
        'PaymentsToAcquireIntangibleAssets',
        'PaymentsToAcquireSoftware',
      ]),
    );
    if (wider) {
      metrics.CapEx.status = '部分可用';
      metrics.CapEx.reason =
        'ProductiveAssets包括软件和其他无形资产；不是PP&E同义标签，不擅自替换';
    }
  }
  function instant(
    tag,
    accn = filing.accn,
    end = filing.end,
    unit = 'USD',
    ns = 'us-gaap',
  ) {
    const f = latest(
      facts(tag, unit, ns).filter(
        (f) => !f.start && f.end === end && (!accn || f.accn === accn),
      ),
    );
    return f ? ref(tag, f, ns, unit) : null;
  }
  function balance(tags) {
    for (const tag of tags) {
      const f = instant(tag);
      if (f) return f;
    }
    return null;
  }
  for (const [key, tags] of Object.entries({
    Cash: ['CashAndCashEquivalentsAtCarryingValue'],
    Investments: ['MarketableSecuritiesCurrent', 'ShortTermInvestments'],
    ShortDebt: ['DebtCurrent'],
    LongDebt: ['LongTermDebtNoncurrent'],
  })) {
    const f = balance(tags);
    metrics[key] = {
      status: f ? '可用' : '缺失',
      value: f?.val ?? null,
      items: f ? [f] : [],
      attempts: history(tags),
      reason: f ? null : '最新申报/最新期末没有匹配事实，不能回填旧余额或零',
    };
  }
  const combined = instant('CashCashEquivalentsAndShortTermInvestments');
  if (
    metrics.Investments.value === null &&
    combined &&
    metrics.Cash.value !== null &&
    combined.val >= metrics.Cash.value
  ) {
    metrics.Investments.status = '可用';
    metrics.Investments.value = combined.val - metrics.Cash.value;
    metrics.Investments.items = [combined, ...metrics.Cash.items];
    metrics.Investments.method =
      'reported cash+shortTermInvestments less cash (same filing/date/unit)';
    metrics.Investments.reason = null;
  }
  // DebtCurrent includes current finance leases in the taxonomy; remove an explicitly disclosed subset.
  const currentLease = instant('FinanceLeaseLiabilityCurrent');
  if (metrics.ShortDebt.value !== null && currentLease) {
    const a = metrics.ShortDebt.value;
    if (a >= currentLease.val) {
      metrics.ShortDebt.value = a - currentLease.val;
      metrics.ShortDebt.items.push(currentLease);
      metrics.ShortDebt.method = 'DebtCurrent-currentFinanceLeases';
    } else {
      metrics.ShortDebt.status = '部分可用';
      metrics.ShortDebt.value = null;
      metrics.ShortDebt.reason = '融资租赁子项与DebtCurrent不协调';
    }
  }
  if (!metrics.ShortDebt.items.length) {
    const mature = instant('LongTermDebtCurrent'),
      short = balance([
        'ShortTermBorrowings',
        'ShortTermDebt',
        'CommercialPaper',
      ]);
    metrics.ShortDebt.attempts.push(
      ...history([
        'LongTermDebtCurrent',
        'ShortTermBorrowings',
        'ShortTermDebt',
        'CommercialPaper',
      ]),
    );
    if (mature && short) {
      metrics.ShortDebt.status = '可用';
      metrics.ShortDebt.value = mature.val + short.val;
      metrics.ShortDebt.items = [mature, short];
      metrics.ShortDebt.reason = null;
      metrics.ShortDebt.method =
        'currentLTD+shortBorrowings (CP not double counted)';
    } else if (mature || short) {
      metrics.ShortDebt.status = '部分可用';
      metrics.ShortDebt.items = [mature, short].filter(Boolean);
      metrics.ShortDebt.reason = '只有部分短期债务构成，其他组件不能假定零';
    }
  }
  if (metrics.LongDebt.value === null) {
    const candidate = balance([
      'LongTermDebt',
      'LongTermDebtAndCapitalLeaseObligations',
      'LongTermDebtAndFinanceLeaseObligationsCurrent',
      'LongTermDebtAndFinanceLeaseObligationsNoncurrent',
    ]);
    metrics.LongDebt.attempts.push(
      ...history([
        'LongTermDebt',
        'LongTermDebtAndCapitalLeaseObligations',
        'LongTermDebtAndFinanceLeaseObligationsNoncurrent',
      ]),
    );
    if (candidate) {
      metrics.LongDebt.status = '部分可用';
      metrics.LongDebt.items = [candidate];
      metrics.LongDebt.reason =
        '存在总长期债务或债务租赁合计；未证明与流动部分/租赁划分，不能直接当非流动有息债务';
    }
  }
  const jointCurrent = instant('LongTermDebtAndCapitalLeaseObligationsCurrent');
  if (metrics.ShortDebt.status === '缺失' && jointCurrent) {
    metrics.ShortDebt.status = '部分可用';
    metrics.ShortDebt.items = [jointCurrent];
    metrics.ShortDebt.reason = '流动债务与资本租赁合计，无法分离纯有息债务';
  }
  metrics.ShortDebt.attempts.push(
    ...history([
      'LongTermDebtAndCapitalLeaseObligationsCurrent',
      'NotesAndLoansPayable',
    ]),
  );
  const shares = instant(
    'CommonStockSharesOutstanding',
    filing.accn,
    filing.end,
    'shares',
  );
  const dei = latest(
    (
      raw.facts.dei?.EntityCommonStockSharesOutstanding?.units.shares || []
    ).filter(
      (f) => !f.start && f.accn === filing.accn && f.end <= filing.filed,
    ),
  );
  metrics.Shares = {
    status: shares || dei ? '可用' : '缺失',
    value: shares?.val ?? dei?.val ?? null,
    items: shares
      ? [shares]
      : dei
        ? [ref('EntityCommonStockSharesOutstanding', dei, 'dei', 'shares')]
        : [],
    reason:
      shares || dei ? null : '最新申报未见可靠实际股数；不使用加权稀释股数代替',
    attempts: history(['CommonStockSharesOutstanding']),
  };
  const startEnd = metrics.Revenue.calculation?.start;
  const priorEnd = startEnd
    ? new Date(Date.parse(startEnd) - 86400000).toISOString().slice(0, 10)
    : null;
  const components = nwcTags.map((tag) => ({
    tag,
    current: instant(tag),
    prior: priorEnd ? instant(tag, null, priorEnd) : null,
  }));
  metrics.DeltaNWC = {
    status: components.some((x) => x.current && x.prior) ? '部分可用' : '缺失',
    value: null,
    reason:
      '可取得部分经营资产负债两期余额，但Other/应计项目未完成经营/融资/税款分类；余额变化也含并购、汇兑和重分类。不用CA-CL或OCF倒推出ΔNWC',
    components,
    attempts: history(nwcTags),
  };
  const cfCandidates = Object.keys(raw.facts['us-gaap'])
    .filter(
      (k) =>
        /^IncreaseDecreaseIn/.test(k) &&
        /Receivable|Inventor|Payable|OperatingCapital|OperatingAsset/.test(k),
    )
    .map((tag) => ({ tag, ttm: ttm(tag) }))
    .filter((x) => x.ttm);
  metrics.DeltaNWC.cashFlowCandidates = cfCandidates;
  return {
    ticker,
    cik: String(raw.cik).padStart(10, '0'),
    entityName: raw.entityName,
    filing,
    annualAnchor: annual ? { start: annual.start, end: annual.end } : null,
    ttmStart: metrics.Revenue.calculation?.start ?? null,
    sha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(dir, `${ticker}-facts.json`)))
      .digest('hex'),
    metrics,
    extra: Object.fromEntries(
      extraTags.map((tag) => [
        tag,
        { ttm: ttm(tag), history: history([tag])[0] },
      ]),
    ),
  };
}
if (require.main === module) {
  const companies = samples.map((ticker) => inspect(ticker)),
    keys = [
      'Revenue',
      'EBIT',
      'Tax',
      'DA',
      'CapEx',
      'OCF',
      'DeltaNWC',
      'Cash',
      'Investments',
      'ShortDebt',
      'LongDebt',
      'Shares',
    ];
  const coverage = Object.fromEntries(
    keys.map((k) => [
      k,
      {
        available: companies.filter((c) => c.metrics[k].status === '可用')
          .length,
        partial: companies.filter((c) => c.metrics[k].status === '部分可用')
          .length,
        missing: companies.filter((c) => c.metrics[k].status === '缺失').length,
      },
    ]),
  );
  const output = {
    verifiedAt: new Date().toISOString(),
    policy:
      'latest 10-K/10-Q anchored; standard us-gaap only; same concept/unit TTM; same-accession current/prior YTD; no missing=zero',
    companies,
    coverage,
  };
  fs.writeFileSync(
    'apps/api/tests/fixtures/financial-evidence/dcf-companyfacts-coverage.json',
    JSON.stringify(output, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        coverage,
        companies: companies.map((c) => ({
          ticker: c.ticker,
          end: c.filing.end,
          metrics: Object.fromEntries(
            keys.map((k) => [k, [c.metrics[k].status, c.metrics[k].value]]),
          ),
        })),
      },
      null,
      2,
    ),
  );
}
module.exports = { inspect };
