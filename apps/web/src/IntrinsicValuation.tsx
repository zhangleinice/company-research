import { Card, Tabs } from 'antd';
import { OwnerEarnings } from './OwnerEarnings.js';
import { DcfCalculator } from './ValuationPage.js';
import { MultipleValuation } from './MultipleValuation.js';
export function IntrinsicValuation({
  cik,
  ticker,
  revision = 0,
}: {
  cik: string;
  ticker: string;
  revision?: number;
}) {
  return (
    <Tabs
      defaultActiveKey="dcf"
      destroyOnHidden={false}
      items={[
        {
          key: 'owner',
          label: 'Owner Earnings',
          children: (
            <OwnerEarnings key={cik} identifier={cik} revision={revision} />
          ),
        },
        {
          key: 'dcf',
          label: 'DCF',
          children: (
            <Card className="valuation-card" title="内在价值">
              <DcfCalculator ticker={ticker} />
            </Card>
          ),
        },
        {
          key: 'multiples',
          label: 'PE & PEG',
          children: (
            <Card className="valuation-card">
              <MultipleValuation ticker={ticker} revision={revision} />
            </Card>
          ),
        },
      ]}
    />
  );
}
