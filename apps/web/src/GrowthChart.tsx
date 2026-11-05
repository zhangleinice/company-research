import { Empty, Space, Tag } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import { periodLabel } from './financial-columns';

export function GrowthChart({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  const points = [...rows].reverse();
  const series = [
    ['revenueGrowth', 'Revenue Growth', '#1677ff'],
    ['epsGrowth', 'EPS Growth', '#52a36b'],
    ['fcfGrowth', 'FCF Growth', '#b66ad2'],
  ] as const;
  const values = points.flatMap((row) =>
    series.flatMap(([key]) => (row[key] === null ? [] : [row[key]!])),
  );
  if (!values.length) return <Empty description="暂无可用增长率数据" />;
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values);
  const span = max - min || 10;
  const x = (index: number) =>
    70 + (index * 770) / Math.max(1, points.length - 1);
  const y = (value: number) => 195 - ((value - min) / span) * 155;
  return (
    <>
      <Space wrap>
        {series.map(([key, label, color]) => (
          <Tag key={key} color={color}>
            {mode === 'quarterly' ? label.replace('Growth', 'YoY') : label}
          </Tag>
        ))}
      </Space>
      <div className="chart-wrap">
        <svg
          viewBox="0 0 900 250"
          role="img"
          aria-label={`${mode === 'annual' ? '年度' : '季度'}财务增长率趋势图`}
        >
          {Array.from(
            { length: 5 },
            (_, index) => min + (span * index) / 4,
          ).map((value, index) => (
            <g key={index}>
              <line
                x1="70"
                x2="840"
                y1={y(value)}
                y2={y(value)}
                stroke="#e8e8e8"
              />
              <text
                x="62"
                y={y(value) + 4}
                textAnchor="end"
                fontSize="11"
                fill="#8c8c8c"
              >
                {value.toFixed(1)}%
              </text>
            </g>
          ))}
          {points.map((row, index) => (
            <text
              key={row.periodEnd}
              x={x(index)}
              y="222"
              textAnchor="middle"
              fontSize="10"
              fill="#8c8c8c"
            >
              {periodLabel(row, mode)}
            </text>
          ))}
          {series.map(([key, label, color]) => (
            <g key={key}>
              {points.map((row, index) => {
                const value = row[key];
                const previous = points[index - 1]?.[key];
                if (value === null) return null;
                return (
                  <g key={row.periodEnd}>
                    {index > 0 && previous != null && (
                      <line
                        x1={x(index - 1)}
                        x2={x(index)}
                        y1={y(previous)}
                        y2={y(value)}
                        stroke={color}
                        strokeWidth="2"
                      />
                    )}
                    <circle cx={x(index)} cy={y(value)} r="3" fill={color}>
                      <title>
                        {periodLabel(row, mode)} · {label}: {value.toFixed(2)}%
                      </title>
                    </circle>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </>
  );
}
