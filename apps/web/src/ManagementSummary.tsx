import { Space, Tag, Typography } from 'antd';
import type { AiResearchSummary } from '@company-research/shared';

type Summary = AiResearchSummary['summaryJson'];
const sections = [
  { title: '经营表现与变化原因', legacy: ['经营表现及原因'] },
  { title: '资金使用与重大决策', legacy: ['资本开支', '现金流与融资'] },
  { title: '未来经营重点与趋势', legacy: ['未来经营重点'] },
  { title: '重大风险', legacy: ['主要风险'] },
];

export function ManagementSummary({ summary }: { summary: Summary }) {
  const legacy = !summary.groups.some((g) => g.topic === sections[0].title);
  return (
    <Space orientation="vertical" size={20} className="full-width">
      {summary.itemSources?.some((s) => s.legacy) && (
        <Typography.Text type="secondary">
          部分内容使用旧版混合摘要缓存；下次手动更新后按章节独立生成。
        </Typography.Text>
      )}
      {summary.itemSources && (
        <Space wrap>
          {summary.itemSources.map((s) => (
            <Typography.Link
              key={s.item}
              title={`生成：${s.generatedAt} · ${s.legacy ? '旧版混合缓存' : '独立章节缓存'}`}
              href={s.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {s.item} · {s.fiscalYear} 财年 · 申报：{s.filingDate}
              {s.legacy ? '（旧缓存）' : ''}
            </Typography.Link>
          ))}
        </Space>
      )}
      {legacy && (
        <Typography.Text type="secondary">
          旧摘要已按新栏目整理；新版内容将在下次手动更新后生成。
        </Typography.Text>
      )}
      {sections.map(({ title, legacy: previous }, index) => {
        const current = summary.groups.find((g) => g.topic === title);
        const findings = current
          ? current.findings
          : previous.flatMap(
              (topic) =>
                summary.groups.find((g) => g.topic === topic)?.findings ?? [],
            );
        return (
          <section key={title}>
            <Typography.Title level={5}>
              {index + 1}. {title}
            </Typography.Title>
            {!findings.length && (
              <Typography.Text type="secondary">
                {summary.unavailableItems?.includes(
                  index === 3 ? 'Item 1A' : 'Item 7',
                )
                  ? '该章节尚无有效缓存，请在需要时主动更新。'
                  : '未找到充分的相关披露'}
              </Typography.Text>
            )}
            {findings.map((finding, i) => (
              <Typography.Paragraph key={i}>
                {finding.kind !== '公司披露的事实' && (
                  <Tag>
                    {finding.kind === '管理层观点' ? '管理层观点' : '分析判断'}
                  </Tag>
                )}
                {finding.riskType && (
                  <Typography.Text strong>{finding.riskType}：</Typography.Text>
                )}
                {finding.text}
                {finding.impact && ` 可能影响：${finding.impact}`}{' '}
                <Typography.Text
                  type="secondary"
                  title={finding.evidence
                    .map((e) => `${e.paragraphId}: ${e.quote}`)
                    .join('\n')}
                >
                  〔
                  {[
                    ...new Set(
                      finding.evidence.map((e) => e.paragraphId.split(':')[0]),
                    ),
                  ].join('、')}
                  〕
                </Typography.Text>
              </Typography.Paragraph>
            ))}
          </section>
        );
      })}
    </Space>
  );
}
