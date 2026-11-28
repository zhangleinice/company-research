import { Card, Col, Row, Space, Statistic, Tooltip, Typography } from 'antd';
import type { AllocationSource } from '@company-research/shared';
import {
  formatAnalysisValue,
  type MetricUnit,
} from '../../utils/financial-analysis.js';
interface Item {
  key: string;
  label: string;
  value: number | null;
  unit: MetricUnit;
  description: string;
  reason?: string | null;
  sources?: AllocationSource[];
}
export function AllocationCards({
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
