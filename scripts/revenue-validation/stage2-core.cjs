/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS validation tooling. */
/* global require, module */
const { load } = require('cheerio');
const suffix = (e) => e.arcrole?.split('/').pop();
const local = (q) => q?.split('}')[1];
const standard = (q, name) =>
  new RegExp(`^\\{http://fasb.org/(us-gaap|srt)/\\d{4}\\}${name}$`).test(
    q || '',
  );
function path(edges, from, to, kinds, seen = new Set()) {
  if (from === to) return [];
  if (seen.has(from)) return null;
  seen = new Set(seen).add(from);
  for (const edge of edges.filter(
    (e) => e.from === from && kinds.includes(suffix(e)) && e.usable !== 'false',
  )) {
    const rest = path(edges, edge.to, to, kinds, seen);
    if (rest) return [edge, ...rest];
  }
  return null;
}
function canonical(f) {
  return JSON.stringify([
    f.concept,
    f.unit,
    [...f.context.dimensions].sort((a, b) =>
      a.dimension.localeCompare(b.dimension),
    ),
  ]);
}
function unsupported(n) {
  return n.edges.some(
    (e) =>
      e.targetRole ||
      e.use === 'prohibited' ||
      (e.priority && e.priority !== '0') ||
      suffix(e) === 'notAll',
  );
}
function classify(fact, networks) {
  const matches = [];
  for (const net of networks.filter(
    (n) => n.kind === 'definitionLink' && !unsupported(n),
  )) {
    for (const all of net.edges.filter(
      (e) => suffix(e) === 'all' && e.contextElement === 'segment',
    )) {
      const primary = path(net.edges, all.from, fact.concept, [
        'domain-member',
      ]);
      if (!primary) continue;
      const axes = net.edges
        .filter((e) => e.from === all.to && suffix(e) === 'hypercube-dimension')
        .map((e) => e.to);
      if (
        !axes.length ||
        fact.context.dimensions.some((d) => !axes.includes(d.dimension))
      )
        continue;
      const bindings = [];
      let valid = true;
      for (const axis of axes) {
        const explicit = fact.context.dimensions.find(
          (d) => d.dimension === axis,
        );
        const defaults = net.edges.filter(
          (e) => e.from === axis && suffix(e) === 'dimension-default',
        );
        const member =
          explicit?.member || (defaults.length === 1 ? defaults[0].to : null);
        const domain = net.edges.filter(
          (e) => e.from === axis && suffix(e) === 'dimension-domain',
        );
        const proofs = domain
          .map((e) => {
            const p =
              member && path(net.edges, e.to, member, ['domain-member']);
            return p ? [e, ...p] : null;
          })
          .filter(Boolean);
        if (
          proofs.length !== 1 ||
          (!explicit && member === null) ||
          (explicit && defaults.some((e) => e.to === member))
        ) {
          valid = false;
          break;
        }
        bindings.push({
          dimension: axis,
          member,
          explicit: !!explicit,
          path: proofs[0],
          parent: proofs[0].at(-1).from,
        });
      }
      if (valid)
        matches.push({
          role: net.role,
          hypercube: all.to,
          primary,
          bindings,
          closed: all.closed === 'true',
        });
    }
  }
  return matches;
}
function displayLabel(fact, member, role, networks) {
  const pre = networks.find(
    (n) => n.kind === 'presentationLink' && n.role === role,
  );
  if (!pre || unsupported(pre)) return null;
  const edges = pre.edges.filter((e) => e.to === member);
  const roles = [
    ...new Set(
      edges.map(
        (e) => e.preferredLabel || 'http://www.xbrl.org/2003/role/label',
      ),
    ),
  ];
  if (roles.length !== 1) return null;
  const labels =
    fact.officialLabels.find((d) => d.member === member)?.labels || [];
  const texts = [
    ...new Set(
      labels
        .filter((x) => x.role === roles[0] && /^en(-|$)/i.test(x.language))
        .map((x) => x.text),
    ),
  ];
  return texts.length === 1 ? { text: texts[0], role: roles[0] } : null;
}
const norm = (s) =>
  s
    .replace(/\s*\[(Member|Domain)\]\s*$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
function tableEvidence(html, fact, label) {
  const $ = load(html, { xmlMode: true });
  const tables = $('table').toArray();
  const table = tables[fact.sourcePosition?.tableIndex];
  if (!table) return null;
  const rows = $(table)
    .find('tr')
    .toArray()
    .filter((n) => $(n).closest('table')[0] === table);
  const row = rows[fact.sourcePosition.rowIndex];
  if (!row) return null;
  const texts = $(row)
    .children('td,th')
    .toArray()
    .map((n) => $(n).text());
  const heading = norm(label.text);
  if (heading.length < 2) return null;
  if (texts.some((t) => norm(t).includes(heading)))
    return {
      tableIndex: fact.sourcePosition.tableIndex,
      rowIndex: fact.sourcePosition.rowIndex,
      kind: 'row-label',
      label: label.text,
    };
  // Do not guess at column headers or colspan/rowspan. Keep such cases unbound.
  return null;
}
function approveComparable(current, prior) {
  if (!current.revenueApproved || !prior.revenueApproved)
    return {
      approved: false,
      reason: 'requires classified external-customer revenue',
    };
  if (
    canonical(current) !== canonical(prior) ||
    current.accessionNumber !== prior.accessionNumber
  )
    return {
      approved: false,
      reason: 'concept, tuple, unit or accession changed',
    };
  const a = current.context,
    b = prior.context,
    days = (x, y) => (Date.parse(y) - Date.parse(x)) / 86400000;
  if (
    days(b.end, a.end) < 330 ||
    days(b.end, a.end) > 400 ||
    Math.abs(days(a.start, a.end) - days(b.start, b.end)) > 7
  )
    return {
      approved: false,
      reason: 'period durations/year offset incompatible',
    };
  const common = current.classifications.find((c) =>
    prior.classifications.some((p) => p.role === c.role),
  );
  if (!common)
    return { approved: false, reason: 'no common classified disclosure role' };
  const pair = current.bindings.find((c) =>
    prior.bindings.some(
      (p) =>
        p.tableIndex === c.tableIndex &&
        p.rowIndex === c.rowIndex &&
        p.label === c.label,
    ),
  );
  if (!pair)
    return {
      approved: false,
      reason:
        'no identical physical comparative row; column-oriented data unsupported',
    };
  if (BigInt(prior.value) <= 0n)
    return { approved: false, reason: 'nonpositive prior revenue' };
  return {
    approved: true,
    reason:
      'same filing comparative row and definition role; identical full tuple/concept/unit; annual duration reconciled',
    value:
      Number(
        ((BigInt(current.value) - BigInt(prior.value)) * 10000000000n) /
          BigInt(prior.value),
      ) / 100000000,
    priorContext: prior.context,
    tableIndex: pair.tableIndex,
    rowIndex: pair.rowIndex,
    role: common.role,
    basis:
      'latest filing comparative/recast presentation only; not original historical filings',
  };
}
module.exports = {
  path,
  canonical,
  unsupported,
  classify,
  displayLabel,
  tableEvidence,
  approveComparable,
  local,
  standard,
};
