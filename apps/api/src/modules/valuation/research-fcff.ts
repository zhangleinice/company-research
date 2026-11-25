import type { ValuationBaseline } from '@company-research/shared';
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
/** Conditional research policy, not approval of actual cash-interest or marginal tax shield. */
export function withResearchFcff(
  b: ValuationBaseline,
  taxRate = 0.21,
): ValuationBaseline {
  const missing = (reason: string): ValuationBaseline => ({
    ...b,
    fcffEstimate: {
      status: 'MISSING',
      value: null,
      taxRate: null,
      reason,
      assumptions: [],
      version: 'ocf-expensed-interest-v1',
    },
  });
  if (!finite(taxRate) || taxRate < 0 || taxRate > 1)
    return missing('缺少有效研究税率');
  if (finite(b.fcff)) return b; // Never replace an approved baseline, including nonpositive values.
  if (!b.applicable)
    return missing('金融企业或行业资料不足，不自动套用普通FCFF模型。');
  if (
    !finite(b.ocf?.value) ||
    !finite(b.capex?.value) ||
    !finite(b.fcf) ||
    b.capex.value < 0
  )
    return missing('缺少有效同期TTM OCF或现金资本支出。');
  const facts = [b.ocf, b.capex, b.interest];
  if (
    !b.ocf.start ||
    facts.some(
      (f) =>
        !f ||
        f.start !== b.ocf.start ||
        f.end !== b.ocf.end ||
        f.end !== b.asOf,
    )
  )
    return missing('经营现金流、资本支出和利息的TTM期间不一致或缺失。');
  if (
    b.ocf.concept !== 'us-gaap:NetCashProvidedByUsedInOperatingActivities' ||
    b.capex.concept !== 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment' ||
    ![
      'us-gaap:InterestExpenseNonoperating',
      'us-gaap:InterestExpense',
    ].includes(b.interest.concept ?? '')
  )
    return missing('缺少可识别的US-GAAP经营现金流、PP&E支出或总利息费用口径。');
  if (!finite(b.interest.value) || b.interest.value < 0)
    return missing('缺少同期总利息费用；不将缺失或净利息收入当作0。');
  if (Math.abs(b.fcf - (b.ocf.value - b.capex.value)) > 0.01)
    return missing('缓存FCF与同期OCF−CapEx不一致。');
  if (!finite(b.ebit?.value) || b.ebit.value <= 0)
    return missing('营业利润非正或缺失，利息税盾可用性不足，暂不自动估算。');
  const pretax = b.fcffChecks?.pretax;
  if (pretax && finite(pretax.value) && pretax.value <= 0)
    return missing('同期税前利润非正，暂不假设可立即利用利息税盾。');
  if (
    facts.some((f) => !f.items.length || f.items.some((i) => i.unit !== 'USD'))
  )
    return missing('缺少美元原始事实来源，无法自动估算。');
  const cash = b.fcffChecks?.cashInterest;
  if (
    cash &&
    finite(cash.value) &&
    (cash.start !== b.ocf.start ||
      cash.end !== b.ocf.end ||
      cash.value !== b.interest.value)
  )
    return missing(
      '已披露现金付息与费用存在差额或期间不同，需先调节，不自动按费用加回。',
    );
  const value = b.fcf + b.interest.value * (1 - taxRate);
  if (!finite(value) || value <= 0)
    return missing('研究性FCFF基准非正，当前正现金流增长模型不适用。');
  const capitalized = b.fcffChecks?.capitalizedInterest?.value;
  return {
    ...b,
    warnings: [
      ...new Set([
        ...(b.warnings ?? []).filter((w) => !w.includes('简单预测禁用')),
        '自动预测使用的是条件性研究估计，不是已核准历史FCFF。',
      ]),
    ],
    fcffEstimate: {
      status: 'RESEARCH',
      value,
      taxRate,
      version: 'ocf-expensed-interest-v1',
      reason: `研究性估计：以已费用化利息代理US-GAAP经营现金付息，${taxRate * 100}%为税盾假设。`,
      assumptions: [
        '非资本化现金付息按US-GAAP列经营活动；已费用化利息作为现金付息代理，未核准应计/非现金差额。',
        `资本化利息${finite(capitalized) ? `TTM披露为${capitalized / 1e6}百万美元` : '金额尚不完整'}，不额外加回；没有将缺失资本化金额设为0。`,
        taxRate === 0.21
          ? '21%参考美国联邦公司税率，仅假设利息可按该税率即时抵扣，不是公司实际税率；未计州/海外税差异与扣除限制。'
          : `${taxRate * 100}%为选择的研究税率，不保证是可即时利用的边际税盾。`,
        '未完成租赁、非经营项目及特殊融资的全面正常化；后续DCF仅为这些假设成立时的条件性研究估值。',
      ],
    },
  };
}
