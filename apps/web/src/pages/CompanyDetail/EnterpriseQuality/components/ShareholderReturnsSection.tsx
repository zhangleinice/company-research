import { Col, Row } from 'antd';
import { MetricCards } from './Metrics.js';
import { METRICS } from '../../utils/financial-analysis.js';
import { Chart } from '../../components/financial/Chart.js';
import { ShareholderReturnsChart } from '../../components/financial/ShareholderReturnsChart.js';
import type { QualitySectionProps } from '../types.js';
const BLUE = '#1677ff';
import type { TrendSeries } from '../../components/financial/FinancialTrendChart.js';
const series = (
  key: TrendSeries['key'],
  label: string,
  color: string,
): TrendSeries => ({ key, label, color });
export function ShareholderReturnsSection({
  rows,
  latest,
  mode,
}: QualitySectionProps) {
  return (
    <>
      <MetricCards
        row={latest}
        mode={mode}
        metrics={[
          METRICS.stockRepurchases,
          METRICS.dilutedSharesGrowth,
          METRICS.dividendsPerShare,
          METRICS.dpsGrowth,
        ]}
      />
      <Row gutter={[24, 16]}>
        <Col xs={24} xl={12}>
          <ShareholderReturnsChart rows={rows} mode={mode} />
        </Col>
        <Col xs={24} xl={12}>
          <Chart
            title="Dividends Per Share Trend · 每股股息趋势（美元/股）"
            rows={rows}
            mode={mode}
            unit="perShare"
            series={[series('dividendsPerShare', 'Declared DPS', BLUE)]}
          />
        </Col>
      </Row>
    </>
  );
}
