import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  Col,
  Divider,
  Input,
  InputNumber,
  Row,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  calculateDcf,
  type ValuationBaseline,
  type ValuationReferences,
} from '@company-research/shared';
import { fetchValuation, fetchValuationReferences } from './api.js';
import {
  calculatorInput,
  initialScenario,
  fcffBasis,
  validateScenarioField,
  type ScenarioKey,
  referenceBridge,
} from './valuation-calculator.js';
const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const rate = (n: number | null) =>
  n === null || !Number.isFinite(n)
    ? '—'
    : `${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
function Equation({
  formula,
  children,
}: {
  formula: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dcf-equation">
      <div>{formula}</div>
      <Typography.Text type="secondary">{children}</Typography.Text>
    </div>
  );
}
export function ValuationPage({
  ticker,
  onBack,
}: {
  ticker: string;
  onBack: () => void;
}) {
  const [baseline, setBaseline] = useState<ValuationBaseline | null>(null);
  const [refs, setRefs] = useState<ValuationReferences | null>(null);
  const [error, setError] = useState(''),
    [refsError, setRefsError] = useState('');
  const [revision, setRevision] = useState(0);
  const [committed, setCommitted] = useState({ ...initialScenario });
  const [draft, setDraft] = useState<Record<ScenarioKey, number | null>>({
    ...initialScenario,
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ScenarioKey, string>>
  >({});
  const { growth, wacc, terminalGrowth } = committed;
  const [useResearch, setUseResearch] = useState(false);
  const [researchValue, setResearchValue] = useState<number | null>(null);
  const [researchReason, setResearchReason] = useState('');
  useEffect(() => {
    const c = new AbortController();
    setBaseline(null);
    setRefs(null);
    setError('');
    setRefsError('');
    setUseResearch(false);
    setResearchValue(null);
    setResearchReason('');
    setCommitted({ ...initialScenario });
    setDraft({ ...initialScenario });
    setFieldErrors({});
    void fetchValuation(ticker, c.signal)
      .then((b) => {
        if (!c.signal.aborted) setBaseline(b);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    void fetchValuationReferences(ticker, c.signal)
      .then((r) => {
        if (!c.signal.aborted) setRefs(r);
      })
      .catch(() => {
        if (!c.signal.aborted) setRefsError('债务、股数参考缓存暂不可用。');
      });
    return () => c.abort();
  }, [ticker, revision]);
  const bridge = useMemo(
    () =>
      referenceBridge(
        refs ?? {
          periodEnd: null,
          cash: null,
          debt: null,
          shares: null,
          sharesBasis: 'unknown',
          sources: {},
        },
        ticker,
      ),
    [refs, ticker],
  );
  const basis = useMemo(
    () =>
      baseline
        ? fcffBasis(baseline, { useResearch, researchValue, researchReason })
        : null,
    [baseline, useResearch, researchValue, researchReason],
  );
  const result = useMemo(
    () =>
      baseline
        ? calculateDcf(
            calculatorInput(baseline, {
              ...committed,
              researchValue,
              useResearch,
              researchReason,
              bridge,
            }),
          )
        : null,
    [baseline, committed, researchValue, useResearch, researchReason, bridge],
  );
  const verifiedBase = basis?.kind === 'VERIFIED';
  const fcff0 = basis?.value ?? null;
  const commitField = (key: ScenarioKey, raw: string) => {
    const value = raw.trim() ? Number(raw.replaceAll(',', '')) : null;
    const checked = validateScenarioField(committed, key, value);
    let message = checked.error;
    if (!message && baseline && fcff0 !== null && fcff0 > 0) {
      const trial = calculateDcf(
        calculatorInput(baseline, {
          ...checked.next,
          researchValue,
          useResearch,
          researchReason,
          bridge,
        }),
      );
      if (trial.ev === null) message = trial.errors[0] ?? '参数超出可计算范围';
    }
    setFieldErrors((e) => ({ ...e, [key]: message }));
    if (!message) {
      setDraft((d) => ({ ...d, [key]: value }));
      if (committed[key] !== value) setCommitted(checked.next);
    }
  };
  const parameter = (key: ScenarioKey, label: string) => (
    <Col xs={24} sm={8} key={key}>
      <Typography.Text className="dcf-parameter-label">{label}</Typography.Text>
      <InputNumber
        aria-label={label}
        suffix="%"
        style={{ width: '100%' }}
        value={draft[key]}
        changeOnBlur={false}
        status={fieldErrors[key] ? 'error' : undefined}
        onChange={(value) => {
          setDraft((d) => ({ ...d, [key]: value }));
          setFieldErrors((e) => ({ ...e, [key]: '' }));
        }}
        onBlur={(e) => commitField(key, e.target.value)}
        onPressEnter={(e) => {
          e.preventDefault();
          // InputNumber handles Enter on its wrapper; the event target is the input.
          commitField(key, (e.target as HTMLInputElement).value);
        }}
      />
      {fieldErrors[key] && (
        <Typography.Text type="danger" role="alert">
          {fieldErrors[key]}；保留上次有效结果。
        </Typography.Text>
      )}
    </Col>
  );
  const firstFive =
    result?.rows.length === 5
      ? result.rows.reduce((sum, r) => sum + r.pv, 0)
      : null;
  const sixth =
    result?.rows[4] && terminalGrowth !== null
      ? result.rows[4].fcff * (1 + terminalGrowth / 100)
      : null;
  const summary = result?.bridge;
  const missingBridge = Object.entries(bridge.items)
    .filter(([, v]) => v.value === null)
    .map(
      ([key]) =>
        ({
          excessCash: '超额现金',
          otherAssets: '其他非经营资产',
          debt: '债务',
          leases: '租赁口径',
          minority: '少数股东权益',
          preferred: '优先股',
          otherClaims: '其他索偿',
          shares: '估值股数',
        })[key],
    );
  const terminalShare =
    result?.ev != null && result.ev > 0 && result.terminalPV != null
      ? (result.terminalPV / result.ev) * 100
      : null;
  return (
    <Card
      className="dcf-calculator"
      title={`${ticker} · DCF估值`}
      extra={<Button onClick={onBack}>返回列表</Button>}
    >
      <Typography.Paragraph type="secondary" className="dcf-period">
        TTM {baseline?.ocf.start ?? '—'} → {baseline?.asOf ?? '—'} ·
        金额：百万美元 · 股数：百万股
      </Typography.Paragraph>
      <div className="dcf-key-metrics">
        <div className="dcf-key-metric">
          <div className="dcf-key-label">
            FCFF₀ · 当前现金流基准{' '}
            {fcff0 !== null && (
              <Tag>{verifiedBase ? '已核准基准' : '研究性估计'}</Tag>
            )}
          </div>
          <div className="dcf-key-value" data-dcf-metric="fcff">
            {money(fcff0)} <span>百万美元</span>
          </div>
        </div>
        <div className="dcf-key-metric">
          <div className="dcf-key-label">
            EV · 企业价值{' '}
            {result?.ev != null && (
              <Tag>{verifiedBase ? '情景估值' : '条件性估值'}</Tag>
            )}
          </div>
          <div className="dcf-key-value" data-dcf-metric="ev">
            {money(result?.ev)} <span>百万美元</span>
          </div>
        </div>
      </div>
      {error && (
        <Typography.Paragraph type="danger">
          {error}{' '}
          <Button
            type="link"
            size="small"
            onClick={() => setRevision((n) => n + 1)}
          >
            重试
          </Button>
        </Typography.Paragraph>
      )}
      <Divider />
      <section className="dcf-section">
        <Typography.Title level={5}>
          历史自由现金流 <Tag color="blue">SEC · TTM</Tag>
        </Typography.Title>
        <div className="dcf-history-formulas">
          <Equation formula="FCF = OCF − CapEx">
            ={' '}
            {money(
              baseline?.ocf.value == null ? null : baseline.ocf.value / 1e6,
            )}{' '}
            −{' '}
            {money(
              baseline?.capex.value == null ? null : baseline.capex.value / 1e6,
            )}{' '}
            ={' '}
            <strong>
              {money(baseline?.fcf == null ? null : baseline.fcf / 1e6)}
            </strong>
          </Equation>
          {fcff0 !== null && (
            <Equation formula="FCFF₀ ≈ FCF + Interest × (1 − T)">
              {basis?.kind === 'AUTO_RESEARCH' ? (
                <>
                  {' '}
                  = {money(
                    baseline?.fcf == null ? null : baseline.fcf / 1e6,
                  )} +{' '}
                  {money(
                    baseline?.interest.value == null
                      ? null
                      : baseline.interest.value / 1e6,
                  )}{' '}
                  × (1 −{' '}
                  {rate(
                    baseline?.fcffEstimate?.taxRate == null
                      ? null
                      : baseline.fcffEstimate.taxRate * 100,
                  )}
                  ) ={' '}
                </>
              ) : verifiedBase ? (
                '已核准FCFF₀ = '
              ) : (
                '用户研究性FCFF₀ = '
              )}
              <strong>{money(fcff0)}</strong>
            </Equation>
          )}
        </div>
        <Typography.Text type="secondary" className="dcf-note">
          {fcff0 === null
            ? basis?.reason || '缺少可靠FCFF基准，历史FCF不直接作为FCFF。'
            : basis?.kind === 'AUTO_RESEARCH'
              ? '税率为研究假设；费用近似经营现金付息，资本化利息不额外加回，相关调整未完全核准。'
              : verifiedBase
                ? '采用已核准历史FCFF基准。'
                : '采用用户明确输入的条件性研究基准。'}
        </Typography.Text>
      </section>
      <Divider />
      <section className="dcf-section">
        <div className="dcf-section-heading">
          <Typography.Title level={5}>估值假设</Typography.Title>
          <Button
            size="small"
            type="link"
            onClick={() => {
              setDraft({ ...initialScenario });
              setCommitted({ ...initialScenario });
              setFieldErrors({});
            }}
          >
            恢复默认
          </Button>
        </div>
        <Row gutter={[16, 10]} className="dcf-parameters">
          {parameter('growth', '未来5年FCFF增长率')}
          {parameter('wacc', 'WACC折现率')}
          {parameter('terminalGrowth', '永续增长率')}
        </Row>
        <Typography.Paragraph type="secondary" className="dcf-note">
          研究情景假设 · 失焦或Enter更新 · 终值假设稳定增长与持续再投资
        </Typography.Paragraph>
        <details className="dcf-details">
          <summary>修改FCFF基准</summary>
          {(baseline?.fcff != null ||
            baseline?.fcffEstimate?.status === 'RESEARCH') && (
            <Button
              type="link"
              size="small"
              onClick={() => setUseResearch((v) => !v)}
            >
              {useResearch ? '恢复自动基准' : '使用手动调整'}
            </Button>
          )}
          {(!verifiedBase || useResearch) && (
            <div className="dcf-research-inputs">
              <InputNumber
                aria-label="研究性FCFF基准"
                value={researchValue}
                onChange={(v) => {
                  setUseResearch(true);
                  setResearchValue(v);
                }}
                placeholder="百万美元"
              />
              <Input
                aria-label="FCFF估算依据"
                value={researchReason}
                onChange={(e) => {
                  setUseResearch(true);
                  setResearchReason(e.target.value);
                }}
                placeholder="调整依据与来源（填写后计算条件情景）"
              />
            </div>
          )}
          <Typography.Text type="secondary">
            仅采用有依据的研究性估计，不默认用FCF替代。
          </Typography.Text>
        </details>
      </section>
      <Divider />
      <section className="dcf-section">
        <div className="dcf-section-heading">
          <Typography.Title level={5}>未来5年现金流折现</Typography.Title>
          <Typography.Text type="secondary">百万美元</Typography.Text>
        </div>
        <Equation
          formula={
            <>
              FCFF(t) = FCFF₀ × (1 + g)<sup>t</sup>
            </>
          }
        >
          = {money(fcff0)} × (1 + {rate(growth)})<sup>t</sup>
        </Equation>
        <Table
          className="dcf-forecast-table"
          size="small"
          pagination={false}
          rowKey="year"
          tableLayout="fixed"
          dataSource={Array.from({ length: 5 }, (_, i) => ({
            year: i + 1,
            fcff: result?.rows[i]?.fcff ?? null,
            pv: result?.rows[i]?.pv ?? null,
          }))}
          columns={[
            {
              title: '年份',
              dataIndex: 'year',
              width: 80,
              render: (y) => `第${y}年`,
            },
            {
              title: '预计FCFF',
              dataIndex: 'fcff',
              align: 'right',
              render: money,
            },
            {
              title: '折现现值',
              dataIndex: 'pv',
              align: 'right',
              render: money,
            },
          ]}
        />
      </section>
      <Divider />
      <section className="dcf-section">
        <Typography.Title level={5}>终值与企业价值</Typography.Title>
        <div className="dcf-formula-summary">
          <Equation formula="TV = FCFF₆ / (WACC − 永续增长率)">
            = {money(sixth)} / ({rate(wacc)} − {rate(terminalGrowth)}) ={' '}
            <strong>{money(result?.terminalValue)}</strong>
          </Equation>
          <Equation
            formula={
              <>
                PV(TV) = TV / (1 + WACC)<sup>5</sup>
              </>
            }
          >
            = {money(result?.terminalValue)} / (1 + {rate(wacc)})<sup>5</sup> ={' '}
            <strong>{money(result?.terminalPV)}</strong>
          </Equation>
          <Equation formula="EV = 前5年FCFF现值合计 + 终值现值">
            = {money(firstFive)} + {money(result?.terminalPV)} ={' '}
            <strong className="dcf-ev-total">{money(result?.ev)}</strong>
          </Equation>
        </div>
        <Typography.Text type="secondary" className="dcf-note">
          终值现值占EV比例 = PV(TV) / EV × 100% ={' '}
          <strong>
            {terminalShare == null ? '—' : `${terminalShare.toFixed(2)}%`}
          </strong>
        </Typography.Text>
        {result && result.ev === null && (
          <Typography.Paragraph type="secondary" className="dcf-note">
            {!baseline?.applicable
              ? '当前公司不适用普通FCFF模型。'
              : fcff0 === null
                ? basis?.reason || '缺少可靠FCFF基准。'
                : result.errors[0]}
          </Typography.Paragraph>
        )}
      </section>
      <Divider />
      <section className="dcf-section dcf-equity">
        <Typography.Title level={5}>
          {result?.perShare == null
            ? '每股内在价值：待补全股权桥接数据'
            : '每股内在价值'}
        </Typography.Title>
        {result?.perShare != null ? (
          <>
            <div className="dcf-result">
              ${money(result.perShare)}{' '}
              <Typography.Text type="secondary">美元 / 股</Typography.Text>
            </div>
            <Equation formula="Equity Value = EV + 非经营资产 − 债务及其他索偿">
              = {money(result.ev)} + {money(summary?.nonOperatingAssets)} −{' '}
              {money(
                summary?.debt != null && summary.otherClaims != null
                  ? summary.debt + summary.otherClaims
                  : null,
              )}{' '}
              = <strong>{money(result.equity)}</strong>
            </Equation>
            <Equation formula="每股内在价值 = Equity Value / 估值股数">
              = {money(result.equity)} / {money(summary?.dilutedShares)} ={' '}
              <strong>{money(result.perShare)}</strong> 美元 / 股
            </Equation>
            <Typography.Text type="secondary" className="dcf-note">
              基于所列假设的{verifiedBase ? '情景估值' : '条件性研究估值'}。
            </Typography.Text>
          </>
        ) : (
          <>
            <div className="dcf-unavailable-formulas">
              Equity Value = EV + 非经营资产 − 债务及其他索偿
              <br />
              每股内在价值 = Equity Value / 估值股数
            </div>
            <Typography.Text type="secondary" className="dcf-note">
              主要缺失：{missingBridge.join('、') || '资产/索偿口径'}
              。未知项不补0。{refsError}
            </Typography.Text>
          </>
        )}
      </section>
    </Card>
  );
}
