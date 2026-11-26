import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Input,
  InputNumber,
  Row,
  Segmented,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  FINANCIAL_METRICS,
  type FinancialPeriod,
  type OwnerEarningsDraft,
  type OwnerEarningsFact,
  type OwnerEarningsResponse,
  type OwnerEarningsYear,
  type OwnerEarningsResults,
} from '@company-research/shared';
import { fetchOwnerEarnings, saveOwnerEarnings } from './api.js';
import {
  OwnerPreviewScheduler,
  ownerPreviewKey,
  validOwnerInput,
} from './owner-earnings-preview.js';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './analysis/FinancialTrendChart.js';
import { cashFlowSeries } from './analysis/CashFlowCharts.js';

export const ownerMoney = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : (n / 1e6).toLocaleString('zh-CN', {
        maximumFractionDigits: 2,
      });
const percent = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : `${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export function ownerDraft(
  data: OwnerEarningsResponse,
): OwnerEarningsDraft | null {
  const y = data.history[0];
  if (!y) return null;
  const s = data.estimate;
  return {
    periodStart: y.periodStart,
    periodEnd: y.periodEnd,
    dataVersion: y.dataVersion,
    method: s?.method ?? 'ratio',
    ratio: s?.ratio ?? null,
    amount: s?.amount ?? null,
    comparable: s?.method === 'amount' ? s.comparable : true,
    rationale: s?.rationale ?? '',
  };
}
function Metric({
  title,
  value,
  description,
  fact,
  basis = 'SEC披露',
}: {
  title: string;
  value: number | null | undefined;
  description: string;
  fact?: OwnerEarningsFact;
  basis?: string;
}) {
  return (
    <Card size="small" className="analysis-metric-card">
      <Statistic
        title={
          <Tooltip
            title={
              <Space orientation="vertical">
                <span>{description}</span>
                {fact?.reason && <span>{fact.reason}</span>}
                {fact?.sources.map((s, i) => (
                  <span key={`${s.accn}-${s.concept}-${i}`}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      SEC原始申报
                    </a>{' '}
                    · {s.concept} · {s.accn} · {s.start} 至 {s.end} · 申报{' '}
                    {s.filed} · USD {s.val.toLocaleString('en-US')}
                  </span>
                ))}
              </Space>
            }
          >
            <span className="analysis-metric-title">
              {title}
              <span className="metric-help" aria-label={`${title} 指标说明`}>
                ⓘ
              </span>
            </span>
          </Tooltip>
        }
        value={value ?? '—'}
        formatter={() => ownerMoney(value)}
      />
      <Typography.Text type="secondary" className="metric-unit">
        百万美元 · {basis}
      </Typography.Text>
    </Card>
  );
}
export function OwnerEarningsTrends({
  history,
}: {
  history: OwnerEarningsYear[];
}) {
  const [cash, setCash] = useState('all'),
    [intensity, setIntensity] = useState('all');
  const rows = history.map((y) => ({
    ...Object.fromEntries(FINANCIAL_METRICS.map((k) => [k, null])),
    fiscalYear: y.fiscalYear,
    fiscalQuarter: null,
    periodStart: y.periodStart,
    periodEnd: y.periodEnd,
    currency: y.currency,
    operatingCashFlow: y.operatingCashFlow.value,
    capex: y.capex.value,
    fcf: y.fcf.value,
  })) as FinancialPeriod[];
  const ratios: TrendSeries[] = [
    { key: 'capexToRevenue', label: 'CapEx / Revenue', color: '#d89614' },
    { key: 'daToRevenue', label: 'D&A / Revenue', color: '#9254de' },
  ];
  const cashItems = cashFlowSeries('all');
  const charts = [
    {
      title: 'Cash Flow & CapEx · 现金流与资本支出趋势',
      all: cashItems,
      items: cashItems.filter((s) => cash === 'all' || s.key === cash),
      selection: cash,
      set: setCash,
      unit: 'money' as const,
    },
    {
      title: 'Capital Intensity · 资本投入强度趋势',
      all: ratios,
      items: ratios.filter((s) => intensity === 'all' || s.key === intensity),
      selection: intensity,
      set: setIntensity,
      unit: 'percent' as const,
    },
  ];
  return (
    <Row gutter={[24, 24]}>
      {charts.map((c) => (
        <Col xs={24} xl={12} key={c.title}>
          <section className="analysis-chart-panel">
            <Typography.Title level={5}>{c.title}</Typography.Title>
            <Space orientation="vertical" size={12} className="full-width">
              <div className="health-chart-filter">
                <Segmented
                  aria-label={c.title}
                  value={c.selection}
                  onChange={(v) => c.set(String(v))}
                  options={[
                    { label: '全部对比', value: 'all' },
                    ...c.all.map((s) => ({ label: s.label, value: s.key })),
                  ]}
                />
              </div>
              <FinancialTrendChart
                rows={rows}
                mode="annual"
                title={c.title}
                series={c.items}
                unit={c.unit}
                retainEmptyPeriods
                includeFiscalYear
                moneyMaximumFractionDigits={2}
                additionalValues={
                  new Map(
                    history.map((y) => [
                      y.periodEnd,
                      {
                        capexToRevenue: y.capexToRevenue,
                        daToRevenue: y.daToRevenue,
                      },
                    ]),
                  )
                }
              />
            </Space>
          </section>
        </Col>
      ))}
    </Row>
  );
}

export function OwnerEarningsView({
  data,
  draft,
  dirty,
  saving = false,
  preview = null,
  dataChanged = false,
  onChange,
  onSave,
}: {
  data: OwnerEarningsResponse;
  draft: OwnerEarningsDraft | null;
  dirty: boolean;
  saving?: boolean;
  preview?: OwnerEarningsResults | null;
  dataChanged?: boolean;
  onChange: (d: OwnerEarningsDraft) => void;
  onSave: () => void;
}) {
  const y = data.history[0];
  if (!y || !draft)
    return <Empty description="暂无完整年度财务缓存；未请求SEC数据" />;
  const confirmed =
    !dirty && !dataChanged && data.estimateStatus === 'confirmed';
  const valid = validOwnerInput(draft, y);
  const results = valid ? (confirmed ? data.results : preview) : null;
  const status =
    dataChanged || data.estimateStatus === 'needs_reconfirmation'
      ? '数据已变化，待重新确认'
      : !valid
        ? '尚未估计'
        : confirmed
          ? '已保存'
          : data.estimate && dirty
            ? '未保存的修改'
            : '未保存的估计预览';
  const estimateBasis = confirmed
    ? '已保存用户估计'
    : valid
      ? '未保存估计预览'
      : '用户估计';
  const metrics: [string, OwnerEarningsFact, string][] = [
    [
      'Net Income · 净利润',
      y.netIncome,
      `报表净利润；${y.netIncomeScope === 'parent' ? '归属于母公司口径，不与合并OCF直接拼接' : y.netIncomeScope === 'consolidated' ? '合并口径' : '归属范围尚未核准'}。`,
    ],
    [
      'OCF · 经营现金流',
      y.operatingCashFlow,
      '完整财年合并经营现金流，已包含实际营运资金变动（经营资产和负债变动），不重复扣除。合并现金流不一定全部归属于母公司普通股股东。',
    ],
    [
      'D&A · 折旧与摊销',
      y.depreciationAmortization,
      '仅使用同一年度现金流申报中核准的完整D&A；不以单独折旧或含其他调整的项目替代。',
    ],
    [
      'CapEx · 资本支出',
      y.capex,
      'Cash PP&E CapEx：现金购置物业、厂房及设备支出；未完整覆盖融资租赁新增资产、资本化无形资产及其他经济再投资。',
    ],
    [
      'FCF · 自由现金流',
      y.fcf,
      'FCF = OCF − Cash PP&E CapEx，沿用现有财务数据。',
    ],
    [
      'SBC · 股权激励',
      y.sbc,
      '同一财年及现金流合并范围的报表股权激励费用，用作经济成本代理，不等于实际稀释成本或抵消稀释所需回购金额。',
    ],
  ];
  const change = (patch: Partial<OwnerEarningsDraft>) =>
    onChange({ ...draft, ...patch });
  return (
    <Space orientation="vertical" size={24} className="full-width">
      <section>
        <Typography.Title level={5}>
          Historical Financial Data · 历史财务数据
        </Typography.Title>
        <Space wrap>
          <Typography.Text type="secondary">
            FY {y.fiscalYear ?? '—'} · {y.periodStart} 至 {y.periodEnd} ·
            百万美元 · 完整财年
          </Typography.Text>
          {y.operatingCashFlow.sources.map((s) => (
            <a key={s.accn} href={s.url} target="_blank" rel="noreferrer">
              SEC原始年报
            </a>
          ))}
        </Space>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          {metrics.map(([title, fact, description]) => (
            <Col xs={24} sm={12} lg={8} xl={4} key={title}>
              <Metric
                title={title}
                value={fact.value}
                fact={fact}
                description={description}
                basis={title.startsWith('FCF') ? '公式计算' : 'SEC披露'}
              />
            </Col>
          ))}
        </Row>
        <Space wrap style={{ marginTop: 12 }}>
          <Tooltip title="当年Cash PP&E CapEx / Revenue × 100%；收入缺失或非正时不计算。">
            <Typography.Text>
              CapEx / Revenue：{percent(y.capexToRevenue)} ⓘ
            </Typography.Text>
          </Tooltip>
          <Tooltip title="当年核准D&A / Revenue × 100%；D&A或收入缺失、收入非正时不计算。">
            <Typography.Text>
              D&A / Revenue：{percent(y.daToRevenue)} ⓘ
            </Typography.Text>
          </Tooltip>
        </Space>
      </section>
      <section>
        <Typography.Title level={5}>
          Historical Trends · 历史趋势
        </Typography.Title>
        <OwnerEarningsTrends history={data.history} />
      </section>
      <section>
        <Typography.Title level={5}>
          Maintenance CapEx Estimation · 维持性资本支出估计
        </Typography.Title>
        <Space orientation="vertical" size={12} className="full-width">
          <Space wrap>
            <Tag color={confirmed ? 'green' : 'gold'}>{status}</Tag>
          </Space>
          <Segmented
            disabled={saving}
            aria-label="维持性资本支出估计方式"
            value={draft.method}
            options={[
              { label: '按比例估计', value: 'ratio' },
              { label: '直接输入金额', value: 'amount' },
            ]}
            onChange={(v) =>
              change({
                method: v as 'ratio' | 'amount',
                ratio: null,
                amount: null,
                comparable: v === 'ratio',
              })
            }
          />
          {draft.method === 'ratio' ? (
            <>
              <InputNumber
                aria-label="维持性资本支出比例"
                disabled={saving || y.capex.value === null}
                value={draft.ratio}
                min={0}
                max={100}
                suffix="%"
                placeholder="输入比例，无默认值"
                onChange={(v) => change({ ratio: v })}
              />
              <Typography.Text type="secondary">
                对当期现金PP&E CapEx的个人假设性拆分，非SEC披露。
                {y.capex.value === null ? ' CapEx缺失，无法使用比例估计。' : ''}
              </Typography.Text>
            </>
          ) : (
            <>
              <InputNumber
                aria-label="正常年度维持性资本支出金额"
                disabled={saving}
                value={draft.amount}
                min={0}
                max={Number.MAX_SAFE_INTEGER / 1e6}
                suffix="百万美元"
                placeholder="输入金额，无默认值"
                style={{ width: 300, maxWidth: '100%' }}
                onChange={(v) => change({ amount: v })}
              />
              <Typography.Text type="secondary">
                可明确输入零；正常年度估计允许超过当期实际CapEx，不自动视为当期支出拆分。
              </Typography.Text>
            </>
          )}
          {draft.method === 'amount' && (
            <Checkbox
              disabled={saving}
              checked={draft.comparable}
              onChange={(e) => change({ comparable: e.target.checked })}
            >
              我确认估计与当期现金CapEx在期间、范围及性质上可直接比较，用于当期拆分
            </Checkbox>
          )}
          <Input.TextArea
            aria-label="维持性资本支出估计依据"
            disabled={saving}
            value={draft.rationale}
            maxLength={10000}
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="记录个人估计依据、历史参考和资产更新判断"
            onChange={(e) => change({ rationale: e.target.value })}
          />
          <Button
            type="primary"
            loading={saving}
            disabled={!valid || confirmed}
            onClick={onSave}
          >
            确认并保存估计
          </Button>
          {data.estimate && (
            <Typography.Text type="secondary">
              保存于 {data.estimate.updatedAt} · 原始CapEx基准{' '}
              {ownerMoney(data.estimate.capexBasis)} 百万美元
            </Typography.Text>
          )}
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Metric
                title="Estimated Maintenance CapEx · 估计维持性资本支出"
                value={results?.maintenanceCapex}
                basis={estimateBasis}
                description="比例方式为当期现金CapEx × 用户比例；金额方式为用户输入的正常年度金额。有效输入即可预览，确认保存后才成为研究记录。"
              />
            </Col>
            <Col xs={24} md={12}>
              <Metric
                title="Estimated Growth CapEx · 估计增长性资本支出"
                value={results?.growthCapex}
                basis={`${estimateBasis} · 条件性计算`}
                description="同期间、范围和性质可比且维持额不超过当期CapEx时，Growth CapEx = Cash PP&E CapEx − Maintenance CapEx。"
              />
            </Col>
          </Row>
          {results?.growthReason && (
            <Typography.Text type="secondary">
              {results.growthReason}
            </Typography.Text>
          )}
        </Space>
      </section>
      <section>
        <Typography.Title level={5}>
          Estimated Owner Earnings · 股东盈余参考值
        </Typography.Title>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Metric
              title="FCF · 自由现金流"
              value={y.fcf.value}
              basis="公式计算"
              description="FCF = OCF − Total Cash PP&E CapEx；复用现有数据。"
            />
          </Col>
          <Col xs={24} lg={8}>
            <Metric
              title="Estimated Owner Earnings"
              value={results?.ownerEarnings}
              basis={estimateBasis}
              description="OCF − Estimated Maintenance CapEx。维持性资本支出后现金流参考值；OCF已包含实际营运资金变动，不重复加回D&A或扣除营运资金。合并现金流不一定全部归属于母公司普通股股东；尚未扣除全部未来增长所需再投资，不代表可以立即分配的全部现金，不能直接作为现有FCFF DCF输入。"
            />
          </Col>
          <Col xs={24} lg={8}>
            <Metric
              title="SBC-adjusted Owner Earnings"
              value={results?.sbcAdjustedOwnerEarnings}
              basis={estimateBasis}
              description={`OCF − SBC − Estimated Maintenance CapEx。SBC报表费用是股权激励经济成本代理，不等于实际稀释成本或抵消稀释所需回购金额。保留实际营运资金影响；合并现金流与普通股股东归属范围不同，且尚未扣除全部增长再投资。${y.sbc.reason ?? ''}`}
            />
          </Col>
        </Row>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          基于经营现金流及用户估计的股东盈余参考值，非严格还原巴菲特定义，不直接用于现有
          FCFF DCF。
        </Typography.Paragraph>
      </section>
    </Space>
  );
}

export function OwnerEarnings({
  identifier,
  revision = 0,
}: {
  identifier: string;
  revision?: number;
}) {
  const [data, setData] = useState<OwnerEarningsResponse | null>(null),
    [draft, setDraft] = useState<OwnerEarningsDraft | null>(null);
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [dataChanged, setDataChanged] = useState(false);
  const [preview, setPreview] = useState<{
    key: string;
    results: OwnerEarningsResults;
  } | null>(null);
  const [scheduler] = useState(() => new OwnerPreviewScheduler());
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    setData(null);
    setDraft(null);
    setError('');
    setDirty(false);
    setSaving(false);
    setPreview(null);
    setDataChanged(false);
    void fetchOwnerEarnings(identifier, c.signal)
      .then((d) => {
        if (!c.signal.aborted) {
          setData(d);
          setDraft(ownerDraft(d));
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => {
      c.abort();
      scheduler.cancel();
    };
  }, [identifier, revision, scheduler]);
  const draftKey = draft ? ownerPreviewKey(identifier, draft) : '';
  useEffect(() => {
    if (
      !data ||
      !draft ||
      saving ||
      !validOwnerInput(draft, data.history[0]) ||
      (!dirty && !dataChanged && data.estimateStatus === 'confirmed') ||
      preview?.key === draftKey
    )
      return;
    scheduler.schedule(
      identifier,
      draft,
      (result) => {
        const latest = result.data.history[0],
          previous = data.history[0];
        if (
          !latest ||
          latest.periodStart !== draft.periodStart ||
          latest.periodEnd !== draft.periodEnd
        ) {
          setData(result.data);
          setDraft(ownerDraft(result.data));
          setDirty(false);
          setPreview(null);
          setDataChanged(false);
          return;
        }
        const changed = latest.dataVersion !== previous?.dataVersion;
        const currentDraft = { ...draft, dataVersion: latest.dataVersion };
        if (changed || result.data.estimateStatus !== data.estimateStatus)
          setData(result.data);
        if (changed) {
          setDraft(currentDraft);
          setDataChanged(true);
        }
        setPreview({
          key: ownerPreviewKey(identifier, currentDraft),
          results: result.results,
        });
      },
      (error) =>
        setError(
          error instanceof Error
            ? `预览未完成：${error.message}`
            : '预览暂不可用',
        ),
    );
    return () => scheduler.cancel();
  }, [
    identifier,
    data,
    draft,
    dirty,
    saving,
    dataChanged,
    draftKey,
    preview?.key,
    scheduler,
  ]);
  const save = async () => {
    if (!draft || !controller.current) return;
    const c = controller.current;
    scheduler.cancel();
    setPreview(null);
    setSaving(true);
    setError('');
    try {
      const d = await saveOwnerEarnings(identifier, draft, c.signal);
      if (!c.signal.aborted) {
        setData(d);
        setDraft(ownerDraft(d));
        setDirty(false);
        setDataChanged(false);
      }
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e instanceof Error ? e.message : '保存失败，请重试');
        // A concurrent SEC refresh must be recoverable without a manual reload control.
        try {
          const fresh = await fetchOwnerEarnings(identifier, c.signal),
            latest = fresh.history[0];
          if (
            !c.signal.aborted &&
            latest &&
            latest.dataVersion !== draft.dataVersion
          ) {
            setData(fresh);
            if (
              latest.periodStart === draft.periodStart &&
              latest.periodEnd === draft.periodEnd
            ) {
              setDraft({ ...draft, dataVersion: latest.dataVersion });
              setDirty(true);
              setDataChanged(true);
            } else {
              setDraft(ownerDraft(fresh));
              setDirty(false);
              setDataChanged(false);
            }
          }
        } catch {
          /* Preserve the draft and original save error if the cache is unavailable. */
        }
      }
    } finally {
      if (!c.signal.aborted) setSaving(false);
    }
  };
  return (
    <Card title="Owner Earnings · 股东盈余">
      <Space orientation="vertical" size={16} className="full-width">
        {error && <Alert type="error" showIcon title={error} />}
        {data ? (
          <OwnerEarningsView
            data={data}
            draft={draft}
            dirty={dirty}
            saving={saving}
            preview={preview?.key === draftKey ? preview.results : null}
            dataChanged={dataChanged}
            onChange={(d) => {
              scheduler.cancel();
              setPreview(null);
              setError('');
              setDraft(d);
              setDirty(true);
            }}
            onSave={() => void save()}
          />
        ) : !error ? (
          <Spin tip="读取年度缓存">
            <div style={{ minHeight: 80 }} />
          </Spin>
        ) : null}
      </Space>
    </Card>
  );
}
