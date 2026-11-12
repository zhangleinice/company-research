/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS tools reuse the compiled NestJS SEC client. */
/* global require, console */
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const { inspect, qname } = require('./parser.cjs');
const root = '/tmp/revenue-breakdown-validation';
function local(n) {
  return n.name?.split(':').pop();
}
const output = [];
for (const name of ['alphabet', 'apple', 'nvidia']) {
  const dir = path.join(root, name),
    html = fs.readFileSync(dir + '/filing.htm', 'utf8'),
    metadata = JSON.parse(fs.readFileSync(dir + '/metadata.json'));
  const report = inspect(html, metadata);
  const doc = load(html, { xmlMode: true });
  const rootNode = doc('html')[0];
  const resolve = (href) => {
    const id = href?.split('#')[1];
    if (!id) return null;
    const pos = id.indexOf('_');
    return pos < 0
      ? null
      : qname(rootNode, id.slice(0, pos) + ':' + id.slice(pos + 1));
  };
  const refs = JSON.parse(fs.readFileSync(dir + '/linkbases.json'));
  const labels = new Map(),
    networks = [];
  for (const ref of refs) {
    const $ = load(fs.readFileSync(path.join(dir, ref.href), 'utf8'), {
      xmlMode: true,
    });
    for (const link of $('*')
      .toArray()
      .filter((n) =>
        ['labelLink', 'definitionLink', 'presentationLink'].includes(local(n)),
      )) {
      const nodes = $(link).children().toArray(),
        loc = new Map(),
        resources = new Map(),
        edges = [];
      for (const n of nodes) {
        if (local(n) === 'loc')
          loc.set(n.attribs['xlink:label'], resolve(n.attribs['xlink:href']));
        if (local(n) === 'label')
          resources.set(n.attribs['xlink:label'], [
            ...(resources.get(n.attribs['xlink:label']) || []),
            {
              text: $(n).text(),
              role: n.attribs['xlink:role'],
              language: n.attribs['xml:lang'],
            },
          ]);
      }
      for (const n of nodes) {
        const a = n.attribs;
        if (local(n) === 'labelArc') {
          const key = loc.get(a['xlink:from']),
            resource = resources.get(a['xlink:to']);
          if (key && resource) {
            const list = labels.get(key) || [];
            list.push(...resource);
            labels.set(key, list);
          }
        } else if (['definitionArc', 'presentationArc'].includes(local(n)))
          edges.push({
            from: loc.get(a['xlink:from']),
            to: loc.get(a['xlink:to']),
            arcrole: a['xlink:arcrole'],
            preferredLabel: a.preferredLabel,
            targetRole: a['xbrldt:targetRole'],
            use: a.use,
            priority: a.priority,
            closed: a['xbrldt:closed'],
            contextElement: a['xbrldt:contextElement'],
            usable: a['xbrldt:usable'],
          });
      }
      if (edges.length)
        networks.push({
          role: link.attribs['xlink:role'],
          kind: local(link),
          edges,
        });
    }
  }
  fs.writeFileSync(dir + '/networks.json', JSON.stringify(networks, null, 2));
  const groupKey = (f) => JSON.stringify([f.concept, f.context.dimensions]);
  for (const fact of report.candidates) {
    fact.officialLabels = fact.context.dimensions.map((d) => ({
      ...d,
      labels: labels.get(d.member) || [],
    }));
    const required = [
      fact.concept,
      ...fact.context.dimensions.flatMap((d) => [d.dimension, d.member]),
    ];
    fact.presentationRoles = networks
      .filter(
        (n) =>
          n.kind === 'presentationLink' &&
          required.every((k) =>
            n.edges.some((e) => e.from === k || e.to === k),
          ),
      )
      .map((n) => n.role);
    fact.dimensionRelationships = fact.context.dimensions.map((d) => {
      const roles = networks.filter(
        (n) =>
          n.kind === 'definitionLink' &&
          n.edges.some((e) => e.from === d.dimension || e.to === d.dimension) &&
          n.edges.some((e) => e.to === d.member),
      );
      return {
        ...d,
        roles: roles.map((n) => n.role),
        hasTargetRole: roles.some((n) => n.edges.some((e) => e.targetRole)),
      };
    });
    const prior = report.candidates.find(
      (p) =>
        groupKey(p) === groupKey(fact) &&
        Math.abs(
          (Date.parse(fact.context.end) - Date.parse(p.context.end)) /
            86400000 -
            365,
        ) < 15,
    );
    fact.arithmeticYoYNotApproved =
      prior && BigInt(prior.value) > 0n
        ? (Number(fact.value) / Number(prior.value) - 1) * 100
        : null;
    fact.blockers = [
      'No complete XBRL Dimensions validity/targetRole/default/arc priority processor',
      'External-customer versus intersegment/adjustment semantics not yet proven per table',
      'Official preferred-label selection and parent/subtotal exclusion not certified',
    ];
    if (fact.context.dimensions.length > 1)
      fact.blockers.push(
        'Multiple axes retained as a tuple; no flattening or aggregation permitted',
      );
    if (!fact.presentationRoles.length)
      fact.blockers.push(
        'No single presentation role contains concept plus all dimension/member locators',
      );
  }
  report.relationshipNetworkCount = networks.length;
  report.stageTwoAllowed = false;
  fs.writeFileSync(dir + '/audit.json', JSON.stringify(report, null, 2));
  output.push({
    name,
    metadata,
    candidates: report.candidates.length,
    duplicates: report.duplicates,
    conflicts: report.conflicts.length,
    dimensions: [
      ...new Set(
        report.candidates.flatMap((f) =>
          f.context.dimensions.map((d) => d.dimension),
        ),
      ),
    ],
    withPresentationRole: report.candidates.filter(
      (f) => f.presentationRoles.length,
    ).length,
    productionApproved: 0,
    stageTwoAllowed: false,
  });
}
fs.writeFileSync(root + '/summary.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
