import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Layout,
  Segmented,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd';
import type {
  FinancialMode,
  ResearchCompany,
  ResearchListResponse,
} from '@company-research/shared';
import { fetchResearchList, setCompanyFavorite } from './api';
import { amount, number, percent } from './financial-columns';
import { CompanyDetails } from './CompanyDetails';

const statusLabels = {
  NOT_FETCHED: '未获取',
  FETCHING: '获取中',
  READY: '已获取',
  FAILED: '获取失败，可重试',
};
const selectedCompany = () =>
  new URLSearchParams(window.location.search).get('company');

export function App() {
  const [form] = Form.useForm<{ q: string }>();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FinancialMode>('annual');
  const [view, setView] = useState('all');
  const [list, setList] = useState<ResearchListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(selectedCompany);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  useEffect(() => {
    const handler = () => {
      setSelected(selectedCompany());
      setRevision((x) => x + 1);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  useEffect(() => {
    if (selected) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchResearchList(
      { page, q: query, mode, favorites: view === 'favorites' },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setList(data);
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
  }, [page, query, mode, view, revision, selected]);
  useEffect(() => {
    if (
      selected ||
      !list?.data.some((row) => row.financialStatus === 'FETCHING')
    )
      return;
    // Poll only database-backed list status; this endpoint never starts a financial acquisition.
    const timer = window.setTimeout(
      () => setRevision((value) => value + 1),
      2000,
    );
    return () => window.clearTimeout(timer);
  }, [list, selected]);

  function navigate(ticker: string | null) {
    window.history.pushState(
      null,
      '',
      ticker
        ? `?company=${encodeURIComponent(ticker)}`
        : window.location.pathname,
    );
    setSelected(ticker);
    setRevision((x) => x + 1);
  }
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
      fixed: 'left',
      width: 250,
      render: (_value, row) => (
        <>
          <Typography.Link onClick={() => navigate(row.ticker)}>
            {row.name ?? row.ticker}
          </Typography.Link>
          <br />
          <Space>
            <Tag>{row.ticker}</Tag>
            <Typography.Text type="secondary">{row.cik}</Typography.Text>
          </Space>
        </>
      ),
    },
    {
      title: '行业',
      dataIndex: 'industry',
      key: 'industry',
      width: 200,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: '数据状态',
      key: 'status',
      width: 160,
      render: (_value, row) => (
        <Tag
          color={
            row.financialStatus === 'READY'
              ? 'success'
              : row.financialStatus === 'FAILED'
                ? 'error'
                : row.financialStatus === 'FETCHING'
                  ? 'processing'
                  : 'default'
          }
        >
          {statusLabels[row.financialStatus]}
        </Tag>
      ),
    },
    {
      title: '财务期间',
      key: 'period',
      width: 140,
      render: (_value, row) => row.financial?.periodEnd ?? '—',
    },
    metric('Revenue', 'revenue'),
    metric(
      mode === 'annual' ? 'Revenue Growth' : 'Revenue YoY',
      'revenueGrowth',
      percent,
    ),
    metric('Diluted EPS', 'eps', number),
    metric(mode === 'annual' ? 'EPS Growth' : 'EPS YoY', 'epsGrowth', percent),
    ...(mode === 'annual'
      ? [
          metric('FCF', 'fcf'),
          metric('ROE', 'roe', percent),
          metric('Net Margin', 'netMargin', percent),
        ]
      : [
          metric('Net Income', 'netIncome'),
          metric('Operating Margin', 'operatingMargin', percent),
          metric('Cash', 'cash'),
        ]),
    metric('Total Debt', 'totalDebt'),
    {
      title: '收藏',
      key: 'favorite',
      fixed: 'right',
      width: 100,
      render: (_value, row) => (
        <Button
          type="link"
          loading={saving.has(row.cik)}
          onClick={() => favorite(row)}
        >
          {row.isFavorite ? '取消收藏' : '收藏'}
        </Button>
      ),
    },
  ];
  return (
    <Layout className="app-layout">
      <Layout.Header className="app-header">
        <div className="header-content">
          <Typography.Title level={4} className="app-title">
            Company Research
          </Typography.Title>
          <Tag color="blue">SEC 公司研究</Tag>
        </div>
      </Layout.Header>
      <Layout.Content className="app-content">
        {selected ? (
          <CompanyDetails
            key={selected}
            identifier={selected}
            onBack={() => navigate(null)}
          />
        ) : (
          <Space orientation="vertical" size={24} className="full-width">
            <Card title="搜索公司">
              <Form
                form={form}
                layout="inline"
                className="query-form"
                onFinish={(values) => {
                  setPage(1);
                  setQuery(values.q?.trim() ?? '');
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
                        form.resetFields();
                        setPage(1);
                        setQuery('');
                      }}
                    >
                      重置
                    </Button>
                  </Space>
                </Form.Item>
              </Form>
              <Typography.Paragraph type="secondary" className="query-help">
                搜索和翻页只读取基础目录与已缓存指标。首次进入详情才获取财务数据；收藏不会触发获取。
              </Typography.Paragraph>
            </Card>
            <Card
              title={view === 'favorites' ? '收藏列表' : 'SEC 公司目录'}
              extra={
                <Button
                  loading={loading}
                  onClick={() => setRevision((x) => x + 1)}
                >
                  重新加载
                </Button>
              }
            >
              <Tabs
                activeKey={view}
                onChange={(key) => {
                  setView(key);
                  setPage(1);
                }}
                items={[
                  { key: 'all', label: '全部公司' },
                  { key: 'favorites', label: '我的收藏' },
                ]}
              />
              <Space className="list-mode">
                <Segmented
                  value={mode}
                  options={[
                    { label: 'Annual', value: 'annual' },
                    { label: 'Quarterly', value: 'quarterly' },
                  ]}
                  onChange={(value) => {
                    setMode(value as FinancialMode);
                    setPage(1);
                  }}
                />
                <Typography.Text type="secondary">
                  金额：百万美元 · 尚未获取或缺失的数据为 —
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
                    <Button onClick={() => setRevision((x) => x + 1)}>
                      重试
                    </Button>
                  }
                />
              )}
              <Table<ResearchCompany>
                rowKey="ticker"
                columns={columns}
                dataSource={list?.data ?? []}
                loading={loading}
                scroll={{ x: 1900 }}
                locale={{
                  emptyText:
                    view === 'favorites'
                      ? '暂无收藏公司，请先在全部公司中收藏'
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
        )}
      </Layout.Content>
      <Layout.Footer className="app-footer">
        数据来源：SEC EDGAR · 财务缓存按 CIK 关联，同一公司的多个 Ticker
        共享缓存和收藏状态
      </Layout.Footer>
    </Layout>
  );
}
