import {
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Tooltip,
  Typography,
} from 'antd';
import type {
  AllocationSource,
  AllocationValue,
  CompanyDetail,
  FinancialPeriod,
} from '@company-research/shared';
import { Chart } from './FinancialAnalysis.js';
import { ShareholderReturnsChart } from './ShareholderReturnsChart.js';
import type { CachedResearch } from '../AiResearch.js';
import {
  CapitalSource,
  CapitalNotes,
  AcquisitionList,
  capitalInformation,
} from './CapitalAllocationResearch.js';
import {
  METRICS,
  formatAnalysisValue,
  type MetricUnit,
} from './financial-analysis.js';

export function managementPeriods(
  detail: Pick<CompanyDetail, 'annual'>,
): FinancialPeriod[] {
  return [...detail.annual]
    .filter((row) => {
      const days =
        (Date.parse(row.periodEnd) - Date.parse(row.periodStart)) / 86400000 +
        1;
      return (
        row.fiscalQuarter === null &&
        days >= 330 &&
        days <= 400 &&
        Date.parse(row.periodEnd) < Date.now()
      );
    })
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
    .slice(0, 10);
}
interface Item {
  key: string;
  label: string;
  value: number | null;
  unit: MetricUnit;
  description: string;
  reason?: string | null;
  sources?: AllocationSource[];
}
function AllocationCards({
  items,
  columns = 4,
}: {
  items: Item[];
  columns?: 3 | 4;
}) {
  return (
    <Row gutter={[16, 16]}>
      {items.map((item) => (
        <Col xs={24} sm={12} xl={columns === 3 ? 8 : 6} key={item.key}>
          <Card
            size="small"
            className="analysis-metric-card"
            data-metric={item.key}
          >
            <Statistic
              title={
                <Tooltip
                  title={
                    <Space orientation="vertical" size={4}>
                      <span>{item.description}</span>
                      {item.sources?.map((s, index) => (
                        <span key={`${s.accessionNumber}-${index}`}>
                          {s.concept} · {s.start ? `${s.start} 至 ` : ''}
                          {s.end} · 申报：{s.filed} ·{' '}
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            SEC原文
                          </a>
                        </span>
                      ))}
                    </Space>
                  }
                >
                  <span className="analysis-metric-title">
                    {item.label}
                    <span className="metric-help">ⓘ</span>
                  </span>
                </Tooltip>
              }
              value={item.value ?? '—'}
              formatter={() => formatAnalysisValue(item.value, item.unit)}
            />
            <Typography.Text type="secondary" className="metric-unit">
              {item.unit === 'money'
                ? '百万美元'
                : item.unit === 'shares'
                  ? '百万股'
                  : item.unit === 'perShare'
                    ? '美元 / 股'
                    : '百分比'}
            </Typography.Text>
            {item.reason && (
              <div>
                <Typography.Text type="secondary">
                  {item.reason}
                </Typography.Text>
              </div>
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
}
export function ManagementAnalysis({
  detail,
  research,
  updating = false,
}: {
  detail: Pick<CompanyDetail, 'annual'>;
  research?: CachedResearch;
  updating?: boolean;
}) {
  const rows = managementPeriods(detail),
    latest = rows[0],
    allocation = latest?.capitalAllocation;
  const unknown = (reason: string): AllocationValue => ({
    value: null,
    reason,
    sources: [],
  });
  const unavailable = latest
    ? '接口未返回资本配置来源，请检查后端版本'
    : '暂无完整年度财务数据';
  const paid = allocation?.dividendsPaid ?? unknown(unavailable);
  const payout = allocation?.payoutRatio ?? unknown(unavailable);
  const shares = allocation?.sharesOutstanding ?? unknown(unavailable);
  const buyback = allocation?.buybackToFcf ?? unknown(unavailable);
  const period = latest
    ? `${latest.fiscalYear ?? ''} 财年 · ${latest.periodStart} 至 ${latest.periodEnd}`
    : '暂无完整年度财务数据';
  const reinvestment = allocation?.reinvestment;
  const { info } = capitalInformation(research);
  return (
    <Space orientation="vertical" size={24} className="full-width">
      <section data-analysis-module="dividends">
        <Card className="analysis-module" title="Dividends · 股息分红">
          <Typography.Paragraph className="analysis-period">
            {period}
          </Typography.Paragraph>
          {!rows.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无年度财务数据"
            />
          )}
          <Space orientation="vertical" size={24} className="full-width">
            <AllocationCards
              items={[
                {
                  key: 'dividendsPerShare',
                  label: 'DPS · 每股股息',
                  value: latest?.dividendsPerShare ?? null,
                  sources: allocation?.references.dividendsPerShare,
                  unit: 'perShare',
                  description: METRICS.dividendsPerShare.description,
                },
                {
                  key: 'dpsGrowth',
                  label: 'DPS YoY · 每股股息同比',
                  value: latest?.dpsGrowth ?? null,
                  sources: allocation?.references.dpsGrowth,
                  unit: 'percent',
                  description: METRICS.dpsGrowth.description,
                },
                {
                  key: 'dividendsPaid',
                  label: 'Cash Dividends Paid · 现金分红',
                  ...paid,
                  unit: 'money',
                  description: METRICS.dividendsPaid.description,
                  reason:
                    paid.reason ??
                    (allocation?.dividendsPaid.scope === 'total'
                      ? 'SEC总股息支付额，非普通股专属口径'
                      : '普通股现金分红'),
                },
                {
                  key: 'payoutRatio',
                  label: 'Dividend Payout Ratio · 股息支付率',
                  ...payout,
                  unit: 'percent',
                  description:
                    '同一完整财年普通股现金分红 ÷ 普通股股东可得净利润 × 100%。归属未核准或净利润不大于零时不计算。',
                },
              ]}
            />
            <Chart
              title="Dividends Per Share Trend · 每股股息趋势（美元/股）"
              rows={rows}
              mode="annual"
              unit="perShare"
              series={[
                {
                  key: 'dividendsPerShare',
                  label: 'Declared DPS',
                  color: '#1677ff',
                },
              ]}
            />
          </Space>
        </Card>
      </section>
      <section data-analysis-module="repurchases">
        <Card className="analysis-module" title="Share Repurchases · 股票回购">
          <Typography.Paragraph className="analysis-period">
            {period}
          </Typography.Paragraph>
          <Space orientation="vertical" size={24} className="full-width">
            <AllocationCards
              items={[
                {
                  key: 'stockRepurchases',
                  label: 'Stock Repurchases · 股票回购金额',
                  value: latest?.stockRepurchases ?? null,
                  sources: allocation?.references.stockRepurchases,
                  unit: 'money',
                  description: METRICS.stockRepurchases.description,
                },
                {
                  key: 'dilutedSharesGrowth',
                  label: 'Diluted Shares YoY · 稀释股数同比',
                  value: latest?.dilutedSharesGrowth ?? null,
                  sources: allocation?.references.dilutedSharesGrowth,
                  unit: 'percent',
                  description: METRICS.dilutedSharesGrowth.description,
                },
                {
                  key: 'sharesOutstanding',
                  label: 'Shares Outstanding · 期末流通股数',
                  ...shares,
                  unit: 'shares',
                  description:
                    '对应财年末的普通股总量，不是期间稀释加权平均股数；不叠加股份类别明细或封面其他日期股数。',
                },
                {
                  key: 'buybackToFcf',
                  label: 'Buyback / FCF · 回购占自由现金流',
                  ...buyback,
                  unit: 'percent',
                  description:
                    '同一完整财年普通股回购现金支出 ÷ FCF × 100%；FCF = OCF − CapEx，且必须大于零。超过100%不截断。',
                },
              ]}
            />
            <ShareholderReturnsChart rows={rows} mode="annual" />
          </Space>
        </Card>
      </section>
      <section data-analysis-module="reinvestment">
        <Card className="analysis-module" title="Business Investment · 业务投资">
          <Space orientation="vertical" size={24} className="full-width">
            <Typography.Text type="secondary">{period}</Typography.Text>
            <AllocationCards
              columns={3}
              items={[
                {
                  key: 'capex',
                  label: 'CapEx · 资本支出',
                  ...(reinvestment?.capex ?? unknown('缺少可靠年度CapEx')),
                  unit: 'money',
                  description:
                    'SEC已披露的年度购建固定资产现金支出，不等于维持性CapEx。',
                },
                {
                  key: 'capexToOcf',
                  label: 'CapEx / OCF',
                  ...(reinvestment?.capexToOcf ??
                    unknown('缺少同财年CapEx及OCF')),
                  unit: 'percent',
                  description: '完整财年CapEx ÷ OCF × 100%，OCF必须大于零。',
                },
                {
                  key: 'capexToRevenue',
                  label: 'CapEx / Revenue',
                  ...(reinvestment?.capexToRevenue ??
                    unknown('缺少同财年CapEx及Revenue')),
                  unit: 'percent',
                  description:
                    '完整财年CapEx ÷ Revenue × 100%，Revenue必须大于零。',
                },
              ]}
            />
            <Chart
              title="CapEx Trend · 资本支出趋势（百万美元）"
              rows={rows.map((r) => ({
                ...r,
                capex: r.capitalAllocation?.reinvestment?.capex.value ?? null,
              }))}
              mode="annual"
              series={[{ key: 'capex', label: 'CapEx', color: '#1677ff' }]}
              moneyDivisor={1e6}
              moneyUnit="百万美元"
            />
            <CapitalSource research={research} updating={updating} />
            <CapitalNotes
              research={research}
              groups={[
                {
                  key: 'investmentAreas',
                  title: '主要投资方向与项目',
                  notes: info?.reinvestment.investmentAreas ?? [],
                },
                {
                  key: 'investmentPurposes',
                  title: '投资目的',
                  notes: info?.reinvestment.investmentPurposes ?? [],
                },
                {
                  key: 'investmentPlans',
                  title: '未来投资计划',
                  notes: info?.reinvestment.investmentPlans ?? [],
                },
                {
                  key: 'investmentRisks',
                  title: '投资相关风险',
                  notes: info?.reinvestment.investmentRisks ?? [],
                },
              ]}
            />
          </Space>
        </Card>
      </section>
      <section data-analysis-module="acquisitions">
        <Card className="analysis-module" title="Acquisitions · 企业收购">
          <Space orientation="vertical" size={16} className="full-width">
            <CapitalSource research={research} updating={updating} />
            <AcquisitionList research={research} />
          </Space>
        </Card>
      </section>
      <section data-analysis-module="financing">
        <Card className="analysis-module" title="Debt & Financing · 债务与融资">
          <Space orientation="vertical" size={16} className="full-width">
            <CapitalSource research={research} updating={updating} />
            <CapitalNotes
              research={research}
              groups={[
                {
                  key: 'financingActivities',
                  title: '重大融资行为',
                  notes: info?.debtAndFinancing.financingActivities ?? [],
                },
                {
                  key: 'financingPurposes',
                  title: '融资资金用途',
                  notes: info?.debtAndFinancing.financingPurposes ?? [],
                },
                {
                  key: 'financingTerms',
                  title: '重要融资条款',
                  notes: info?.debtAndFinancing.financingTerms ?? [],
                },
                {
                  key: 'financingRisks',
                  title: '融资风险',
                  notes: info?.debtAndFinancing.financingRisks ?? [],
                },
              ]}
            />
            <Typography.Text type="secondary">
              债务发行与偿还现金流指标尚未接入，后续核实SEC数据后补充。
            </Typography.Text>
          </Space>
        </Card>
      </section>
    </Space>
  );
}
