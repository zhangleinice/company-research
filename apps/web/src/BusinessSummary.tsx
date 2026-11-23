import { Card, Space, Tag, Typography } from 'antd';
import {
  BUSINESS_MODEL_TOPICS,
  BUSINESS_MODEL_PROMPT_VERSION,
  type AiResearchSummary,
} from '@company-research/shared';
type Summary = AiResearchSummary['summaryJson'];
const topics = BUSINESS_MODEL_TOPICS;
const legacyTopics = ['公司主要业务', '主要业务板块', '增长机会'];
export function BusinessSummary({
  summary,
  promptVersion,
}: {
  summary: Summary;
  promptVersion?: string;
}) {
  const threeQuestions =
    summary.groups.length === topics.length &&
    topics.every((topic, i) => summary.groups[i].topic === topic);
  const legacy =
    !threeQuestions ||
    (promptVersion !== undefined &&
      promptVersion !== BUSINESS_MODEL_PROMPT_VERSION);
  return (
    <Space orientation="vertical" size={20} className="full-width">
      {legacy && (
        <Typography.Text type="secondary">
          正在展示旧版缓存，已按三问题兼容展示，内容未重新生成；竞争优势栏目不在本Tab展示。用户主动「更新数据」后才生成新版，可能产生API费用。
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
                    <Typography.Paragraph>
                      {index === 0 && finding.businessName && (
                        <Typography.Text strong>
                          {finding.businessName}：
                        </Typography.Text>
                      )}
                      {finding.text}
                    </Typography.Paragraph>
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
