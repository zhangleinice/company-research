import { GrowthChart } from '../GrowthChart.js';
import {
  Alert,
  Card,
  Col,
  Descriptions,
  Empty,
  Row,
  Space,
  Statistic,
  Tag,
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

const BLUE = '#1677ff',
  GREEN = '#389e6f',
  PURPLE = '#9254de',
  ORANGE = '#d89614';
const series = (
  key: TrendSeries['key'],
  label: string,
  color: string,
): TrendSeries => ({ key, label, color });
function MetricTitle({ metric }: { metric: MetricDefinition }) {
  return (
    <Tooltip title={metric.description}>
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
}: {
  metrics: MetricDefinition[];
  row: FinancialPeriod | undefined;
  mode: FinancialMode;
}) {
  return (
    <Row gutter={[16, 16]}>
      {metrics.map((metric) => {
        const value = analysisValue(row, metric.key, mode);
        return (
          <Col xs={24} sm={12} xl={6} key={metric.key}>
            <Card
              size="small"
              className="analysis-metric-card"
              data-metric={metric.key}
            >
              <Statistic
                title={<MetricTitle metric={metric} />}
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
                      : '倍'}
              </Typography.Text>
            </Card>
          </Col>
        );
      })}
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
        label: <MetricTitle metric={metric} />,
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
function Chart({
  title,
  rows,
  mode,
  series,
  unit = 'money',
}: {
  title: string;
  rows: FinancialPeriod[];
  mode: FinancialMode;
  series: TrendSeries[];
  unit?: 'money' | 'percent';
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
      />
    </section>
  );
}
export function AnalysisPlaceholder({ title }: { title: string }) {
  return (
    <Card size="small" className="analysis-placeholder">
      <Space wrap>
        <Typography.Text strong>{title}</Typography.Text>
        <Tag>待开发</Tag>
      </Space>
    </Card>
  );
}

export function FinancialAnalysis({
  detail,
  mode,
}: {
  detail: Pick<CompanyDetail, 'annual' | 'quarterly'>;
  mode: FinancialMode;
}) {
  const rows = analysisPeriods(detail, mode),
    latest = rows[0];
  const periodText = latest
    ? `${mode === 'annual' ? '完整财年' : '独立季度'} · ${latest.periodStart} 至 ${latest.periodEnd}`
    : '当前口径暂无可用报告期间';
  return (
    <Space orientation="vertical" size={24} className="full-width">
      {ANALYSIS_MODULES.map((module) => (
        <section
          key={module.key}
          data-analysis-module={module.key}
          aria-labelledby={`analysis-${module.key}`}
        >
          <Card
            title={<span id={`analysis-${module.key}`}>{module.title}</span>}
            className="analysis-module"
          >
            <Typography.Paragraph type="secondary">
              {module.purpose}
            </Typography.Paragraph>
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
                          title="Revenue 历史趋势"
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
                      metrics={[
                        METRICS.grossMargin,
                        METRICS.operatingMargin,
                        METRICS.netMargin,
                        mode === 'annual' ? METRICS.roe : METRICS.netIncome,
                      ]}
                    />
                    <Auxiliary
                      row={latest}
                      mode={mode}
                      metrics={[
                        METRICS.grossProfit,
                        METRICS.operatingIncome,
                        ...(mode === 'annual'
                          ? [METRICS.netIncome, METRICS.roa]
                          : []),
                      ]}
                    />
                    {mode === 'quarterly' && (
                      <Typography.Paragraph type="secondary">
                        季度资本回报口径尚未验证，不展示 ROE /
                        ROA，也不以年度值替代。
                      </Typography.Paragraph>
                    )}
                    <Row gutter={[24, 24]}>
                      <Col xs={24} xl={12}>
                        <Chart
                          title="利润率历史趋势"
                          rows={rows}
                          mode={mode}
                          unit="percent"
                          series={[
                            series('grossMargin', 'Gross Margin', BLUE),
                            series(
                              'operatingMargin',
                              'Operating Margin',
                              GREEN,
                            ),
                            series('netMargin', 'Net Margin', PURPLE),
                          ]}
                        />
                      </Col>
                      <Col xs={24} xl={12}>
                        <Chart
                          title="利润历史变化"
                          rows={rows}
                          mode={mode}
                          series={[
                            series('grossProfit', 'Gross Profit', BLUE),
                            series(
                              'operatingIncome',
                              'Operating Income',
                              GREEN,
                            ),
                            series('netIncome', 'Net Income', PURPLE),
                          ]}
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
                      metrics={[
                        METRICS.operatingCashFlow,
                        METRICS.capex,
                        METRICS.fcf,
                        METRICS.fcfMargin,
                      ]}
                    />
                    <Typography.Paragraph className="cash-flow-formula">
                      <Typography.Text strong>
                        FCF = OCF − CapEx
                      </Typography.Text>
                    </Typography.Paragraph>
                    {latest &&
                      (latest.capex === null || latest.fcf === null) && (
                        <Alert
                          type="info"
                          showIcon
                          className="analysis-note"
                          title="CapEx / FCF 数据不完整"
                          description="缺失可能源于标准字段未覆盖、单位或报告期间不匹配；本页保留缺失状态。没有可靠 CapEx 时不会填 0 或估算 FCF。"
                        />
                      )}
                    <Typography.Paragraph type="secondary">
                      CapEx
                      当前采用购建物业、厂房及设备的现金支出；不把并购、净投资现金流或无形资产购置混入该口径。
                    </Typography.Paragraph>
                    <Row gutter={[24, 24]}>
                      <Col xs={24} xl={12}>
                        <Chart
                          title="OCF / CapEx / FCF 历史趋势"
                          rows={rows}
                          mode={mode}
                          series={[
                            series('operatingCashFlow', 'OCF', BLUE),
                            series('capex', 'CapEx', ORANGE),
                            series('fcf', 'FCF', GREEN),
                          ]}
                        />
                      </Col>
                      <Col xs={24} xl={12}>
                        <Chart
                          title="利润与经营现金流对比"
                          rows={rows}
                          mode={mode}
                          series={[
                            series('netIncome', 'Net Income', PURPLE),
                            series('operatingCashFlow', 'OCF', BLUE),
                          ]}
                        />
                      </Col>
                    </Row>
                    <Typography.Title level={5}>
                      辅助信息 · 增长与股东现金回报
                    </Typography.Title>
                    <Auxiliary
                      row={latest}
                      mode={mode}
                      metrics={[
                        METRICS.fcfGrowth,
                        METRICS.netIncome,
                        METRICS.stockRepurchases,
                        METRICS.dividendsPaid,
                      ]}
                    />
                  </>
                )}
                {module.key === 'financial-health' && (
                  <>
                    <MetricCards
                      row={latest}
                      mode={mode}
                      metrics={[
                        METRICS.cash,
                        METRICS.totalDebt,
                        METRICS.netDebt,
                        METRICS.currentRatio,
                      ]}
                    />
                    <Typography.Paragraph type="secondary">
                      余额均取对应报告期末。Net Debt = Total Debt −
                      Cash，仅扣现金及现金等价物，不扣短期投资；Total Debt
                      是有息债务，不是 Total Liabilities。
                    </Typography.Paragraph>
                    <Chart
                      title="现金储备与债务历史趋势"
                      rows={rows}
                      mode={mode}
                      series={[
                        series('cash', 'Cash', BLUE),
                        series('totalDebt', 'Total Debt', ORANGE),
                      ]}
                    />
                    <Auxiliary
                      row={latest}
                      mode={mode}
                      metrics={[
                        METRICS.marketableSecurities,
                        METRICS.currentAssets,
                        METRICS.currentLiabilities,
                        METRICS.debtToEquity,
                      ]}
                    />
                  </>
                )}
              </>
            )}
          </Card>
        </section>
      ))}
    </Space>
  );
}
