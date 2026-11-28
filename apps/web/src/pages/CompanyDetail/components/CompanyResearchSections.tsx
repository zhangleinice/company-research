import { useState } from 'react';
import { IntrinsicValuation } from '../Valuation/index.js';
import { useCachedResearch } from '../hooks/useCachedResearch.js';
import { ResearchCard } from '../BusinessModel/index.js';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Space,
  Popconfirm,
  Tabs,
} from 'antd';
import type { CompanyDetail, FinancialMode } from '@company-research/shared';
import { CompanyQualityContent } from '../EnterpriseQuality/index.js';
import { InvestorRelationsLink } from './InvestorRelationsLink.js';
import { ManagementAnalysis } from '../Management/index.js';

export function CompanyResearchSections({
  detail,
  investorWebsite = null,
  mode,
  saving,
  onFavorite,
  onModeChange,
  onUpdate,
  updating = false,
  revision = 0,
}: {
  detail: CompanyDetail;
  investorWebsite?: string | null;
  mode: FinancialMode;
  saving: boolean;
  onFavorite: () => void;
  onModeChange: (mode: FinancialMode) => void;
  onReload: () => void;
  onUpdate?: () => void;
  updating?: boolean;
  revision?: number;
}) {
  const [activeTab, setActiveTab] = useState('business');
  const managementResearch = useCachedResearch(
    detail.cik,
    'management',
    revision,
  );
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
              key: 'investorWebsite',
              label: '投资者关系',
              children: <InvestorRelationsLink url={investorWebsite} />,
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
          />
        )}
      </Card>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        destroyOnHidden={false}
        items={[
          {
            key: 'business',
            label: '商业模式',
            children: (
              <ResearchCard
                cik={detail.cik}
                kind="business"
                revision={revision}
                updating={updating}
              />
            ),
          },
          {
            key: 'quality',
            label: '企业质量',
            children: (
              <CompanyQualityContent
                detail={detail}
                mode={mode}
                onModeChange={onModeChange}
                revision={revision}
              />
            ),
          },
          {
            key: 'management',
            label: '管理层',
            children: (
              <ManagementAnalysis
                detail={detail}
                research={managementResearch}
                updating={updating}
              />
            ),
          },
          {
            key: 'intrinsic',
            label: '内在价值',
            children: (
              <IntrinsicValuation
                key={detail.cik}
                ticker={detail.ticker}
                revision={revision}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}
