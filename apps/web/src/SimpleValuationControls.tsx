import {
  Button,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import {
  FEDERAL_TAX_SOURCE,
  INFLATION_SOURCE,
  type SimpleValuationData,
  type IndustryWaccData,
} from '@company-research/shared';
import {
  emptySimpleSettings,
  resetSimpleOverride,
  setSimpleOverride,
  type SimpleSettings,
  type resolveSimpleSettings,
} from './simple-valuation-state.js';
type Resolved = ReturnType<typeof resolveSimpleSettings>;
const numericFormat = (
  v: number | undefined,
  info: { userTyping: boolean; input: string },
) =>
  info.userTyping
    ? info.input
    : v == null || String(v) === ''
      ? ''
      : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const numericParse = (v: string | undefined) =>
  v?.trim() ? Number(v.replaceAll(',', '')) : Number.NaN;
function secLinks(value: unknown, cik: string): string[] {
  if (Array.isArray(value)) return value.flatMap((x) => secLinks(x, cik));
  if (!value || typeof value !== 'object') return [];
  const o = value as Record<string, unknown>;
  return [
    ...(typeof o.accn === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(o.accn)
      ? [
          `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${o.accn.replaceAll('-', '')}/${o.accn}-index.html`,
        ]
      : []),
    ...Object.values(o)
      .filter((x) => typeof x === 'object')
      .flatMap((x) => secLinks(x, cik)),
  ];
}
export function SimpleValuationControls({
  data,
  settings: s,
  resolved: r,
  industries,
  onChange,
}: {
  data: SimpleValuationData | null;
  settings: SimpleSettings;
  resolved: Resolved;
  industries: IndustryWaccData;
  onChange: (v: SimpleSettings) => void;
}) {
  const sources = (value: unknown) => (
    <>
      {[...new Set(secLinks(value, data?.cik ?? ''))].slice(0, 2).map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer">
          SEC申报来源
        </a>
      ))}
    </>
  );
  const update = (patch: Partial<SimpleSettings>) =>
    onChange({ ...s, ...patch });
  const parameter = (
    key: keyof SimpleSettings['overrides'],
    label: string,
    tip: React.ReactNode,
  ) => (
    <>
      <Tooltip title={tip}>
        <Typography.Text className="dcf-parameter-label">
          {label} ⓘ
        </Typography.Text>
      </Tooltip>
      <InputNumber
        aria-label={label}
        value={r.parameters[key]}
        formatter={numericFormat}
        parser={numericParse}
        suffix="%"
        style={{ width: '100%' }}
        onChange={(v) => onChange(setSimpleOverride(s, key, v))}
      />
    </>
  );
  return (
    <>
      <div className="dcf-section-heading">
        <Typography.Title level={5}>估值假设</Typography.Title>
        <Button
          size="small"
          type="link"
          onClick={() => onChange(emptySimpleSettings())}
        >
          恢复默认
        </Button>
      </div>
      <Row gutter={[16, 10]} className="dcf-parameters">
        <Col xs={24} sm={12}>
          <Tooltip
            title={
              <Space orientation="vertical">
                <span>{r.fcff.formula}</span>
                <span>{r.fcff.reason}</span>
                {r.fcff.warnings.map((w) => (
                  <span key={w}>{w}</span>
                ))}
                {sources(r.period)}
              </Space>
            }
          >
            <Typography.Text className="dcf-parameter-label">
              FCFF基准 ⓘ
            </Typography.Text>
          </Tooltip>
          <Select
            aria-label="FCFF基准选择"
            value={s.basis}
            style={{ width: '100%' }}
            options={[
              { value: 'ttm', label: '最新TTM FCFF' },
              {
                value: 'annual',
                label: `最新完整财年FCFF${data?.latestAnnual ? ' · ' + data.latestAnnual.label : ''}`,
              },
              { value: 'manual', label: '手动输入FCFF' },
            ]}
            onChange={(v) => update({ basis: v })}
          />
        </Col>
        <Col xs={24} sm={12}>
          <Tooltip
            title={
              <Space orientation="vertical">
                <span>
                  {r.tax.formula}；{r.tax.reason}
                </span>
                {r.tax.warnings.map((w) => (
                  <span key={w}>{w}</span>
                ))}
                <span>
                  21%为美国联邦法定税率简化参考，不含州/海外税；历史有效税率不一定是边际税率。注册地不明或非美国企业不自动采用21%。
                </span>
                <a href={FEDERAL_TAX_SOURCE} target="_blank" rel="noreferrer">
                  IRS税率来源
                </a>
                <span>
                  SEC注册地：{data?.incorporation ?? '未确认'}；TTM税务期间：
                  {data?.ttm.tax.start ?? '—'} 至 {data?.ttm.tax.end ?? '—'}
                </span>
                {sources([data?.ttm.tax, data?.ttm.pretax])}
              </Space>
            }
          >
            <Typography.Text className="dcf-parameter-label">
              Tax Rate · 税率 ⓘ
            </Typography.Text>
          </Tooltip>
          <Select
            aria-label="税率方法"
            value={r.taxMethod}
            style={{ width: '100%' }}
            options={[
              {
                value: 'federal',
                label: '美国联邦税率21%',
                disabled: data?.usIncorporated !== true,
              },
              {
                value: 'effective',
                label:
                  r.taxMethod === 'effective' && r.tax.value !== null
                    ? `TTM有效税率 · ${(r.tax.value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
                    : 'TTM有效税率',
              },
              { value: 'manual', label: '手动输入税率' },
            ]}
            onChange={(v) => update({ taxMethod: v })}
          />
          {r.taxMethod === 'manual' ? (
            <InputNumber
              aria-label="手动税率"
              formatter={numericFormat}
              parser={numericParse}
              suffix="%"
              value={s.taxManual === null ? null : s.taxManual * 100}
              onChange={(v) =>
                update({ taxManual: v === null ? null : v / 100 })
              }
            />
          ) : data && r.tax.value === null && s.basis !== 'manual' ? (
            <Typography.Text type="danger" className="dcf-note">
              {r.tax.reason}
            </Typography.Text>
          ) : null}
        </Col>
        {s.basis === 'manual' && (
          <Col span={24}>
            <Space wrap>
              <InputNumber
                aria-label="研究性FCFF基准"
                formatter={numericFormat}
                parser={numericParse}
                placeholder="百万美元"
                value={s.manualFcff}
                onChange={(v) => update({ manualFcff: v })}
              />
              <Input
                aria-label="FCFF估算依据"
                value={s.manualReason}
                placeholder="调整依据与来源"
                onChange={(e) => update({ manualReason: e.target.value })}
              />
            </Space>
          </Col>
        )}
        <Col xs={24} sm={8}>
          {parameter(
            'growth',
            '未来5年FCFF增长率',
            <Space orientation="vertical">
              <span>
                {s.overrides.growth !== undefined
                  ? '当前为手动调整'
                  : '当前为系统默认'}{' '}
                · {s.growthMethod === 'fcf' ? '历史FCF' : '历史营收'}
                五年间隔CAGR
              </span>
              <span>{r.growth.formula}</span>
              <span>{r.growth.reason}</span>
              <span>
                近3年辅助参考：{r.growth3.formula}；{r.growth3.reason}
              </span>
              {r.growth.warnings.map((w) => (
                <span key={w}>{w}</span>
              ))}
              <span>
                历史增长率不代表未来实际增长率；未作折扣、截断或固定5%替代。
              </span>
              {sources([
                r.growth.points[0]?.sources,
                r.growth.points.at(-1)?.sources,
              ])}
            </Space>,
          )}
          <Select
            aria-label="增长率估值方法"
            value={s.growthMethod}
            style={{ width: '100%', marginTop: 6 }}
            options={[
              { value: 'fcf', label: 'Historical FCF Growth · 历史FCF增长' },
              {
                value: 'revenue',
                label: 'Historical Revenue Growth · 历史营收增长',
              },
            ]}
            onChange={(v) =>
              onChange(resetSimpleOverride({ ...s, growthMethod: v }, 'growth'))
            }
          />
        </Col>
        <Col xs={24} sm={8}>
          {parameter(
            'wacc',
            'WACC折现率',
            <Space orientation="vertical">
              <span>
                {s.overrides.wacc !== undefined
                  ? '当前为手动调整'
                  : '当前为系统默认参考'}
              </span>
              <span>
                实际使用：
                {r.parameters.wacc === null
                  ? '—'
                  : `${r.parameters.wacc.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`}
                ；默认参考：{r.wacc.formula}；{r.wacc.reason}
              </span>
              <span>
                SEC SIC：{data?.sic ?? '缺失'}。{r.wacc.basisReason}{' '}
                SIC映射为本项目配置，并非官方交叉表。
              </span>
              {r.wacc.warnings.map((w) => (
                <span key={w}>{w}</span>
              ))}
              <a href={industries.page} target="_blank" rel="noreferrer">
                Damodaran官方来源 · {industries.date}
              </a>
            </Space>,
          )}
          <Select
            aria-label="WACC行业选择"
            showSearch
            optionFilterProp="label"
            allowClear
            placeholder="请选择行业"
            value={r.wacc.industry}
            style={{ width: '100%', marginTop: 6 }}
            options={[
              ...(industries.nonFinancialMarket
                ? [industries.nonFinancialMarket]
                : []),
              ...industries.industries,
            ].map((i) => ({ value: i.name, label: i.name }))}
            onChange={(v) =>
              onChange(
                resetSimpleOverride({ ...s, industry: v ?? null }, 'wacc'),
              )
            }
          />
        </Col>
        <Col xs={24} sm={8}>
          {parameter(
            'terminalGrowth',
            '永续增长率',
            <Space orientation="vertical">
              <span>
                {s.overrides.terminalGrowth !== undefined
                  ? '当前为手动调整'
                  : '当前为长期通胀默认参考'}
                ；{r.terminal.formula}
              </span>
              {r.terminal.warnings.map((w) => (
                <span key={w}>{w}</span>
              ))}
              <span>WACC必须大于永续增长率。</span>
              <a href={INFLATION_SOURCE} target="_blank" rel="noreferrer">
                美联储长期通胀目标
              </a>
            </Space>,
          )}
        </Col>
      </Row>
    </>
  );
}
