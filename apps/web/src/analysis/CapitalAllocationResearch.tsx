import { Collapse, Empty, Space, Table, Tag, Typography } from 'antd';
import type { AcquisitionEvent, CapitalNote } from '@company-research/shared';
import type { CachedResearch } from '../AiResearch.js';

export function capitalInformation(research?: CachedResearch) {
  const summary = research?.state?.summary;
  const info = summary?.summaryJson.capitalAllocation;
  const source = info?.source;
  const valid =
    !!source &&
    typeof source.cik === 'string' &&
    source.cik.length === 10 &&
    source.item === 'Item 7' &&
    source.accessionNumber === summary?.accessionNumber &&
    source.sourceUrl === summary?.sourceUrl;
  return { summary, info: valid ? info : undefined };
}
export function CapitalSource({
  research,
  updating = false,
}: {
  research?: CachedResearch;
  updating?: boolean;
}) {
  const { info } = capitalInformation(research);
  const failed = research?.error || research?.state?.status === 'FAILED';
  return (
    <Space orientation="vertical" size={4} className="full-width">
      <Typography.Text type="secondary">
        仅覆盖对应10-K Item 7；交易状态截至该申报披露，不是实时状态。
      </Typography.Text>
      {info?.source && (
        <Typography.Text type="secondary">
          {info.source.fiscalYear}财年 · 报告期末：{info.source.reportDate} ·
          申报：{info.source.filingDate} ·{' '}
          <a
            href={info.source.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            SEC原文
          </a>
        </Typography.Text>
      )}
      {failed && (
        <Typography.Text type="secondary">
          {info
            ? '本次提取失败，继续展示上一次成功结果。'
            : '提取失败，尚无可展示的资本配置结果。'}
        </Typography.Text>
      )}
      {updating && (
        <Typography.Text type="secondary">
          正在更新，继续展示已有缓存。
        </Typography.Text>
      )}
      {info?.coverage === 'partial' && (
        <Typography.Text type="secondary">
          输入覆盖不足：{info.coverageReason}
        </Typography.Text>
      )}
      {!info && !failed && (
        <Typography.Text type="secondary">
          {research?.state === null
            ? '正在读取资本配置缓存…'
            : '现有缓存尚无有效资本配置结构化信息；主动更新后生成，可能产生AI费用。'}
        </Typography.Text>
      )}
    </Space>
  );
}
const kinds = {
  fact: '已披露事实',
  plan: '管理层计划／预期',
  risk: '风险提示',
};
const activities = {
  actualFinancing: '实际融资／偿还',
  creditFacility: '授信额度',
  commercialPaperProgram: '商业票据计划',
  debtBalance: '期末债务余额',
  plan: '融资计划',
  other: '其他披露',
};
function renderNote(n: CapitalNote, i: number) {
  return (
    <Typography.Paragraph key={i}>
      <Tag>{kinds[n.kind]}</Tag>
      {n.activityType && <Tag>{activities[n.activityType]}</Tag>}
      {n.text}
    </Typography.Paragraph>
  );
}
export function CapitalNotes({
  groups,
  research,
  investmentDetailsOpen = false,
}: {
  investmentDetailsOpen?: boolean;
  groups: { title: string; key: string; notes: CapitalNote[] }[];
  research?: CachedResearch;
}) {
  const { info } = capitalInformation(research);
  return (
    <Space orientation="vertical" size={16} className="full-width">
      {groups.map((g) => (
        <section key={g.key}>
          <Typography.Title level={5}>{g.title}</Typography.Title>
          {!info || !g.notes.length ? (
            <Typography.Text type="secondary">
              {info ? '本期 Item 7 暂无可展示的重要披露。' : '—'}
            </Typography.Text>
          ) : (
            <>
              {g.notes
                .slice(0, g.key === 'investmentAreas' ? 3 : undefined)
                .map(renderNote)}
              {g.key === 'investmentAreas' && g.notes.length > 3 && (
                <Collapse
                  defaultActiveKey={investmentDetailsOpen ? ['more'] : []}
                  items={[
                    {
                      key: 'more',
                      label: `展开其余投资信息（${g.notes.length - 3}条）`,
                      children: g.notes.slice(3).map(renderNote),
                    },
                  ]}
                />
              )}
            </>
          )}
        </section>
      ))}
    </Space>
  );
}
const statuses = {
  announced: '已公告',
  pending: '待完成',
  completed: '已完成',
  terminated: '已终止',
  unknown: '未知',
};
const dateTypes = {
  agreement: '协议日期',
  announcement: '公告日期',
  completion: '实际完成',
  termination: '终止日期',
  expectedCompletion: '预计完成',
};
const considerations = {
  cash: '现金',
  stock: '股票',
  cashAndStock: '现金＋股票',
  cashPlusDebt: '现金并承接债务',
  other: '其他披露方式',
  unknown: '未知',
};
export function considerationExplanation(e: AcquisitionEvent): string {
  const value = e.transactionValue;
  if (e.considerationType === 'cashPlusDebt' || value?.scope === 'cashPlusDebt')
    return '；另行承担债务，现金金额不等于完整交易对价';
  if (!value) return '；金额未明确披露';
  if (value.scope === 'unknown' || e.considerationType === 'unknown')
    return '；对价范围或支付方式未明确';
  if (e.considerationType === 'cash') {
    // Conditions are read only from the saved transaction-value evidence, never inferred from the target.
    const adjustment = [
      value.rawText,
      ...value.evidence.map((x) => x.quote),
    ].some((text) =>
      /\b(?:subject to (?:customary )?(?:closing|purchase price) adjustments?|(?:closing|purchase price) adjustments?)\b|交割调整/iu.test(
        text,
      ),
    );
    return adjustment
      ? '；现金对价，最终金额可能因交割调整而变化'
      : '；现金对价';
  }

  if (value.scope === 'cash') return '；所列金额为现金部分';
  return '';
}
export function AcquisitionList({ research }: { research?: CachedResearch }) {
  const { info } = capitalInformation(research);
  if (!info) return null;
  if (!info.acquisitions.events.length)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="当前输入Item 7未提取到收购事件，不代表公司没有收购。"
      />
    );
  return (
    <Table<AcquisitionEvent>
      size="small"
      pagination={false}
      scroll={{ x: 800 }}
      rowKey={(_, i) => String(i)}
      dataSource={info.acquisitions.events}
      columns={[
        { title: '收购对象', dataIndex: 'targetName' },
        {
          title: '披露交易对价',
          render: (_, e) => (
            <>
              <div>
                {e.transactionValue?.rawText ?? '—'}
                {e.transactionValue?.currency
                  ? ` · ${e.transactionValue.currency}`
                  : ''}
              </div>
              <Typography.Text type="secondary">
                原文提取，待核对 · {considerations[e.considerationType]}
                {considerationExplanation(e)}
              </Typography.Text>
            </>
          ),
        },
        {
          title: '收购目的',
          render: (_, e) => e.acquisitionPurpose?.text ?? '— 未明确披露',
        },
        {
          title: '交易日期',
          render: (_, e) =>
            e.transactionDate ? (
              <>
                {e.transactionDate.value}
                <br />
                <Typography.Text type="secondary">
                  {dateTypes[e.transactionDate.type]} ·{' '}
                  {e.transactionDate.precision === 'day'
                    ? '日'
                    : e.transactionDate.precision === 'month'
                      ? '月'
                      : '年'}
                  精度
                </Typography.Text>
              </>
            ) : (
              '—'
            ),
        },
        { title: '披露状态', render: (_, e) => statuses[e.transactionStatus] },
      ]}
    />
  );
}
