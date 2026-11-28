/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS tools reuse the compiled NestJS SEC client. */
/* global require */
// Explicit local-cache acceptance test. No network or database access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
for (const [name, samples] of [
  [
    'alphabet',
    [
      ['GoogleServicesMember', '342721000000'],
      ['GoogleCloudMember', '58705000000'],
      ['AllOtherSegmentsMember', '1537000000'],
    ],
  ],
  [
    'apple',
    [
      ['IPhoneMember', '254098000000'],
      ['MacMember', '37929000000'],
      ['IPadMember', '27929000000'],
      ['ServiceMember', '123301000000'],
    ],
  ],
  [
    'nvidia',
    [
      ['ComputeAndNetworkingSegmentMember', '193479000000'],
      ['GraphicsSegmentMember', '22459000000'],
      ['DataCenterMember', '193737000000'],
    ],
  ],
])
  test(`${name}: latest filing amounts match manually checked original XBRL cells; all remain unapproved`, () => {
    const r = JSON.parse(
      fs.readFileSync(`/tmp/revenue-breakdown-validation/${name}/audit.json`),
    );
    for (const [member, value] of samples) {
      const facts = r.candidates.filter(
        (x) =>
          x.context.end === r.metadata.reportDate &&
          x.context.dimensions.some((d) => d.member.endsWith('}' + member)),
      );
      assert.ok(
        facts.some((x) => x.value === value),
        member,
      );
    }
    assert.equal(r.conflicts.length, 0);
    assert.equal(r.productionApproved, 0);
    assert.equal(r.stageTwoAllowed, false);
    for (const f of r.candidates) {
      assert.equal(f.accessionNumber, r.metadata.accessionNumber);
      assert.ok(f.blockers.length);
      assert.equal(f.unit, 'USD');
    }
  });
test('known subtotal/adjustment traps prevent naive integration', () => {
  const read = (n) =>
    JSON.parse(
      fs.readFileSync(`/tmp/revenue-breakdown-validation/${n}/audit.json`),
    );
  const find = (r, m) =>
    BigInt(
      r.candidates
        .filter(
          (x) =>
            x.context.end === r.metadata.reportDate &&
            x.context.dimensions.some((d) => d.member.endsWith('}' + m)),
        )
        .sort(
          (a, b) => a.context.dimensions.length - b.context.dimensions.length,
        )[0].value,
    );
  const g = read('alphabet');
  assert.equal(
    find(g, 'GoogleServicesMember') +
      find(g, 'GoogleCloudMember') +
      find(g, 'AllOtherSegmentsMember'),
    402963000000n,
  );
  assert.notEqual(402963000000n, 402836000000n);
  const n = read('nvidia');
  assert.equal(
    find(n, 'ComputeMember') + find(n, 'NetworkingMember'),
    find(n, 'DataCenterMember'),
  );
  const a = read('apple');
  assert.equal(
    find(a, 'IPhoneMember') +
      find(a, 'MacMember') +
      find(a, 'IPadMember') +
      find(a, 'WearablesHomeandAccessoriesMember'),
    find(a, 'ProductMember'),
  );
});
