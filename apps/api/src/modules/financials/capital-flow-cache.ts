import { load } from 'cheerio';
import { CAPITAL_FLOW_TAGS } from './capital-overview';
import type { Element } from 'domhandler';
import { qname, amount } from '../revenue/parser/facts.cjs';
import type { DebtFiling } from './debt-disclosure';
import type { CapitalFlowFact } from '@company-research/shared';
/** Bounded annual entity-wide Inline facts from an already cached cash-flow statement. No retrieval. */
export function cachedCapitalFlowFacts(
  html: string,
  f: DebtFiling,
): CapitalFlowFact[] {
  const prefix = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.accessionNumber.replaceAll('-', '')}/`;
  if (
    !/^\d{10}$/.test(f.cik) ||
    !/^\d{10}-\d{2}-\d{6}$/.test(f.accessionNumber) ||
    !f.sourceUrl.startsWith(prefix)
  )
    throw Error('Invalid cached filing identity');
  const $ = load(html, { xmlMode: true }),
    nodes = $('*')
      .toArray()
      .filter((n): n is Element => n.type === 'tag');
  const local = (n: Element) => n.name.split(':').pop();
  const dei = (name: string) =>
    nodes
      .filter(
        (n) =>
          n.attribs.name?.split(':').pop() === name &&
          /^\{http:\/\/xbrl.sec.gov\/dei\//.test(
            qname(n, n.attribs.name) ?? '',
          ),
      )
      .map((n) => $(n).text().trim());
  if (
    !dei('DocumentType').some((x) => /^10-K(\/A)?$/.test(x)) ||
    !dei('DocumentPeriodEndDate').some(
      (x) =>
        Number.isFinite(Date.parse(x + ' UTC')) &&
        new Date(x + ' UTC').toISOString().slice(0, 10) === f.reportDate,
    )
  )
    throw Error('Cached filing report identity mismatch');
  const contexts = new Map<string, { start: string; end: string }>(),
    units = new Set<string>();
  for (const n of nodes) {
    if (local(n) === 'context') {
      const descendants = $(n)
          .find('*')
          .toArray()
          .filter((x): x is Element => x.type === 'tag'),
        get = (name: string) => descendants.filter((x) => local(x) === name);
      const id = get('identifier'),
        s = get('startDate'),
        e = get('endDate');
      if (
        id.length !== 1 ||
        $(id[0]).text().trim().padStart(10, '0') !== f.cik ||
        id[0].attribs.scheme !== 'http://www.sec.gov/CIK' ||
        s.length !== 1 ||
        e.length !== 1 ||
        descendants.some((x) =>
          [
            'segment',
            'scenario',
            'explicitMember',
            'typedMember',
            'instant',
          ].includes(local(x)!),
        )
      )
        continue;
      const start = $(s[0]).text().trim(),
        end = $(e[0]).text().trim(),
        days = (Date.parse(end) - Date.parse(start)) / 86400000;
      if (days >= 349 && days <= 379 && end <= f.reportDate)
        contexts.set(n.attribs.id, { start, end });
    } else if (local(n) === 'unit') {
      const measures = $(n)
        .find('*')
        .toArray()
        .filter(
          (x): x is Element => x.type === 'tag' && local(x) === 'measure',
        );
      if (
        measures.length === 1 &&
        qname(measures[0], $(measures[0]).text().trim()) ===
          '{http://www.xbrl.org/2003/iso4217}USD'
      )
        units.add(n.attribs.id);
    }
  }
  const result: CapitalFlowFact[] = [];
  for (const n of nodes) {
    if (qname(n, n.name) !== '{http://www.xbrl.org/2013/inlineXBRL}nonFraction')
      continue;
    const a = n.attribs,
      p = contexts.get(a.contextRef);
    if (
      !p ||
      !units.has(a.unitRef) ||
      a.continuedAt ||
      a.target ||
      ['true', '1'].includes(a['xsi:nil'])
    )
      continue;
    if (!CAPITAL_FLOW_TAGS.has(a.name?.split(':').pop() ?? '')) continue;
    const qualified = qname(n, a.name);
    if (!qualified) continue;
    const table = $(n).closest('table').text().replace(/\s+/g, ' ');
    if (
      !/net cash|cash generated|cash used/i.test(table) ||
      !/investing/i.test(table) ||
      !/financing/i.test(table)
    )
      continue;
    try {
      const value = Number(
        amount(
          $(n).text(),
          a.scale,
          a.sign,
          a.format ? qname(n, a.format) : null,
        ),
      );
      if (!Number.isSafeInteger(value)) continue;
      result.push({
        statement: true,
        concept: a.name,
        value,
        ...p,
        accessionNumber: f.accessionNumber,
        filed: f.filingDate,
        url: f.sourceUrl,
        unit: 'USD',
      });
    } catch {
      /* Unsupported Inline formats remain unavailable. */
    }
  }
  return result;
}
