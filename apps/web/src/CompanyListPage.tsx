import { useSearchParams } from 'react-router-dom';
import { listFilters } from './routes.js';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd';
import type {
  FinancialMode,
  ResearchCompany,
  ResearchListResponse,
} from '@company-research/shared';
import { fetchResearchList, setCompanyFavorite } from './api.js';
import { amount, percent } from './financial-columns.js';

export function CompanyListPage({
  favorites,
  onOpen,
  onValuation,
}: {
  favorites: boolean;
  onOpen: (ticker: string) => void;
  onValuation: (ticker: string) => void;
}) {
  const [form] = Form.useForm<{ q: string }>();
  const [params, setParams] = useSearchParams();
  const { page, query, mode } = listFilters(params);
  const updateFilters = (patch: {
    page?: number;
    q?: string;
    mode?: FinancialMode;
  }) => {
    const next = new URLSearchParams(params);
    if (patch.page !== undefined) {
      if (patch.page > 1) next.set('page', String(patch.page));
      else next.delete('page');
    }
    if (patch.q !== undefined) {
      if (patch.q) next.set('q', patch.q);
      else next.delete('q');
    }
    if (patch.mode !== undefined) {
      if (patch.mode === 'quarterly') next.set('mode', patch.mode);
      else next.delete('mode');
    }
    setParams(next, { replace: true });
  };
  const setPage = (next: number) => updateFilters({ page: next });
  const [list, setList] = useState<ResearchListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  useEffect(() => {
    form.setFieldsValue({ q: query });
  }, [form, query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchResearchList({ page, q: query, mode, favorites }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setList(data);
          const lastPage = Math.max(1, Math.ceil(data.total / 10));
          if (page > lastPage) setPage(lastPage);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setList(null);
          setError(error instanceof Error ? error.message : '公司列表加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, query, mode, favorites, revision]);
  useEffect(() => {
    if (!list?.data.some((row) => row.financialStatus === 'FETCHING')) return;
    // Poll only database-backed list status; this endpoint never starts a financial acquisition.
    const timer = window.setTimeout(
      () => setRevision((value) => value + 1),
      2000,
    );
    return () => window.clearTimeout(timer);
  }, [list]);

  async function favorite(row: ResearchCompany) {
    setSaving((previous) => new Set(previous).add(row.cik));
    try {
      await setCompanyFavorite(row.cik, !row.isFavorite);
      setRevision((x) => x + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : '收藏操作失败');
    } finally {
      setSaving((previous) => {
        const next = new Set(previous);
        next.delete(row.cik);
        return next;
      });
    }
  }
  const metric = (
    title: string,
    key: keyof NonNullable<ResearchCompany['financial']>,
    format = amount,
  ): TableColumnsType<ResearchCompany>[number] => ({
    title,
    key,
    width: 145,
    align: 'right',
    render: (_value, row) =>
      format(row.financial?.[key] as number | null | undefined),
  });
  const columns: TableColumnsType<ResearchCompany> = [
    {
      title: '公司',
      key: 'company',
      ellipsis: { showTitle: false },
      fixed: 'left',
      width: 125,
      render: (_value, row) => (
        <>
          <Typography.Link
            className="company-name-link"
            title={row.name ?? row.ticker}
            onClick={() => onOpen(row.ticker)}
          >
            {row.name ?? row.ticker}
          </Typography.Link>
          <Tag>{row.ticker}</Tag>
        </>
      ),
    },
    metric('Revenue YoY', 'revenueGrowth', percent),
    metric('EPS YoY', 'epsGrowth', percent),
    metric('Operating Margin', 'operatingMargin', percent),
    metric('Net Margin', 'netMargin', percent),
    { ...metric('OCF', 'operatingCashFlow'), width: 175 },
    { ...metric('FCF', 'fcf'), width: 165 },
    metric('Cash', 'cash'),
    metric('Total Debt', 'totalDebt'),
    {
      title: '财务期间',
      key: 'period',
      width: 140,
      render: (_value, row) => row.financial?.periodEnd ?? '—',
    },
    {
      title: '操作',
      key: 'actions',
      width: 210,
      render: (_, row) => (
        <Space size="small">
          <Typography.Link onClick={() => onOpen(row.ticker)}>
            详情
          </Typography.Link>
          <Typography.Link onClick={() => onValuation(row.ticker)}>
            估值
          </Typography.Link>
          <Button
            type="link"
            loading={saving.has(row.cik)}
            onClick={() => favorite(row)}
          >
            {row.isFavorite ? '取消收藏' : '收藏'}
          </Button>
        </Space>
      ),
    },
  ];
  return (
    <Space orientation="vertical" size={24} className="full-width">
      <Card title="搜索公司">
        <Form
          form={form}
          initialValues={{ q: query }}
          layout="inline"
          className="query-form"
          onFinish={(values) => {
            updateFilters({ page: 1, q: values.q?.trim() ?? '' });
          }}
        >
          <Form.Item name="q" label="公司 / Ticker">
            <Input
              className="ticker-input"
              placeholder="例如 Alphabet、GOOG、AAPL"
              allowClear
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                搜索
              </Button>
              <Button
                onClick={() => {
                  form.setFieldsValue({ q: '' });
                  updateFilters({ page: 1, q: '' });
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card
        title={favorites ? '我的收藏' : 'SEC 公司目录'}
        extra={
          <Button loading={loading} onClick={() => setRevision((x) => x + 1)}>
            重新加载
          </Button>
        }
      >
        <Space className="list-mode">
          <Segmented
            value={mode}
            options={[
              { label: 'Annual', value: 'annual' },
              { label: 'Quarterly', value: 'quarterly' },
            ]}
            onChange={(value) => {
              updateFilters({ mode: value as FinancialMode, page: 1 });
            }}
          />
          <Typography.Text type="secondary">
            {mode === 'annual' ? '最新完整财年' : '最新独立季度'} · 增长率：YoY
            · 金额：百万美元；Cash / Total Debt 为期末余额 · 缺失为 —
          </Typography.Text>
        </Space>
        {error && (
          <Alert
            type="error"
            showIcon
            title="操作未完成"
            description={error}
            className="list-alert"
            action={
              <Button onClick={() => setRevision((x) => x + 1)}>重试</Button>
            }
          />
        )}
        <Table<ResearchCompany>
          rowKey="ticker"
          columns={columns}
          dataSource={list?.data ?? []}
          loading={loading}
          scroll={{ x: 1575 }}
          locale={{
            emptyText: favorites
              ? '还没有收藏公司，前往「公司列表」收藏感兴趣的公司吧'
              : '暂无匹配公司',
          }}
          pagination={{
            current: page,
            pageSize: 10,
            total: list?.total ?? 0,
            disabled: loading,
            showSizeChanger: false,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total.toLocaleString()} 条`,
            onChange: setPage,
          }}
        />
      </Card>
    </Space>
  );
}
