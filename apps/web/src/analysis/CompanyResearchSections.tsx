import { Alert, Button, Card, Descriptions, Segmented, Typography } from 'antd';
import type { CompanyDetail, FinancialMode } from '@company-research/shared';
import { AnalysisPlaceholder, FinancialAnalysis } from './FinancialAnalysis.js';

export function CompanyResearchSections({
  detail,
  mode,
  saving,
  onFavorite,
  onModeChange,
  onReload,
}: {
  detail: CompanyDetail;
  mode: FinancialMode;
  saving: boolean;
  onFavorite: () => void;
  onModeChange: (mode: FinancialMode) => void;
  onReload: () => void;
}) {
  return (
    <>
      <Card
        title="公司基本信息"
        extra={
          <Button loading={saving} onClick={onFavorite}>
            {detail.isFavorite ? '取消收藏' : '收藏公司'}
          </Button>
        }
      >
        <Descriptions
          column={{ xs: 1, sm: 2, lg: 3 }}
          items={[
            {
              key: 'name',
              label: '公司名称',
              children: detail.name ?? detail.ticker,
            },
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
        <div className="analysis-mode-controls">
          <Segmented
            aria-label="财务报告期间口径"
            value={mode}
            options={[
              { label: 'Annual', value: 'annual' },
              { label: 'Quarterly', value: 'quarterly' },
            ]}
            onChange={(value) => onModeChange(value as FinancialMode)}
          />
          <Typography.Text type="secondary">
            {mode === 'annual' ? '最近 10 个完整财年' : '最近 10 个独立季度'} ·
            以下四个模块同步切换
          </Typography.Text>
        </div>
        {detail.financialStatus === 'FETCHING' && (
          <Alert
            type="info"
            title="该公司数据正在获取中"
            description="另一个请求正在获取数据，请稍后重新加载。"
            action={<Button onClick={onReload}>重新加载</Button>}
          />
        )}
      </Card>
      <AnalysisPlaceholder title="业务概览 · Business" />
      <FinancialAnalysis detail={detail} mode={mode} />
      <AnalysisPlaceholder title="管理层与风险 · Management & Risks" />
      <AnalysisPlaceholder title="估值分析 · Valuation" />
    </>
  );
}
