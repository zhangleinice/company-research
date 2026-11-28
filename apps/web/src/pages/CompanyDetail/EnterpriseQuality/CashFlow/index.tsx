import { Col, Row } from 'antd';
import { MetricCards } from '../components/Metrics.js';
import { METRICS } from '../../utils/financial-analysis.js';

import type { QualitySectionProps } from '../types.js';
import { CashFlowCharts } from './components/CashFlowCharts.js';
import { CashFlowQualityChart } from './components/CashFlowQualityChart.js';
export function CashFlowSection({ rows, latest, mode }: QualitySectionProps) {
  return (
    <>
      <MetricCards
        row={latest}
        mode={mode}
        columns={5}
        metrics={[
          METRICS.operatingCashFlow,
          METRICS.capex,
          METRICS.fcf,
          METRICS.fcfMargin,
          METRICS.cashConversionRatio,
        ]}
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <CashFlowCharts rows={rows} mode={mode} />
        </Col>
        <Col xs={24} xl={12}>
          <CashFlowQualityChart rows={rows} mode={mode} />
        </Col>
      </Row>
    </>
  );
}
