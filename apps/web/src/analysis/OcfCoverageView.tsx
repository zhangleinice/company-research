import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, Space, Spin, Tooltip, Typography } from 'antd';
import type { CapitalAllocationOverview } from '@company-research/shared';
import { ocfCoverage } from './ocf-coverage.js';
import { capitalNodeAmount } from './capital-sankey-options.js';
const CoveragePie = lazy(() => import('./OcfCoveragePie.js'));
export function OcfCoverageView({
  overview,
}: {
  overview: CapitalAllocationOverview | undefined;
}) {
  const model = ocfCoverage(overview);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const barScale = Math.max(
    100,
    ...model.items.map((i) => Math.abs(i.ratio ?? 0)),
  );
  const details = (
    <div className="ocf-coverage-items">
      {model.items.map((i) => (
        <Tooltip
          key={i.key}
          title={
            <Space orientation="vertical">
              <span>
                {overview?.start ?? '—'} → {overview?.end ?? '—'}
              </span>
              <span>{i.note}</span>
              <span>占比 = 对应金额 / 经营现金流 × 100%</span>
              {i.sources.map((s, index) => (
                <span key={index}>
                  {s.concept} · {s.start ?? ''} → {s.end} · {s.accessionNumber}{' '}
                  <a href={s.url} target="_blank" rel="noreferrer">
                    财报来源
                  </a>
                </span>
              ))}
            </Space>
          }
        >
          <div className="ocf-coverage-item">
            <div className="ocf-coverage-line">
              <span>
                <span
                  className="ocf-coverage-swatch"
                  style={{ background: i.color }}
                />
                {i.name}
              </span>
              <span>
                {i.value === null ? '—' : capitalNodeAmount(i.value / 1e6)} ·{' '}
                {i.ratio === null ? '—' : `${i.ratio.toFixed(2)}%`}
              </span>
            </div>
            {!model.canPie && i.ratio !== null && (
              <div
                className="ocf-coverage-track"
                role="img"
                aria-label={`${i.name}：占经营现金流${i.ratio.toFixed(2)}%${i.ratio < 0 ? '，负余额' : ''}`}
              >
                <div
                  style={{
                    width: `${(Math.abs(i.ratio) / barScale) * 100}%`,
                    background: i.color,
                  }}
                />
              </div>
            )}
          </div>
        </Tooltip>
      ))}
    </div>
  );
  return (
    <Space orientation="vertical" size={12} className="full-width">
      <div className="capital-sankey-heading">
        <Typography.Text strong>
          经营现金流{' '}
          {model.ocf === null ? '—' : capitalNodeAmount(model.ocf / 1e6)}
        </Typography.Text>
        <Tooltip title="该图是经营现金流对核心支出的覆盖分析，不代表现金逐笔流向。扣除核心支出后余额不代表实际留存现金；债务及金融资产交易不纳入本视图。收购及相关投资保留原披露的混合范围。">
          <Typography.Text type="secondary" tabIndex={0}>
            图表口径 ⓘ
          </Typography.Text>
        </Tooltip>
      </div>
      <Typography.Text type="secondary">
        金额单位：百万美元；比例为占经营现金流的比例。
      </Typography.Text>
      {!model.complete && (
        <Alert
          type="warning"
          title="核心支出数据不完整，仅展示已识别项目；不将缺失视为零，不推算余额。"
        />
      )}
      {(model.ocf === null || model.ocf <= 0) && (
        <Alert
          type="warning"
          title="经营现金流缺失或非正，仅展示金额，不计算比例或绘制环形图。"
        />
      )}
      {model.insufficient && (
        <Alert
          type="warning"
          title="经营现金流覆盖不足：已识别核心支出超过经营现金流，按真实比例展示。"
        />
      )}
      <div className={model.canPie ? 'ocf-coverage-layout' : undefined}>
        {model.canPie && (
          <div
            className="ocf-coverage-donut"
            role="img"
            aria-label="经营现金流对核心支出覆盖环形图"
          >
            {mounted ? (
              <Suspense fallback={<Spin description="加载经营现金流图" />}>
                <CoveragePie items={model.items} />
              </Suspense>
            ) : (
              <Spin description="加载经营现金流图" />
            )}
            <div className="ocf-coverage-center">
              <span>经营现金流</span>
              <strong>{capitalNodeAmount(model.ocf! / 1e6)}</strong>
            </div>
          </div>
        )}
        {details}
      </div>
    </Space>
  );
}
