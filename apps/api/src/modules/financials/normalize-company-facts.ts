import { normalizeFinancialHealth } from './financial-health';
import { capexToOperatingCashFlow } from './cash-flow-calculations';
import {
  FINANCIAL_METRICS,
  type FinancialMetric,
  type FinancialPeriod,
} from '@company-research/shared';
import { isObject } from './annual-financials';

interface Fact {
  start?: string;
  end: string;
  val: number;
  filed: string;
  form: string;
  accn: string;
  fy?: number;
  fp?: string;
}
interface Value {
  fact: Fact;
  concept: string;
  unit: string;
}
export interface NormalizedPeriod extends FinancialPeriod {
  sources: Record<string, unknown>;
}
const FLOW_TAGS: Partial<Record<FinancialMetric, string[]>> = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
  ],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  eps: ['EarningsPerShareDiluted'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  stockRepurchases: ['PaymentsForRepurchaseOfCommonStock'],
  dividendsPaid: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'],
};
const INSTANT_TAGS: Partial<Record<FinancialMetric, string[]>> = {
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
  marketableSecurities: ['MarketableSecuritiesCurrent', 'ShortTermInvestments'],
  currentAssets: ['AssetsCurrent'],
  currentLiabilities: ['LiabilitiesCurrent'],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  equity: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  ],
  shortTermDebt: ['DebtCurrent'],
  longTermDebt: ['LongTermDebtNoncurrent'],
  sharesOutstanding: ['CommonStockSharesOutstanding'],
};
const DAY = 86400000;
const days = (start: string, end: string) =>
  (Date.parse(end) - Date.parse(start)) / DAY + 1;
const shift = (date: string, amount: number) =>
  new Date(Date.parse(date) + amount * DAY).toISOString().slice(0, 10);
function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validFact(value: unknown): value is Fact {
  return (
    isObject(value) &&
    validDate(value.end) &&
    validDate(value.filed) &&
    value.end <= value.filed &&
    (value.start === undefined ||
      (validDate(value.start) && value.start <= value.end)) &&
    typeof value.val === 'number' &&
    Number.isFinite(value.val) &&
    typeof value.accn === 'string' &&
    typeof value.form === 'string' &&
    /^(10-K|10-Q|20-F|40-F)(\/A)?$/.test(value.form)
  );
}
const annualFact = (x: Value) =>
  x.fact.start &&
  days(x.fact.start, x.fact.end) >= 330 &&
  days(x.fact.start, x.fact.end) <= 400 &&
  /^(10-K|20-F|40-F)/.test(x.fact.form) &&
  (!x.fact.fp || x.fact.fp === 'FY');
const quarterFact = (x: Value) =>
  x.fact.start &&
  days(x.fact.start, x.fact.end) >= 60 &&
  days(x.fact.start, x.fact.end) <= 110;
const latest = (values: Value[]) =>
  values.sort(
    (a, b) =>
      b.fact.filed.localeCompare(a.fact.filed) ||
      b.fact.accn.localeCompare(a.fact.accn),
  )[0];
const source = (value: Value) => ({
  concept: value.concept,
  unit: value.unit,
  ...value.fact,
});
const divide = (
  a: number | null,
  b: number | null,
  multiplier = 1,
): number | null =>
  a !== null && b !== null && b > 0 && Number.isFinite((a / b) * multiplier)
    ? (a / b) * multiplier
    : null;
const difference = (a: number | null, b: number | null) =>
  a !== null && b !== null && Number.isFinite(a - b) ? a - b : null;
const growth = (current: number | null, prior: number | null) =>
  current !== null &&
  prior !== null &&
  prior > 0 &&
  Number.isFinite((current / prior - 1) * 100)
    ? (current / prior - 1) * 100
    : null;

/** Normalize periods using observation dates, not the fy/fp filing context on historical facts. */
export function normalizeCompanyFacts(raw: unknown): {
  annual: NormalizedPeriod[];
  quarterly: NormalizedPeriod[];
} {
  if (!isObject(raw) || !isObject(raw.facts) || !isObject(raw.facts['us-gaap']))
    return { annual: [], quarterly: [] };
  const taxonomy = raw.facts['us-gaap'];
  function readTag(tag: string, unit = 'USD'): Value[] {
    const concept = taxonomy[tag];
    if (
      !isObject(concept) ||
      !isObject(concept.units) ||
      !Array.isArray(concept.units[unit])
    )
      return [];
    return concept.units[unit]
      .filter(validFact)
      .map((fact) => ({ fact, concept: `us-gaap:${tag}`, unit }));
  }
  const values = new Map<FinancialMetric, Value[]>();
  for (const [metric, tags] of Object.entries({
    ...FLOW_TAGS,
    ...INSTANT_TAGS,
  }) as [FinancialMetric, string[]][]) {
    const unit =
      metric === 'eps'
        ? 'USD/shares'
        : metric === 'sharesOutstanding'
          ? 'shares'
          : 'USD';
    values.set(
      metric,
      tags.flatMap((tag) => readTag(tag, unit)),
    );
  }
  const flows = Object.keys(FLOW_TAGS).flatMap(
    (metric) => values.get(metric as FinancialMetric) ?? [],
  );
  const annualEnds = [
    ...new Set(flows.filter(annualFact).map((x) => x.fact.end)),
  ].sort();
  const annualAnchors = annualEnds.map((end) => {
    const matching = flows.filter((x) => annualFact(x) && x.fact.end === end);
    // Earliest original report supplies the fiscal-year label; later comparative fy values do not relabel old years.
    const anchor = matching.sort((a, b) =>
      a.fact.filed.localeCompare(b.fact.filed),
    )[0].fact;
    return {
      start: anchor.start!,
      end,
      fy:
        Number.isInteger(anchor.fy) &&
        days(end, anchor.filed) <= 270 &&
        Math.abs(anchor.fy! - Number(end.slice(0, 4))) <= 1
          ? anchor.fy!
          : null,
    };
  });
  type Anchor = {
    start: string;
    end: string;
    fy: number | null;
    q: number | null;
    yearStart: string;
  };
  function pick(
    metric: FinancialMetric,
    predicate: (value: Value) => boolean,
  ): Value | undefined {
    const tags = FLOW_TAGS[metric] ?? INSTANT_TAGS[metric] ?? [];
    for (const tag of tags) {
      const match = latest(
        (values.get(metric) ?? []).filter(
          (x) => x.concept === `us-gaap:${tag}` && predicate(x),
        ),
      );
      if (match) return match;
    }
  }
  function cumulative(
    metric: FinancialMetric,
    anchor: Anchor,
  ): Value | undefined {
    return pick(
      metric,
      (x) => x.fact.start === anchor.yearStart && x.fact.end === anchor.end,
    );
  }
  function row(anchor: Anchor, quarterly: boolean): NormalizedPeriod {
    const result = {
      ...Object.fromEntries(FINANCIAL_METRICS.map((key) => [key, null])),
      fiscalYear: anchor.fy,
      fiscalQuarter: anchor.q,
      periodStart: anchor.start,
      periodEnd: anchor.end,
      currency: 'USD',
      sources: {},
    } as NormalizedPeriod;
    for (const metric of Object.keys(FLOW_TAGS) as FinancialMetric[]) {
      const direct = pick(
        metric,
        (x) => x.fact.start === anchor.start && x.fact.end === anchor.end,
      );
      if (direct) {
        result[metric] = direct.fact.val;
        result.sources[metric] = {
          method: 'reported',
          items: [source(direct)],
        };
        continue;
      }
      // EPS is not additive: annual/YTD diluted EPS cannot safely be subtracted (weighted share counts differ).
      if (!quarterly || metric === 'eps' || anchor.q === 1) continue;
      const current = cumulative(metric, anchor);
      if (!current) continue;
      const priorCandidates = (values.get(metric) ?? []).filter(
        (x) =>
          x.concept === current.concept &&
          x.unit === current.unit &&
          x.fact.start === anchor.yearStart &&
          x.fact.end === shift(anchor.start, -1) &&
          x.fact.filed <= current.fact.filed,
      );
      const previous =
        latest(
          priorCandidates.filter((x) => x.fact.accn === current.fact.accn),
        ) ?? latest(priorCandidates);
      if (!previous) continue;
      result[metric] = difference(current.fact.val, previous.fact.val);
      result.sources[metric] = {
        method: 'ytd_difference',
        items: [source(current), source(previous)],
      };
    }
    // Company Facts is entity-wide (no segment dimensions). Only pair total revenue
    // with total cost of revenue from the very same filing, currency and duration.
    // Do not substitute operating expenses, service-only costs or a different filing.
    if (result.grossProfit === null && result.revenue !== null) {
      const revenueSource = result.sources.revenue;
      const revenueItems =
        isObject(revenueSource) && Array.isArray(revenueSource.items)
          ? revenueSource.items
          : [];
      const pairs = revenueItems.map((item) => {
        if (
          !isObject(item) ||
          item.unit !== 'USD' ||
          ![
            'us-gaap:Revenues',
            'us-gaap:SalesRevenueNet',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
          ].includes(String(item.concept))
        )
          return null;
        const cost = ['CostOfRevenue', 'CostOfGoodsAndServicesSold']
          .map((tag) =>
            latest(
              readTag(tag).filter(
                (value) =>
                  value.fact.start === item.start &&
                  value.fact.end === item.end &&
                  value.fact.accn === item.accn &&
                  value.fact.filed === item.filed &&
                  value.fact.form === item.form &&
                  value.fact.val >= 0,
              ),
            ),
          )
          .find(Boolean);
        return cost ? { revenue: item, cost } : null;
      });
      const reported =
        isObject(revenueSource) &&
        revenueSource.method === 'reported' &&
        pairs.length === 1;
      const differenced =
        isObject(revenueSource) &&
        revenueSource.method === 'ytd_difference' &&
        pairs.length === 2;
      if ((reported || differenced) && pairs.every((pair) => pair !== null)) {
        const current = pairs[0]!;
        const prior = differenced ? pairs[1]! : null;
        // Cumulative subtraction must retain the same cost definition at both endpoints.
        const cost =
          prior && current.cost.concept !== prior.cost.concept
            ? null
            : prior
              ? current.cost.fact.val - prior.cost.fact.val
              : current.cost.fact.val;
        if (cost !== null && cost >= 0) {
          result.grossProfit = difference(result.revenue, cost);
          result.sources.grossProfit = {
            method: 'calculated',
            formula: 'revenue-costOfRevenue',
            costMethod: differenced ? 'ytd_difference' : 'reported',
            inputs: [revenueSource, ...pairs.map((pair) => source(pair!.cost))],
          };
        }
      }
    }
    for (const metric of Object.keys(INSTANT_TAGS) as FinancialMetric[]) {
      const selected = pick(
        metric,
        (x) => !x.fact.start && x.fact.end === anchor.end,
      );
      if (selected) {
        result[metric] = selected.fact.val;
        result.sources[metric] = {
          method: 'reported',
          items: [source(selected)],
        };
      }
    }
    if (result.capex !== null && result.capex < 0) result.capex = null;
    result.capexToOcf = capexToOperatingCashFlow(
      result.capex,
      result.operatingCashFlow,
    );
    if (result.capexToOcf !== null)
      result.sources.capexToOcf = {
        method: 'calculated',
        formula: 'capex/operatingCashFlow*100',
        inputs: [result.sources.capex, result.sources.operatingCashFlow],
      };
    result.fcf = difference(result.operatingCashFlow, result.capex);
    if (result.fcf !== null)
      result.sources.fcf = {
        method: 'calculated',
        formula: 'operatingCashFlow-capex',
        inputs: [result.sources.operatingCashFlow, result.sources.capex],
      };
    const health = normalizeFinancialHealth(readTag, anchor.end);
    const { sources: healthSources, ...balances } = health;
    Object.assign(result, balances);
    Object.assign(result.sources, healthSources);
    result.bookValuePerShare = divide(result.equity, result.sharesOutstanding);
    result.grossMargin = divide(result.grossProfit, result.revenue, 100);
    result.operatingMargin = divide(
      result.operatingIncome,
      result.revenue,
      100,
    );
    result.netMargin = divide(result.netIncome, result.revenue, 100);
    result.fcfMargin = divide(result.fcf, result.revenue, 100);
    if (!quarterly) {
      const income = pick(
        'netIncome',
        (x) => x.fact.start === anchor.start && x.fact.end === anchor.end,
      );
      const balance = (tags: string[], end: string) => {
        for (const tag of tags) {
          const candidates = readTag(tag).filter(
            (x) =>
              !x.fact.start &&
              x.fact.end === end &&
              income &&
              x.fact.filed <= income.fact.filed,
          );
          const selected =
            latest(
              candidates.filter((x) => x.fact.accn === income?.fact.accn),
            ) ?? latest(candidates);
          if (selected) return selected;
        }
      };
      const equityTag =
        income?.concept === 'us-gaap:ProfitLoss'
          ? 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'
          : 'StockholdersEquity';
      const equity = balance([equityTag], shift(anchor.start, -1));
      const endingEquity = balance([equityTag], anchor.end);
      const assets = balance(['Assets'], shift(anchor.start, -1));
      const endingAssets = balance(['Assets'], anchor.end);
      // Prefer consolidated profit for total assets when reported in the same filing.
      const totalIncome =
        latest(
          readTag('ProfitLoss').filter(
            (x) =>
              x.fact.start === anchor.start &&
              x.fact.end === anchor.end &&
              x.fact.accn === income?.fact.accn,
          ),
        ) ?? income;
      result.roe =
        equity &&
        endingEquity &&
        equity.fact.val > 0 &&
        endingEquity.fact.val > 0
          ? divide(
              result.netIncome,
              (equity.fact.val + endingEquity.fact.val) / 2,
              100,
            )
          : null;
      result.roa =
        assets &&
        endingAssets &&
        assets.fact.val > 0 &&
        endingAssets.fact.val > 0
          ? divide(
              totalIncome?.fact.val ?? null,
              (assets.fact.val + endingAssets.fact.val) / 2,
              100,
            )
          : null;
      if (equity) result.sources.beginningEquity = source(equity);
      if (assets) result.sources.beginningAssets = source(assets);
      if (result.roe !== null)
        result.sources.roe = {
          method: 'calculated',
          formula: 'annualNetIncome/averageEquity*100',
          inputs: [
            income && source(income),
            source(equity!),
            source(endingEquity!),
          ],
        };
      if (result.roa !== null)
        result.sources.roa = {
          method: 'calculated',
          formula: 'annualNetIncome/averageAssets*100',
          inputs: [
            totalIncome && source(totalIncome),
            source(assets!),
            source(endingAssets!),
          ],
        };
    }
    result.sources.calculationPolicy = {
      version: 1,
      percentages: 'percentage_points',
      fcf: 'operatingCashFlow-capex',
      totalDebt: 'shortTermDebt+longTermDebt',
      roe: 'annual netIncome/average beginning and ending equity',
      roa: 'annual netIncome/average beginning and ending assets',
      quarterlyEps: 'reported independent quarter only',
    };
    for (const metric of FINANCIAL_METRICS)
      if (result[metric] !== null && !Number.isFinite(result[metric]))
        result[metric] = null;
    for (const metric of FINANCIAL_METRICS) {
      if (result[metric] !== null && !Number.isFinite(result[metric]))
        result[metric] = null;
    }
    return result;
  }
  const annual = annualAnchors.map((anchor) =>
    row({ ...anchor, q: null, yearStart: anchor.start }, false),
  );
  const quarterEnds = new Set(
    flows
      .filter(
        (x) =>
          quarterFact(x) ||
          (x.fact.start &&
            days(x.fact.start, x.fact.end) >= 150 &&
            days(x.fact.start, x.fact.end) <= 300 &&
            /^10-Q/.test(x.fact.form)),
      )
      .map((x) => x.fact.end),
  );
  annualAnchors.forEach((anchor) => quarterEnds.add(anchor.end));
  const quarters: Anchor[] = [];
  for (const end of [...quarterEnds].sort()) {
    const year = annualAnchors.find((x) => x.start <= end && x.end >= end);
    const precedingYear = [...annualAnchors].reverse().find((x) => x.end < end);
    const initial = flows
      .filter(
        (x) =>
          x.fact.end === end &&
          x.fact.start &&
          /^10-Q/.test(x.fact.form) &&
          x.fact.fp === 'Q1' &&
          quarterFact(x),
      )
      .sort((a, b) => a.fact.filed.localeCompare(b.fact.filed))[0];
    const yearStart =
      year?.start ??
      (precedingYear && days(precedingYear.end, end) <= 330
        ? shift(precedingYear.end, 1)
        : initial?.fact.start);
    if (!yearStart) continue;
    const elapsed = days(yearStart, end);
    const q = Math.round(elapsed / 91);
    if (q < 1 || q > 4 || Math.abs(elapsed - q * 91) > 20) continue;
    const direct = flows
      .filter(
        (x) =>
          x.fact.end === end && quarterFact(x) && x.fact.start! >= yearStart,
      )
      .sort((a, b) => a.fact.filed.localeCompare(b.fact.filed))[0];
    const previous = quarters.find(
      (x) => x.yearStart === yearStart && x.q === q - 1,
    );
    const start =
      direct?.fact.start ??
      (q === 1 ? yearStart : previous ? shift(previous.end, 1) : undefined);
    if (!start || days(start, end) < 60 || days(start, end) > 110) continue;
    const firstFiling = flows
      .filter((x) => x.fact.end === end && /^10-Q/.test(x.fact.form))
      .sort((a, b) => a.fact.filed.localeCompare(b.fact.filed))[0]?.fact;
    quarters.push({
      start,
      end,
      yearStart,
      q,
      fy:
        year?.fy ??
        (precedingYear?.fy !== null && precedingYear?.fy !== undefined
          ? precedingYear.fy + 1
          : Number.isInteger(firstFiling?.fy)
            ? firstFiling!.fy!
            : null),
    });
  }
  const quarterly = quarters.map((anchor) => row(anchor, true));
  function concepts(value: unknown): string[] {
    if (!isObject(value)) return [];
    const direct =
      typeof value.concept === 'string'
        ? [`${value.concept}:${value.unit}`]
        : [];
    return [
      ...direct,
      ...(['items', 'inputs'] as const).flatMap((key) =>
        Array.isArray(value[key]) ? value[key].flatMap(concepts) : [],
      ),
    ].sort();
  }
  // Bridge only revenue definitions reconciled by at least two identical, latest-filed overlapping periods.
  // Including assessed taxes is deliberately excluded from automatic bridging.
  const revenueBridges = new Map<string, Set<string>>();
  const bridgeTags = [
    'Revenues',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
  ];
  for (const a of bridgeTags)
    for (const b of bridgeTags) {
      if (a >= b) continue;
      const left = readTag(a),
        right = readTag(b);
      const periods = [
        ...new Set(
          left
            .filter((x) => x.fact.start)
            .map((x) => `${x.fact.start}/${x.fact.end}`),
        ),
      ];
      let matches = 0,
        conflict = false;
      for (const period of periods) {
        const x = latest(
          left.filter((x) => `${x.fact.start}/${x.fact.end}` === period),
        );
        const y = latest(
          right.filter((x) => `${x.fact.start}/${x.fact.end}` === period),
        );
        if (!x || !y) continue;
        if (
          Math.abs(x.fact.val - y.fact.val) >
          Math.max(1, Math.abs(x.fact.val) * 1e-10)
        ) {
          conflict = true;
          break;
        }
        matches++;
      }
      if (!conflict && matches >= 2) {
        const x = `us-gaap:${a}:USD`,
          y = `us-gaap:${b}:USD`;
        (revenueBridges.get(x) ?? revenueBridges.set(x, new Set()).get(x)!).add(
          y,
        );
        (revenueBridges.get(y) ?? revenueBridges.set(y, new Set()).get(y)!).add(
          x,
        );
      }
    }
  function bridged(a: string, b: string) {
    const visited = new Set<string>();
    const queue = [a];
    while (queue.length) {
      const node = queue.pop()!;
      if (node === b) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      queue.push(...(revenueBridges.get(node) ?? []));
    }
    return false;
  }
  function comparable(
    a: NormalizedPeriod,
    b: NormalizedPeriod,
    metric: FinancialMetric,
  ) {
    const left = concepts(a.sources[metric]);
    const right = concepts(b.sources[metric]);
    if (
      metric === 'revenue' &&
      left.length &&
      right.length &&
      left.every((x) => right.some((y) => bridged(x, y))) &&
      right.every((y) => left.some((x) => bridged(x, y)))
    )
      return true;
    return (
      left.length > 0 &&
      JSON.stringify([...new Set(left)]) === JSON.stringify([...new Set(right)])
    );
  }
  function calculateGrowth(rows: NormalizedPeriod[], quarterly: boolean) {
    for (let index = 0; index < rows.length; index++) {
      const current = rows[index];
      const prior = rows.find(
        (x) =>
          x !== current &&
          (!quarterly || x.fiscalQuarter === current.fiscalQuarter) &&
          days(x.periodEnd, current.periodEnd) >= 330 &&
          days(x.periodEnd, current.periodEnd) <= 400,
      );
      if (prior) {
        for (const [out, metric] of [
          ['revenueGrowth', 'revenue'],
          ['epsGrowth', 'eps'],
          ['fcfGrowth', 'fcf'],
          ['netIncomeGrowth', 'netIncome'],
          ['sharesChange', 'sharesOutstanding'],
        ] as [FinancialMetric, FinancialMetric][])
          current[out] =
            comparable(current, prior, metric) &&
            (metric !== 'eps' || (current.eps !== null && current.eps > 0))
              ? growth(current[metric], prior[metric])
              : null;
        current.sources.growthComparisonPeriodEnd = prior.periodEnd;
        current.sources.revenueComparisonPolicy =
          'same concept or reconciled revenue concepts with >=2 matching overlapping periods, no conflicts, USD only';
      }
      if (!quarterly) {
        for (const years of [3, 5]) {
          const previous = rows.find(
            (candidate) =>
              candidate !== current &&
              Math.abs(
                days(candidate.periodEnd, current.periodEnd) - years * 365,
              ) <= 20,
          );
          if (
            !previous ||
            Math.abs(
              days(previous.periodEnd, current.periodEnd) - years * 365,
            ) > 20
          )
            continue;
          for (const metric of ['revenue', 'eps', 'fcf'] as const) {
            const a = current[metric];
            const b = previous[metric];
            const value =
              (metric !== 'fcf' || rows[index - years] === previous) &&
              comparable(current, previous, metric) &&
              a !== null &&
              b !== null &&
              a > 0 &&
              b > 0
                ? (Math.pow(a / b, 1 / years) - 1) * 100
                : null;
            current[`${metric}Cagr${years}y` as FinancialMetric] =
              value !== null && Number.isFinite(value) ? value : null;
          }
        }
      }
    }
  }
  calculateGrowth(annual, false);
  calculateGrowth(quarterly, true);
  return {
    annual: annual.slice(-10).reverse(),
    quarterly: quarterly.slice(-10).reverse(),
  };
}
