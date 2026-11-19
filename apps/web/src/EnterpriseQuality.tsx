import { useEffect, useState } from 'react';
import { Descriptions, Divider, Spin, Table, Typography } from 'antd';
import type {
  EnterpriseQuality,
  ValuationFact,
} from '@company-research/shared';
import { fetchEnterpriseQuality } from './api.js';

const amount = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : (value / 1e6).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
function Fact({
  fact,
  missing = '数据不足',
}: {
  fact?: ValuationFact;
  missing?: string;
}) {
  if (fact?.value == null)
    return (
      <>
        — <Typography.Text type="secondary">{missing}</Typography.Text>
      </>
    );
  return (
    <span>
      {amount(fact.value)}{' '}
      <Typography.Text type="secondary">
        {fact.start === null
          ? '已获取'
          : fact.items.length === 1
            ? '已获取'
            : '已计算'}
      </Typography.Text>
    </span>
  );
}
export function QualityAnalysis({ data }: { data: EnterpriseQuality }) {
  const income =
    data.commonNetIncome.value !== null ? data.commonNetIncome : data.netIncome;
  const da = data.depreciationAmortization;
  const sourceFacts = [
    income,
    da,
    data.depreciation,
    data.amortization,
    data.ebit,
    data.capex,
    data.taxExpense,
    data.pretaxIncome,
  ];
  const sources = [
    ...new Set(
      sourceFacts.flatMap((f) =>
        f.items
          .map((x) => x.url)
          .filter(
            (url): url is string =>
              typeof url === 'string' && /^https:\/\/www\.sec\.gov\//.test(url),
          ),
      ),
    ),
  ];
  return (
    <div className="quality-analysis">
      <Typography.Paragraph type="secondary" className="dcf-period">
        TTM {data.start ?? '—'} → {data.asOf ?? '—'} · 金额：百万美元 ·
        仅使用已有SEC缓存
      </Typography.Paragraph>
      {data.applicable === false && (
        <Typography.Paragraph type="secondary">
          当前公司不适合直接套用普通经营企业口径，以下仅展示已有输入。
        </Typography.Paragraph>
      )}
      <section>
        <Typography.Title level={5}>股东盈余 · Owner Earnings</Typography.Title>
        <div className="dcf-equation">
          Owner Earnings ≈ Net Income + D&amp;A − Maintenance CapEx − ΔNWC
        </div>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: 'ni',
              label:
                data.commonNetIncome.value !== null
                  ? '普通股可享净利润'
                  : '归母净利润',
              children: <Fact fact={income} />,
            },
            {
              key: 'da',
              label: '折旧与摊销',
              children: <Fact fact={da} missing="完整合计尚未核准" />,
            },
            {
              key: 'maintenance',
              label: '维持性CapEx',
              children: '— 未找到可直接采用的单独披露',
            },
            {
              key: 'nwc',
              label: '经营性ΔNWC',
              children: '— 经营范围及现金流分类未核准',
            },
          ]}
        />
        {da.value === null && (
          <Typography.Paragraph type="secondary" className="dcf-note">
            已有分项：折旧 {amount(data.depreciation.value)}；无形资产摊销{' '}
            {amount(data.amortization.value)}。不自动相加或补零。
          </Typography.Paragraph>
        )}
        <div className="quality-result">
          ≈ {amount(income.value)} + {amount(da.value)} − — − — = —
        </div>
        <Typography.Text type="secondary" className="dcf-note">
          关键输入及归属口径未完整核准，暂不计算；不替代DCF的FCFF。
        </Typography.Text>
      </section>
      <Divider />
      <section>
        <Typography.Title level={5}>投入资本回报率 · ROIC</Typography.Title>
        <div className="dcf-equation">
          ROIC = NOPAT / Average Invested Capital
        </div>
        <div className="dcf-equation">
          NOPAT = EBIT × (1 − T) = {amount(data.ebit.value)} × (1 − —) = —
        </div>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: 'ebit',
              label: 'EBIT（营业利润代理）',
              children: <Fact fact={data.ebit} />,
            },
            {
              key: 'tax',
              label: '历史有效税率',
              children:
                data.historicalTaxRate === null
                  ? '— 税费或税前利润不足'
                  : `${(data.historicalTaxRate * 100).toFixed(2)}% · 已计算，非NOPAT适用税率`,
            },
            {
              key: 'taxexpense',
              label: 'TTM所得税费用',
              children: <Fact fact={data.taxExpense} />,
            },
            {
              key: 'pretax',
              label: 'TTM税前利润',
              children: <Fact fact={data.pretaxIncome} />,
            },
          ]}
        />
        <Table
          size="small"
          pagination={false}
          rowKey="periodEnd"
          scroll={{ x: 560 }}
          dataSource={data.capital}
          locale={{ emptyText: '期初、期末投入资本组成缓存不足' }}
          columns={[
            { title: '报告期末', dataIndex: 'periodEnd' },
            ...(
              [
                ['equity', '股东权益'],
                ['debt', '有息债务'],
                ['cash', '现金'],
                ['securities', '流动可交易证券'],
              ] as const
            ).map(([key, title]) => ({
              title,
              key,
              align: 'right' as const,
              render: (_: unknown, row: EnterpriseQuality['capital'][number]) =>
                amount(row[key].value),
            })),
          ]}
        />
        <div className="quality-result">
          Average Invested Capital = (期初投入资本 + 期末投入资本) / 2 = —
        </div>
        <div className="quality-result">ROIC = — / — = —</div>
        <Typography.Text type="secondary" className="dcf-note">
          税率、经营必需现金、投资、租赁与少数股东范围尚未确定；以上组成项不自动加减为投入资本。
        </Typography.Text>
      </section>
      <Divider />
      <section>
        <Typography.Title level={5}>
          维持性资本支出 · Maintenance CapEx
        </Typography.Title>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 3 }}
          items={[
            {
              key: 'maintenance',
              label: '维持性CapEx',
              children: '— 需要进一步研究或估算',
            },
            {
              key: 'total',
              label: '全部CapEx',
              children: <Fact fact={data.capex} />,
            },
            {
              key: 'growth',
              label: '成长性CapEx',
              children: '— 尚不能可靠区分',
            },
          ]}
        />
        <Typography.Text type="secondary" className="dcf-note">
          全部CapEx仅供参考，不自动替代或按比例拆分维持性CapEx。
        </Typography.Text>
      </section>
      <Divider />
      <Typography.Paragraph>
        <strong>竞争优势（经济商誉）</strong>：— 待研究
      </Typography.Paragraph>
      <Typography.Paragraph>
        <strong>管理层资本配置能力</strong>：— 待研究
      </Typography.Paragraph>
      {sources.length > 0 && (
        <div className="quality-sources">
          <Typography.Text type="secondary">SEC来源：</Typography.Text>
          {sources.map((url, i) => (
            <Typography.Link
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              申报{i + 1} ↗
            </Typography.Link>
          ))}
        </div>
      )}
    </div>
  );
}
export function EnterpriseQualityPanel({ ticker }: { ticker: string }) {
  const [data, setData] = useState<EnterpriseQuality | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    void fetchEnterpriseQuality(ticker, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('已有财务缓存暂不可用，未触发数据更新。');
      });
    return () => controller.abort();
  }, [ticker]);
  return data ? (
    <QualityAnalysis data={data} />
  ) : error ? (
    <Typography.Text type="secondary">{error}</Typography.Text>
  ) : (
    <Spin aria-label="读取企业质量缓存" />
  );
}
