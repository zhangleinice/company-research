import { EquityBridgeDetails } from './components/EquityBridgeDetails.js';
import { MarginOfSafety } from '../components/MarginOfSafety.js';
import {
  valuationNumber,
  valuationPercent,
} from '../utils/valuation-format.js';
import { EvComposition } from './components/EvComposition.js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Divider, Table, Tag, Typography } from 'antd';
import {
  calculateDcf,
  equityDefaultEstimates,
  type ValuationBaseline,
  type SimpleValuationData,
  type ValuationReferences,
  type EquityBridgeResearch,
} from '@company-research/shared';
import { bridgeWithDefaults } from './utils/equity-bridge-editor.js';
import {
  fetchValuation,
  fetchValuationReferences,
  fetchSimpleValuationInputs,
} from '../../../../services/api.js';
import { SimpleValuationControls } from './components/SimpleValuationControls.js';
import {
  emptySimpleSettings,
  resolveSimpleSettings,
  simpleCalculationBaseline,
} from './utils/simple-valuation-state.js';
import industryData from '../../../../data/industry-wacc-us.json' with { type: 'json' };
import {
  calculatorInput,
  fcffBasis,
  referenceBridge,
} from './utils/valuation-calculator.js';
const money = valuationNumber;
const rate = valuationPercent;
function Equation({
  formula,
  children,
}: {
  formula: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dcf-equation">
      <div>{formula}</div>
      <Typography.Text type="secondary">{children}</Typography.Text>
    </div>
  );
}
export function DcfCalculator({ ticker }: { ticker: string }) {
  return <DcfCalculatorSession key={ticker} ticker={ticker} />;
}
function DcfCalculatorSession({ ticker }: { ticker: string }) {
  const [baseline, setBaseline] = useState<ValuationBaseline | null>(null);
  const [refs, setRefs] = useState<ValuationReferences | null>(null);
  const [bridgeDraft, setBridgeDraft] = useState<{
    ticker: string;
    research: EquityBridgeResearch;
  } | null>(null);
  const [error, setError] = useState(''),
    [refsError, setRefsError] = useState('');
  const [revision, setRevision] = useState(0);
  const [simpleData, setSimpleData] = useState<SimpleValuationData | null>(
    null,
  );
  const [simpleError, setSimpleError] = useState('');
  const [settings, setSettings] = useState(emptySimpleSettings);
  const resolved = useMemo(
    () => resolveSimpleSettings(simpleData, settings, industryData),
    [simpleData, settings],
  );
  const { growth, wacc, terminalGrowth } = resolved.parameters;
  const useResearch = settings.basis === 'manual';
  const researchValue = settings.manualFcff;
  const researchReason = settings.manualReason;
  const calculationBaseline = useMemo(
    () =>
      baseline ? simpleCalculationBaseline(baseline, settings, resolved) : null,
    [baseline, settings, resolved],
  );
  useEffect(() => {
    const c = new AbortController();
    setBaseline(null);
    setRefs(null);
    setBridgeDraft(null);
    setError('');
    setRefsError('');
    setSimpleData(null);
    setSimpleError('');
    setSettings(emptySimpleSettings());
    void fetchValuation(ticker, c.signal)
      .then((b) => {
        if (!c.signal.aborted) {
          setBaseline(b);
          void fetchSimpleValuationInputs(ticker, c.signal)
            .then((data) => {
              if (c.signal.aborted) return;
              if (data.cik !== b.cik || data.ttm.end !== b.asOf)
                throw Error('估值参数数据的公司身份或报告期不一致');
              setSimpleData(data);
            })
            .catch((e) => {
              if (!c.signal.aborted) setSimpleError(e.message);
            });
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    void fetchValuationReferences(ticker, c.signal)
      .then((r) => {
        if (!c.signal.aborted) setRefs(r);
      })
      .catch(() => {
        if (!c.signal.aborted) setRefsError('债务、股数参考缓存暂不可用。');
      });
    return () => c.abort();
  }, [ticker, revision]);
  const bridgeDefaults = useMemo(
    () =>
      refs?.equityBridge
        ? equityDefaultEstimates({ references: refs.equityBridge, baseline })
        : null,
    [refs, baseline],
  );
  const bridge = useMemo(
    () =>
      refs?.equityBridge && bridgeDefaults
        ? {
            ...bridgeWithDefaults(
              refs.equityBridge,
              bridgeDraft,
              ticker,
              bridgeDefaults,
            ),
            unresolved:
              baseline &&
              (baseline.cik !== refs.equityBridge.cik ||
                baseline.asOf !== refs.equityBridge.asOf)
                ? '现金流基准与桥接参考的公司或报告期不一致，请先核对数据'
                : '',
          }
        : referenceBridge(
            refs ?? {
              periodEnd: null,
              cash: null,
              debt: null,
              shares: null,
              sharesBasis: 'unknown',
              sources: {},
            },
            ticker,
          ),
    [refs, ticker, baseline, bridgeDraft, bridgeDefaults],
  );
  const basis = useMemo(
    () =>
      calculationBaseline
        ? fcffBasis(calculationBaseline, {
            useResearch,
            researchValue,
            researchReason,
          })
        : null,
    [calculationBaseline, useResearch, researchValue, researchReason],
  );
  const result = useMemo(
    () =>
      calculationBaseline
        ? calculateDcf(
            calculatorInput(calculationBaseline, {
              ...resolved.parameters,
              researchValue,
              useResearch,
              researchReason,
              bridge,
            }),
          )
        : null,
    [
      calculationBaseline,
      resolved.parameters,
      researchValue,
      useResearch,
      researchReason,
      bridge,
    ],
  );
  const verifiedBase = basis?.kind === 'VERIFIED';
  const fcff0 = basis?.value ?? null;
  const sourcePeriod = resolved.period;
  const displayFcf =
    sourcePeriod?.ocf.value != null && sourcePeriod.capex.value != null
      ? sourcePeriod.ocf.value - sourcePeriod.capex.value
      : null;
  const firstFive =
    result?.rows.length === 5
      ? result.rows.reduce((sum, r) => sum + r.pv, 0)
      : null;
  const sixth =
    result?.forecast[4] && terminalGrowth !== null
      ? result.forecast[4].fcff * (1 + terminalGrowth / 100)
      : null;
  return (
    <div className="dcf-calculator">
      <Typography.Paragraph type="secondary" className="dcf-period">
        {settings.basis === 'manual'
          ? '手动FCFF · 财务参考期'
          : settings.basis === 'annual'
            ? '完整财年'
            : 'TTM'}{' '}
        {sourcePeriod?.start ?? '—'} → {sourcePeriod?.end ?? '—'} ·
        金额：百万美元 · 股数：百万股
      </Typography.Paragraph>
      <div className="dcf-key-metrics">
        <div className="dcf-key-metric">
          <div className="dcf-key-label">
            FCFF₀ · 当前现金流基准{' '}
            {fcff0 !== null && (
              <Tag>{verifiedBase ? '已核准基准' : '研究性估计'}</Tag>
            )}
          </div>
          <div className="dcf-key-value" data-dcf-metric="fcff">
            {money(fcff0)} <span>百万美元</span>
          </div>
        </div>
        <div className="dcf-key-metric">
          <div className="dcf-key-label">
            EV · 企业价值{' '}
            {result?.ev != null && (
              <Tag>{verifiedBase ? '情景估值' : '条件性估值'}</Tag>
            )}
          </div>
          <div className="dcf-key-value" data-dcf-metric="ev">
            {money(result?.ev)} <span>百万美元</span>
          </div>
        </div>
      </div>
      {error && (
        <Typography.Paragraph type="danger">
          {error}{' '}
          <Button
            type="link"
            size="small"
            onClick={() => setRevision((n) => n + 1)}
          >
            重试
          </Button>
        </Typography.Paragraph>
      )}
      <Divider />
      <section className="dcf-section">
        <Typography.Title level={5}>
          {settings.basis === 'manual'
            ? '手动FCFF基准'
            : resolved.calculationMethod === 'ebit'
              ? '税后经营利润法 · FCFF组成'
              : '历史自由现金流'}{' '}
          <Tag color="blue">
            {settings.basis === 'manual'
              ? '研究假设'
              : `财报参考 · ${settings.basis === 'annual' ? (sourcePeriod?.label ?? '年度') : 'TTM'}`}
          </Tag>
        </Typography.Title>
        <div className="dcf-history-formulas">
          {settings.basis === 'manual' ? (
            <Equation formula="FCFF₀ = 用户正常化现金流假设">
              <strong>{money(fcff0)}</strong>
            </Equation>
          ) : resolved.calculationMethod === 'ebit' ? (
            <>
              <Equation formula="NOPAT = Operating Income × (1 − Tax Rate)">
                = {money(resolved.ebit.components.ebit)} × (1 −{' '}
                {rate(
                  resolved.tax.value === null ? null : resolved.tax.value * 100,
                )}
                ) = <strong>{money(resolved.ebit.components.nopat)}</strong>
              </Equation>
              <Equation formula="FCFF₀ = NOPAT + D&A − CapEx − ΔNWC">
                = {money(resolved.ebit.components.nopat)} +{' '}
                {money(resolved.ebit.components.da)} −{' '}
                {money(resolved.ebit.components.capex)} − (
                {money(resolved.ebit.components.deltaNwc)}) ={' '}
                <strong>{money(resolved.fcff.value)}</strong>
              </Equation>
            </>
          ) : (
            <>
              <Equation formula="FCF = OCF − CapEx">
                ={' '}
                {money(
                  sourcePeriod?.ocf.value == null
                    ? null
                    : sourcePeriod.ocf.value / 1e6,
                )}{' '}
                −{' '}
                {money(
                  sourcePeriod?.capex.value == null
                    ? null
                    : sourcePeriod.capex.value / 1e6,
                )}{' '}
                ={' '}
                <strong>
                  {money(displayFcf === null ? null : displayFcf / 1e6)}
                </strong>
              </Equation>
              <Equation formula="FCFF₀ ≈ FCF + Interest × (1 − T)">
                = {money(displayFcf === null ? null : displayFcf / 1e6)} +{' '}
                {money(
                  sourcePeriod?.interest.value == null
                    ? null
                    : sourcePeriod.interest.value / 1e6,
                )}{' '}
                × (1 −{' '}
                {rate(
                  resolved.tax.value === null ? null : resolved.tax.value * 100,
                )}
                ) = <strong>{money(resolved.fcff.value)}</strong>
              </Equation>
            </>
          )}
        </div>
      </section>
      <Divider />
      <section className="dcf-section">
        <SimpleValuationControls
          data={simpleData}
          settings={settings}
          resolved={resolved}
          industries={industryData}
          onChange={setSettings}
        />
        {simpleError && (
          <Typography.Text type="warning" className="dcf-note">
            估值参数参考暂不可用：{simpleError}
          </Typography.Text>
        )}
      </section>
      <Divider />
      <section className="dcf-section">
        <div className="dcf-section-heading">
          <Typography.Title level={5}>现金流折现</Typography.Title>
          <Typography.Text type="secondary">百万美元</Typography.Text>
        </div>
        <Equation
          formula={
            <>
              FCFF(t) = FCFF₀ × (1 + g)<sup>t</sup>
            </>
          }
        >
          = {money(fcff0)} × (1 + {rate(growth)})<sup>t</sup>
        </Equation>
        <Table
          className="dcf-forecast-table"
          size="small"
          pagination={false}
          rowKey="year"
          tableLayout="fixed"
          scroll={{ x: 480 }}
          rowClassName={(row) => (row.year === '合计EV' ? 'dcf-ev-row' : '')}
          dataSource={[
            ...Array.from({ length: 5 }, (_, i) => ({
              year: `第${i + 1}年`,
              fcff: result?.forecast[i]?.fcff ?? null,
              pv: result?.rows[i]?.pv ?? null,
            })),
            {
              year: '第6年～永续（TV）',
              fcff: result?.terminalValue ?? null,
              pv: result?.terminalPV ?? null,
            },
            { year: '合计EV', fcff: null, pv: result?.ev ?? null },
          ]}
          columns={[
            {
              title: '年份',
              dataIndex: 'year',
              width: 150,
            },
            {
              title: '预计FCFF / TV',
              dataIndex: 'fcff',
              align: 'right',
              render: money,
            },
            {
              title: '折现现值',
              dataIndex: 'pv',
              align: 'right',
              render: money,
            },
          ]}
        />
        <Typography.Text type="secondary" className="dcf-note">
          TV是第6年起永续现金流在第5年末的价值，并非第6年单年FCFF。
        </Typography.Text>
        <EvComposition
          firstFive={firstFive}
          terminalPV={result?.terminalPV}
          ev={result?.ev}
        />
        <details className="dcf-details dcf-calculation-details">
          <summary>查看计算公式</summary>
          <div className="dcf-formula-summary">
            <strong>终值 TV（Terminal Value）</strong>
            <Equation formula="TV = FCFF₆ / (WACC − 永续增长率)">
              = {money(sixth)} / ({rate(wacc)} − {rate(terminalGrowth)}) ={' '}
              <strong>{money(result?.terminalValue)}</strong>
            </Equation>
            <strong>终值现值 PV(TV)</strong>
            <Equation
              formula={
                <>
                  PV(TV) = TV / (1 + WACC)<sup>5</sup>
                </>
              }
            >
              = {money(result?.terminalValue)} / (1 + {rate(wacc)})<sup>5</sup>{' '}
              = <strong>{money(result?.terminalPV)}</strong>
            </Equation>
            <strong>企业价值 EV（Enterprise Value）</strong>
            <Equation formula="EV = 前5年FCFF现值合计 + 终值现值">
              = {money(firstFive)} + {money(result?.terminalPV)} ={' '}
              <strong className="dcf-ev-total">{money(result?.ev)}</strong>
            </Equation>
          </div>
        </details>
        {result && result.ev === null && (
          <Typography.Paragraph type="secondary" className="dcf-note">
            {!baseline?.applicable
              ? '当前公司不适用普通FCFF模型。'
              : fcff0 === null
                ? basis?.reason || '缺少可靠FCFF基准。'
                : result.errors[0]}
          </Typography.Paragraph>
        )}
      </section>
      <Divider />
      <EquityBridgeDetails
        fcffNotice={resolved.bridgeNotice}
        baseline={baseline}
        references={refs}
        result={result}
        error={refsError}
        bridge={bridge}
        defaults={bridgeDefaults}
        onChange={(research) => setBridgeDraft({ ticker, research })}
      />
      <MarginOfSafety model="DCF" fairValue={result?.perShare ?? null} />
    </div>
  );
}
