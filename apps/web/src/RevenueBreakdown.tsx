import { useEffect, useState } from 'react';
import { Card, Space, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type {
  RevenueBreakdownResponse,
  RevenueGroup,
} from '@company-research/shared';
import { fetchRevenueBreakdown } from './api.js';

export function formatRevenueMillions(value: string | null | undefined) {
  if (value == null) return '—';
  const n = BigInt(value),
    absolute = n < 0n ? -n : n;
  const integer = new Intl.NumberFormat('zh-CN').format(absolute / 1000000n);
  const fraction = (absolute % 1000000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${n < 0n ? '-' : ''}${integer}${fraction ? '.' + fraction : ''}`;
}
export function RevenueTables({ data }: { data: RevenueBreakdownResponse }) {
  if (!data.groups.length) return null;
  return (
    <Card
      className="analysis-module"
      title="Revenue Breakdown · 收入明细"
      aria-label="Revenue Breakdown · 收入明细"
    >
      <Space orientation="vertical" size={20} className="full-width">
        {data.groups.map((group, index) => {
          const years = [
            ...new Set(
              group.rows.flatMap((row) => row.facts.map((f) => f.fiscalYear)),
            ),
          ].sort((a, b) => a - b);
          type Row = RevenueGroup['rows'][number];
          const columns: TableColumnsType<Row> = [
            { title: '原始项目', dataIndex: 'name', key: 'name', width: 260 },
            ...years.map((year) => ({
              title: String(year),
              key: String(year),
              align: 'right' as const,
              render: (_: unknown, row: Row) =>
                formatRevenueMillions(
                  row.facts.find((f) => f.fiscalYear === year)?.value,
                ),
            })),
            {
              title: `${years.at(-1)} YoY`,
              key: 'yoy',
              align: 'right',
              render: (_, row) => {
                const value = row.facts.find(
                  (f) => f.fiscalYear === years.at(-1),
                )?.yoy.value;
                return value == null ? '—' : `${value.toFixed(2)}%`;
              },
            },
          ];
          return (
            <section key={group.tableIndex}>
              <Space wrap className="list-mode">
                <Typography.Text strong>
                  {data.fiscalYear} 财年 · 原始披露表 {index + 1}
                </Typography.Text>
                <Typography.Text type="secondary">
                  金额：百万美元
                </Typography.Text>
                <Typography.Link
                  href={group.rows[0]?.facts[0]?.factUrl || group.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  SEC 原始 10-K
                </Typography.Link>
              </Space>
              <Table<Row>
                size="small"
                rowKey="rowIndex"
                columns={columns}
                dataSource={group.rows}
                pagination={false}
                scroll={{ x: 700 }}
              />
            </section>
          );
        })}
      </Space>
    </Card>
  );
}
export function RevenueBreakdown({
  cik,
  revision = 0,
}: {
  cik: string;
  revision?: number;
}) {
  const [data, setData] = useState<RevenueBreakdownResponse | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRevenueBreakdown(cik, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          setData(next);
          if (next.status === 'NOT_FETCHED')
            timer = setTimeout(() => void load(), 2000);
        })
        .catch(() => {
          /* Revenue failures never replace the Business summary. */
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [cik, revision]);
  return data ? <RevenueTables data={data} /> : null;
}
