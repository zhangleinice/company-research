/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS validation. */
/* global require, module */
const { load } = require('cheerio');
const { inspect, qname } = require('./facts.cjs');
const normalize = (s) => s.replace(/\s+/g, ' ').trim();
const signature = (f) =>
  JSON.stringify([
    f.concept,
    f.unit,
    [...f.context.dimensions].sort((a, b) =>
      a.dimension.localeCompare(b.dimension),
    ),
  ]);
function comparable(current, prior) {
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  if (
    signature(current) !== signature(prior) ||
    current.accessionNumber !== prior.accessionNumber
  )
    return { value: null, reason: 'concept/unit/full context tuple differs' };
  if (
    days(prior.context.end, current.context.end) < 330 ||
    days(prior.context.end, current.context.end) > 400 ||
    days(prior.context.start, current.context.start) < 330 ||
    days(prior.context.start, current.context.start) > 400 ||
    Math.abs(
      days(current.context.start, current.context.end) -
        days(prior.context.start, prior.context.end),
    ) > 7
  )
    return { value: null, reason: 'annual start/end dates or duration differ' };
  if (BigInt(prior.value) <= 0n)
    return { value: null, reason: 'prior amount is zero or negative' };
  return {
    value:
      Number(
        ((BigInt(current.value) - BigInt(prior.value)) * 10000000000n) /
          BigInt(prior.value),
      ) / 100000000,
    priorPeriod: { start: prior.context.start, end: prior.context.end },
    reason:
      'same original comparative row, accession, concept, full dimension tuple, unit and compatible annual periods; latest filing presentation',
  };
}
function extractTables(html, metadata) {
  const inspected = inspect(html, metadata, { tableMode: true });
  const $ = load(html, { xmlMode: true });
  const tables = $('table').toArray();
  const skips = [];
  const groups = new Map();
  for (const fact of inspected.occurrences) {
    const pos = fact.sourcePosition,
      table = tables[pos.tableIndex];
    if (!table) {
      skips.push({ factId: pos.factId, reason: 'no original table' });
      continue;
    }
    const row = $(table).find('tr').toArray()[pos.rowIndex];
    const nodes = $(row)
      .find('*')
      .toArray()
      .filter(
        (n) =>
          n.attribs?.id === pos.factId &&
          qname(n, n.attribs.name) === fact.concept &&
          n.attribs.contextRef === fact.context.id,
      );
    if (nodes.length !== 1) {
      skips.push({
        factId: pos.factId,
        reason: 'fact node not uniquely located',
      });
      continue;
    }
    const cells = $(row).children('td,th').toArray();
    const index = cells.findIndex((n) =>
      $(n)
        .find('*')
        .toArray()
        .some((x) => x.name?.split(':').pop() === 'nonFraction'),
    );
    const nameCells = cells
      .slice(0, index)
      .filter(
        (n) =>
          normalize($(n).text()) && !/^[$€£]+$/.test(normalize($(n).text())),
      );
    // A revenue row must start with plain official text, before any numeric fact.
    // Column-oriented segments require header-grid resolution, intentionally skipped.
    if (
      !nameCells.length ||
      nameCells.some((n) =>
        $(n)
          .find('*')
          .toArray()
          .some((x) => x.name?.split(':').pop() === 'nonFraction'),
      )
    ) {
      skips.push({
        factId: pos.factId,
        tableIndex: pos.tableIndex,
        rowIndex: pos.rowIndex,
        reason:
          'no unique leading text label; column-oriented/mixed row skipped',
      });
      continue;
    }
    const name = normalize(nameCells.map((n) => $(n).text()).join(' '));
    if (!name || /^[\d\s$€£%,.()—–-]+$/.test(name)) {
      skips.push({
        factId: pos.factId,
        reason: 'label is not descriptive text',
      });
      continue;
    }
    const conflict = inspected.conflicts.some((c) => {
      const key = JSON.parse(c.key);
      return (
        key[0] === fact.concept &&
        key[1] === fact.context.start &&
        key[2] === fact.context.end &&
        JSON.stringify(key[4]) ===
          JSON.stringify(
            [...fact.context.dimensions].sort((a, b) =>
              a.dimension.localeCompare(b.dimension),
            ),
          )
      );
    });
    if (conflict) {
      skips.push({ factId: pos.factId, reason: 'conflicting XBRL amounts' });
      continue;
    }
    let group = groups.get(pos.tableIndex);
    if (!group) {
      const allRows = $(table).find('tr').toArray();
      const first = allRows.findIndex((n) =>
        $(n)
          .find('*')
          .toArray()
          .some((x) => x.name?.split(':').pop() === 'nonFraction'),
      );
      const header = normalize(
        allRows
          .slice(0, Math.max(0, first))
          .map((n) => $(n).text())
          .join(' '),
      );
      group = {
        tableIndex: pos.tableIndex,
        tableId: table.attribs.id || null,
        header,
        sourceUrl: metadata.sourceUrl,
        accessionNumber: metadata.accessionNumber,
        rows: [],
      };
      groups.set(pos.tableIndex, group);
    }
    let output = group.rows.find((r) => r.rowIndex === pos.rowIndex);
    if (!output) {
      output = {
        rowIndex: pos.rowIndex,
        name,
        originalRow: normalize($(row).text()),
        facts: [],
      };
      group.rows.push(output);
    }
    if (output.name !== name) {
      skips.push({
        factId: pos.factId,
        reason: 'inconsistent leading row label',
      });
      continue;
    }
    // A row mixing different money concepts/tuples is not split into invented items.
    const extracted = { ...fact, factUrl: `${fact.sourceUrl}#${pos.factId}` };
    delete extracted.status;
    output.facts.push(extracted);
  }
  const result = [];
  for (const group of groups.values()) {
    group.rows = group.rows.filter((row) => {
      if (new Set(row.facts.map(signature)).size !== 1) {
        skips.push({
          tableIndex: group.tableIndex,
          rowIndex: row.rowIndex,
          reason: 'mixed concepts or dimensions in one original row',
        });
        return false;
      }
      const byPeriod = new Map();
      for (const f of row.facts) {
        const p = f.context.start + '/' + f.context.end;
        const old = byPeriod.get(p);
        if (old && old.value !== f.value) return false;
        byPeriod.set(p, old || f);
      }
      row.facts = [...byPeriod.values()].sort((a, b) =>
        a.context.end.localeCompare(b.context.end),
      );
      for (const f of row.facts) {
        const offset = Math.round(
          (Date.parse(metadata.reportDate) - Date.parse(f.context.end)) /
            86400000 /
            365.25,
        );
        f.fiscalYear = metadata.fiscalYear - offset;
        f.yoy = {
          value: null,
          reason: 'no comparable prior year in this original row',
        };
        const prior = row.facts.find((x) => x.fiscalYear === f.fiscalYear - 1);
        if (prior) f.yoy = comparable(f, prior);
      }
      return row.facts.length > 0;
    });
    const containsBreakdown = group.rows.some((r) =>
      r.facts.some((f) =>
        f.context.dimensions.some((d) =>
          /^\{http:\/\/fasb.org\/(srt|us-gaap)\/\d{4}\}(ProductOrServiceAxis|StatementBusinessSegmentsAxis|StatementGeographicalAxis)$/.test(
            d.dimension,
          ),
        ),
      ),
    );
    if (group.rows.length && containsBreakdown) result.push(group);
    else
      skips.push({
        tableIndex: group.tableIndex,
        reason:
          'not a supported dimensional revenue breakdown table; consolidated/derivative-only disclosure omitted',
      });
  }
  return {
    metadata,
    groups: result,
    skips,
    rejected: inspected.rejected,
    policy:
      'Original table/row order only. No regrouping, hierarchy, aggregation or imputation. Amount strings in USD. Totals and adjustments retain verbatim row labels. YoY is latest-filing same-row comparison, not original historical filings.',
  };
}
module.exports = { extractTables, comparable };
