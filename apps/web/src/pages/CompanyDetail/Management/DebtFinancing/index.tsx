import { Card, Space } from 'antd';

import { AllocationCards } from '../components/AllocationCards.js';
import {
  CapitalSource,
  CapitalNotes,
  capitalInformation,
} from '../components/CapitalAllocationResearch.js';
import { unknown } from '../utils/missing-allocation.js';
import type { ManagementModuleProps } from '../types.js';
export function DebtFinancingModule({
  latest,
  research,
  updating = false,
}: ManagementModuleProps) {
  const { info } = capitalInformation(research);
  return (
    <section data-analysis-module="financing">
      <Card className="analysis-module" title="Debt & Financing · 债务与融资">
        <Space orientation="vertical" size={16} className="full-width">
          <CapitalSource research={research} updating={updating} />
          <CapitalNotes
            research={research}
            groups={[
              {
                key: 'financingActivities',
                title: '重大融资行为',
                notes: info?.debtAndFinancing.financingActivities ?? [],
              },
              {
                key: 'financingPurposes',
                title: '融资资金用途',
                notes: info?.debtAndFinancing.financingPurposes ?? [],
              },
              {
                key: 'financingTerms',
                title: '重要融资条款',
                notes: info?.debtAndFinancing.financingTerms ?? [],
              },
              {
                key: 'financingRisks',
                title: '融资风险',
                notes: info?.debtAndFinancing.financingRisks ?? [],
              },
            ]}
          />
          <AllocationCards
            items={[
              {
                key: 'debtIssuance',
                label: 'Proceeds from Issuance of Debt · 债务发行现金流入',
                unit: 'money',
                description:
                  '同一完整财年的债务发行现金流入（百万美元），仅采用SEC长短期债务汇总标签，不累加分项。',
                ...(latest?.capitalAllocation?.debtCashFlows?.debtIssuance ??
                  unknown('缺少年度债务现金流缓存，请仅刷新SEC财务数据')),
              },
              {
                key: 'debtRepayments',
                label: 'Repayments of Debt · 债务偿还现金流出',
                unit: 'money',
                description:
                  '同一完整财年的债务偿还现金流出（百万美元），不以债务余额变化或融资租赁付款替代。',
                ...(latest?.capitalAllocation?.debtCashFlows?.debtRepayments ??
                  unknown('缺少年度债务现金流缓存，请仅刷新SEC财务数据')),
              },
            ]}
          />
        </Space>
      </Card>
    </section>
  );
}
