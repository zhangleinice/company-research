import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { Element } from 'domhandler';
import { amount, qname } from '../revenue/parser/facts.cjs';
import type { DebtFiling } from './debt-disclosure';
import type { DepreciationDisclosure } from './depreciation-amortization';

/** Reuses the already bounded filing acquisition. Only entity-wide duration USD
 * Inline facts qualify, including precision; never parses a free-form dollar guess. */
export function extractDepreciationDisclosures(
  html: string,
  filing: DebtFiling,
): DepreciationDisclosure[] {
  const prefix = `https://www.sec.gov/Archives/edgar/data/${Number(filing.cik)}/${filing.accessionNumber.replaceAll('-', '')}/`;
  if (
    !/^\d{10}$/.test(filing.cik) ||
    !/^\d{10}-\d{2}-\d{6}$/.test(filing.accessionNumber) ||
    !new URL(filing.sourceUrl).href.startsWith(prefix)
  )
    throw Error('Invalid D&A filing identity');
  const $ = load(html, { xmlMode: true });
  const nodes = $('*')
    .toArray()
    .filter((n): n is Element => n.type === 'tag');
  const ns = 'http://www.xbrl.org/2003/instance',
    ix = 'http://www.xbrl.org/2013/inlineXBRL';
  const is = (n: Element, space: string, name: string) =>
    qname(n, n.name) === `{${space}}${name}`;
  const descendants = (n: Element, space: string, name: string) =>
    $(n)
      .find('*')
      .toArray()
      .filter((x): x is Element => x.type === 'tag')
      .filter((x) => is(x, space, name));
  const dei = (name: string) =>
    nodes
      .filter(
        (n) =>
          /^\{http:\/\/xbrl.sec.gov\/dei\/\d{4}\}/.test(
            qname(n, n.attribs.name) ?? '',
          ) && n.attribs.name?.split(':').pop() === name,
      )
      .map((n) => $(n).text().trim());
  const form = dei('DocumentType')[0];
  if (
    !/^10-[KQ](\/A)?$/.test(form ?? '') ||
    (filing.filingType && filing.filingType !== form) ||
    !dei('DocumentPeriodEndDate').some(
      (d) =>
        Number.isFinite(Date.parse(d + ' UTC')) &&
        new Date(d + ' UTC').toISOString().slice(0, 10) === filing.reportDate,
    )
  )
    throw Error('D&A document identity mismatch');
  const contexts = new Map<string, { start: string; end: string }>();
  const ids = new Set<string>();
  for (const n of nodes.filter((n) => is(n, ns, 'context'))) {
    const id = n.attribs.id;
    if (ids.has(id)) throw Error('Duplicate D&A context');
    ids.add(id);
    const identifiers = descendants(n, ns, 'identifier'),
      starts = descendants(n, ns, 'startDate'),
      ends = descendants(n, ns, 'endDate');
    if (
      identifiers.length !== 1 ||
      identifiers[0].attribs.scheme !== 'http://www.sec.gov/CIK' ||
      $(identifiers[0]).text().trim().padStart(10, '0') !== filing.cik ||
      starts.length !== 1 ||
      ends.length !== 1 ||
      $(n)
        .find('*')
        .toArray()
        .some((x) =>
          [
            'segment',
            'scenario',
            'explicitMember',
            'typedMember',
            'instant',
          ].includes('name' in x ? x.name.split(':').pop()! : ''),
        )
    )
      continue;
    const start = $(starts[0]).text().trim(),
      end = $(ends[0]).text().trim(),
      days = (Date.parse(end) - Date.parse(start)) / 86400000;
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(start) &&
      /^\d{4}-\d{2}-\d{2}$/.test(end) &&
      days >= 60 &&
      days <= 380 &&
      end <= filing.reportDate
    )
      contexts.set(id, { start, end });
  }
  const units = new Set<string>(),
    unitIds = new Set<string>();
  for (const n of nodes.filter((n) => is(n, ns, 'unit'))) {
    if (unitIds.has(n.attribs.id)) throw Error('Duplicate D&A unit');
    unitIds.add(n.attribs.id);
    const measures = descendants(n, ns, 'measure');
    if (
      measures.length === 1 &&
      !descendants(n, ns, 'divide').length &&
      qname(measures[0], $(measures[0]).text().trim()) ===
        '{http://www.xbrl.org/2003/iso4217}USD'
    )
      units.add(n.attribs.id);
  }
  const result: DepreciationDisclosure[] = [],
    hash = createHash('sha256').update(html).digest('hex');
  for (const n of nodes.filter((n) => is(n, ix, 'nonFraction'))) {
    const a = n.attribs,
      period = contexts.get(a.contextRef),
      qualified = qname(n, a.name),
      local = a.name?.split(':').pop();
    if (
      !period ||
      !units.has(a.unitRef) ||
      !qualified ||
      !local ||
      a.continuedAt ||
      a.target ||
      ['true', '1'].includes(a['xsi:nil'])
    )
      continue;
    const standard = /^\{https?:\/\/fasb.org\/us-gaap\/\d{4}\}/.test(qualified);
    let kind: DepreciationDisclosure['kind'];
    if (
      standard &&
      [
        'DepreciationDepletionAndAmortization',
        'DepreciationAndAmortization',
      ].includes(local)
    )
      kind = 'total';
    else if (standard && local === 'Depreciation') kind = 'depreciation';
    else if (standard && local === 'AmortizationOfIntangibleAssets')
      kind = 'amortization';
    else {
      const row = $(n).closest('tr'),
        label = row
          .find('td')
          .first()
          .text()
          .toLowerCase()
          .replace(/[^a-z]/g, '');
      // Issuer extensions qualify only on a pure D&A cash-flow line, never Other.
      const table = $(n).closest('table');
      if (
        standard ||
        ![
          'DepreciationAndAmortization',
          'DepreciationDepletionAndAmortization',
        ].includes(local) ||
        ![
          'depreciationandamortization',
          'depreciationdepletionandamortization',
        ].includes(label) ||
        !table
          .find('*')
          .toArray()
          .some(
            (x) =>
              x.type === 'tag' &&
              /\}NetCashProvidedByUsedInOperatingActivities$/.test(
                qname(x, x.attribs.name) ?? '',
              ),
          )
      )
        continue;
      kind = 'total';
    }
    try {
      const val = Number(
        amount(
          $(n).text(),
          a.scale,
          a.sign,
          a.format ? (qname(n, a.format) ?? a.format) : undefined,
        ),
      );
      if (
        !Number.isSafeInteger(val) ||
        val < 0 ||
        !/^(INF|-?\d+)$/.test(a.decimals ?? '')
      )
        continue;
      const decimals = a.decimals === 'INF' ? 'INF' : Number(a.decimals);
      result.push({
        ...period,
        val,
        kind,
        cik: filing.cik,
        concept: standard ? `us-gaap:${local}` : qualified,
        accn: filing.accessionNumber,
        filed: filing.filingDate,
        form,
        unit: 'USD',
        url: filing.sourceUrl,
        decimals,
        approximate: decimals !== 'INF' && decimals < -6,
        evidence: `Inline XBRL ${a.id ?? a.contextRef}; SHA256 ${hash}; ${$(n).parent().text().replace(/\s+/g, ' ').slice(0, 240)}`,
      });
    } catch {
      /* Unsupported transforms or scales leave the input missing. */
    }
  }
  return result;
}
