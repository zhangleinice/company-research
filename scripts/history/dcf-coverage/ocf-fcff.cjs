const fs = require('node:fs');
const { load } = require('cheerio');
const { inspect } = require('./verify.cjs');
const {
  amount,
  qname,
} = require('../../../apps/api/src/modules/revenue/parser/facts.cjs');
const tags = [
  'InterestExpense',
  'InterestExpenseNonoperating',
  'InterestExpenseDebt',
  'InterestAndDebtExpense',
  'InterestExpenseDebtExcludingAmortization',
  'InterestPaid',
  'InterestPaidNet',
  'InterestPaidCapitalized',
  'InterestCostsCapitalized',
  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
];
function inline(file, cik, url) {
  const $ = load(fs.readFileSync(file), { xmlMode: true }),
    all = $('*').toArray(),
    contexts = new Map(),
    units = new Map();
  for (const n of all) {
    if (n.name?.endsWith(':context')) {
      const children = $(n).find('*').toArray(),
        value = (key) =>
          children
            .filter((x) => x.name?.endsWith(':' + key))
            .map((x) => $(x).text().trim());
      if (
        value('identifier')[0]?.padStart(10, '0') !== cik ||
        children.some((x) => /:(explicitMember|typedMember)$/.test(x.name))
      )
        continue;
      contexts.set(n.attribs.id, {
        start: value('startDate')[0],
        end: value('endDate')[0] || value('instant')[0],
      });
    }
    if (n.name?.endsWith(':unit')) {
      const m = $(n)
        .find('*')
        .toArray()
        .find((x) => x.name?.endsWith(':measure'));
      if (m) units.set(n.attribs.id, qname(m, $(m).text().trim()));
    }
  }
  return all.flatMap((n) => {
    const a = n.attribs;
    if (
      !a?.name ||
      !contexts.has(a.contextRef) ||
      units.get(a.unitRef) !== '{http://www.xbrl.org/2003/iso4217}USD' ||
      a['xsi:nil'] === 'true'
    )
      return [];
    try {
      return [
        {
          concept: qname(n, a.name),
          ...contexts.get(a.contextRef),
          value: amount(
            $(n).text(),
            a.scale,
            a.sign,
            a.format ? qname(n, a.format) : null,
          ),
          context: a.contextRef,
          id: a.id,
          unit: 'USD',
          source: url,
          row: $(n)
            .closest('tr')
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 700),
        },
      ];
    } catch {
      return [];
    }
  });
}
const companies = [
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
].map((t) => inspect(t, tags));
const out = [];
for (const c of companies) {
  const file = `/tmp/ocf-fcff-validation/${c.ticker}.html`,
    facts = inline(file, c.cik, c.filing.url);
  const $ = load(fs.readFileSync(file));
  const body = $('body').text().replace(/\s+/g, ' ');
  const snippets = [
    'capitalized interest',
    'interest capitalized',
    'interest expense',
    'cash interest',
    'finance leases',
    'income tax',
  ].map((term) => {
    const at = body.toLowerCase().indexOf(term);
    return at < 0
      ? { term, text: null }
      : { term, text: body.slice(Math.max(0, at - 100), at + 380) };
  });
  let capex = c.metrics.CapEx.calculation,
    scope = 'PP&E cash purchases';
  let alternative = null;
  if (['AMZN', 'NVDA'].includes(c.ticker)) {
    alternative = c.metrics.CapEx.widerCandidate;
    const current = alternative.items[1];
    const matched = facts.find(
      (f) =>
        f.concept?.endsWith('}PaymentsToAcquireProductiveAssets') &&
        f.start === current.start &&
        f.end === current.end &&
        Number(f.value) === current.val,
    );
    if (!matched) throw Error('Alternative not reconciled to original table');
    capex = alternative;
    scope =
      c.ticker === 'AMZN'
        ? 'reported gross purchases of property and equipment (not issuer net FCF)'
        : 'reported purchases of property/equipment AND intangible assets';
    alternative = { ...alternative, originalTable: matched };
    if (c.ticker === 'NVDA') {
      const annual = inline(
        '/tmp/ocf-fcff-validation/NVDA-annual.html',
        c.cik,
        alternative.items[0].filingUrl,
      );
      if (
        !annual.some(
          (f) =>
            f.concept?.endsWith('}PaymentsToAcquireProductiveAssets') &&
            f.start === alternative.items[0].start &&
            f.end === alternative.items[0].end &&
            Number(f.value) === alternative.items[0].val,
        )
      )
        throw Error('NVDA annual endpoint mismatch');
    }
  }
  const ocf = c.metrics.OCF.calculation;
  const interest =
    tags
      .filter((t) => /^Interest.*Expense|^InterestAndDebt/.test(t))
      .map((t) => c.extra[t].ttm)
      .find(Boolean) || null;
  const paid =
    ['InterestPaid', 'InterestPaidNet']
      .map((t) => c.extra[t].ttm)
      .find(Boolean) || null;
  const pretax =
    tags
      .filter((t) => t.startsWith('IncomeLoss'))
      .map((t) => c.extra[t].ttm)
      .find(Boolean) || null;
  const tax = c.metrics.Tax.calculation;
  const etr =
    tax &&
    pretax &&
    pretax.value > 0 &&
    tax.start === pretax.start &&
    tax.end === pretax.end
      ? tax.value / pretax.value
      : null;
  if (ocf && capex && (ocf.start !== capex.start || ocf.end !== capex.end))
    throw Error('Period mismatch');
  let supplement = null;
  if (c.ticker === 'XOM') {
    const raw = JSON.parse(
      fs.readFileSync('/tmp/dcf-companyfacts-coverage/XOM-facts.json'),
    );
    const selected = [
      'NetCashProvidedByUsedInOperatingActivities',
      'PaymentsToAcquirePropertyPlantAndEquipment',
    ].map((tag) => {
      const fy = raw.facts['us-gaap'][tag].units.USD.filter(
        (f) => f.start === '2025-01-01' && f.end === '2025-12-31',
      ).at(-1);
      const now = facts.find(
          (f) =>
            f.concept?.endsWith('}' + tag) &&
            f.start === '2026-01-01' &&
            f.end === c.filing.end,
        ),
        before = facts.find(
          (f) =>
            f.concept?.endsWith('}' + tag) &&
            f.start === '2025-01-01' &&
            f.end === '2025-06-30',
        );
      if (!fy || !now || !before) return null;
      return {
        tag,
        start: '2025-07-01',
        end: c.filing.end,
        value: fy.val + Number(now.value) - Number(before.value),
        items: [
          {
            ...fy,
            concept: 'us-gaap:' + tag,
            unit: 'USD',
            source:
              'https://data.sec.gov/api/xbrl/companyfacts/CIK0000034088.json',
          },
          now,
          before,
        ],
      };
    });
    if (selected.every(Boolean))
      supplement = {
        ocf: selected[0],
        capex: selected[1],
        fcf: selected[0].value - selected[1].value,
        source:
          'raw standard Inline XBRL + existing CompanyFacts annual; not CompanyFacts-only',
      };
  }
  out.push({
    ticker: c.ticker,
    filing: c.filing,
    ocf,
    capex,
    capexScope: scope,
    alternative,
    fcf: ocf && capex ? ocf.value - capex.value : null,
    interest,
    interestPaid: paid,
    interestAttempts: Object.fromEntries(
      tags.filter((t) => t.startsWith('Interest')).map((t) => [t, c.extra[t]]),
    ),
    pretax,
    tax,
    historicalEffectiveTaxRate: etr,
    taxShieldRate: null,
    simplifiedFCFF: null,
    reason:
      'Expense/cash interest bridge, capitalized/lease/financial-business adjustments and marginal usable tax shield not jointly verified; historical ETR is not a verified interest shield rate',
    rawInterestFacts: facts
      .filter((f) =>
        /InterestExpense|InterestPaid|InterestCostsCapitalized/.test(
          f.concept || '',
        ),
      )
      .map(({ row, ...rest }) => rest),
    snippets: snippets.map((s) => ({ term: s.term, present: s.text !== null })),
    supplement,
  });
}
fs.writeFileSync(
  'apps/api/tests/fixtures/financial-evidence/ocf-fcff-coverage.json',
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      companies: out,
      companyFactsFCFCount: out.filter((c) => c.fcf !== null).length,
      supplementedFCFCount: out.filter((c) => c.fcf !== null || c.supplement)
        .length,
      approvedFCFFCount: 0,
      xomFreshResponseCheck: (() => {
        const fresh = JSON.parse(
          fs.readFileSync('/tmp/ocf-fcff-validation/XOM-facts-fresh.json'),
        );
        const xom = out.find((c) => c.ticker === 'XOM');
        return Object.fromEntries(
          [
            'NetCashProvidedByUsedInOperatingActivities',
            'PaymentsToAcquirePropertyPlantAndEquipment',
          ].map((tag) => {
            const observations = fresh.facts['us-gaap'][tag].units.USD;
            return [
              tag,
              {
                latestEnd: observations
                  .map((f) => f.end)
                  .sort()
                  .at(-1),
                latestAccessionPresent: observations.some(
                  (f) => f.accn === xom.filing.accn,
                ),
                latestRawFilingEnd: xom.filing.end,
              },
            ];
          }),
        );
      })(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  out.map((c) => ({
    ticker: c.ticker,
    ocf: c.ocf?.value,
    capex: c.capex?.value,
    fcf: c.fcf,
    interest: c.interest?.value,
    paid: c.interestPaid?.value,
    etr: c.historicalEffectiveTaxRate,
    supplement: c.supplement?.fcf,
  })),
);
