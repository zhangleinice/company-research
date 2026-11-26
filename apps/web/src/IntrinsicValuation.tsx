import { Card, Tabs } from 'antd';
import { DcfCalculator } from './ValuationPage.js';
import { MultipleValuation } from './MultipleValuation.js';
export function IntrinsicValuation({
  ticker,
  revision = 0,
}: {
  ticker: string;
  revision?: number;
}) {
  return (
    <Tabs
      defaultActiveKey="dcf"
      destroyOnHidden={false}
      items={[
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
