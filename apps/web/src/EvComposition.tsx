import { Typography } from 'antd';

/** Presentation ratios only: never normalize invalid or signed components to 100%. */
export function evComposition(
  firstFive: number | null | undefined,
  terminalPV: number | null | undefined,
  ev: number | null | undefined,
) {
  if (
    firstFive == null ||
    terminalPV == null ||
    ev == null ||
    !Number.isFinite(firstFive) ||
    !Number.isFinite(terminalPV) ||
    !Number.isFinite(ev) ||
    ev <= 0 ||
    firstFive < 0 ||
    terminalPV < 0 ||
    Math.abs(firstFive + terminalPV - ev) > Math.abs(ev) * 1e-10
  )
    return null;
  const forecast = (firstFive / ev) * 100;
  const terminal = (terminalPV / ev) * 100;
  if (forecast > 100 || terminal > 100) return null;
  return { forecast, terminal };
}

export function EvComposition({
  firstFive,
  terminalPV,
  ev,
}: {
  firstFive: number | null;
  terminalPV: number | null | undefined;
  ev: number | null | undefined;
}) {
  const parts = evComposition(firstFive, terminalPV, ev);
  return (
    <div className="dcf-composition">
      <Typography.Text strong>EV价值构成</Typography.Text>
      {parts ? (
        <div
          className={
            Math.min(parts.forecast, parts.terminal) < 15
              ? 'dcf-composition-body has-small-share'
              : 'dcf-composition-body'
          }
        >
          <div className="dcf-composition-outside" aria-hidden="true">
            <span>{parts.forecast.toFixed(2)}%</span>
            <span>{parts.terminal.toFixed(2)}%</span>
          </div>
          <div
            className="dcf-composition-bar"
            role="img"
            aria-label={`第1～5年 ${parts.forecast.toFixed(2)}%；第6年～永续 ${parts.terminal.toFixed(2)}%`}
          >
            <div
              className="dcf-composition-forecast"
              style={{ width: `${parts.forecast}%` }}
            >
              <span>{parts.forecast.toFixed(2)}%</span>
            </div>
            <div
              className="dcf-composition-terminal"
              style={{ width: `${parts.terminal}%` }}
            >
              <span>{parts.terminal.toFixed(2)}%</span>
            </div>
          </div>
          <div className="dcf-composition-legend" aria-hidden="true">
            <span>
              <i className="dcf-composition-forecast" />
              第1～5年
            </span>
            <span>
              <i className="dcf-composition-terminal" />
              第6年～永续
            </span>
          </div>
        </div>
      ) : (
        <Typography.Paragraph type="secondary" className="dcf-note">
          — EV或现值数据不足，或构成包含负值，暂不展示比例。
        </Typography.Paragraph>
      )}
    </div>
  );
}
