/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS tools reuse the compiled NestJS SEC client. */
/* global require, module, URL */
// Deliberately isolated stage-1 candidate extractor. Not a production data source.
const { load } = require('cheerio');
const XBRLI = 'http://www.xbrl.org/2003/instance';
const XBRLDI = 'http://xbrl.org/2006/xbrldi';
const IX = 'http://www.xbrl.org/2013/inlineXBRL';
function qname(node, value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 2) return null;
  let parent = node;
  while (parent) {
    const ns = parent.attribs?.[`xmlns:${parts[0]}`];
    if (ns) return `{${ns}}${parts[1]}`;
    parent = parent.parent;
  }
  return null;
}
function local(node) {
  return String(node.name || '')
    .split(':')
    .pop();
}
function namespace(node) {
  return qname(node, node.name)?.match(/^\{([^}]+)\}/)?.[1];
}
function amount(text, scale, sign, format) {
  const fmt = format?.replace(/^\{[^}]+\}/, '');
  if (
    format &&
    !/^\{http:\/\/www.xbrl.org\/inlineXBRL\/transformation\/(2015-02-26|2020-02-12|2022-02-16)\}(num-dot-decimal|numdotdecimal|fixed-zero|zerodash)$/.test(
      format,
    )
  )
    throw Error('unsupported transformation');
  let v = text.trim().replace(/\u00a0/g, ' ');
  if (['fixed-zero', 'zerodash'].includes(fmt)) {
    if (!/^[-–—]$/.test(v)) throw Error('invalid declared zero');
    v = '0';
  }
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(v))
    throw Error('invalid numeric text');
  if (!/^-?\d+$/.test(scale || '0') || Math.abs(Number(scale || 0)) > 12)
    throw Error('invalid scale');
  if (sign && sign !== '-') throw Error('invalid sign');
  const [whole, fraction = ''] = v.replaceAll(',', '').split('.');
  const exponent = Number(scale || 0) - fraction.length;
  let n = BigInt(whole + fraction) * (sign === '-' ? -1n : 1n);
  if (exponent < 0) {
    const divisor = 10n ** BigInt(-exponent);
    if (n % divisor) throw Error('nonintegral USD unsupported');
    n /= divisor;
  } else n *= 10n ** BigInt(exponent);
  return n.toString();
}
function inspect(html, metadata, options = {}) {
  if (
    !/^\d{10}$/.test(metadata.cik) ||
    !/^\d{10}-\d{2}-\d{6}$/.test(metadata.accessionNumber)
  )
    throw Error('invalid filing identity');
  const expected = `/Archives/edgar/data/${Number(metadata.cik)}/${metadata.accessionNumber.replaceAll('-', '')}/`;
  const url = new URL(metadata.sourceUrl);
  if (
    url.origin !== 'https://www.sec.gov' ||
    !url.pathname.startsWith(expected)
  )
    throw Error('filing URL identity mismatch');
  const $ = load(html, { xmlMode: true });
  const all = $('*').toArray();
  const is = (node, ns, name) => local(node) === name && namespace(node) === ns;
  const children = (node, ns, name) =>
    $(node)
      .find('*')
      .toArray()
      .filter((x) => is(x, ns, name));
  const text = (node, ns, name) =>
    children(node, ns, name).map((n) => $(n).text().trim());
  const contexts = new Map();
  const units = new Map();
  const rejected = [];
  const candidates = [];
  const tables = $('table').toArray();
  const linkRefs = all
    .filter((n) => local(n) === 'schemaRef')
    .map((n) => n.attribs['xlink:href']);
  for (const node of all.filter((n) => is(n, XBRLI, 'context'))) {
    const dimensions = children(node, XBRLDI, 'explicitMember').map((n) => ({
      dimension: qname(n, n.attribs.dimension),
      member: qname(n, $(n).text().trim()),
    }));
    const ids = children(node, XBRLI, 'identifier');
    const context = {
      id: node.attribs.id,
      cik: ids.length === 1 ? $(ids[0]).text().trim().padStart(10, '0') : null,
      scheme: ids[0]?.attribs.scheme,
      start: text(node, XBRLI, 'startDate')[0],
      end: text(node, XBRLI, 'endDate')[0],
      instant: text(node, XBRLI, 'instant')[0],
      dimensions,
      typed: children(node, XBRLDI, 'typedMember').length,
    };
    if (contexts.has(context.id)) throw Error('duplicate context ID');
    contexts.set(context.id, context);
  }
  for (const node of all.filter((n) => is(n, XBRLI, 'unit'))) {
    if (units.has(node.attribs.id)) throw Error('duplicate unit ID');
    const measures = children(node, XBRLI, 'measure');
    units.set(
      node.attribs.id,
      measures.length === 1 && !children(node, XBRLI, 'divide').length
        ? qname(measures[0], $(measures[0]).text().trim())
        : null,
    );
  }
  for (const node of all.filter((n) => is(n, IX, 'nonFraction'))) {
    const a = node.attribs;
    const concept = qname(node, a.name);
    // This exact whitelist is only a revenue *candidate* gate. Presentation and
    // definition relationships/external-customer semantics still require validation.
    const adjustment =
      options.tableMode &&
      /^\{http:\/\/fasb.org\/us-gaap\/\d{4}\}RevenueNotFromContractWithCustomer$/.test(
        concept || '',
      );
    if (
      !concept ||
      (!adjustment &&
        !/^\{http:\/\/fasb.org\/us-gaap\/\d{4}\}(RevenueFromContractWithCustomerExcludingAssessedTax|RevenueFromContractWithCustomerIncludingAssessedTax|Revenues|SalesRevenueNet)$/.test(
          concept,
        ))
    )
      continue;
    const context = contexts.get(a.contextRef);
    if (!context || (!options.tableMode && !context.dimensions.length))
      continue;
    try {
      if (
        context.cik !== metadata.cik ||
        context.scheme !== 'http://www.sec.gov/CIK'
      )
        throw Error('CIK mismatch');
      if (
        context.typed ||
        context.instant ||
        !context.start ||
        !context.end ||
        context.dimensions.some((d) => !d.dimension || !d.member)
      )
        throw Error('unsupported context');
      for (const date of [context.start, context.end])
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date
        )
          throw Error('invalid period date');
      const days =
        (Date.parse(context.end) - Date.parse(context.start)) / 86400000 + 1;
      if (days < 330 || days > 400 || context.end > metadata.reportDate)
        throw Error('not a complete historical annual duration');
      const ago =
        (Date.parse(metadata.reportDate) - Date.parse(context.end)) / 86400000;
      if (ago > 750) throw Error('outside latest three years');
      if (units.get(a.unitRef) !== '{http://www.xbrl.org/2003/iso4217}USD')
        throw Error('non-USD/unknown unit');
      if (a['xsi:nil'] === 'true' || a.continuedAt || a.target)
        throw Error('nil/continuation/target unsupported');
      const numeric = $(node).clone();
      numeric
        .find('*')
        .filter((_, n) => local(n) === 'exclude' && namespace(n) === IX)
        .remove();
      if (a.format && !qname(node, a.format))
        throw Error('unresolved transformation QName');
      const value = amount(
        numeric.text(),
        a.scale,
        a.sign,
        a.format ? qname(node, a.format) : null,
      );
      if (BigInt(value) < 0n && !adjustment)
        throw Error('negative revenue candidate');
      const row = $(node).closest('tr').text().replace(/\s+/g, ' ').trim();
      const tableNode = $(node).closest('table')[0];
      const rowNode = $(node).closest('tr')[0];
      candidates.push({
        sourcePosition: {
          tableIndex: tables.indexOf(tableNode),
          rowIndex: tableNode
            ? $(tableNode).find('tr').toArray().indexOf(rowNode)
            : -1,
          factId: a.id || null,
        },
        sourceUrl: metadata.sourceUrl,
        accessionNumber: metadata.accessionNumber,
        concept,
        context,
        unit: 'USD',
        rawText: numeric.text(),
        scale: a.scale || '0',
        sign: a.sign || '',
        format: a.format || null,
        decimals: a.decimals,
        value,
        tableRow: row,
        status: 'CANDIDATE_NOT_APPROVED',
      });
    } catch (e) {
      rejected.push({ concept, contextId: a.contextRef, reason: e.message });
    }
  }
  const unique = new Map();
  const conflicts = [];
  for (const fact of candidates) {
    const key = JSON.stringify([
      fact.concept,
      fact.context.start,
      fact.context.end,
      fact.unit,
      [...fact.context.dimensions].sort((a, b) =>
        a.dimension.localeCompare(b.dimension),
      ),
    ]);
    const existing = unique.get(key);
    if (existing && existing.value !== fact.value) {
      conflicts.push({ key, values: [existing.value, fact.value] });
      existing.status = 'CONFLICT';
    } else if (!existing) unique.set(key, fact);
  }
  return {
    metadata,
    schemaRefs: linkRefs,
    contexts: contexts.size,
    candidates: [...unique.values()],
    duplicates: candidates.length - unique.size,
    occurrences: candidates,
    rejected,
    conflicts,
    productionApproved: 0,
  };
}
module.exports = { inspect, amount, qname };
