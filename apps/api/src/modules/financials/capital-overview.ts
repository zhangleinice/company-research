import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isObject } from './annual-financials';
import {
  CAPITAL_OVERVIEW_POLICY,
  type CapitalFlowCache,
  type CapitalFlowFact,
  type CapitalAllocationOverview,
  type CapitalOverviewItem,
  type FinancialPeriod,
  type AnnualCapitalAllocation,
} from '@company-research/shared';
export async function readCapitalFlowCache(
  cik: string,
): Promise<CapitalFlowCache | null> {
  if (!/^\d{10}$/.test(cik)) return null;
  try {
    const d = JSON.parse(
      await readFile(
        join(__dirname, '../../../data/capital-allocation', cik + '.json'),
        'utf8',
      ),
    ) as CapitalFlowCache;
    return d.version === CAPITAL_OVERVIEW_POLICY &&
      d.cik === cik &&
      Array.isArray(d.facts)
      ? d
      : { version: CAPITAL_OVERVIEW_POLICY, cik, facts: [] };
  } catch {
    return { version: CAPITAL_OVERVIEW_POLICY, cik, facts: [] };
  }
}
const local = (s: string) => s.split(':').pop()!;
export function capitalOverview(
  row: FinancialPeriod,
  allocation: AnnualCapitalAllocation,
  cache: CapitalFlowCache | null,
  provenance?: unknown,
): CapitalAllocationOverview {
  const source = isObject(provenance) ? provenance : {};
  const reported = (
    key: 'operatingCashFlow' | 'stockRepurchases',
    concept: string,
  ) => {
    const s = source[key];
    const f =
      isObject(s) &&
      s.method === 'reported' &&
      Array.isArray(s.items) &&
      s.items.length === 1
        ? s.items[0]
        : null;
    if (
      !isObject(f) ||
      row.currency !== 'USD' ||
      row.fiscalQuarter !== null ||
      f.concept !== concept ||
      f.unit !== 'USD' ||
      f.start !== row.periodStart ||
      f.end !== row.periodEnd ||
      f.val !== row[key] ||
      typeof f.val !== 'number' ||
      !Number.isFinite(f.val) ||
      typeof f.accn !== 'string' ||
      !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) ||
      typeof f.filed !== 'string' ||
      !/^10-K(\/A)?$/.test(String(f.form))
    )
      return [];
    return [
      {
        concept,
        unit: 'USD',
        start: row.periodStart,
        end: row.periodEnd,
        accessionNumber: f.accn,
        filed: f.filed,
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cache?.cik ?? '0')}/${f.accn.replaceAll('-', '')}/${f.accn}-index.html`,
      },
    ];
  };
  const anchor = reported(
    'operatingCashFlow',
    'us-gaap:NetCashProvidedByUsedInOperatingActivities',
  )[0];
  const fs = (cache?.facts ?? []).filter(
    (f) =>
      f.start === row.periodStart &&
      f.end === row.periodEnd &&
      f.accessionNumber === anchor?.accessionNumber &&
      f.unit === 'USD' &&
      Number.isFinite(f.value) &&
      f.filed === anchor.filed &&
      f.url.startsWith('https://www.sec.gov/Archives/edgar/data/'),
  );
  const pick = (tags: string[]): CapitalFlowFact[] => {
    for (const tag of tags) {
      const xs = fs.filter((f) => local(f.concept) === tag);
      if (xs.length) {
        if (new Set(xs.map((x) => x.value)).size !== 1) return [];
        return [xs[0]];
      }
    }
    return [];
  };
  const val = (facts: CapitalFlowFact[]) =>
    facts.length ? facts.reduce((s, f) => s + f.value, 0) : null;
  const ocf =
    row.operatingCashFlow !== null && anchor ? row.operatingCashFlow : null;
  const sources = (facts: CapitalFlowFact[]) =>
    facts.map((f) => ({
      concept: f.concept,
      unit: f.unit,
      start: f.start,
      end: f.end,
      accessionNumber: f.accessionNumber,
      filed: f.filed,
      url: f.url,
    }));
  const items: CapitalOverviewItem[] = [];
  const add = (
    key: string,
    label: string,
    group: CapitalOverviewItem['group'],
    facts: CapitalFlowFact[],
    direction: CapitalOverviewItem['direction'],
    note: string,
    invert = false,
    fallback?: number | null,
    fallbackSources = key === 'operatingCashFlow'
      ? anchor
        ? [anchor]
        : []
      : key === 'capex'
        ? allocation.reinvestment?.capex.sources
        : key === 'dividendsPaid'
          ? allocation.dividendsPaid.sources
          : reported(
              'stockRepurchases',
              'us-gaap:PaymentsForRepurchaseOfCommonStock',
            ),
  ) => {
    const v = val(facts);
    const value = v === null ? (fallback ?? null) : invert ? -v : v;
    items.push({
      key,
      label,
      group,
      value,
      ratio:
        value === null || ocf === null || ocf <= 0
          ? null
          : ((['fx', 'cashChange'].includes(key) ? value : Math.abs(value)) /
              ocf) *
            100,
      direction:
        value === null
          ? 'unknown'
          : direction === 'outflow' && value < 0
            ? 'inflow'
            : direction === 'inflow' && value < 0
              ? 'outflow'
              : direction,
      note,
      sources: facts.length ? sources(facts) : (fallbackSources ?? []),
    });
  };
  add(
    'operatingCashFlow',
    'OCF',
    'operations',
    [],
    'inflow',
    '资金分析基准；并非所有用途均由当期OCF单独融资。',
    false,
    ocf,
  );
  add(
    'capex',
    'Cash PP&E CapEx',
    'operations',
    [],
    'outflow',
    '现金购置PP&E，不含全部非现金租赁及经济再投资。',
    false,
    allocation.reinvestment?.capex.value,
  );
  const acq = pick([
    'PaymentsToAcquireBusinessesNetOfCashAcquired',
    'AcquisitionsNetOfCashAcquiredAndPurchasesOfIntangibleAndOtherAssets',
    'AcquisitionsOfBusinessesEquityMethodInvestmentsAndNonmarketableSecurities',
  ]);
  add(
    'acquisitions',
    'Acquisitions & related investment payments',
    'operations',
    acq,
    'outflow',
    '按原披露范围展示，可能含无形资产、权益法投资、非上市证券及撤资净额，不等于纯企业收购对价。',
  );
  add(
    'stockRepurchases',
    'Buybacks',
    'operations',
    [],
    'outflow',
    '普通股回购现金支出，不将回购授权视为支出。',
    false,
    reported('stockRepurchases', 'us-gaap:PaymentsForRepurchaseOfCommonStock')
      .length
      ? row.stockRepurchases
      : null,
  );
  add(
    'dividendsPaid',
    'Dividends',
    'operations',
    [],
    'outflow',
    `保留现有分红范围：${allocation.dividendsPaid.scope}；可能含股息等价物。`,
    false,
    allocation.dividendsPaid.value,
  );
  const debtIn = pick([
    'ProceedsFromIssuanceOfDebt',
    'ProceedsFromDebtNetOfIssuanceCosts',
    'ProceedsFromIssuanceOfLongTermDebt',
    'ProceedsFromDebtMaturingInMoreThanThreeMonths',
  ]);
  add(
    'debtIn',
    debtIn.some((f) =>
      [
        'ProceedsFromIssuanceOfLongTermDebt',
        'ProceedsFromDebtMaturingInMoreThanThreeMonths',
      ].includes(local(f.concept)),
    )
      ? 'Long-term debt issuance · 分项'
      : 'Debt issuance proceeds',
    'financing',
    debtIn,
    'inflow',
    '汇总优先；可能为扣发行成本后的净额，或仅长期债务分项。未取得商业票据毛流入不视为零。',
  );
  const repay = pick([
    'RepaymentsOfDebt',
    'RepaymentsOfDebtAndCapitalLeaseObligations',
    'RepaymentsOfLongTermDebt',
    'RepaymentsOfDebtMaturingInMoreThanThreeMonths',
  ]);
  add(
    'debtOut',
    repay.some(
      (f) => local(f.concept) === 'RepaymentsOfDebtAndCapitalLeaseObligations',
    )
      ? 'Debt & capital lease repayments'
      : repay.some((f) =>
            [
              'RepaymentsOfLongTermDebt',
              'RepaymentsOfDebtMaturingInMoreThanThreeMonths',
            ].includes(local(f.concept)),
          )
        ? 'Long-term debt repayments · 分项'
        : 'Debt repayments',
    'financing',
    repay,
    'outflow',
    '汇总与分项互斥；部分披露含资本租赁。短期债务净变动另列，不能冒充毛偿还额。',
  );
  add(
    'shortDebtNet',
    'Short-term debt · 净变动',
    'financing',
    pick([
      'ProceedsFromRepaymentsOfCommercialPaper',
      'ProceedsFromRepaymentsOfShortTermDebtMaturingInThreeMonthsOrLess',
    ]),
    'net',
    '商业票据／短期债务净变动，不与其期限分项重复相加；净流入正、净偿还负。',
  );
  add(
    'stockIssued',
    'Common stock issuance proceeds',
    'financing',
    pick(['ProceedsFromIssuanceOfCommonStock']),
    'inflow',
    '仅母公司普通股发行现金流；不含出售子公司少数权益，不将SBC费用当作发行现金。',
  );
  const purchases = pick([
    'PaymentsToAcquireInvestments',
    'PaymentsToAcquireMarketableSecurities',
    'PaymentsToAcquireAvailableForSaleSecuritiesDebt',
    'PurchasesofInvestments',
  ]);
  add(
    'investBuy',
    'Securities & investment purchases',
    'financing',
    [
      ...purchases,
      ...(purchases.some(
        (f) => local(f.concept) === 'PaymentsToAcquireMarketableSecurities',
      )
        ? pick(['PaymentsToAcquireOtherInvestments'])
        : []),
    ],
    'outflow',
    '优先汇总，市场证券与明确独立的其他投资才相加。可能包含短期和长期投资。',
  );
  const combined = pick([
    'ProceedsFromSaleAndMaturityOfMarketableSecurities',
    'ProceedsFromDisposalsOfInvestments',
    'ProceedsFromSaleAndMaturityOfAvailableForSaleSecurities',
  ]);
  add(
    'investSell',
    'Investment sales & maturities',
    'financing',
    combined.length
      ? [
          ...combined,
          ...(combined.some(
            (f) =>
              local(f.concept) ===
              'ProceedsFromSaleAndMaturityOfMarketableSecurities',
          )
            ? pick(['ProceedsFromSaleAndMaturityOfOtherInvestments'])
            : []),
        ]
      : [
          ...pick([
            'ProceedsFromSaleOfAvailableForSaleSecuritiesDebt',
            'ProceedsFromInvestments',
          ]),
          ...pick([
            'ProceedsFromMaturitiesPrepaymentsAndCallsOfAvailableForSaleSecurities',
          ]),
        ],
    'inflow',
    '出售与到期回收汇总优先，不再加入其组成项；缺少组成项时不冒充完整回收额。',
  );
  add(
    'assetDisposals',
    'Business, investment & asset disposals',
    'other',
    [
      ...pick([
        'ProceedsFromDisposalsOfBusinessesEquityMethodInvestmentsAndNonmarketableSecurities',
      ]),
      ...pick(['ProceedsFromSaleOfPropertyPlantAndEquipment']),
    ],
    'inflow',
    '业务、权益法及非上市投资处置与PP&E出售；缺少独立披露时保留缺失，收购净额中的撤资不再次加入。',
  );
  const otherI = pick(['PaymentsForProceedsFromOtherInvestingActivities']);
  const collateral = pick([
    'CollateralPaidReceivedAssociatedWithHedgingActivitiesNet',
  ]);
  const transformed = [
    ...otherI.map((f) => ({ ...f, value: -f.value })),
    ...collateral.map((f) => ({ ...f, value: -f.value })),
  ];
  // Preserve original source amounts: inversion is explicitly documented in the note.
  add(
    'otherInvest',
    'Other investing cash flows',
    'other',
    transformed,
    'net',
    '其他投资现金影响＋独立对冲抵押品净回收。PaymentsForProceeds与CollateralPaidReceived标签按现金影响反向，保留净额正负；不从差额推算。',
  );
  const otherF = [
    ...pick(['ProceedsFromPaymentsForOtherFinancingActivities']),
    ...pick(['NetProceedsPaymentsRelatedToStockBasedAwardActivities']).map(
      (f) => ({ ...f, value: -f.value }),
    ),
    ...pick(['PaymentsRelatedToTaxWithholdingForShareBasedCompensation'])
      .map((f) => ({ ...f, value: -f.value }))
      .filter((f) => f.statement === true),
    ...pick(['ProceedsFromMinorityShareholders']),
  ];
  add(
    'otherFinance',
    'Other financing cash flows',
    'other',
    otherF,
    'net',
    '已识别其他融资净额、股权奖励净付款及出售少数权益；代扣税仅在现金流主表独立列示时另纳入，避免与其他净额重复。NetProceedsPaymentsRelatedToStockBasedAwardActivities按净付款反向。不将少数权益融资归为普通股发行；不是未识别差额。',
  );
  const fx = pick([
    'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations',
  ]);
  const change = pick([
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
    'CashAndCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
  ]);
  add(
    'fx',
    'FX effect',
    'other',
    fx,
    'net',
    '现金流量表口径，保留汇率现金影响正负；未单列不自动补零。',
  );
  add(
    'cashChange',
    'Change in cash · 现金流量表口径',
    'other',
    change,
    'net',
    '可能包含受限现金、处置组；不得以资产负债表未受限现金差分替代，不等同于留存现金。',
  );
  const investing = val(pick(['NetCashProvidedByUsedInInvestingActivities'])),
    financing = val(pick(['NetCashProvidedByUsedInFinancingActivities'])),
    exchange = val(fx),
    cashChange = val(change);
  const difference =
    ocf !== null &&
    investing !== null &&
    financing !== null &&
    exchange !== null &&
    cashChange !== null
      ? ocf + investing + financing + exchange - cashChange
      : null;
  return {
    version: CAPITAL_OVERVIEW_POLICY,
    start: row.periodStart,
    end: row.periodEnd,
    ocf,
    items,
    reconciliation: {
      sources: [
        ...(anchor ? [anchor] : []),
        ...sources([
          ...pick(['NetCashProvidedByUsedInInvestingActivities']),
          ...pick(['NetCashProvidedByUsedInFinancingActivities']),
          ...fx,
          ...change,
        ]),
      ],
      status:
        difference === null
          ? 'INCOMPLETE'
          : Math.abs(difference) <= 1
            ? 'MATCHED'
            : 'CONFLICT',
      operating: ocf,
      investing,
      financing,
      fx: exchange,
      cashChange,
      difference,
      note: 'OCF + investing + financing + FX = cash change。同一申报及期间；现金变化可能包含受限现金。未单列FX保持缺失，即使三项净现金流与变化相等也不虚构零值。',
    },
  };
}

export const CAPITAL_FLOW_TAGS = new Set([
  'AcquisitionsNetOfCashAcquiredAndPurchasesOfIntangibleAndOtherAssets',
  'AcquisitionsOfBusinessesEquityMethodInvestmentsAndNonmarketableSecurities',
  'CashAndCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
  'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
  'CollateralPaidReceivedAssociatedWithHedgingActivitiesNet',
  'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations',
  'NetCashProvidedByUsedInFinancingActivities',
  'NetCashProvidedByUsedInInvestingActivities',
  'NetProceedsPaymentsRelatedToStockBasedAwardActivities',
  'PaymentsForProceedsFromOtherInvestingActivities',
  'PaymentsRelatedToTaxWithholdingForShareBasedCompensation',
  'PaymentsToAcquireAvailableForSaleSecuritiesDebt',
  'PaymentsToAcquireBusinessesNetOfCashAcquired',
  'PaymentsToAcquireInvestments',
  'PaymentsToAcquireMarketableSecurities',
  'PaymentsToAcquireOtherInvestments',
  'ProceedsFromDebtMaturingInMoreThanThreeMonths',
  'ProceedsFromDebtNetOfIssuanceCosts',
  'ProceedsFromDisposalsOfBusinessesEquityMethodInvestmentsAndNonmarketableSecurities',
  'ProceedsFromDisposalsOfInvestments',
  'ProceedsFromInvestments',
  'ProceedsFromIssuanceOfCommonStock',
  'ProceedsFromIssuanceOfDebt',
  'ProceedsFromIssuanceOfLongTermDebt',
  'ProceedsFromMaturitiesPrepaymentsAndCallsOfAvailableForSaleSecurities',
  'ProceedsFromMinorityShareholders',
  'ProceedsFromPaymentsForOtherFinancingActivities',
  'ProceedsFromRepaymentsOfCommercialPaper',
  'ProceedsFromRepaymentsOfShortTermDebtMaturingInThreeMonthsOrLess',
  'ProceedsFromSaleAndMaturityOfAvailableForSaleSecurities',
  'ProceedsFromSaleAndMaturityOfMarketableSecurities',
  'ProceedsFromSaleAndMaturityOfOtherInvestments',
  'ProceedsFromSaleOfAvailableForSaleSecuritiesDebt',
  'ProceedsFromSaleOfPropertyPlantAndEquipment',
  'PurchasesofInvestments',
  'RepaymentsOfDebt',
  'RepaymentsOfDebtAndCapitalLeaseObligations',
  'RepaymentsOfDebtMaturingInMoreThanThreeMonths',
  'RepaymentsOfLongTermDebt',
]);
