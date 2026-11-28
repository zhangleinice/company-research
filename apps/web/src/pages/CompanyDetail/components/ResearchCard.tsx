import type { ReactNode } from 'react';
import { Alert, Card, Space, Spin, Typography } from 'antd';
import type { AiResearchKind, AiResearchState } from '@company-research/shared';
import {
  useCachedResearch,
  type CachedResearch,
} from '../hooks/useCachedResearch.js';
export function ResearchCard({
  cik,
  kind,
  revision = 0,
  updating = false,
  research,
  renderSummary,
}: {
  cik: string;
  kind: AiResearchKind;
  revision?: number;
  updating?: boolean;
  research?: CachedResearch;
  renderSummary: (
    summary: NonNullable<AiResearchState['summary']>,
  ) => ReactNode;
}) {
  const own = useCachedResearch(cik, kind, revision, research === undefined);
  const { state, error } = research ?? own;
  const summary = state?.summary;
  return (
    <Card
      className="ai-research-card"
      title={
        kind === 'business'
          ? 'Business · 业务概述'
          : 'Management & Risks · 管理层与风险'
      }
    >
      <Space orientation="vertical" size={16} className="full-width">
        {(error || state?.error) && (
          <Alert
            type="warning"
            showIcon
            title="AI 摘要未更新"
            description={error || state?.error}
          />
        )}
        {updating && (
          <Typography.Text type="secondary">
            正在更新；已有摘要继续展示，财年及申报版本以以下信息为准。
          </Typography.Text>
        )}
        {!state && !error && <Spin size="small" />}
        {state && !summary && (
          <Typography.Text type="secondary">
            {updating
              ? '正在首次生成 AI 总结…'
              : '尚无有效摘要，可使用顶部「更新数据」入口。'}
          </Typography.Text>
        )}
        {summary && (
          <>
            <Space wrap separator="·">
              <Typography.Text>
                {summary.fiscalYear} 财年 · 10-K
              </Typography.Text>
              <Typography.Text>
                申报日期：{summary.filingDate} · 生成时间：
                {new Date(summary.updatedAt).toLocaleDateString('sv-SE')}
              </Typography.Text>
              <Typography.Link
                href={summary.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                SEC 原始年报
              </Typography.Link>
            </Space>
            {renderSummary(summary)}
          </>
        )}
      </Space>
    </Card>
  );
}
