import { Col, Row } from 'antd';
import { MetricCards } from '../components/Metrics.js';
import { METRICS } from '../../utils/financial-analysis.js';

import type { QualitySectionProps } from '../types.js';
import { ProfitabilityCharts } from './components/ProfitabilityCharts.js';
import {
  CapitalReturnTrends,
  RoicMetricCard,
} from './components/RoicPresentation.js';
export function ProfitabilitySection({
  rows,
  latest,
  mode,
  quality,
}: QualitySectionProps) {
  return (
    <>
      <MetricCards
        row={latest}
        mode={mode}
        columns={5}
        extra={<RoicMetricCard row={latest} mode={mode} resource={quality} />}
        metrics={[
          METRICS.grossMargin,
          METRICS.operatingMargin,
          METRICS.netMargin,
          METRICS.roe,
        ]}
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <ProfitabilityCharts rows={rows} mode={mode} />
        </Col>
        <Col xs={24} xl={12}>
          <CapitalReturnTrends rows={rows} mode={mode} data={quality?.data} />
        </Col>
      </Row>
    </>
  );
}
