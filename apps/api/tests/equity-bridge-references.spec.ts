import { equityBridgeReferences } from '../src/modules/valuation/equity-bridge-references';
it('keeps AAPL-style annual weighted shares despite a same-date derived Q4 with no independent weighted shares', () => {
  const end = new Date('2026-09-26');
  const annual = {
    periodStart: new Date('2025-09-28'),
    periodEnd: end,
    basicShares: 14661935000,
    dilutedShares: 14720306000,
    sharesOutstanding: 14532259000,
    sources: {},
  };
  const quarter = {
    periodStart: new Date('2026-06-28'),
    periodEnd: end,
    basicShares: null,
    dilutedShares: null,
    sharesOutstanding: 14532259000,
    sources: {},
  };
  const refs = equityBridgeReferences('0000320193', annual, quarter, null);
  expect(refs.facts.annualDilutedShares.value).toBe(14720306000);
  expect(refs.facts.annualBasicShares.start).toBe('2025-09-28');
  expect(refs.facts.quarterDilutedShares.value).toBeNull();
  expect(refs.facts.shares.value).toBe(14532259000);
  expect(quarter.dilutedShares).toBeNull();
});
it('requires version 2 coherent approved financing debt, retains zero, and never joins stale foreign disclosures', () => {
  const row = {
    periodEnd: new Date('2026-09-30'),
    sources: {
      balanceSheetInputs: {
        version: 2,
        periodEnd: '2026-09-30',
        financeLeasesIncludedInDebt: true,
        financingDebt: { value: 0, status: 'VERIFIED', items: [] },
        cash: { value: 0, status: 'VERIFIED', items: [] },
      },
    },
  };
  const r = equityBridgeReferences('0000000001', null, row, {
    bridgeDisclosures: {
      cik: '0000000002',
      asOf: '2026-09-30',
      items: { minority: { value: 999 } },
    },
  });
  expect(r.facts.financingDebt.value).toBe(0);
  expect(r.facts.cash.value).toBe(0);
  expect(r.facts.minority.value).toBeNull();
  const stale = equityBridgeReferences('0000000001', null, row, {
    bridgeDisclosures: {
      cik: '0000000001',
      asOf: '2026-09-30',
      items: {
        minority: {
          value: 999,
          start: null,
          end: '2025-12-31',
          items: [],
          concept: null,
        },
      },
    },
  });
  expect(stale.facts.minority.value).toBeNull();
  Object.assign(row.sources.balanceSheetInputs, {
    debtComponents: {
      LongTermDebtAndCapitalLeaseObligations: {
        value: 40e6,
        status: 'VERIFIED',
        items: [],
      },
    },
  });
  expect(
    equityBridgeReferences('0000000001', null, row, null).debtComponents
      ?.LongTermDebtAndCapitalLeaseObligations.value,
  ).toBe(40e6);
  row.sources.balanceSheetInputs.financingDebt.status = 'REVIEW_REQUIRED';
  expect(
    equityBridgeReferences('0000000001', null, row, null).facts.financingDebt
      .value,
  ).toBeNull();
  row.sources.balanceSheetInputs.version = 1;
  expect(
    equityBridgeReferences('0000000001', null, row, null).facts.cash.value,
  ).toBeNull();
});
