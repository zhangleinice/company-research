import { ResearchCard } from '../AiResearch.js';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Segmented,
  Typography,
  Space,
  Popconfirm,
} from 'antd';
import type { CompanyDetail, FinancialMode } from '@company-research/shared';
import { AnalysisPlaceholder, FinancialAnalysis } from './FinancialAnalysis.js';

export function CompanyResearchSections({
  detail,
  mode,
  saving,
  onFavorite,
  onModeChange,
  onUpdate,
  updating = false,
  revision = 0,
}: {
  detail: CompanyDetail;
  mode: FinancialMode;
  saving: boolean;
  onFavorite: () => void;
  onModeChange: (mode: FinancialMode) => void;
  onReload: () => void;
  onUpdate?: () => void;
  updating?: boolean;
  revision?: number;
}) {
  return (
    <Space orientation="vertical" size={24} className="full-width">
      <Card
        title="公司基本信息"
        extra={
          <Space>
            <Button loading={saving} onClick={onFavorite}>
              {detail.isFavorite ? '取消收藏' : '收藏公司'}
            </Button>
            <Popconfirm
              title="更新数据"
              description="将重新获取 SEC 财务数据和最新年报，并重新生成两个 AI 摘要，可能产生 API 费用。是否继续？"
              onConfirm={onUpdate}
              disabled={updating}
            >
              <Button type="primary" loading={updating} disabled={updating}>
                更新数据
              </Button>
            </Popconfirm>
          </Space>
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
            以下五个财务模块同步切换
          </Typography.Text>
        </div>
        {detail.financialStatus === 'FETCHING' && (
          <Alert
            type="info"
            title="该公司数据正在获取中"
            description="另一个请求正在获取数据，请稍后重新加载。"
          />
        )}
      </Card>
      <ResearchCard
        cik={detail.cik}
        kind="business"
        revision={revision}
        updating={updating}
      />
      <FinancialAnalysis detail={detail} mode={mode} />
      <ResearchCard
        cik={detail.cik}
        kind="management"
        revision={revision}
        updating={updating}
      />
      <AnalysisPlaceholder title="估值分析 · Valuation" />
    </Space>
  );
}
