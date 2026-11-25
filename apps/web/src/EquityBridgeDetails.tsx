import { useState } from 'react';
import { Table, Tooltip, Typography, Space, InputNumber, Button } from 'antd';
import {
  evaluateEquityBridge,
  PRELIMINARY_FCFF_NOTICE,
  type EquityBridgeInput,
  type EquityDefaultKey,
  type EquityDefaultEstimate,
  type EquityBridgeResearch,
  type ResearchBridgeKey,
  type ResearchReference,
  type ResearchReferenceKey,
  type ValuationBaseline,
  type ValuationReferences,
  type calculateDcf,
} from '@company-research/shared';
import {
  bridgeMoney,
  setTableBridgeAmount,
  visibleBridgeFacts,
  usesDefaultEstimate,
  restoreBridgeDefault,
} from './equity-bridge-editor.js';
type Result = ReturnType<typeof calculateDcf>;
const empty: ResearchReference = {
  value: null,
  start: null,
  end: '',
  concept: null,
  items: [],
  status: 'MISSING',
  reason: '当前缓存未找到可靠金额，不代表不存在或为0',
};
const labels: Partial<Record<ResearchReferenceKey, string>> = {
  shortDebt: '短期有息债务',
  longDebt: '非流动长期债务',
  plainDebt: '不含融资租赁的totalDebt',
  financingDebt: '含融资租赁的financingDebt',
  financeLeases: '融资租赁组成',
  minority: '一般少数权益',
  narrowMinority: '较窄标签少数权益（需核对总范围）',
  preferred: '优先股账面参考',
  convertiblePreferred: '可转换优先股账面参考',
  lossContingencies: '诉讼／或有损失应计',
  taxClaims: '未确认税收利益',
  pensionClaims: '养老金缺口',
  shares: '最近可得时点普通股',
  annualBasicShares: '完整财年平均基本股数',
  annualDilutedShares: '完整财年平均稀释股数',
  quarterBasicShares: '独立季度平均基本股数',
  quarterDilutedShares: '独立季度平均稀释股数',
};
const explanations: Record<ResearchBridgeKey, string> = {
  cash: '仅加回超额现金。经营所需现金或直接输入的超额现金都不得超过同日现金余额。',
  shortInvestments:
    '仅加回独立于现金的非经营投资；核对其收益没有包含在预测FCFF中。',
  longInvestments: '映射覆盖有限；账面值不等于经济价值，不能自动全额加回。',
  financingDebt:
    '采用核准的含融资租赁债务作为经济价值近似，或明确手动估计完整金额；不得重复计入流动长期债务。',
  minority:
    '账面值不等于经济价值；需覆盖不归属于母公司普通股股东的全部权益，且总额与可赎回部分不重复扣减。',
  preferred:
    '核对实际发行主体与转换条款。索偿扣减与同一股份转换稀释互斥；手动转换须处理转换前股息及剩余索偿。',
  otherClaims:
    '不机械相加候选金额。核对诉讼、税务、养老金及其他重大事项是否已在预测现金流或其他调整中体现。',
  shares:
    '股数必须大于0。历史平均稀释股数不是当前完全稀释股数；核对多类别股份权益及同一SBC成本不重复计量。',
};
function sourceLinks(value: unknown, cik?: string): string[] {
  if (Array.isArray(value)) return value.flatMap((x) => sourceLinks(x, cik));
  if (!value || typeof value !== 'object') return [];
  const o = value as Record<string, unknown>;
  const direct = [o.url, o.sourceUrl].filter(
    (x): x is string =>
      typeof x === 'string' && x.startsWith('https://www.sec.gov/Archives/'),
  );
  if (cik && typeof o.accn === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(o.accn))
    direct.push(
      `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${o.accn.replaceAll('-', '')}/${o.accn}-index.html`,
    );
  return [
    ...direct,
    ...Object.values(o)
      .filter((x) => typeof x === 'object')
      .flatMap((x) => sourceLinks(x, cik)),
  ];
}
function sourceDescriptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(sourceDescriptions);
  if (!value || typeof value !== 'object') return [];
  const o = value as Record<string, unknown>;
  return [
    ...(typeof o.concept === 'string'
      ? [`${o.concept} · ${o.accn ?? ''} · 申报 ${o.filed ?? '未知'}`]
      : []),
    ...Object.values(o)
      .filter((x) => typeof x === 'object')
      .flatMap(sourceDescriptions),
  ];
}
function Figure({
  fact,
  label,
  shares = false,
  cik,
}: {
  fact: ResearchReference;
  label?: string;
  shares?: boolean;
  cik?: string;
}) {
  const urls = [...new Set(sourceLinks(fact.items, cik))];
  return (
    <div>
      <Tooltip
        title={
          <Space orientation="vertical">
            <span>
              {fact.start
                ? `${fact.start} 至 ${fact.end}`
                : `截至 ${fact.end || '未知日期'}`}{' '}
              · {fact.concept ?? '核准来源及组成见申报'} ·{' '}
              {shares ? 'shares' : 'USD'}
            </span>
            {fact.reason && <span>{fact.reason}</span>}
            {[...new Set(sourceDescriptions(fact.items))]
              .slice(0, 6)
              .map((text) => (
                <span key={text}>{text}</span>
              ))}
            {urls.slice(0, 3).map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                SEC原始申报
              </a>
            ))}
          </Space>
        }
      >
        <span tabIndex={0}>
          {label && `${label}：`}
          {bridgeMoney(fact.value === null ? null : fact.value / 1e6)}
        </span>
      </Tooltip>
    </div>
  );
}
export function EquityBridgeDetails({
  references,
  result,
  error = '',
  bridge,
  onChange,
  defaults,
}: {
  baseline: ValuationBaseline | null;
  references: ValuationReferences | null;
  result: Result | null;
  error?: string;
  bridge?: EquityBridgeInput;
  onChange?: (research: EquityBridgeResearch) => void;
  defaults?: Record<EquityDefaultKey, EquityDefaultEstimate> | null;
}) {
  const [editing, setEditing] = useState<EquityDefaultKey | null>(null);
  const r = bridge?.research;
  const refs = r?.references ?? references?.equityBridge;
  const fact = (key: ResearchReferenceKey) => refs?.facts[key] ?? empty;
  const evaluation = bridge ? evaluateEquityBridge(bridge) : null;
  const values = evaluation?.research?.values;
  type DataRow = {
    key: string;
    label: string;
    adjustmentKey?: ResearchBridgeKey;
    facts?: ResearchReferenceKey[];
    note: string;
    status?: string;
    value?: number | null;
    total?: boolean;
    unit?: string;
  };
  const pending = (
    key: ResearchBridgeKey,
    label: string,
    facts: ResearchReferenceKey[] = [key],
  ): DataRow => ({
    key,
    label,
    adjustmentKey: key,
    facts,
    note: explanations[key],
  });
  const debtApproved =
    r?.items.financingDebt.treatment === 'reference' &&
    refs?.facts.financingDebt.status === 'VERIFIED' &&
    refs.financingDebtIncludesLeases === true;
  const rows: DataRow[] = [
    {
      key: 'ev',
      label: '企业价值EV',
      value: result?.ev,
      status: result?.ev == null ? '待计算' : '已计算',
      note: 'DCF情景结果；不是SEC披露金额。',
    },
    pending('cash', '现金及现金等价物'),
    pending('shortInvestments', '短期有价证券'),
    pending('longInvestments', '其他长期投资'),
    {
      key: 'shortDebt',
      label: '短期有息债务',
      facts: ['shortDebt'],
      status: '组成明细',
      note: '融资债务组成，不单独扣减；不重复计入流动长期债务。',
    },
    {
      key: 'longDebt',
      label: '长期有息债务',
      facts: ['longDebt'],
      status: '组成明细',
      note: '融资债务组成，不单独扣减。',
    },
    {
      key: 'financeLeases',
      label: '融资租赁负债',
      facts: ['financeLeases'],
      value: debtApproved ? 0 : null,
      status: debtApproved ? '已含债务' : '范围待核准',
      note: '融资租赁包含在已核准融资债务中时，不再次扣减。',
    },
    {
      ...pending('financingDebt', '总融资债务', ['financingDebt']),
      status: debtApproved ? '核准参考' : '待核准',
    },
    {
      key: 'operatingLeases',
      label: '经营租赁负债',
      facts: ['operatingLeases'],
      value: 0,
      status: '经营成本',
      note: '按现有FCFF经营成本政策处理，不额外扣减经营租赁负债；0为额外估值调整而非SEC余额。',
    },
    pending('minority', '少数股东权益', ['minority', 'narrowMinority']),
    pending('preferred', '优先股', ['preferred', 'convertiblePreferred']),
    pending('otherClaims', '其他重大索偿', [
      'lossContingencies',
      'taxClaims',
      'pensionClaims',
    ]),
    {
      ...pending('shares', '估值使用的股数', [
        'shares',
        'annualBasicShares',
        'annualDilutedShares',
        'quarterBasicShares',
        'quarterDilutedShares',
      ]),
      unit: '百万股',
    },
    {
      key: 'equity',
      label: '股权内在价值',
      value: result?.equity,
      status: result?.equity == null ? '待确认' : '已计算',
      total: true,
      note: '沿用现有DCF股权桥接结果；必要调整尚未核准时不计算。',
    },
    {
      key: 'perShare',
      label: '每股内在价值',
      value: result?.perShare,
      status: result?.perShare == null ? '待确认' : '已计算',
      total: true,
      unit: '美元/股',
      note: '股权价值除以适用股数；不自动以历史平均股数代替当前适用股数。',
    },
  ];
  const amount = (row: DataRow) =>
    row.adjustmentKey
      ? r?.items[row.adjustmentKey].treatment === 'pending'
        ? null
        : (values?.[row.adjustmentKey] ?? null)
      : (row.value ?? null);
  const pendingLabels = rows
    .filter((row) => row.adjustmentKey && amount(row) === null)
    .map((row) => row.label);
  return (
    <section className="dcf-section dcf-equity">
      <Typography.Title level={5}>股权价值与每股内在价值</Typography.Title>
      <div className="dcf-unavailable-formulas">
        股权价值 = EV + 可加回的非经营性资产 − 债务及其他索偿
        <br />
        每股内在价值 = 股权价值 ÷ 适用股数
      </div>
      <Typography.Paragraph type="secondary" className="dcf-note">
        金额：百万美元；股数：百万股。输入为个人估值假设，结果仅作条件性参考。悬浮查看来源及口径。
      </Typography.Paragraph>
      <Table<DataRow>
        className="dcf-bridge-table"
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={rows}
        scroll={{ x: 780 }}
        rowClassName={(row) => (row.total ? 'dcf-ev-row' : '')}
        columns={[
          {
            title: '项目',
            dataIndex: 'label',
            width: 180,
            render: (_, row) => (
              <Tooltip title={row.note} trigger={['hover', 'focus']}>
                <span className="dcf-bridge-hint" tabIndex={0}>
                  {row.label}
                </span>
              </Tooltip>
            ),
          },
          {
            title: 'SEC财报金额',
            key: 'reported',
            width: 240,
            align: 'right',
            render: (_, row) => (
              <>
                {(() => {
                  const compact = [
                    'financingDebt',
                    'minority',
                    'preferred',
                    'otherClaims',
                    'shares',
                  ].includes(row.key);
                  const keys =
                    compact && refs
                      ? visibleBridgeFacts(refs, row.key)
                      : (row.facts ?? []);
                  return keys.length
                    ? keys.map((key) => (
                        <Figure
                          key={key}
                          fact={fact(key)}
                          cik={refs?.cik}
                          label={keys.length > 1 ? labels[key] : undefined}
                          shares={row.key === 'shares'}
                        />
                      ))
                    : '—';
                })()}
              </>
            ),
          },
          {
            title: '估值调整 / 结果',
            key: 'adjustment',
            width: 160,
            align: 'right',
            render: (_, row) => {
              const n = amount(row);
              if (row.adjustmentKey && row.adjustmentKey !== 'financingDebt') {
                const key = row.adjustmentKey;
                const d = defaults?.[key];
                if (editing !== key)
                  return (
                    <Tooltip
                      title={
                        <Space orientation="vertical">
                          <span>
                            {r && usesDefaultEstimate(r, key)
                              ? '当前使用系统默认估计（估值假设）'
                              : '当前使用手动调整值（个人假设）'}
                            ：{bridgeMoney(n)}
                          </span>
                          <span>
                            默认方法：{d?.method ?? explanations[key]}
                          </span>
                          <span>默认计算：{d?.calculation}</span>
                          {d?.reason && <span>{d.reason}</span>}
                          {d?.warnings.map((w) => (
                            <span key={w}>{w}</span>
                          ))}
                          {d?.sources.map((f, i) => (
                            <span key={i}>
                              {f.concept ??
                                f.items
                                  .map((x) => String(x.concept ?? ''))
                                  .join('、')}{' '}
                              · {f.start ? `${f.start} 至 ` : '截至 '}
                              {f.end} ·{' '}
                              {bridgeMoney(
                                f.value === null ? null : f.value / 1e6,
                              )}{' '}
                              {key === 'shares' ? '百万股' : '百万美元'}
                            </span>
                          ))}
                          {[
                            ...new Set(
                              (d?.sources ?? []).flatMap((f) =>
                                sourceLinks(f.items, refs?.cik),
                              ),
                            ),
                          ]
                            .slice(0, 4)
                            .map((url) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                SEC原始申报
                              </a>
                            ))}
                          <span>{explanations[key]}</span>
                        </Space>
                      }
                    >
                      <span tabIndex={0} className="dcf-bridge-hint">
                        {bridgeMoney(n)} ⓘ
                      </span>
                    </Tooltip>
                  );
                return (
                  <InputNumber
                    aria-label={`${row.label}估值金额`}
                    value={r?.items[key].value ?? null}
                    placeholder="—"
                    autoFocus
                    onBlur={() => setEditing(null)}
                    onPressEnter={() => setEditing(null)}
                    disabled={!r || !onChange}
                    controls={false}
                    style={{ width: 132, textAlign: 'right' }}
                    className="dcf-bridge-input"
                    formatter={(v, info) =>
                      info.userTyping
                        ? info.input
                        : v == null || String(v) === ''
                          ? ''
                          : bridgeMoney(Number(v))
                    }
                    parser={(v) =>
                      v?.trim() ? Number(v.replaceAll(',', '')) : Number.NaN
                    }
                    onChange={(v) =>
                      r && onChange?.(setTableBridgeAmount(r, key, v))
                    }
                  />
                );
              }
              return `${bridgeMoney(n)}${n === null || !row.unit ? '' : ` ${row.unit}`}`;
            },
          },
          {
            title: '操作',
            key: 'action',
            width: 100,
            render: (_, row) =>
              row.adjustmentKey && row.adjustmentKey !== 'financingDebt' ? (
                <Space size={4}>
                  <Button
                    type="link"
                    size="small"
                    disabled={!r || !onChange}
                    onClick={() =>
                      setEditing(row.adjustmentKey as EquityDefaultKey)
                    }
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    disabled={!r || !onChange || !defaults}
                    onClick={() => {
                      if (r && defaults) {
                        const key = row.adjustmentKey as EquityDefaultKey;
                        onChange?.(restoreBridgeDefault(r, key, defaults[key]));
                        setEditing(null);
                      }
                    }}
                  >
                    恢复默认
                  </Button>
                </Space>
              ) : (
                '—'
              ),
          },
        ]}
      />
      <Typography.Text type="secondary" className="dcf-note">
        {PRELIMINARY_FCFF_NOTICE}
      </Typography.Text>
      {result?.perShare == null && (
        <Typography.Text type="secondary" className="dcf-note">
          暂不能计算每股内在价值：
          {pendingLabels.length
            ? pendingLabels.join('、') + '仍需核准。'
            : '股权价值或适用股数尚未具备计算条件。'}
          {[
            ...new Set(
              evaluation?.errors.filter((message) =>
                /超过|非负有效|必须大于|口径选择无效|上限|报告期不一致/.test(
                  message,
                ),
              ) ?? [],
            ),
          ].join('；')}
          {error && '参考数据暂不可用。'}
        </Typography.Text>
      )}
    </section>
  );
}
