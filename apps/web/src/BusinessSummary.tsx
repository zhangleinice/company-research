import { Card, Space, Tag, Typography } from 'antd';
import type { AiResearchSummary } from '@company-research/shared';
type Summary = AiResearchSummary['summaryJson'];
const topics = [
  '公司做什么？',
  '公司怎么赚钱？',
  '公司有什么竞争优势？',
  '未来有哪些增长机会？',
];
const legacyTopics = ['公司主要业务', '主要业务板块', '竞争优势', '增长机会'];
export function BusinessSummary({ summary }: { summary: Summary }) {
  const legacy = !summary.groups.some((g) => g.topic === topics[0]);
  return (
    <Space orientation="vertical" size={20} className="full-width">
      {legacy && (
        <Typography.Text type="secondary">
          正在展示旧版缓存，尚未生成新版商业模式介绍；使用「更新数据」可重新生成，可能产生
          API 费用。
        </Typography.Text>
      )}
      {topics.map((topic, index) => {
        const group = summary.groups.find(
          (g) => g.topic === topic || g.topic === legacyTopics[index],
        );
        return (
          <section key={topic}>
            <Typography.Title level={5}>
              {index + 1}. {topic}
            </Typography.Title>
            {!group?.findings.length && (
              <Typography.Text type="secondary">
                未找到充分的相关披露
              </Typography.Text>
            )}
            {group?.findings.map((finding, i) => {
              const content = (
                <>
                  {finding.kind !== '公司披露的事实' && (
                    <Tag>
                      {finding.kind === '管理层观点' ? '公司主张' : '分析判断'}
                    </Tag>
                  )}
                  {index === 1 && finding.businessName ? (
                    <>
                      <Typography.Paragraph>
                        <Typography.Text strong>做什么：</Typography.Text>
                        {finding.offering}
                      </Typography.Paragraph>
                      <Typography.Paragraph>
                        <Typography.Text strong>怎么赚钱：</Typography.Text>
                        {finding.monetization}
                      </Typography.Paragraph>
                    </>
                  ) : (
                    <Typography.Paragraph>{finding.text}</Typography.Paragraph>
                  )}
                  <Typography.Text
                    type="secondary"
                    title={finding.evidence.map((e) => e.quote).join('\n')}
                  >
                    〔
                    {[
                      ...new Set(
                        finding.evidence.map(
                          (e) => e.paragraphId.split(':')[0],
                        ),
                      ),
                    ].join('、')}
                    〕
                  </Typography.Text>
                </>
              );
              return index === 1 && finding.businessName ? (
                <Card
                  key={i}
                  size="small"
                  title={finding.businessName}
                  className="analysis-note"
                >
                  {content}
                </Card>
              ) : (
                <div key={i}>{content}</div>
              );
            })}
          </section>
        );
      })}
    </Space>
  );
}
