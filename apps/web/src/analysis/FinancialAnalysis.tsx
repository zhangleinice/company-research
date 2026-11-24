import { FinancialRatioChart } from './FinancialRatioChart.js';
import { CapitalReturnTrends, RoicMetricCard } from './RoicPresentation.js';
import type { QualityResource } from '../EnterpriseQuality.js';
import type { ReactNode } from 'react';
import { ShareholderReturnsChart } from './ShareholderReturnsChart.js';
import { FinancialHealthChart } from './FinancialHealthChart.js';
import { CashFlowQualityChart } from './CashFlowQualityChart.js';
import { CashFlowCharts } from './CashFlowCharts.js';
import { ProfitabilityCharts } from './ProfitabilityCharts.js';
import { GrowthChart } from '../GrowthChart.js';
import {
  Card,
  Col,
  Descriptions,
  Empty,
  Row,
  Space,
  Statistic,
  Tooltip,
  Typography,
} from 'antd';
import type {
  CompanyDetail,
  FinancialMode,
  FinancialPeriod,
} from '@company-research/shared';
import {
  ANALYSIS_MODULES,
  METRICS,
  analysisPeriods,
  analysisValue,
  formatAnalysisValue,
  type MetricDefinition,
} from './financial-analysis.js';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';

const BLUE = '#1677ff';
const series = (
  key: TrendSeries['key'],
  label: string,
  color: string,
): TrendSeries => ({ key, label, color });
function MetricTitle({
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
function MetricCards({
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
function Auxiliary({
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
export function Chart({
  title,
  rows,
  mode,
  series,
  unit = 'money',
  moneyDivisor,
  moneyUnit,
}: {
  title: string;
  rows: FinancialPeriod[];
  mode: FinancialMode;
  series: TrendSeries[];
  unit?: 'money' | 'percent' | 'shares' | 'perShare';
  moneyDivisor?: number;
  moneyUnit?: string;
}) {
  return (
    <section className="analysis-chart-panel">
      <Typography.Title level={5}>{title}</Typography.Title>
      <FinancialTrendChart
        title={title}
        rows={rows}
        mode={mode}
        series={series}
        unit={unit}
        moneyDivisor={moneyDivisor}
        moneyUnit={moneyUnit}
      />
    </section>
  );
}
export function FinancialAnalysis({
  detail,
  mode,
  modules,
  growthDetails,
  quality,
}: {
  detail: Pick<CompanyDetail, 'annual' | 'quarterly'>;
  mode: FinancialMode;
  modules?: readonly (typeof ANALYSIS_MODULES)[number]['key'][];
  growthDetails?: ReactNode;
  quality?: QualityResource;
}) {
  const rows = analysisPeriods(detail, mode),
    latest = rows[0];
  const periodText = latest
    ? `${mode === 'annual' ? '完整财年' : '独立季度'} · ${latest.periodStart} 至 ${latest.periodEnd}`
    : '当前口径暂无可用报告期间';
  return (
    <Space orientation="vertical" size={24} className="full-width">
      {ANALYSIS_MODULES.filter(
        (module) => !modules || modules.includes(module.key),
      ).map((module) => (
        <section
          key={module.key}
          data-analysis-module={module.key}
          aria-labelledby={`analysis-${module.key}`}
        >
          <Card
            title={<span id={`analysis-${module.key}`}>{module.title}</span>}
            className="analysis-module"
          >
            <Typography.Paragraph className="analysis-period">
              {periodText} · 金额：百万美元 · 缺失数据：—
            </Typography.Paragraph>
            {!rows.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`暂无${mode === 'annual' ? '年度' : '独立季度'}财务数据`}
              />
            )}
            {rows.length > 0 && (
              <>
                {module.key === 'growth' && (
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
                        季度仅展示独立季度与同比；CAGR
                        需要完整年度数据，此处保留 —。
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
                          <GrowthChart
                            rows={rows}
                            mode={mode}
                            includeFcf={false}
                          />
                        </section>
                      </Col>
                    </Row>
                  </>
                )}
                {module.key === 'profitability' && (
                  <>
                    <MetricCards
                      row={latest}
                      mode={mode}
                      columns={5}
                      extra={
                        <RoicMetricCard
                          row={latest}
                          mode={mode}
                          resource={quality}
                        />
                      }
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
                        <CapitalReturnTrends
                          rows={rows}
                          mode={mode}
                          data={quality?.data}
                        />
                      </Col>
                    </Row>
                  </>
                )}
                {module.key === 'cash-flow' && (
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
                )}
                {module.key === 'financial-health' && (
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
                )}
                {module.key === 'shareholder-returns' && (
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
                          series={[
                            series('dividendsPerShare', 'Declared DPS', BLUE),
                          ]}
                        />
                      </Col>
                    </Row>
                  </>
                )}
              </>
            )}
            {module.key === 'growth' && growthDetails}
          </Card>
        </section>
      ))}
    </Space>
  );
}
