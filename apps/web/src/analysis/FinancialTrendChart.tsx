import { useEffect, useId, useRef, useState } from 'react';
import { Empty, Space, Tag } from 'antd';
import type {
  FinancialMetric,
  FinancialMode,
  FinancialPeriod,
} from '@company-research/shared';
import {
  analysisValue,
  formatAnalysisValue,
  type MetricUnit,
} from './financial-analysis.js';

export interface TrendSeries {
  key: FinancialMetric;
  label: string;
  color: string;
}
/** Reuses the original SVG chart approach; no plotting library or client-side metric calculations. */
export function FinancialTrendChart({
  rows,
  mode,
  series,
  unit,
  title,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
  series: TrendSeries[];
  unit: MetricUnit;
  title: string;
}) {
  const id = useId();
  const points = [...rows].sort((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd),
  );
  const values = points.flatMap((row) =>
    series.flatMap((item) => {
      const value = analysisValue(row, item.key, mode);
      return value === null ? [] : [value];
    }),
  );
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const hasData = values.length > 0;
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasData]);
  if (!values.length)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={`${title}：暂无可靠数据`}
      />
    );
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = max - min || 1;
  const firstDate = Date.parse(points[0].periodEnd);
  const lastDate = Date.parse(points[points.length - 1].periodEnd);
  const x = (index: number) =>
    70 +
    (lastDate === firstDate
      ? (width - 90) / 2
      : ((Date.parse(points[index].periodEnd) - firstDate) /
          (lastDate - firstDate)) *
        (width - 90));
  const y = (value: number) => 190 - ((value - min) / span) * 150;
  const label = (row: FinancialPeriod) =>
    mode === 'annual'
      ? String(row.fiscalYear ?? row.periodEnd.slice(0, 4))
      : `${row.fiscalYear ?? row.periodEnd.slice(0, 4)} Q${row.fiscalQuarter ?? '—'}`;
  const tick = (value: number) => {
    if (unit === 'percent') return `${value.toFixed(1)}%`;
    const displayed = value / (unit === 'money' ? 1000000 : 1);
    return new Intl.NumberFormat('zh-CN', {
      maximumFractionDigits: 1,
      notation: Math.abs(displayed) >= 100000 ? 'compact' : 'standard',
    }).format(displayed);
  };
  return (
    <div className="analysis-chart" ref={container}>
      <Space wrap size={[8, 8]}>
        {series.map((item) => (
          <Tag key={item.key} color={item.color}>
            {item.label}
          </Tag>
        ))}
      </Space>
      <svg
        viewBox={`0 0 ${width} 250`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-description`}>
          {mode === 'annual' ? '年度' : '独立季度'}；
          {unit === 'money'
            ? '百万美元'
            : unit === 'percent'
              ? '百分数'
              : unit === 'ratio'
                ? '倍'
                : '美元 / 股'}
          。缺失值不连线；悬停数据点查看起止日期和数值。
        </desc>
        {Array.from({ length: 5 }, (_, index) => min + (span * index) / 4).map(
          (value, index) => (
            <g key={index}>
              <line
                x1="70"
                x2={width - 20}
                y1={y(value)}
                y2={y(value)}
                stroke="#e8edf4"
              />
              <text
                x="60"
                y={y(value) + 4}
                textAnchor="end"
                fontSize="11"
                fill="#8c8c8c"
              >
                {tick(value)}
              </text>
            </g>
          ),
        )}
        {points.map((row, index) =>
          index % Math.ceil(points.length / (width < 480 ? 4 : 6)) === 0 ||
          index === points.length - 1 ? (
            <text
              key={row.periodEnd}
              x={x(index)}
              y="222"
              textAnchor="middle"
              fontSize="10"
              fill="#8c8c8c"
            >
              {label(row)}
            </text>
          ) : null,
        )}
        {series.map((item) => (
          <g key={item.key}>
            {points.map((row, index) => {
              const value = analysisValue(row, item.key, mode);
              const previous = analysisValue(points[index - 1], item.key, mode);
              if (value === null) return null;
              return (
                <g key={row.periodEnd}>
                  {index > 0 &&
                    previous !== null &&
                    (Date.parse(row.periodEnd) -
                      Date.parse(points[index - 1].periodEnd)) /
                      86400000 <=
                      (mode === 'annual' ? 400 : 120) && (
                      <line
                        x1={x(index - 1)}
                        x2={x(index)}
                        y1={y(previous)}
                        y2={y(value)}
                        stroke={item.color}
                        strokeWidth="2"
                      />
                    )}
                  <circle cx={x(index)} cy={y(value)} r="3.5" fill={item.color}>
                    <title>{`${row.periodStart} 至 ${row.periodEnd} · ${item.label}: ${formatAnalysisValue(value, unit)}${unit === 'money' ? ' 百万美元' : ''}`}</title>
                  </circle>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
