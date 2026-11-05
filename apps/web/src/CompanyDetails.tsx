import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Collapse,
  Select,
  Segmented,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import {
  FINANCIAL_METRICS,
  type CompanyDetail,
  type FinancialMode,
} from '@company-research/shared';
import { fetchCompanyDetail, setCompanyFavorite } from './api';
import {
  amount,
  number,
  percent,
  financialColumns,
  periodLabel,
} from './financial-columns';
import { GrowthChart } from './GrowthChart';

export function CompanyDetails({
  identifier,
  onBack,
}: {
  identifier: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<FinancialMode>('annual');
  const [saving, setSaving] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setDetail(null);
    fetchCompanyDetail(identifier, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setDetail(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '公司数据获取失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [identifier, revision]);
  const rows = detail
    ? mode === 'annual'
      ? detail.annual
      : detail.quarterly
    : [];
  const selectedRow =
    rows.find((row) => row.periodEnd === selectedPeriod) ?? rows[0];
  const formatMetric = (
    key: (typeof FINANCIAL_METRICS)[number],
    value: number | null,
  ) =>
    /growth|margin|cagr|^roe$|^roa$|sharesChange/i.test(key)
      ? percent(value)
      : [
            'eps',
            'sharesOutstanding',
            'bookValuePerShare',
            'debtToEquity',
            'currentRatio',
          ].includes(key)
        ? number(value)
        : amount(value);

  async function favorite() {
    if (!detail) return;
    setSaving(true);
    try {
      await setCompanyFavorite(detail.cik, !detail.isFavorite);
      setDetail({ ...detail, isFavorite: !detail.isFavorite });
    } catch (error) {
      setError(error instanceof Error ? error.message : '收藏失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Space orientation="vertical" size={24} className="full-width">
      <Space wrap>
        <Button onClick={onBack}>← 返回公司列表</Button>
        <Typography.Title level={3} className="detail-title">
          {detail?.name ?? identifier}
        </Typography.Title>
      </Space>
      {error && (
        <Alert
          type="error"
          showIcon
          title="操作未完成"
          description={error}
          action={
            <Button onClick={() => setRevision((x) => x + 1)}>重试获取</Button>
          }
        />
      )}
      {loading && (
        <Card>
          <Space>
            <Spin />
            <Typography.Text>
              正在读取公司数据；首次访问需要从 SEC 获取并保存财务数据…
            </Typography.Text>
          </Space>
        </Card>
      )}
      {detail && (
        <>
          <Card
            title="公司基本信息"
            extra={
              <Button loading={saving} onClick={favorite}>
                {detail.isFavorite ? '取消收藏' : '收藏公司'}
              </Button>
            }
          >
            <Descriptions
              column={{ xs: 1, sm: 2, lg: 3 }}
              items={[
                { key: 'ticker', label: 'Ticker', children: detail.ticker },
                { key: 'cik', label: 'CIK', children: detail.cik },
                {
                  key: 'industry',
                  label: '行业',
                  children: detail.industry ?? '—',
                },
                {
                  key: 'updated',
                  label: '财务数据更新时间',
                  children: detail.lastFetchedAt
                    ? new Date(detail.lastFetchedAt).toLocaleString('zh-CN')
                    : '—',
                },
              ]}
            />
            {detail.financialStatus === 'FETCHING' && (
              <Alert
                type="info"
                title="该公司数据正在获取中"
                description="另一个请求正在获取数据，请稍后重新加载。"
                action={
                  <Button onClick={() => setRevision((x) => x + 1)}>
                    重新加载
                  </Button>
                }
              />
            )}
          </Card>
          <Card
            title="财务数据"
            extra={
              <Segmented
                value={mode}
                options={[
                  { label: 'Annual', value: 'annual' },
                  { label: 'Quarterly', value: 'quarterly' },
                ]}
                onChange={(value) => setMode(value as FinancialMode)}
              />
            }
          >
            <Typography.Paragraph type="secondary">
              最近 {mode === 'annual' ? '10 个完整财年' : '10 个独立季度'}
              ；金额单位为百万美元，EPS 与每股指标为美元。缺失字段显示 —。
            </Typography.Paragraph>
            <Table
              rowKey="periodEnd"
              columns={financialColumns(mode)}
              dataSource={rows}
              pagination={false}
              scroll={{ x: mode === 'annual' ? 2200 : 1500 }}
            />
            {selectedRow && (
              <Collapse
                className="metric-details"
                items={[
                  {
                    key: 'metrics',
                    label: '查看选定期间的全部原始指标与计算指标',
                    children: (
                      <>
                        <Select
                          aria-label="选择指标明细期间"
                          className="period-select"
                          value={selectedRow.periodEnd}
                          onChange={setSelectedPeriod}
                          options={rows.map((row) => ({
                            value: row.periodEnd,
                            label: `${periodLabel(row, mode)} · ${row.periodEnd}`,
                          }))}
                        />
                        <Descriptions
                          bordered
                          size="small"
                          column={{ xs: 1, sm: 2, lg: 3 }}
                          items={FINANCIAL_METRICS.map((key) => ({
                            key,
                            label: key,
                            children: formatMetric(key, selectedRow[key]),
                          }))}
                        />
                      </>
                    ),
                  },
                ]}
              />
            )}
          </Card>
          <Card title="财务增长趋势">
            <GrowthChart rows={rows} mode={mode} />
          </Card>
        </>
      )}
    </Space>
  );
}
