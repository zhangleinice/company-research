import { Empty, Table, Typography } from 'antd';
import type { AcquisitionEvent } from '@company-research/shared';
import type { CachedResearch } from '../../../hooks/useCachedResearch.js';
import { capitalInformation } from '../../components/CapitalAllocationResearch.js';
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
