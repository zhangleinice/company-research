import type { ReactNode } from 'react';
import {
  Card,
  Col,
  Descriptions,
  Row,
  Statistic,
  Tooltip,
  Typography,
} from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import {
  analysisValue,
  formatAnalysisValue,
  type MetricDefinition,
} from '../../utils/financial-analysis.js';
export function MetricTitle({
  metric,
  row,
}: {
  metric: MetricDefinition;
  row?: FinancialPeriod;
}) {
  return (
    <Tooltip
      title={`${metric.description}${metric.key === 'interestCoverage' && row?.interestCoverageDetails?.reason ? ` ${row.interestCoverageDetails.reason}` : ''}`}
    >
      <span className="analysis-metric-title">
        {metric.label}
        <span className="metric-help" aria-label={`${metric.label} 指标说明`}>
          ⓘ
        </span>
      </span>
    </Tooltip>
  );
}
export function MetricCards({
  metrics,
  row,
  mode,
  columns = 4,
  extra,
}: {
  metrics: MetricDefinition[];
  columns?: 3 | 4 | 5 | 6;
  extra?: ReactNode;
  row: FinancialPeriod | undefined;
  mode: FinancialMode;
}) {
  const layout =
    columns === 5
      ? { xs: { flex: '100%' }, sm: { flex: '50%' }, xl: { flex: '20%' } }
      : { xs: 24, sm: 12, xl: columns === 6 ? 4 : columns === 3 ? 8 : 6 };
  return (
    <Row gutter={[16, 16]}>
      {metrics.map((metric) => {
        const value = analysisValue(row, metric.key, mode);
        return (
          <Col {...layout} key={metric.key}>
            <Card
              size="small"
              className="analysis-metric-card"
              data-metric={metric.key}
            >
              <Statistic
                title={<MetricTitle metric={metric} row={row} />}
                value={value ?? '—'}
                formatter={() => formatAnalysisValue(value, metric.unit)}
              />
              <Typography.Text type="secondary" className="metric-unit">
                {metric.unit === 'money'
                  ? '百万美元'
                  : metric.unit === 'perShare'
                    ? '美元 / 股'
                    : metric.unit === 'percent'
                      ? '百分比'
                      : metric.unit === 'shares'
                        ? '百万股'
                        : '倍'}
              </Typography.Text>
            </Card>
          </Col>
        );
      })}
      {extra && <Col {...layout}>{extra}</Col>}
    </Row>
  );
}
export function Auxiliary({
  metrics,
  row,
  mode,
}: {
  metrics: MetricDefinition[];
  row: FinancialPeriod | undefined;
  mode: FinancialMode;
}) {
  return (
    <Descriptions
      className="analysis-auxiliary"
      size="small"
      column={{ xs: 1, sm: 2, lg: 4 }}
      items={metrics.map((metric) => ({
        key: metric.key,
        label: <MetricTitle metric={metric} row={row} />,
        children: (
          <span data-metric={metric.key}>
            {formatAnalysisValue(
              analysisValue(row, metric.key, mode),
              metric.unit,
            )}
            {analysisValue(row, metric.key, mode) !== null &&
              (metric.unit === 'money'
                ? ' 百万美元'
                : metric.unit === 'perShare'
                  ? ' 美元 / 股'
                  : '')}
          </span>
        ),
      }))}
    />
  );
}
