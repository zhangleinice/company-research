import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Alert, Card, Segmented, Space, Spin, Tooltip, Typography } from 'antd';
import { OcfCoverageView } from './components/OcfCoverageView.js';
import {
  capitalSankey,
  capitalFlowName,
  type FinancialPeriod,
  type CapitalSankeyModel,
} from '@company-research/shared';
import {
  capitalSankeyHeight,
  capitalNodeLabel,
  capitalNodeAmount,
  capitalFundsRatio,
} from './utils/capital-sankey-options.js';
const SankeyChart = lazy(() => import('./components/CapitalSankeyChart.js'));
const num = (v: number | null) =>
  v === null
    ? '—'
    : v.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
class ChartBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function CapitalAllocationOverview({
  rows,
}: {
  rows: FinancialPeriod[];
}) {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<'ocf' | 'total'>('ocf');
  useEffect(() => setMounted(true), []);
  const latest = [...rows]
    .filter(
      (r) =>
        r.fiscalQuarter === null &&
        Date.parse(r.periodEnd) <= Date.now() &&
        (Date.parse(r.periodEnd) - Date.parse(r.periodStart)) / 86400000 >=
          329 &&
        (Date.parse(r.periodEnd) - Date.parse(r.periodStart)) / 86400000 <= 399,
    )
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  const stored = latest?.capitalAllocation?.overview;
  const o =
    stored &&
    stored.start === latest.periodStart &&
    stored.end === latest.periodEnd
      ? stored
      : undefined;
  const model = capitalSankey(o);
  const fallback = (
    <Space orientation="vertical" size={8} className="full-width">
      <Typography.Text type="secondary">
        {model.reason ?? '图表暂不可用，以下仅列已识别现金流，不代表完整分配。'}
      </Typography.Text>
      <div className="capital-sankey-fallback">
        {o?.items
          .filter((x) => x.key !== 'operatingCashFlow')
          .map((x) => (
            <Tooltip
              key={x.key}
              title={
                <Space orientation="vertical">
                  <span>{x.note}</span>
                  <span>占经营现金流：{num(x.ratio)}%</span>
                  {x.sources.map((s, i) => (
                    <span key={i}>
                      {s.concept} · {s.start} → {s.end}{' '}
                      <a href={s.url} target="_blank" rel="noreferrer">
                        财报来源
                      </a>
                    </span>
                  ))}
                </Space>
              }
            >
              <span>
                {capitalFlowName(x.key)}：
                {x.value === null ? '—' : capitalNodeAmount(x.value / 1e6)} /{' '}
                {num(
                  x.value === null
                    ? null
                    : capitalFundsRatio(
                        Math.abs(x.value),
                        model.canChart ? model.sourceTotal : null,
                      ),
                )}
                %
              </span>
            </Tooltip>
          ))}
      </div>
    </Space>
  );
  return (
    <section data-analysis-module="capital-allocation-overview">
      <Card
        className="analysis-module"
        title="资本配置"
        extra={
          latest
            ? `FY${latest.fiscalYear ?? latest.periodEnd.slice(0, 4)}`
            : '—'
        }
      >
        <Space orientation="vertical" size={12} className="full-width">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { label: '经营现金流', value: 'ocf' },
              { label: '总资金流向', value: 'total' },
            ]}
          />
          {view === 'ocf' ? (
            <OcfCoverageView overview={o} />
          ) : (
            <>
              <div className="capital-sankey-heading">
                <Typography.Text strong>
                  经营现金流{' '}
                  {o?.ocf == null ? '—' : capitalNodeAmount(o.ocf / 1e6)}
                </Typography.Text>
                <Tooltip
                  title={
                    <Space orientation="vertical">
                      <span>
                        {latest?.periodStart ?? '—'} →{' '}
                        {latest?.periodEnd ?? '—'}
                        。按现金流量表口径展示，可能包含受限现金、净额及混合投资付款。汇率影响单列，不视为经营收入。资金经统一汇总连接，不暗示某笔融资用于某项支出。
                      </span>
                      <span>
                        占比 = 节点金额 / 资金汇总金额 ×
                        100%；原有经营现金流占比保留在节点Tooltip中。汇率影响仅为现金变动勾稽项目，不视为实际融资收入。
                      </span>
                      <span>
                        未单列或缺失：{model.missing.join('、') || '无'}
                        。缺失不视为零。
                      </span>
                      <span>
                        已披露为零：{model.zero.join('、') || '无'}
                        。零值不绘制流线。
                      </span>
                      <span>{o?.reconciliation.note}</span>
                    </Space>
                  }
                >
                  <Typography.Text type="secondary" tabIndex={0}>
                    图表口径 ⓘ
                  </Typography.Text>
                </Tooltip>
              </div>
              <Typography.Text type="secondary">
                金额单位：百万美元；比例为占总资金的比例。
              </Typography.Text>
              {model.canChart ? (
                <>
                  {model.status === 'UNIDENTIFIED' && (
                    <Alert
                      type="warning"
                      title="存在未识别现金流差额，图中已单独标记；不属于现金储备。"
                    />
                  )}
                  {model.missing.length > 0 && (
                    <Typography.Text type="secondary">
                      已识别现金流勾稽展示，未单列项目仍保留缺失，不代表完整资金分配。
                    </Typography.Text>
                  )}
                  <div className="capital-sankey-columns" aria-hidden="true">
                    <span>资金来源</span>
                    <span>资金用途</span>
                  </div>
                  <div className="capital-sankey-scroll">
                    <div
                      className="capital-sankey-plot"
                      style={{ minHeight: capitalSankeyHeight(model) }}
                      role="img"
                      aria-label="本财年资金来源、资金汇总与资金用途桑基图"
                    >
                      {mounted ? (
                        <ChartBoundary fallback={fallback}>
                          <Suspense
                            fallback={<Spin description="加载资金流向图" />}
                          >
                            <SankeyChart
                              model={model}
                              period={`${latest.periodStart} → ${latest.periodEnd}`}
                            />
                          </Suspense>
                        </ChartBoundary>
                      ) : (
                        <Spin description="加载资金流向图" />
                      )}
                      <AccessibleNodes model={model} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <Alert
                    type="warning"
                    title="数据不完整，暂不能可靠形成平衡资金图"
                  />
                  {fallback}
                </>
              )}
            </>
          )}
        </Space>
      </Card>
    </section>
  );
}
function AccessibleNodes({ model }: { model: CapitalSankeyModel }) {
  return (
    <ul className="capital-sankey-accessible">
      {model.nodes.map((n) => (
        <li key={n.key}>{capitalNodeLabel(n, model.sourceTotal)}</li>
      ))}
    </ul>
  );
}
