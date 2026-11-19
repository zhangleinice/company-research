import type { ReactNode } from 'react';
import { Table, Tooltip, Typography } from 'antd';
import type {
  BridgeDisclosureKey,
  ValuationBaseline,
  ValuationFact,
  ValuationReferences,
  calculateDcf,
} from '@company-research/shared';

type Result = ReturnType<typeof calculateDcf>;
const format = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const missing: ValuationFact = {
  value: null,
  start: null,
  end: '',
  concept: null,
  items: [],
};
type Figure = { label?: string; fact: ValuationFact };
type DetailRow = {
  key: string;
  label: string;
  figures: Figure[];
  adjustment: number | null;
  status: string;
  note: string;
  unit?: string;
  total?: boolean;
};

/** Disclosures are references; they never feed or approve the calculation engine. */
export function EquityBridgeDetails({
  baseline,
  references,
  result,
  error = '',
}: {
  baseline: ValuationBaseline | null;
  references: ValuationReferences | null;
  result: Result | null;
  error?: string;
}) {
  const disclosures = baseline?.bridgeDisclosures;
  const matching =
    disclosures?.cik === baseline?.cik && disclosures?.asOf === baseline?.asOf;
  const fact = (key: BridgeDisclosureKey): ValuationFact => {
    const disclosed = matching ? disclosures?.items[key] : null;
    if (disclosed?.value != null) return disclosed;
    const capital = baseline?.quality?.capital.find(
      (x) => x.periodEnd === baseline.asOf,
    );
    const cached =
      key === 'cash'
        ? capital?.cash
        : key === 'securities'
          ? capital?.securities
          : key === 'totalDebt'
            ? capital?.debt
            : null;
    if (cached?.value != null) return cached;
    const reference =
      key === 'cash'
        ? references?.cash
        : key === 'totalDebt'
          ? references?.debt
          : key === 'dilutedShares' &&
              references?.sharesBasis === 'weightedDiluted'
            ? references.shares
            : key === 'commonShares' &&
                references?.sharesBasis === 'currentCommon'
              ? references.shares
              : null;
    return reference == null
      ? missing
      : {
          value: reference,
          start: null,
          end: references?.periodEnd ?? '',
          concept: null,
          items: [],
        };
  };
  const knownScope = (figures: Figure[]) => {
    const known = figures.filter((x) => x.fact.value !== null);
    return known.length ? known : [{ fact: missing }];
  };
  const rows: DetailRow[] = [];
  const pending = (
    key: string,
    label: string,
    figures: Figure[],
    review: string,
    note: string,
  ) => {
    const known = figures.some((x) => x.fact.value !== null);
    const derived =
      known &&
      figures.some((x) =>
        x.fact.items.some(
          (item) =>
            (item.provenance as { method?: string } | undefined)?.method &&
            (item.provenance as { method: string }).method !== 'reported',
        ),
      );
    rows.push({
      key,
      label,
      figures,
      adjustment: null,
      status: known ? review : '未找到',
      note: `${known ? (derived ? 'SEC输入已计算。' : 'SEC金额已获取。') : '当前缓存未找到可靠金额，不代表不存在或为0。'}${figures.length === 1 && figures[0].label ? figures[0].label + '。' : ''}${note}`,
    });
  };
  rows.push({
    key: 'ev',
    label: '企业价值EV',
    figures: [],
    adjustment: result?.ev ?? null,
    status: result?.ev == null ? '待确认' : '已计算',
    note: 'DCF情景结果，作为股权桥接起点；不是SEC披露金额。',
  });
  pending(
    'cash',
    '现金及现金等价物',
    [{ fact: fact('cash') }],
    '需估算',
    '加回候选：仅超额现金；不能将全部现金直接加回。',
  );
  pending(
    'securities',
    '短期有价证券',
    [{ fact: fact('securities') }],
    '待确认',
    '加回候选：核对非经营归属及收益是否已计入FCFF。',
  );
  pending(
    'investments',
    '其他长期投资',
    [{ fact: fact('longTermInvestments') }],
    '待确认',
    '加回候选：账面值不等于可实现净价值，需避免重复计价。',
  );
  pending(
    'shortDebt',
    '短期有息债务',
    [{ fact: fact('shortDebt') }],
    '待确认',
    '扣减候选：与长期部分、租赁保持不重叠。',
  );
  pending(
    'longDebt',
    '长期有息债务',
    [{ fact: fact('longDebt') }],
    '待确认',
    '扣减候选：账面金额尚未核准为估值扣减金额。',
  );
  pending(
    'operatingLeases',
    '经营租赁负债',
    [{ fact: fact('operatingLeases') }],
    '待确认',
    '视FCFF口径：已包含的经营租赁现金流不能重复扣除。',
  );
  pending(
    'financeLeases',
    '融资租赁负债',
    [{ fact: fact('financeLeases') }],
    '待确认',
    '视FCFF口径：与债务、租赁利息及再投资口径保持一致。',
  );
  pending(
    'minority',
    '少数股东权益',
    knownScope([
      { label: '一般少数权益', fact: fact('minority') },
      { label: 'VIE少数权益', fact: fact('noncontrollingVIE') },
    ]),
    '待确认',
    '扣减候选：核对合并范围与可赎回部分；不同范围不相加。',
  );
  pending(
    'preferred',
    '优先股及其他重大索偿',
    knownScope([
      { label: '优先股', fact: fact('preferred') },
      { label: '可转换优先股', fact: fact('convertiblePreferred') },
      { label: '流动或有损失应计', fact: fact('lossContingenciesCurrent') },
      { label: '未确认税收利益', fact: fact('unrecognizedTaxBenefits') },
    ]),
    '待确认',
    '各项分别展示，不加总，亦不代表全部索偿；优先股扣减不能与转换稀释重复计算，或有和税务金额不等于最终现金支付。',
  );
  pending(
    'shares',
    '估值使用的股数',
    [
      { label: '期末普通股', fact: fact('commonShares') },
      { label: '期间平均基本', fact: fact('basicShares') },
      { label: '期间平均稀释', fact: fact('dilutedShares') },
    ],
    '待确认',
    '作为分母：与估值时点及潜在稀释一致，不相加、不重复计数。',
  );
  rows[rows.length - 1].unit = '百万股';
  // The existing engine is the sole authority for approved aggregate results.
  rows.push({
    key: 'equity',
    label: '股权内在价值',
    figures: [],
    adjustment: result?.equity ?? null,
    status: result?.equity == null ? '待确认' : '已计算',
    note:
      result?.equity == null
        ? '关键资产及索偿调整尚未核准。'
        : '沿用现有DCF股权桥接计算结果。',
    total: true,
  });
  rows.push({
    key: 'perShare',
    label: '每股内在价值',
    figures: [],
    adjustment: result?.perShare ?? null,
    status: result?.perShare == null ? '待确认' : '已计算',
    note:
      result?.perShare == null
        ? '股权价值或适用股数尚未核准。'
        : '沿用现有引擎结果；美元/股。',
    unit: '美元/股',
    total: true,
  });
  const amount = (n: number | null, unit?: string) =>
    `${format(n)}${n === null || !unit ? '' : ` ${unit}`}`;
  const figure = ({ label, fact: f }: Figure, i: number): ReactNode => (
    <div key={i}>
      {label && <Typography.Text type="secondary">{label}：</Typography.Text>}
      <Tooltip
        title={[f.start ? `${f.start} → ${f.end}` : f.end, f.concept]
          .filter(Boolean)
          .join(' · ')}
      >
        <span>{format(f.value === null ? null : f.value / 1e6)}</span>
      </Tooltip>
    </div>
  );
  return (
    <section className="dcf-section dcf-equity">
      <Typography.Title level={5}>股权价值与每股内在价值</Typography.Title>
      <div className="dcf-unavailable-formulas">
        股权价值 = EV + 可加回的非经营性资产 − 债务及其他索偿
        <br />
        每股内在价值 = 股权价值 ÷ 适用股数
      </div>
      <Typography.Paragraph type="secondary" className="dcf-note">
        金额：百万美元；股数：百万股。SEC财报金额不等于估值调整金额。悬浮项目查看口径。
      </Typography.Paragraph>
      <Table
        className="dcf-bridge-table"
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={rows}
        scroll={{ x: 690 }}
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
            render: (_, row) =>
              row.figures.length
                ? row.figures.map((value, i) =>
                    figure(
                      {
                        ...value,
                        label: row.figures.length > 1 ? value.label : undefined,
                      },
                      i,
                    ),
                  )
                : '—',
          },
          {
            title: '估值调整 / 结果',
            key: 'adjustment',
            width: 160,
            align: 'right',
            render: (_, row) => amount(row.adjustment, row.unit),
          },
          { title: '状态', dataIndex: 'status', width: 100 },
        ]}
      />
      {result?.perShare == null && (
        <Typography.Text type="secondary" className="dcf-note">
          暂不能计算每股内在价值：非经营资产、租赁、少数股东权益、优先股及其他索偿、适用股数仍需核准。
          {error}
        </Typography.Text>
      )}
    </section>
  );
}
