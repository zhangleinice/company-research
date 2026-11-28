import { AcquisitionList } from './components/AcquisitionList.js';
import { Card, Space } from 'antd';

import { CapitalSource } from '../components/CapitalAllocationResearch.js';

import type { ManagementModuleProps } from '../types.js';
export function AcquisitionsModule({
  research,
  updating = false,
}: ManagementModuleProps) {
  return (
    <section data-analysis-module="acquisitions">
      <Card className="analysis-module" title="Acquisitions · 企业收购">
        <Space orientation="vertical" size={16} className="full-width">
          <CapitalSource research={research} updating={updating} />
          <AcquisitionList research={research} />
        </Space>
      </Card>
    </section>
  );
}
