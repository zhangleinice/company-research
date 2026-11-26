import { useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  Col,
  Divider,
  InputNumber,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import type { MultipleInputs } from '@company-research/shared';
import { MarginOfSafety } from './MarginOfSafety.js';
import {
  valuationNumber,
  multipleValueFormula,
  justifiedPeFormula,
  epsCagrFormula,
} from './valuation-format.js';
import { fetchMultipleInputs } from './api.js';
import {
  emptyMultipleSettings,
  resolveMultiples,
  resetPeSettings,
  resetPegSettings,
  type MultipleSettings,
} from './multiple-valuation-state.js';
import peData from './data/industry-pe-us.json' with { type: 'json' };
import costs from './data/industry-wacc-us.json' with { type: 'json' };
const fmt = valuationNumber;
const dollars = (value: number | null) =>
  value === null || !Number.isFinite(value) ? '—' : `$${fmt(value)}`;
export function multipleInputFormatter(
  value: number | string | null | undefined,
  info: { userTyping: boolean; input: string },
) {
  if (info.userTyping) return info.input;
  if (
    value == null ||
    String(value).trim() === '' ||
    !Number.isFinite(Number(value))
  )
    return '';
  return fmt(Number(value));
}
function Sources({
  items,
  cik,
}: {
  items: Record<string, unknown>[];
  cik?: string;
}) {
  return (
    <>
      {items.map((s, i) => (
        <div key={i}>
          {String(s.concept ?? '')} · {String(s.start ?? '')} →{' '}
          {String(s.end ?? '')}{' '}
          {typeof s.accn === 'string' &&
            cik &&
            /^\d{10}-\d{2}-\d{6}$/.test(s.accn) && (
              <a
                target="_blank"
                rel="noreferrer"
                href={`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${s.accn.replaceAll('-', '')}/${s.accn}-index.html`}
              >
                SEC来源
              </a>
            )}
        </div>
      ))}
    </>
  );
}
export function MultipleValuation({
  ticker,
  revision = 0,
}: {
  ticker: string;
  revision?: number;
}) {
  return <MultipleSession key={`${ticker}:${revision}`} ticker={ticker} />;
}
function MultipleSession({ ticker }: { ticker: string }) {
  const [data, setData] = useState<MultipleInputs | null>(null),
    [error, setError] = useState(''),
    [s, set] = useState<MultipleSettings>(emptyMultipleSettings);
  useEffect(() => {
    const c = new AbortController();
    void fetchMultipleInputs(ticker, c.signal)
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [ticker]);
  const r = resolveMultiples(data, s, peData, costs),
    update = (patch: Partial<MultipleSettings>) => set({ ...s, ...patch });
  const override = (
    key: keyof MultipleSettings['overrides'],
    value: number | null,
  ) => set({ ...s, overrides: { ...s.overrides, [key]: value } });
  const label = (text: string, tip: ReactNode) => (
    <Tooltip title={tip}>
      <Typography.Text className="dcf-parameter-label">
        {text} ⓘ
      </Typography.Text>
    </Tooltip>
  );
  const field = (
    text: string,
    value: number | null,
    change: (x: number | null) => void,
    tip: ReactNode,
    suffix?: string,
  ) => (
    <>
      {label(text, tip)}
      <InputNumber
        aria-label={text}
        value={value}
        placeholder="—"
        style={{ width: '100%' }}
        suffix={suffix}
        formatter={multipleInputFormatter}
        parser={(v) => (v?.trim() ? Number(v.replaceAll(',', '')) : NaN)}
        onChange={change}
      />
    </>
  );
  const historyTip = (
    <Space orientation="vertical">
      <span>
        最近五个完整财年有效ROE中位数 ≈{' '}
        {fmt(r.roe.value === null ? null : r.roe.value * 100)}%
      </span>
      {r.roe.warnings.map((x) => (
        <span key={x}>{x}</span>
      ))}
      {data?.annual.slice(0, 5).map((y) => (
        <span key={y.end}>
          FY{y.year}：{fmt(y.roe === null ? null : y.roe * 100)}%
          <Sources items={y.roeSources} cik={data?.cik} />
        </span>
      ))}
    </Space>
  );
  const industryTip = (
    <Space orientation="vertical">
      <span>
        SIC {data?.sic ?? '—'}；{r.match.basis}
      </span>
      <span>
        行业：{r.match.name ?? '未匹配'}；PE {fmt(r.industryPe)}x；Ke{' '}
        {fmt(r.industryKe === null ? null : r.industryKe * 100)}%
      </span>
      <a target="_blank" rel="noreferrer" href={peData.page}>
        Damodaran 美国行业PE · {peData.date}
      </a>
      <span>
        {peData.field}；仅盈利企业总市值／滚动净利润，不是普通平均PE或Forward
        PE。行业相对估值不等于严格内在价值。
      </span>
      <a target="_blank" rel="noreferrer" href={costs.page}>
        Cost of Equity · {costs.date}
      </a>
      <span>
        Ke为行业股权资本成本，不使用WACC替代。
        {s.overrides.ke !== undefined || s.overrides.pe !== undefined
          ? '当前包含用户手动调整。'
          : '当前使用行业参考。'}
      </span>
    </Space>
  );
  const epsTip = (
    <Space orientation="vertical">
      <span>{r.epsSelectionReason}</span>
      <span>
        {r.epsBasis === 'manual'
          ? '用户手动EPS假设，不修改SEC数据'
          : `${r.reference?.start ?? '—'} → ${r.reference?.end ?? '—'}；${r.reference?.reason ?? 'SEC直接披露稀释EPS'}`}
      </span>
      <Sources items={r.reference?.sources ?? []} cik={data?.cik} />
      {data?.warnings.map((x) => (
        <span key={x}>{x}</span>
      ))}
      <span>
        EPS须为正；默认优先采用有效TTM，其次最新完整财年。用户主动选择后不自动切换，不使用累计EPS差分补齐TTM。
      </span>
    </Space>
  );
  const growthTip = (
    <Space orientation="vertical">
      <span>
        {s.growthMethod === 'manual'
          ? '当前为用户预期增长假设'
          : '当前采用历史完整财年EPS CAGR'}
      </span>
      <span>
        {epsCagrFormula(data?.annual ?? [], 5, r.growth5.value)}；
        {r.growth5.reason}
      </span>
      <span>
        {epsCagrFormula(data?.annual ?? [], 3, r.growth3.value)}；
        {r.growth3.reason}
      </span>
      {[...new Set([...r.growth5.warnings, ...r.growth3.warnings])].map((x) => (
        <span key={x}>{x}</span>
      ))}
      {data?.annual.slice(0, 6).map((y) => (
        <span key={y.end}>
          FY{y.year} EPS {fmt(y.eps.value)}
          <Sources items={y.eps.sources} cik={data?.cik} />
        </span>
      ))}
    </Space>
  );
  const industrySelect = (
    <Select
      aria-label="PE行业选择"
      style={{ width: '100%' }}
      showSearch
      optionFilterProp="label"
      allowClear
      value={r.match.name}
      placeholder="请选择行业"
      options={peData.industries.map((x) => ({ label: x.name, value: x.name }))}
      onChange={(v) => {
        const next = { ...s.overrides };
        delete next.pe;
        delete next.ke;
        update({ industry: v, overrides: next });
      }}
    />
  );
  const peDetail = (
    <Space orientation="vertical">
      {s.peMethod === 'justified' && (
        <>
          <span>
            {justifiedPeFormula(r.inputs.roe, r.inputs.g, r.inputs.ke, r.pe)}
          </span>
          <span>
            Retention Ratio ≈{' '}
            {fmt(
              r.justified.retention === null
                ? null
                : r.justified.retention * 100,
            )}
            %；Payout Ratio ≈{' '}
            {fmt(r.justified.payout === null ? null : r.justified.payout * 100)}
            %
          </span>
          {r.justified.warnings.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </>
      )}
      <span>{multipleValueFormula(r.eps, r.pe, r.peValue.value)}</span>
      <span>PE与PEG独立计算，不自动平均；此处为每股研究估值。</span>
    </Space>
  );
  const pegDetail = (
    <Space orientation="vertical">
      <span>
        {fmt(s.targetPeg)} × {fmt(r.growth === null ? null : r.growth * 100)} ≈{' '}
        {fmt(r.peg.value)}x（增长率使用百分数）
      </span>
      <span>{multipleValueFormula(r.eps, r.peg.value, r.pegValue.value)}</span>
      {r.peg.warnings.map((x) => (
        <span key={x}>{x}</span>
      ))}
    </Space>
  );
  return (
    <div className="dcf-calculator multiple-valuation">
      <section className="dcf-section" aria-label="共用EPS基准">
        {error && <Typography.Text type="danger">{error}</Typography.Text>}
        <div className="multiple-valuation-eps-row">
          <div className="multiple-valuation-eps-value">
            <Tooltip title={epsTip}>
              <Typography.Text>Diluted EPS ⓘ</Typography.Text>
            </Tooltip>
            {r.epsBasis === 'manual' ? (
              <InputNumber
                aria-label="Diluted EPS"
                className="multiple-valuation-manual-eps"
                value={s.manualEps}
                prefix="$"
                placeholder="—"
                formatter={multipleInputFormatter}
                parser={(v) =>
                  v?.trim() ? Number(v.replaceAll(',', '')) : NaN
                }
                onChange={(v) => update({ manualEps: v })}
              />
            ) : (
              <Typography.Text strong>{dollars(r.eps)}</Typography.Text>
            )}
          </div>
          <Tooltip title={epsTip}>
            <Select
              aria-label="PE和PEG共用EPS基准"
              className="multiple-valuation-eps-basis"
              value={r.epsBasis}
              options={[
                { value: 'ttm', label: 'TTM' },
                { value: 'annual', label: `FY${data?.annual[0]?.year ?? '—'}` },
                { value: 'manual', label: 'Manual' },
              ]}
              onChange={(epsBasis) => update({ epsBasis })}
            />
          </Tooltip>
        </div>
      </section>
      <Divider />
      <section className="dcf-section" aria-label="PE估值">
        <div className="dcf-section-heading">
          <Tooltip title="市盈率估值；行业相对估值不等于严格的内在价值。">
            <Typography.Title level={5}>PE Valuation</Typography.Title>
          </Tooltip>
          <Button
            type="link"
            size="small"
            onClick={() => set(resetPeSettings(s))}
          >
            恢复默认
          </Button>
        </div>
        <Row
          gutter={[16, 10]}
          className="dcf-parameters"
          aria-label="PE估值参数"
        >
          <Col xs={24} sm={8} className="multiple-valuation-field">
            {label(
              '估值方法',
              '行业市盈率法、单阶段基本面市盈率法或手动输入；PE、PEG独立输出，不自动平均。',
            )}
            <Select
              aria-label="PE估值方法"
              value={s.peMethod}
              style={{ width: '100%' }}
              options={[
                { value: 'industry', label: 'Industry PE' },
                { value: 'justified', label: 'Justified PE' },
                { value: 'manual', label: 'Manual PE' },
              ]}
              onChange={(peMethod) => {
                const overrides = { ...s.overrides };
                delete overrides.pe;
                update({ peMethod, overrides });
              }}
            />
          </Col>
          {s.peMethod !== 'manual' && (
            <Col xs={24} sm={8} className="multiple-valuation-field">
              {label('参考行业', industryTip)}
              {industrySelect}
            </Col>
          )}
          {s.peMethod === 'justified' ? (
            <>
              <Col xs={24} sm={8} className="multiple-valuation-field">
                {field(
                  'ROE',
                  r.inputs.roe,
                  (v) => override('roe', v),
                  <>
                    <span>长期净资产收益率近似。</span>
                    {historyTip}
                  </>,
                  '%',
                )}
              </Col>
              <Col xs={24} sm={8} className="multiple-valuation-field">
                {field(
                  'Long-term Growth',
                  r.inputs.g,
                  (v) => override('g', v),
                  '长期增长率：2%为成熟阶段名义增长研究假设；需g≥0、g<ROE且g<Ke。',
                  '%',
                )}
              </Col>
              <Col xs={24} sm={8} className="multiple-valuation-field">
                {field(
                  'Cost of Equity',
                  r.inputs.ke,
                  (v) => override('ke', v),
                  industryTip,
                  '%',
                )}
              </Col>
            </>
          ) : (
            <Col xs={24} sm={8} className="multiple-valuation-field">
              {field(
                s.peMethod === 'industry' ? 'Industry PE' : 'Manual PE',
                r.pe,
                (v) => override('pe', v),
                <>
                  {industryTip}
                  <div>
                    {s.overrides.pe !== undefined
                      ? '当前为手动调整'
                      : '当前为默认参考；手动模式无默认PE'}
                  </div>
                </>,
                'x',
              )}
            </Col>
          )}
        </Row>
        <MultipleValuationResult
          fairPe={r.pe}
          fairValue={r.peValue.value}
          detail={peDetail}
          formula={
            s.peMethod === 'justified'
              ? 'Fair PE = (1 − g / ROE) × (1 + g) / (Ke − g)；Fair Value = EPS × Fair PE'
              : 'Fair Value = EPS × Fair PE'
          }
        />
        <MarginOfSafety model="PE" fairValue={r.peValue.value} />
        {r.peValue.value === null && (
          <Typography.Text type="warning" className="dcf-note">
            {r.epsBasis !== 'manual' && r.eps === null
              ? `${r.epsSelectionReason} ${r.reference?.reason ?? ''}`
              : r.pe === null && s.peMethod === 'justified'
                ? r.justified.reason
                : r.peValue.reason}
          </Typography.Text>
        )}
      </section>
      <Divider />
      <section className="dcf-section" aria-label="PEG估值">
        <div className="dcf-section-heading">
          <Tooltip title="市盈增长比估值；PEG=1为经验规则，不是严格的内在价值公式。">
            <Typography.Title level={5}>PEG Valuation</Typography.Title>
          </Tooltip>
          <Button
            type="link"
            size="small"
            onClick={() => set(resetPegSettings(s))}
          >
            恢复默认
          </Button>
        </div>
        <Row
          gutter={[16, 10]}
          className="dcf-parameters"
          aria-label="PEG估值参数"
        >
          <Col xs={24} sm={8} className="multiple-valuation-field">
            {label('增长率方法', growthTip)}
            <Select
              aria-label="EPS增长率方法"
              style={{ width: '100%' }}
              value={s.growthMethod}
              options={[
                { value: '5', label: '5Y EPS CAGR' },
                { value: '3', label: '3Y EPS CAGR' },
                { value: 'manual', label: 'Manual' },
              ]}
              onChange={(growthMethod) => update({ growthMethod })}
            />
          </Col>
          <Col xs={24} sm={8} className="multiple-valuation-field">
            {field(
              'EPS Growth',
              r.growth === null ? null : r.growth * 100,
              (v) => update({ growthMethod: 'manual', manualGrowth: v }),
              growthTip,
              '%',
            )}
          </Col>
          <Col xs={24} sm={8} className="multiple-valuation-field">
            {field(
              'Target PEG',
              s.targetPeg,
              (v) => update({ targetPeg: v }),
              r.peg.warnings.join('；'),
              'x',
            )}
          </Col>
        </Row>
        <MultipleValuationResult
          fairPe={r.peg.value}
          fairValue={r.pegValue.value}
          detail={pegDetail}
          formula="Fair PE = Target PEG × EPS Growth（百分数）；Fair Value = EPS × Fair PE"
        />
        <MarginOfSafety model="PEG" fairValue={r.pegValue.value} />
        {r.pegValue.value === null && (
          <Typography.Text type="warning" className="dcf-note">
            {r.eps === null
              ? 'EPS 缺失，可在顶部切换基准'
              : r.growth === null && s.growthMethod !== 'manual'
                ? s.growthMethod === '5'
                  ? r.growth5.reason
                  : r.growth3.reason
                : (r.peg.reason ?? r.pegValue.reason)}
          </Typography.Text>
        )}
      </section>
    </div>
  );
}
/** Presentation only: model calculations and substituted formula values stay upstream. */
export function MultipleValuationResult({
  fairPe,
  fairValue,
  formula,
  detail,
}: {
  fairPe: number | null;
  fairValue: number | null;
  formula: string;
  detail: ReactNode;
}) {
  return (
    <div className="multiple-valuation-result">
      <Row gutter={[24, 12]} className="multiple-valuation-result-values">
        <Col span={12}>
          <Tooltip title="合理市盈率，单位为倍。">
            <Typography.Text type="secondary">合理市盈率</Typography.Text>
          </Tooltip>
          <div className="multiple-valuation-fair-pe">
            {fmt(fairPe)}
            {fairPe === null ? '' : 'x'}
          </div>
        </Col>
        <Col span={12}>
          <Tooltip
            title={
              <Space orientation="vertical">
                <span>{formula}</span>
                {detail}
              </Space>
            }
            trigger={['hover', 'focus']}
          >
            <Typography.Text type="secondary" tabIndex={0}>
              每股估值 ⓘ
            </Typography.Text>
          </Tooltip>
          <div className="multiple-valuation-fair-value">
            {dollars(fairValue)}
          </div>
        </Col>
      </Row>
    </div>
  );
}
