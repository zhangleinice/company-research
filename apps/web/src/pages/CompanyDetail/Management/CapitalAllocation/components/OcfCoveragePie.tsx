import { Pie } from '@ant-design/charts';
import type { CoverageItem } from '../utils/ocf-coverage.js';
import { capitalNodeAmount } from '../utils/capital-sankey-options.js';

export default function OcfCoveragePie({ items }: { items: CoverageItem[] }) {
  const data = items.filter((i) => i.value !== null && i.value > 0);
  return (
    <Pie
      data={data}
      angleField="value"
      colorField="key"
      height={320}
      radius={0.94}
      innerRadius={0.72}
      padding={0}
      scale={{
        color: {
          domain: data.map((i) => i.key),
          range: data.map((i) => i.color),
        },
      }}
      legend={false}
      labels={[]}
      animate={false}
      tooltip={{
        title: (d: CoverageItem) => d.name,
        items: [
          (d: CoverageItem) => ({
            name: '金额（百万美元）',
            value: capitalNodeAmount(d.value! / 1e6),
          }),
          (d: CoverageItem) => ({
            name: '占经营现金流',
            value: `${d.ratio!.toFixed(2)}%`,
          }),
          (d: CoverageItem) => ({ name: '计算口径', value: d.note }),
          (d: CoverageItem) => ({
            name: '财报来源',
            value:
              d.sources
                .map(
                  (s) =>
                    `${s.concept}；${s.start ?? ''} → ${s.end}；${s.accessionNumber}；${s.url}`,
                )
                .join('\n') || '由已披露核心项目计算',
          }),
        ],
      }}
    />
  );
}
