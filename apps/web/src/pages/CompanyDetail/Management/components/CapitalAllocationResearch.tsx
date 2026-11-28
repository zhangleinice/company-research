import { Collapse, Space, Tag, Typography } from 'antd';
import type { CapitalNote } from '@company-research/shared';
import type { CachedResearch } from '../../hooks/useCachedResearch.js';

export function capitalInformation(research?: CachedResearch) {
  const summary = research?.state?.summary;
  const info = summary?.summaryJson.capitalAllocation;
  const source = info?.source;
  const valid =
    !!source &&
    typeof source.cik === 'string' &&
    source.cik.length === 10 &&
    source.item === 'Item 7' &&
    source.accessionNumber === summary?.accessionNumber &&
    source.sourceUrl === summary?.sourceUrl;
  return { summary, info: valid ? info : undefined };
}
export function CapitalSource({
  research,
  updating = false,
}: {
  research?: CachedResearch;
  updating?: boolean;
}) {
  const { info } = capitalInformation(research);
  const failed = research?.error || research?.state?.status === 'FAILED';
  return (
    <Space orientation="vertical" size={4} className="full-width">
      <Typography.Text type="secondary">
        仅覆盖对应10-K Item 7；交易状态截至该申报披露，不是实时状态。
      </Typography.Text>
      {info?.source && (
        <Typography.Text type="secondary">
          {info.source.fiscalYear}财年 · 报告期末：{info.source.reportDate} ·
          申报：{info.source.filingDate} ·{' '}
          <a
            href={info.source.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            SEC原文
          </a>
        </Typography.Text>
      )}
      {failed && (
        <Typography.Text type="secondary">
          {info
            ? '本次提取失败，继续展示上一次成功结果。'
            : '提取失败，尚无可展示的资本配置结果。'}
        </Typography.Text>
      )}
      {updating && (
        <Typography.Text type="secondary">
          正在更新，继续展示已有缓存。
        </Typography.Text>
      )}
      {info?.coverage === 'partial' && (
        <Typography.Text type="secondary">
          输入覆盖不足：{info.coverageReason}
        </Typography.Text>
      )}
      {!info && !failed && (
        <Typography.Text type="secondary">
          {research?.state === null
            ? '正在读取资本配置缓存…'
            : '现有缓存尚无有效资本配置结构化信息；主动更新后生成，可能产生AI费用。'}
        </Typography.Text>
      )}
    </Space>
  );
}
const kinds = {
  fact: '已披露事实',
  plan: '管理层计划／预期',
  risk: '风险提示',
};
const activities = {
  actualFinancing: '实际融资／偿还',
  creditFacility: '授信额度',
  commercialPaperProgram: '商业票据计划',
  debtBalance: '期末债务余额',
  plan: '融资计划',
  other: '其他披露',
};
function renderNote(n: CapitalNote, i: number) {
  return (
    <Typography.Paragraph key={i}>
      <Tag>{kinds[n.kind]}</Tag>
      {n.activityType && <Tag>{activities[n.activityType]}</Tag>}
      {n.text}
    </Typography.Paragraph>
  );
}
export function CapitalNotes({
  groups,
  research,
  investmentDetailsOpen = false,
}: {
  investmentDetailsOpen?: boolean;
  groups: { title: string; key: string; notes: CapitalNote[] }[];
  research?: CachedResearch;
}) {
  const { info } = capitalInformation(research);
  return (
    <Space orientation="vertical" size={16} className="full-width">
      {groups.map((g) => (
        <section key={g.key}>
          <Typography.Title level={5}>{g.title}</Typography.Title>
          {!info || !g.notes.length ? (
            <Typography.Text type="secondary">
              {info ? '本期 Item 7 暂无可展示的重要披露。' : '—'}
            </Typography.Text>
          ) : (
            <>
              {g.notes
                .slice(0, g.key === 'investmentAreas' ? 3 : undefined)
                .map(renderNote)}
              {g.key === 'investmentAreas' && g.notes.length > 3 && (
                <Collapse
                  defaultActiveKey={investmentDetailsOpen ? ['more'] : []}
                  items={[
                    {
                      key: 'more',
                      label: `展开其余投资信息（${g.notes.length - 3}条）`,
                      children: g.notes.slice(3).map(renderNote),
                    },
                  ]}
                />
              )}
            </>
          )}
        </section>
      ))}
    </Space>
  );
}
