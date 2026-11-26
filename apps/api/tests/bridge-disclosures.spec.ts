import { bridgeDisclosures } from '../src/modules/valuation/bridge-disclosures';
const filing = {
  end: '2026-09-30',
  accn: '0000000001-26-000001',
  filed: '2026-10-29',
};
const observation = (val: number, extra = {}) => ({
  val,
  end: filing.end,
  accn: filing.accn,
  filed: filing.filed,
  form: '10-Q',
  ...extra,
});
const facts = (entries: ReturnType<typeof observation>[]) => ({
  cik: '1',
  facts: {
    'us-gaap': { OperatingLeaseLiability: { units: { USD: entries } } },
  },
});
const periods = { annual: [], quarterly: [] };
it('keeps explicit reported zero distinct from missing values and records filing provenance', () => {
  const b = bridgeDisclosures(
    facts([observation(0)]),
    '0000000001',
    filing,
    periods,
  );
  expect(b.items.operatingLeases.value).toBe(0);
  expect(b.items.financeLeases.value).toBeNull();
  expect(b.items.preferred.value).toBeNull();
  expect(b.items.operatingLeases.items[0]).toMatchObject({
    unit: 'USD',
    accn: filing.accn,
    end: filing.end,
  });
  expect(b.items.operatingLeases.items[0].url).toContain('000000000126000001');
});
it('does not combine narrower NCI/preferred concepts or treat them as absence of broader claims', () => {
  const raw = {
    cik: '1',
    facts: {
      'us-gaap': {
        NoncontrollingInterestInVariableInterestEntity: {
          units: { USD: [observation(50)] },
        },
        ConvertiblePreferredStockNonredeemableOrRedeemableIssuerOptionValue: {
          units: { USD: [observation(30)] },
        },
      },
    },
  };
  const b = bridgeDisclosures(raw, '0000000001', filing, periods);
  expect(b.items.noncontrollingVIE.value).toBe(50);
  expect(b.items.minority.value).toBeNull();
  expect(b.items.convertiblePreferred.value).toBe(30);
  expect(b.items.preferred.value).toBeNull();
  expect(b).not.toHaveProperty('adjustments');
});
it('rejects conflicting, different-accession, stale, duration or non-USD balance facts', () => {
  for (const entries of [
    [observation(1), observation(2)],
    [observation(1, { accn: 'other' })],
    [observation(1, { end: '2025-09-30' })],
    [observation(1, { start: '2026-01-01' })],
  ]) {
    expect(
      bridgeDisclosures(facts(entries), '0000000001', filing, periods).items
        .operatingLeases.value,
    ).toBeNull();
  }
  expect(() =>
    bridgeDisclosures(facts([]), '0000000002', filing, periods),
  ).toThrow('CIK');
  const raw = {
    cik: '1',
    facts: {
      'us-gaap': {
        OperatingLeaseLiability: { units: { EUR: [observation(1)] } },
      },
    },
  };
  expect(
    bridgeDisclosures(raw, '0000000001', filing, periods).items.operatingLeases
      .value,
  ).toBeNull();
});

it('extracts noncurrent accrued taxes at the exact filing date separately from gross UTBs', () => {
  const raw = facts([]);
  Object.assign(raw.facts['us-gaap'], {
    AccruedIncomeTaxesNoncurrent: {
      units: {
        USD: [observation(12219e6), observation(99, { accn: 'other' })],
      },
    },
    UnrecognizedTaxBenefits: { units: { USD: [observation(12500e6)] } },
  });
  const b = bridgeDisclosures(raw, '0000000001', filing, periods);
  expect(b.items.noncurrentIncomeTaxes?.value).toBe(12219e6);
  expect(b.items.noncurrentIncomeTaxes?.concept).toBe(
    'us-gaap:AccruedIncomeTaxesNoncurrent',
  );
  expect(b.items.unrecognizedTaxBenefits.value).toBe(12500e6);
  expect(b.items.noncurrentIncomeTaxes?.items[0].accn).toBe(filing.accn);
});
