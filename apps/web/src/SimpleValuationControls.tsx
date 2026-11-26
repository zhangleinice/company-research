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
  type EbitComponent,
  type SimpleValuationData,
  type IndustryWaccData,
} from '@company-research/shared';
import {
  emptySimpleSettings,
  setEbitOverride,
  resetEbitOverride,
  resetSimpleOverride,
  setSimpleOverride,
  type SimpleSettings,
  type resolveSimpleSettings,
} from './simple-valuation-state.js';
import {
  valuationNumber,
  valuationPercent,
  simpleCagrFormula,
} from './valuation-format.js';
type Resolved = ReturnType<typeof resolveSimpleSettings>;
const numericFormat = (
  v: number | undefined,
  info: { userTyping: boolean; input: string },
) =>
  info.userTyping
    ? info.input
    : v == null || String(v) === ''
      ? ''
      : valuationNumber(Number(v));
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
  const percentTax = valuationPercent(
    r.tax.value === null ? null : r.tax.value * 100,
  );
  const fcffFormula =
    s.basis === 'manual'
      ? `手动FCFF ≈ ${valuationNumber(r.fcff.value)}（百万美元）`
      : r.calculationMethod === 'ebit'
        ? `FCFF ≈ ${valuationNumber(r.ebit.components.nopat)} + ${valuationNumber(r.ebit.components.da)} − ${valuationNumber(r.ebit.components.capex)} − (${valuationNumber(r.ebit.components.deltaNwc)}) ≈ ${valuationNumber(r.fcff.value)}（百万美元）`
        : `FCFF ≈ ${valuationNumber(r.period?.ocf.value == null ? null : r.period.ocf.value / 1e6)} − ${valuationNumber(r.period?.capex.value == null ? null : r.period.capex.value / 1e6)} + ${valuationNumber(r.period?.interest.value == null ? null : r.period.interest.value / 1e6)} × (1 − ${percentTax}) ≈ ${valuationNumber(r.fcff.value)}（百万美元）`;
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
  const ebitField = (key: EbitComponent, label: string) => {
    const manual = r.ebit.manualComponents.includes(key);
    const input = r.period?.ebitInputs;
    const source =
      key === 'ebit'
        ? input?.operatingIncome
        : key === 'da'
          ? input?.depreciationAmortization
          : key === 'capex'
            ? r.period?.capex
            : input?.workingCapital;
    return (
      <Col xs={24} sm={12} lg={6} key={key}>
        <Space size={4}>
          <Tooltip
            title={
              <Space orientation="vertical">
                <span>
                  {manual ? '当前为手动研究假设' : '当前为财报参考或公式估计'}
                  ；默认值：
                  {r.ebit.defaults[key] === null
                    ? '—'
                    : r.ebit.defaults[key]?.toLocaleString('zh-CN', {
                        maximumFractionDigits: 2,
                      })}{' '}
                  百万美元
                </span>
                {key === 'ebit' && (
                  <span>采用SEC Operating Income，不使用税前利润加利息。</span>
                )}
                {key === 'da' && (
                  <span>
                    完整D&A优先；分项与附注舍入金额保留近似标记，不使用含Other的混合指标。
                    {input?.depreciationAmortization.reason}
                  </span>
                )}
                {key === 'capex' && (
                  <span>现金购置PP&E支出，未覆盖全部经济再投资。</span>
                )}
                {key === 'deltaNwc' && (
                  <>
                    <span>
                      当前依据：{r.ebit.nwcBasis}
                      ；正值为投入，负值为释放。必要经营现金增量已计入，不再次扣除。
                    </span>
                    <span>{input?.workingCapital?.calculation}</span>
                    {input?.workingCapital?.items
                      .filter(
                        (x) =>
                          ['MISSING', 'UNRESOLVED', 'CONFLICT'].includes(
                            x.status,
                          ) &&
                          (x.sources.length || x.category === 'payables'),
                      )
                      .map((x) => (
                        <span key={x.category}>
                          未纳入：{x.label}；
                          {x.cashImpact === null
                            ? '完整期间金额缺失'
                            : (x.cashImpact / 1e6).toLocaleString('zh-CN', {
                                maximumFractionDigits: 2,
                              }) + '百万美元现金影响'}
                          ；{x.reason}
                        </span>
                      ))}
                  </>
                )}
                {input?.cacheIssues.map((x) => (
                  <span key={x}>{x}</span>
                ))}
                {sources(source)}
              </Space>
            }
          >
            <Typography.Text className="dcf-parameter-label">
              {label} ⓘ
            </Typography.Text>
          </Tooltip>
          {key === 'deltaNwc' && r.ebit.nwcBasis === 'PARTIAL' && (
            <Typography.Text type="warning">部分估计</Typography.Text>
          )}
          {manual && (
            <Button
              size="small"
              type="link"
              aria-label={`恢复${label}默认值`}
              onClick={() => onChange(resetEbitOverride(s, key))}
            >
              恢复
            </Button>
          )}
        </Space>
        <InputNumber
          aria-label={label}
          value={r.ebit.components[key]}
          formatter={numericFormat}
          parser={numericParse}
          placeholder="—（可手动输入）"
          style={{ width: '100%' }}
          onChange={(v) => onChange(setEbitOverride(s, key, v))}
        />
      </Col>
    );
  };
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
        <Col xs={24} sm={8}>
          <Tooltip
            title={
              <Space orientation="vertical">
                <span>{r.methodSelectionReason}</span>
                <span>
                  默认优先采用可用的EBIT法，其次采用OCF法；用户主动选择后不自动切换。
                </span>
                <span>{r.bridgeNotice}</span>
              </Space>
            }
          >
            <Typography.Text className="dcf-parameter-label">
              FCFF计算方法 ⓘ
            </Typography.Text>
          </Tooltip>
          <Select
            aria-label="FCFF计算方法"
            value={r.calculationMethod}
            style={{ width: '100%' }}
            options={[
              { value: 'ebit', label: 'EBIT Method · 税后经营利润法' },
              { value: 'ocf', label: 'OCF Method · 经营现金流法' },
            ]}
            onChange={(calculationMethod) => update({ calculationMethod })}
          />
        </Col>
        <Col xs={24} sm={8}>
          <Tooltip
            title={
              <Space orientation="vertical">
                <span>{fcffFormula}</span>
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
        <Col xs={24} sm={8}>
          <Tooltip
            title={
              <Space orientation="vertical">
                <span>
                  {r.taxMethod === 'effective'
                    ? `TTM税费 ${valuationNumber(data?.ttm.tax.value == null ? null : data.ttm.tax.value / 1e6)} / 税前利润 ${valuationNumber(data?.ttm.pretax.value == null ? null : data.ttm.pretax.value / 1e6)}（百万美元）≈ ${percentTax}`
                    : `Tax Rate ≈ ${percentTax}`}
                  ；{r.tax.reason}
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
                label: '美国联邦税率21.00%',
                disabled: data?.usIncorporated !== true,
              },
              {
                value: 'effective',
                label:
                  r.taxMethod === 'effective' && r.tax.value !== null
                    ? `TTM有效税率 · ${valuationPercent(r.tax.value * 100)}`
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
        {s.basis !== 'manual' && r.calculationMethod === 'ebit' && (
          <>
            {ebitField('ebit', 'Operating Income · 经营利润')}
            {ebitField('da', 'D&A · 折旧与摊销')}
            {ebitField('capex', 'CapEx · 资本支出')}
            {ebitField('deltaNwc', 'ΔNWC · 经营营运资金变化')}
          </>
        )}
        {s.basis !== 'manual' && r.fcff.reason && (
          <Col span={24}>
            <Typography.Text type="danger" className="dcf-note">
              {r.fcff.reason}
              {r.fcff.value === null &&
              r.calculationMethod === 'ebit' &&
              r.period?.ebitInputs?.cacheIssues.length
                ? '；' + r.period.ebitInputs.cacheIssues.join('；')
                : ''}
            </Typography.Text>
          </Col>
        )}
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
              <span>{simpleCagrFormula(r.growth, s.growthMethod)}</span>
              <span>{r.growth.reason}</span>
              <span>
                近3年辅助参考：{simpleCagrFormula(r.growth3, s.growthMethod)}；
                {r.growth3.reason}
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
                  : valuationPercent(r.parameters.wacc)}
                ；默认参考：{r.wacc.industry ?? '未匹配行业'} WACC ≈{' '}
                {valuationPercent(
                  r.wacc.value === null ? null : r.wacc.value * 100,
                )}
                ；{r.wacc.reason}
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
                ；长期通胀参考 ≈{' '}
                {valuationPercent(
                  r.terminal.value === null ? null : r.terminal.value * 100,
                )}
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
