import { Col, Row } from 'antd';
import { MetricCards } from '../components/Metrics.js';
import { METRICS } from '../../utils/financial-analysis.js';

import type { QualitySectionProps } from '../types.js';
import { FinancialHealthChart } from './components/FinancialHealthChart.js';
import { FinancialRatioChart } from './components/FinancialRatioChart.js';
export function FinancialHealthSection({
  rows,
  latest,
  mode,
}: QualitySectionProps) {
  return (
    <>
      <MetricCards
        row={latest}
        mode={mode}
        columns={6}
        metrics={[
          METRICS.cashAndShortTermSecurities,
          METRICS.totalDebt,
          METRICS.netDebt,
          METRICS.currentRatio,
          METRICS.debtToEquity,
          METRICS.interestCoverage,
        ]}
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <FinancialHealthChart rows={rows} mode={mode} />
        </Col>
        <Col xs={24} xl={12}>
          <FinancialRatioChart rows={rows} mode={mode} />
        </Col>
      </Row>
    </>
  );
}
