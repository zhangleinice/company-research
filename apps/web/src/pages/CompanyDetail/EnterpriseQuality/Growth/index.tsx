import { Col, Row, Typography } from 'antd';
import { MetricCards, Auxiliary } from '../components/Metrics.js';
import { METRICS } from '../../utils/financial-analysis.js';
import { Chart } from '../../components/financial/Chart.js';

import type { QualitySectionProps } from '../types.js';
import { GrowthChart } from './components/GrowthChart.js';
const BLUE = '#1677ff';
import type { TrendSeries } from '../../components/financial/FinancialTrendChart.js';
const series = (
  key: TrendSeries['key'],
  label: string,
  color: string,
): TrendSeries => ({ key, label, color });
export function GrowthSection({ rows, latest, mode }: QualitySectionProps) {
  return (
    <>
      <MetricCards
        row={latest}
        mode={mode}
        metrics={[
          METRICS.revenue,
          METRICS.revenueGrowth,
          METRICS.eps,
          METRICS.epsGrowth,
        ]}
      />
      <Auxiliary
        row={latest}
        mode={mode}
        metrics={[
          METRICS.revenueCagr3y,
          METRICS.revenueCagr5y,
          METRICS.epsCagr3y,
          METRICS.epsCagr5y,
        ]}
      />
      {mode === 'quarterly' && (
        <Typography.Paragraph type="secondary">
          季度仅展示独立季度与同比；CAGR 需要完整年度数据，此处保留 —。
        </Typography.Paragraph>
      )}
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <Chart
            title="Revenue 历史趋势（亿美元）"
            moneyDivisor={100000000}
            moneyUnit="亿美元"
            rows={rows}
            mode={mode}
            series={[series('revenue', 'Revenue', BLUE)]}
          />
        </Col>
        <Col xs={24} xl={12}>
          <section className="analysis-chart-panel">
            <Typography.Title level={5}>
              Revenue / EPS 同比趋势
            </Typography.Title>
            <GrowthChart rows={rows} mode={mode} includeFcf={false} />
          </section>
        </Col>
      </Row>
    </>
  );
}
