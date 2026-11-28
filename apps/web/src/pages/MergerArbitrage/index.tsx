import { useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd';
import type { MergerListResponse } from '@company-research/shared';
import { fetchMergers } from '../../services/api';
export function MergersPage() {
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<MergerListResponse | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchMergers(page, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '并购列表读取失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, revision]);
  return (
    <Card title="并购套利">
      <Space orientation="vertical" size={16} className="full-width">
        <Alert
          type="info"
          showIcon
          title="全部记录待核实"
          description="来源为 FMP，并不代表已经签署正式收购协议。当前套餐每次最多返回5条，本阶段首次读取后保存缓存。"
        />
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            action={
              <Button onClick={() => setRevision((v) => v + 1)}>重试</Button>
            }
          />
        )}
        {data && (
          <Typography.Text type="secondary">
            缓存时间：{new Date(data.checkedAt).toLocaleString('zh-CN')}
          </Typography.Text>
        )}
        <Table<MergerListResponse['data'][number]>
          rowKey="id"
          loading={loading}
          dataSource={data?.data ?? []}
          scroll={{ x: 1000 }}
          pagination={{
            current: page,
            pageSize: 10,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{ emptyText: '暂无并购记录' }}
          columns={[
            {
              title: '日期（FMP，待核实）',
              dataIndex: 'transactionDate',
              width: 180,
            },
            { title: '收购方', dataIndex: 'companyName' },
            {
              title: '收购方 Ticker',
              dataIndex: 'symbol',
              render: (v: string | null) => v ?? '—',
            },
            { title: '目标公司', dataIndex: 'targetedCompanyName' },
            {
              title: '目标 Ticker',
              dataIndex: 'targetedSymbol',
              render: (v: string | null) => v ?? '—',
            },
            { title: '状态', key: 'status', render: () => <Tag>待核实</Tag> },
            {
              title: '来源',
              key: 'source',
              render: (_, row) => (
                <Typography.Link
                  href={row.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  SEC 原始公告
                </Typography.Link>
              ),
            },
          ]}
        />
      </Space>
    </Card>
  );
}
