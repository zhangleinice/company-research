import { useEffect, useState } from 'react';
import { Alert, Card, Space, Spin, Tag, Typography } from 'antd';
import type { AiResearchKind, AiResearchState } from '@company-research/shared';
import { fetchAiResearch } from './api.js';

export function ResearchCard({
  cik,
  kind,
  revision = 0,
  updating = false,
}: {
  cik: string;
  kind: AiResearchKind;
  revision?: number;
  updating?: boolean;
}) {
  const [state, setState] = useState<AiResearchState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetchAiResearch(cik, kind, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '摘要缓存读取失败');
      });
    return () => controller.abort();
  }, [cik, kind, revision]);
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
            <Space wrap split="·">
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
            {summary.summaryJson.groups.map((g, i) => (
              <section key={g.topic}>
                <Typography.Title level={5}>
                  {i + 1}. {g.topic}
                </Typography.Title>
                {!g.findings.length && (
                  <Typography.Text type="secondary">
                    未找到相关披露
                  </Typography.Text>
                )}
                {g.findings.map((f, j) => (
                  <Typography.Paragraph key={j}>
                    <Tag>{f.kind}</Tag>
                    {f.text}{' '}
                    <Typography.Text type="secondary">
                      〔
                      {[
                        ...new Set(
                          f.evidence.map((e) => e.paragraphId.split(':')[0]),
                        ),
                      ].join('、')}
                      〕
                    </Typography.Text>
                  </Typography.Paragraph>
                ))}
              </section>
            ))}
          </>
        )}
      </Space>
    </Card>
  );
}
