import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { amount, qname } from '../revenue/parser/facts.cjs';
import type { HealthValue } from './balance-sheet-inputs';

export interface DebtFiling {
  cik: string;
  accessionNumber: string;
  reportDate: string;
  filingDate: string;
  sourceUrl: string;
  filingType?: '10-K' | '10-Q';
}
export interface DebtDisclosure {
  version: 'debt-disclosure-v1';
  filing: DebtFiling;
  periodEnd: string;
  facts: HealthValue[];
  plainDebt: number | null;
  financingDebt: number | null;
  financeLeases: number | null;
  currentPlainDebt: number | null;
  noncurrentPlainDebt: number | null;
  evidence: Record<string, unknown>[];
  currentInvestments: number | null;
  balanceLiabilities: number;
  reason: string | null;
}
const XBRLI = 'http://www.xbrl.org/2003/instance';
const IX = 'http://www.xbrl.org/2013/inlineXBRL';
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const local = (n: { name?: string }) => n.name?.split(':').pop();

/** Deterministic statement evidence, not a word search for dollar amounts.
 * Facts must have a consolidated instant context, SEC CIK, USD unit and a
 * supported Inline XBRL transform. Arithmetic alone never certifies face value. */
export function extractDebtDisclosures(
  html: string,
  filing: DebtFiling,
): DebtDisclosure[] {
  const expected = `https://www.sec.gov/Archives/edgar/data/${Number(filing.cik)}/${filing.accessionNumber.replaceAll('-', '')}/`;
  if (
    !/^\d{10}$/.test(filing.cik) ||
    !/^\d{10}-\d{2}-\d{6}$/.test(filing.accessionNumber) ||
    !new URL(filing.sourceUrl).href.startsWith(expected)
  )
    throw Error('Invalid debt filing identity');
  const $ = load(html, { xmlMode: true });
  const nodes = $('*')
    .toArray()
    .filter(
      (n): n is import('domhandler').Element =>
        n.type === 'tag' || n.type === 'script' || n.type === 'style',
    );
  const is = (n: (typeof nodes)[number], ns: string, name: string) =>
    qname(n, n.name ?? '') === `{${ns}}${name}`;
  const descendants = (n: (typeof nodes)[number], ns: string, name: string) =>
    $(n)
      .find('*')
      .toArray()
      .filter((x) => is(x, ns, name));
  const dei = (name: string) =>
    nodes
      .filter(
        (n) =>
          /^\{http:\/\/xbrl.sec.gov\/dei\/\d{4}\}/.test(
            qname(n, n.attribs?.name ?? '') ?? '',
          ) && n.attribs?.name?.split(':').pop() === name,
      )
      .map((n) => clean($(n).text()));
  if (
    !dei('DocumentType').some(
      (s) =>
        /^10-[KQ](\/A)?$/.test(s) &&
        (!filing.filingType || s === filing.filingType),
    ) ||
    !dei('DocumentPeriodEndDate').some(
      (text) =>
        Number.isFinite(Date.parse(text + ' UTC')) &&
        new Date(text + ' UTC').toISOString().slice(0, 10) ===
          filing.reportDate,
    )
  )
    throw Error('Debt filing DEI identity mismatch');
  const documentType = dei('DocumentType')[0];
  const contexts = new Map<string, string>();
  const contextIds = new Set<string>();
  for (const n of nodes.filter((n) => is(n, XBRLI, 'context'))) {
    const id = n.attribs.id;
    if (contextIds.has(id)) throw Error('Duplicate context ID');
    contextIds.add(id);
    const identifiers = descendants(n, XBRLI, 'identifier');
    const instants = descendants(n, XBRLI, 'instant');
    if (
      identifiers.length !== 1 ||
      identifiers[0].attribs.scheme !== 'http://www.sec.gov/CIK' ||
      $(identifiers[0]).text().trim().padStart(10, '0') !== filing.cik ||
      instants.length !== 1 ||
      $(n)
        .find('*')
        .toArray()
        .some((x) =>
          ['explicitMember', 'typedMember', 'startDate'].includes(
            local(x) ?? '',
          ),
        )
    )
      continue;
    const end = $(instants[0]).text().trim();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      !Number.isFinite(Date.parse(end)) ||
      new Date(end).toISOString().slice(0, 10) !== end ||
      end > filing.reportDate
    )
      continue;
    contexts.set(id, end);
  }
  const units = new Set<string>();
  const unitIds = new Set<string>();
  for (const n of nodes.filter((n) => is(n, XBRLI, 'unit'))) {
    if (unitIds.has(n.attribs.id)) throw Error('Duplicate unit ID');
    unitIds.add(n.attribs.id);
    const measures = descendants(n, XBRLI, 'measure');
    if (
      measures.length === 1 &&
      qname(measures[0], $(measures[0]).text().trim()) ===
        '{http://www.xbrl.org/2003/iso4217}USD' &&
      !descendants(n, XBRLI, 'divide').length
    )
      units.add(n.attribs.id);
  }
  const tables = $('table').toArray();
  const hash = createHash('sha256').update(html).digest('hex');
  type Occurrence = {
    value: HealthValue;
    tag: string;
    end: string;
    table: number;
    label: string;
    id: string | null;
    contribution: number;
    decimals: number;
    rawText: string;
    format: string | null;
    scale: string;
    contextId: string;
  };
  const occurrences: Occurrence[] = [];
  for (const n of nodes.filter((n) => is(n, IX, 'nonFraction'))) {
    const a = n.attribs,
      end = contexts.get(a.contextRef);
    if (
      !end ||
      !units.has(a.unitRef) ||
      ['true', '1'].includes(a['xsi:nil']) ||
      a.continuedAt ||
      a.target
    )
      continue;
    const qualified = qname(n, a.name),
      tag = a.name?.split(':').pop();
    if (
      !qualified ||
      !tag ||
      !/^\{https?:\/\/(?:fasb.org\/us-gaap|[^}]+)\//.test(qualified)
    )
      continue;
    const table = $(n).closest('table')[0] as import('domhandler').Element,
      row = $(n).closest('tr');
    const label = clean(
      row
        .children('td,th')
        .toArray()
        .slice(
          0,
          row
            .children('td,th')
            .toArray()
            .findIndex((c) =>
              $(c)
                .find('*')
                .toArray()
                .some((x) => is(x, IX, 'nonFraction')),
            ),
        )
        .map((c) => $(c).text())
        .join(' '),
    );
    try {
      const format = a.format ? qname(n, a.format) : null;
      const numeric = $(n).clone();
      numeric
        .find('*')
        .filter((_, x) => is(x, IX, 'exclude'))
        .remove();
      // fixed-zero is a declared transformation, including prose such as "no".
      const text = format?.endsWith('}fixed-zero')
        ? '—'
        : clean(numeric.text());
      const number = Number(amount(text, a.scale, a.sign, format));
      if (!Number.isSafeInteger(number)) continue;
      const concept = /^\{https?:\/\/fasb.org\/us-gaap\//.test(qualified)
        ? `us-gaap:${tag}`
        : a.name;
      occurrences.push({
        tag,
        end,
        table: tables.indexOf(table),
        label,
        id: a.id ?? null,
        rawText: clean(numeric.text()),
        format,
        scale: a.scale ?? '0',
        contextId: a.contextRef,
        decimals: a.decimals === 'INF' ? Infinity : Number(a.decimals ?? NaN),
        contribution: /^\s*\(.*\)\s*$/.test(
          $(n).closest('td').text().replace(/\s|\$/g, ''),
        )
          ? -Math.abs(number)
          : number,
        value: {
          concept,
          unit: 'USD',
          fact: {
            end,
            val: number,
            accn: filing.accessionNumber,
            filed: filing.filingDate,
            form: documentType,
          },
        },
      });
    } catch {
      /* Unsupported formats remain missing, never numeric guesses. */
    }
  }
  const results: DebtDisclosure[] = [];
  const tableEnds = [
    ...new Set(
      occurrences
        .filter((x) => x.tag === 'Assets')
        .map((x) => `${x.table}|${x.end}`),
    ),
  ];
  for (const key of tableEnds) {
    const [index, end] = key.split('|'),
      table = Number(index);
    const bs = occurrences.filter((x) => x.table === table && x.end === end);
    const all = occurrences.filter((x) => x.end === end);
    const get = (tag: string, xs = all) => {
      const found = xs.filter(
        (x) => x.tag === tag && x.value.concept === `us-gaap:${tag}`,
      );
      found.sort((a, b) => b.decimals - a.decimals);
      const best = found[0];
      return best &&
        found.every(
          (x) =>
            x.value.fact.val === best.value.fact.val ||
            (Number.isFinite(x.decimals) &&
              x.decimals < best.decimals &&
              Math.abs(x.value.fact.val - best.value.fact.val) <=
                0.5 * Math.pow(10, -x.decimals)),
        )
        ? best
        : undefined;
    };
    const asset = get('Assets', bs),
      cash = get('CashAndCashEquivalentsAtCarryingValue', bs),
      liability = get('Liabilities', bs),
      equity =
        get(
          'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
          bs,
        ) ?? get('StockholdersEquity', bs);
    const currentLiability = get('LiabilitiesCurrent', bs);
    const rowPosition = (x: Occurrence) =>
      $(tables[x.table])
        .find('tr')
        .toArray()
        .findIndex((row) => x.id && $(row).find(`[id="${x.id}"]`).length > 0);
    const firstEquity = Math.min(
      ...bs
        .filter((x) =>
          /^(?:CommonStockValue|CommonStocksIncludingAdditionalPaidInCapital|AdditionalPaidInCapitalCommonStock|StockholdersEquity|PreferredStockValue)$/.test(
            x.tag,
          ),
        )
        .map(rowPosition),
    );
    const noncurrentParts = currentLiability
      ? bs.filter(
          (x) =>
            rowPosition(x) > rowPosition(currentLiability) &&
            rowPosition(x) < firstEquity &&
            /Liabilit|Debt|Lease|Tax.*Payable|Deferred.*Tax/.test(x.tag),
        )
      : [];
    const noncurrentAggregate = get('LiabilitiesNoncurrent', bs);
    const liabilityParts = noncurrentAggregate
      ? [noncurrentAggregate]
      : [...new Map(noncurrentParts.map((x) => [rowPosition(x), x])).values()];
    const balanceLiabilities =
      liability?.value.fact.val ??
      (currentLiability && liabilityParts.length
        ? currentLiability.value.fact.val +
          liabilityParts.reduce((s, x) => s + x.value.fact.val, 0)
        : NaN);
    if (
      !asset ||
      !cash ||
      !equity ||
      !currentLiability ||
      asset.value.fact.val !== balanceLiabilities + equity.value.fact.val
    )
      continue;
    const rawLong = get('LongTermDebtNoncurrent', bs),
      combinedLong = get('LongTermDebtAndCapitalLeaseObligations', bs);
    const combinedCurrent = get(
      'LongTermDebtAndCapitalLeaseObligationsCurrent',
    );
    const current = get('LongTermDebtCurrent') ?? combinedCurrent;
    const cp = get('CommercialPaper'),
      other = get('OtherShortTermBorrowings'),
      short =
        get('ShortTermBorrowings') ??
        get('ShortTermDebt') ??
        get('NotesAndLoansPayable', bs);
    const borrow =
      short?.value.fact.val ??
      (cp && other
        ? cp.value.fact.val + other.value.fact.val
        : cp?.value.fact.val);
    if (
      short &&
      [cp, other].reduce((s, x) => s + (x?.value.fact.val ?? 0), 0) >
        short.value.fact.val
    )
      continue;
    const leaseCandidates = all.filter(
      (x) =>
        x.tag === 'FinanceLeaseLiability' && !/\band other\b/i.test(x.label),
    );
    const pureLease = get('FinanceLeaseLiability', leaseCandidates);
    const leaseCurrent = get('FinanceLeaseLiabilityCurrent');
    const leaseNoncurrent = get('FinanceLeaseLiabilityNoncurrent');
    const leaseParts = [leaseCurrent, leaseNoncurrent].filter(
      (x): x is Occurrence => !!x && !/\band other\b/i.test(x.label),
    );
    const leaseAmount =
      pureLease?.value.fact.val ??
      (leaseParts.length === 2
        ? leaseParts.reduce((s, x) => s + x.value.fact.val, 0)
        : null);

    const bundledLease = get('FinanceLeaseLiability');
    let plain: number | null = null,
      funding: number | null = null,
      currentDebt: number | null = null,
      longDebt: number | null = null;
    const used: Occurrence[] = [
      asset,
      cash,
      equity,
      ...(liability ? [liability] : [currentLiability, ...liabilityParts]),
    ];
    const long = rawLong ?? combinedLong;
    if (
      !long ||
      !current ||
      long.value.fact.val < 0 ||
      current.value.fact.val < 0 ||
      (borrow !== undefined && borrow < 0) ||
      (leaseAmount !== null && leaseAmount < 0)
    )
      continue;
    // A separate debt note must reconcile the balance-sheet long-term amount
    // to current maturities and a declared total, or net principal adjustments.
    const noteTables = [
      ...new Set(
        all
          .filter(
            (x) =>
              x.table !== table &&
              [
                'LongTermDebtNoncurrent',
                'LongTermDebtAndCapitalLeaseObligations',
              ].includes(x.tag) &&
              x.value.fact.val === long.value.fact.val,
          )
          .map((x) => x.table),
      ),
    ];
    let note: Occurrence[] | undefined;
    for (const ni of noteTables) {
      const xs = all.filter((x) => x.table === ni);
      if (
        !xs.some(
          (x) =>
            x.tag === current.tag &&
            x.value.fact.val === current.value.fact.val,
        )
      )
        continue;
      const root = xs.filter(
        (x) =>
          /(?:^|\s)total(?:\b|\d)/i.test(x.label) &&
          (/debt/i.test(x.label) ||
            [
              'LongTermDebt',
              'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities',
            ].includes(x.tag)),
      );
      const net =
        long.value.fact.val +
        current.value.fact.val +
        (combinedLong &&
        !rawLong &&
        !combinedCurrent &&
        !xs.some(
          (x) =>
            x.value.concept === 'us-gaap:LongTermDebtNoncurrent' &&
            x.value.fact.val === long.value.fact.val,
        )
          ? (leaseCurrent?.value.fact.val ?? NaN)
          : 0);
      const cost = xs.filter((x) =>
        /unamortized|hedge.*adjust|premium.*exchange|fair value adjust/i.test(
          x.label,
        ),
      );
      const total = root.find(
        (x) => x.value.fact.val === net && !/face|principal/i.test(x.label),
      );
      const gross = root.find(
        (x) =>
          x.value.fact.val + cost.reduce((s, c) => s + c.contribution, 0) ===
          net,
      );
      if (total || gross) {
        note = xs;
        used.push(total ?? gross!, ...cost, current, long);
        break;
      }
    }
    if (!note) continue;
    // The primary balance sheet enumerates borrowing categories; the note
    // confirms the carrying scope. No absent category is materialized as zero.
    const extraDebtBS = bs.filter(
      (x) =>
        /debt|borrow|paper|notes.*payable/i.test(x.tag) &&
        (x.value.concept !== `us-gaap:${x.tag}` ||
          ![
            'LongTermDebtNoncurrent',
            'LongTermDebtAndCapitalLeaseObligations',
            'LongTermDebtCurrent',
            'LongTermDebtAndCapitalLeaseObligationsCurrent',
            'CommercialPaper',
            'NotesAndLoansPayable',
            'ShortTermBorrowings',
            'ShortTermDebt',
          ].includes(x.tag)),
    );
    const unsupportedBorrowing = all.some(
      (x) =>
        !x.value.concept.startsWith('us-gaap:') &&
        /(?:ShortTerm|Current|Other).*(?:Borrow|Debt|Loan)/.test(x.tag) &&
        !/Adjustment|Hedge|FairValue|Maturities|Payments|Collateral|Rate|CreditFacility|Guarantee|DisposalGroup/.test(
          x.tag,
        ),
    );
    if (extraDebtBS.length || unsupportedBorrowing) continue;
    const shortAmount =
      borrow ??
      (bs.some((x) =>
        [
          'CommercialPaper',
          'ShortTermBorrowings',
          'ShortTermDebt',
          'NotesAndLoansPayable',
        ].includes(x.tag),
      )
        ? null
        : 0);
    if (shortAmount === null) continue;
    used.push(...[short, cp, other].filter((x): x is Occurrence => !!x));
    const notePlain = note.some(
      (x) =>
        x.value.concept === 'us-gaap:LongTermDebtNoncurrent' &&
        x.value.fact.val === long.value.fact.val,
    );
    if (rawLong || notePlain) {
      currentDebt = current.value.fact.val + shortAmount;
      longDebt = long.value.fact.val;
      plain = currentDebt + longDebt;
      if (leaseAmount !== null) {
        funding = plain + leaseAmount;
        used.push(...(pureLease ? [pureLease] : leaseParts));
      }
    } else if (combinedLong && leaseCurrent && bundledLease) {
      funding =
        combinedLong.value.fact.val +
        current.value.fact.val +
        leaseCurrent.value.fact.val +
        shortAmount;
      used.push(leaseCurrent, bundledLease);
      if (leaseAmount !== null) {
        plain = funding - leaseAmount;
        currentDebt = current.value.fact.val + shortAmount;
        longDebt = plain - currentDebt;
      }
    } else if (combinedLong && combinedCurrent) {
      funding =
        combinedLong.value.fact.val +
        combinedCurrent.value.fact.val +
        shortAmount;
      used.push(combinedCurrent);
    }
    const disposal = all.some(
      (x) =>
        /LiabilitiesOfDisposalGroupIncludingDiscontinuedOperation/.test(
          x.tag,
        ) && x.value.fact.val !== 0,
    );
    const genericInvestment = get('MarketableSecurities', bs);
    const currentAssetTotal = get('AssetsCurrent', bs);
    const shortInvestment =
      get('ShortTermInvestments', bs) ?? get('OtherShortTermInvestments', bs);
    const cashAggregate = get('CashCashEquivalentsAndShortTermInvestments', bs);
    const position = (x: Occurrence) =>
      $(tables[x.table])
        .find('tr')
        .toArray()
        .findIndex((row) => x.id && $(row).find(`[id="${x.id}"]`).length > 0);
    const approvedGeneric =
      genericInvestment &&
      currentAssetTotal &&
      shortInvestment &&
      cashAggregate &&
      cashAggregate.value.fact.val ===
        cash.value.fact.val + shortInvestment.value.fact.val &&
      position(genericInvestment) > position(cash) &&
      position(genericInvestment) < position(currentAssetTotal) &&
      position(genericInvestment) !== position(shortInvestment);
    const currentInvestments = approvedGeneric
      ? genericInvestment.value.fact.val + shortInvestment.value.fact.val
      : null;
    if (approvedGeneric)
      used.push(
        genericInvestment,
        shortInvestment,
        cashAggregate,
        currentAssetTotal,
      );
    used.push(
      ...all.filter((x) => /DisposalGroup.*(?:Debt|Loans|Notes)/.test(x.tag)),
    );
    const evidence = [
      ...new Map(
        used.map((x) => [
          x.id ?? JSON.stringify(x),
          {
            ...x.value.fact,
            concept: x.value.concept,
            unit: 'USD',
            sourceUrl: filing.sourceUrl + (x.id ? `#${x.id}` : ''),
            factId: x.id,
            rowLabel: x.label,
            tableIndex: x.table,
            documentHash: hash,
            rawText: x.rawText,
            format: x.format,
            scale: x.scale,
            contextId: x.contextId,
            decimals: Number.isFinite(x.decimals)
              ? x.decimals
              : String(x.decimals),
            displayContribution: x.contribution,
          },
        ]),
      ).values(),
    ];
    results.push({
      version: 'debt-disclosure-v1',
      filing,
      periodEnd: end,
      facts: [
        ...new Set(
          all
            .filter((x) => x.value.concept.startsWith('us-gaap:'))
            .map((x) => x.tag),
        ),
      ]
        .map((tag) => get(tag)?.value)
        .filter((x): x is HealthValue => !!x),
      plainDebt: disposal ? null : plain,
      financingDebt: disposal ? null : funding,
      financeLeases: leaseAmount,
      currentPlainDebt: disposal ? null : currentDebt,
      noncurrentPlainDebt: disposal ? null : longDebt,
      evidence,
      currentInvestments,
      balanceLiabilities,
      reason: disposal
        ? '待售处置组债务范围尚未完成勾稽'
        : funding === null
          ? '未取得明确的融资租赁范围'
          : plain === null
            ? '债务附注中的租赁与其他债务合并披露，无法单独拆分'
            : null,
    });
  }
  return results;
}

export function hasDebtBalanceFacts(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || !('facts' in raw))
    return false;
  const f = (raw as { facts?: Record<string, Record<string, unknown>> })
    .facts?.['us-gaap'];
  return (
    !!f?.Assets &&
    [
      'LongTermDebtNoncurrent',
      'LongTermDebtAndCapitalLeaseObligations',
      'LongTermDebtCurrent',
      'DebtCurrent',
    ].some((tag) => !!f[tag])
  );
}
