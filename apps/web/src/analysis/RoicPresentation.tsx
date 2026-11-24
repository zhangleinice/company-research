import { Card, Statistic, Tag, Tooltip, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import type { QualityResource } from '../EnterpriseQuality.js';
import { FinancialTrendChart } from './FinancialTrendChart.js';
import { formatAnalysisValue } from './financial-analysis.js';
import {
  matchRoic,
  roicHistory,
  roicPercent,
  roicReasons,
  roicStatus,
  type RoicHistory,
  type RoicResult,
} from './roic-presentation.js';
const label = (mode: FinancialMode) =>
  mode === 'annual' ? '年度报表口径参考 ROIC' : '单季度报表口径参考 ROIC';
function Status({
  result,
  history,
}: {
  result?: RoicResult;
  history?: RoicHistory;
}) {
  return (
    <Tag color={result?.status === 'READY' ? 'green' : undefined}>
      {roicStatus(result, history)}
    </Tag>
  );
}
export function RoicMetricCard({
  row,
  mode,
  resource,
}: {
  row?: FinancialPeriod;
  mode: FinancialMode;
  resource?: QualityResource;
}) {
  const history = roicHistory(resource?.data, mode),
    result = matchRoic(row, history, mode);
  return (
    <Card size="small" className="analysis-metric-card" data-metric="roic">
      <Statistic
        title={
          <Tooltip
            title={`${label(mode)} = NOPAT / 平均投入资本；仅显示当前完整报告期间，缺失不回退。`}
          >
            <span className="analysis-metric-title">
              ROIC · 投入资本回报率
              <span className="metric-help" aria-label="ROIC 指标说明">
                {' '}
                ⓘ
              </span>
            </span>
          </Tooltip>
        }
        value={roicPercent(result) ?? '—'}
        formatter={() => formatAnalysisValue(roicPercent(result), 'percent')}
      />
      <Typography.Text type="secondary" className="metric-unit">
        {label(mode)}
        {mode === 'quarterly' ? ' · 非年化、非 TTM' : ''}
      </Typography.Text>
      {resource?.loading ? (
        <Typography.Text type="secondary">读取 ROIC 缓存…</Typography.Text>
      ) : resource?.error ? (
        <Typography.Text type="secondary">{resource.error}</Typography.Text>
      ) : (
        <>
          <Status result={result} history={history} />
          {roicReasons(result, history).map((r, i) => (
            <div key={`${r.code}-${i}`}>
              <Typography.Text type="secondary">{r.message}</Typography.Text>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}
export function CapitalReturnTrends({
  rows,
  mode,
  data,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
  data?: QualityResource['data'];
}) {
  const history = roicHistory(data, mode);
  const values = new Map(
    rows.map((row) => [
      row.periodEnd,
      roicPercent(matchRoic(row, history, mode)),
    ]),
  );
  const title = 'Capital Return Trends · 资本回报趋势';
  return (
    <section className="analysis-chart-panel" data-chart="capital-returns">
      <Typography.Title level={5}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {label(mode)}
        {mode === 'quarterly' ? ' · 单季度、非年化、非 TTM' : ''} ·
        缺失期间不连线
      </Typography.Paragraph>
      <FinancialTrendChart
        title={title}
        rows={rows}
        mode={mode}
        unit="percent"
        series={[
          { key: 'roe', label: 'ROE', color: '#1677ff' },
          { key: 'roic', label: 'ROIC', color: '#389e6f' },
        ]}
        roicValues={values}
        retainEmptyPeriods
      />
    </section>
  );
}
