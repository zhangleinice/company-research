import { z } from 'zod';
import { hasActualFinancingEvidence } from './financing-facts';
import {
  ExtractionValidationError,
  locateValidationError,
} from './validation-diagnostics';
import type {
  CapitalAllocationInformation,
  AcquisitionEvent,
  SecEvidence,
} from '@company-research/shared';
import type { Paragraph } from './filing-parser';
const evidence = z
  .array(
    z
      .object({ paragraphId: z.string(), quote: z.string().min(12).max(1500) })
      .strict(),
  )
  .min(1)
  .max(12);
const note = z
  .object({
    text: z.string().min(1).max(1200),
    kind: z.enum(['fact', 'plan', 'risk']),
    activityType: z
      .enum([
        'actualFinancing',
        'creditFacility',
        'commercialPaperProgram',
        'debtBalance',
        'plan',
        'other',
      ])
      .optional(),
    evidence,
  })
  .strict();
const notes = z.array(note).max(500);
const event = z
  .object({
    targetName: z.string().min(1).max(300),
    transactionDate: z
      .object({
        value: z.string(),
        precision: z.enum(['year', 'month', 'day']),
        type: z.enum([
          'agreement',
          'announcement',
          'completion',
          'termination',
          'expectedCompletion',
        ]),
        evidence,
      })
      .strict()
      .nullable(),
    transactionValue: z
      .object({
        rawText: z.string().min(1).max(500),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
        scope: z.enum(['cash', 'total', 'cashPlusDebt', 'unknown']),
        evidence,
      })
      .strict()
      .nullable(),
    acquisitionPurpose: note.nullable(),
    transactionStatus: z.enum([
      'announced',
      'pending',
      'completed',
      'terminated',
      'unknown',
    ]),
    considerationType: z.enum([
      'cash',
      'stock',
      'cashAndStock',
      'cashPlusDebt',
      'other',
      'unknown',
    ]),
    evidence,
  })
  .strict();
export const capitalInformationSchema = z
  .object({
    version: z.literal(1),
    coverage: z.enum(['complete', 'partial']),
    coverageReason: z.string().min(1).max(500).nullable(),
    reinvestment: z
      .object({
        investmentAreas: notes,
        investmentPurposes: notes,
        investmentPlans: notes,
        investmentRisks: notes,
      })
      .strict(),
    acquisitions: z.object({ events: z.array(event).max(500) }).strict(),
    debtAndFinancing: z
      .object({
        financingActivities: notes,
        financingPurposes: notes,
        financingTerms: notes,
        financingRisks: notes,
      })
      .strict(),
  })
  .strict();
export function emptyCapitalInformation(): CapitalAllocationInformation {
  return {
    version: 1,
    coverage: 'complete',
    coverageReason: null,
    reinvestment: {
      investmentAreas: [],
      investmentPurposes: [],
      investmentPlans: [],
      investmentRisks: [],
    },
    acquisitions: { events: [] },
    debtAndFinancing: {
      financingActivities: [],
      financingPurposes: [],
      financingTerms: [],
      financingRisks: [],
    },
  };
}
const future =
  /expected?\s+to\s+(?:close|complete)|anticipat\w*[^.]{0,80}(?:close|complete)|pending acquisition|subject to[^.]{0,80}closing/i;
const completed = (text: string) =>
  text
    .split(/[.!?\n]/)
    .some(
      (s) => !future.test(s) && /\b(completed|closed|consummated)\b/i.test(s),
    );
const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function capitalEvidence(
  data: CapitalAllocationInformation,
): SecEvidence[] {
  return [
    ...Object.values(data.reinvestment).flat(),
    ...Object.values(data.debtAndFinancing).flat(),
  ]
    .flatMap((n) => n.evidence)
    .concat(
      data.acquisitions.events.flatMap((e) => [
        ...e.evidence,
        ...(e.transactionDate?.evidence ?? []),
        ...(e.transactionValue?.evidence ?? []),
        ...(e.acquisitionPurpose?.evidence ?? []),
      ]),
    );
}
export function validateCapitalInformation(
  value: unknown,
  paragraphs: Paragraph[],
): CapitalAllocationInformation {
  const data = capitalInformationSchema.parse(value);
  const source = new Map(paragraphs.map((p) => [p.id, p.text]));
  const locatedNotes = [
    ...Object.entries(data.reinvestment).flatMap(([key, items]) =>
      items.map((n, i) => ({
        n,
        path: `capitalAllocation.reinvestment.${key}[${i}]`,
      })),
    ),
    ...Object.entries(data.debtAndFinancing).flatMap(([key, items]) =>
      items.map((n, i) => ({
        n,
        path: `capitalAllocation.debtAndFinancing.${key}[${i}]`,
      })),
    ),
  ];
  const references = locatedNotes.map(({ n, path }) => ({
    evidence: n.evidence,
    path,
  }));
  for (const [i, e] of data.acquisitions.events.entries()) {
    const path = `capitalAllocation.acquisitions.events[${i}]`;
    references.push({ path, evidence: e.evidence });
    for (const key of [
      'transactionDate',
      'transactionValue',
      'acquisitionPurpose',
    ] as const)
      if (e[key])
        references.push({ path: `${path}.${key}`, evidence: e[key]!.evidence });
  }
  for (const ref of references)
    for (const [i, e] of ref.evidence.entries())
      if (
        !e.paragraphId.startsWith('Item 7:') ||
        !source.get(e.paragraphId)?.includes(e.quote)
      )
        throw new ExtractionValidationError(
          `${ref.path}.evidence[${i}]`,
          'SEC_EVIDENCE_MISMATCH',
          [e.paragraphId],
          '资本配置引用必须逐字匹配本次输入的Item 7',
        );
  if (data.coverage === 'partial' && !data.coverageReason)
    throw new ExtractionValidationError(
      'capitalAllocation.coverageReason',
      'COVERAGE_REASON_MISSING',
      [],
      '覆盖不足必须说明原因',
    );
  for (const { n, path } of locatedNotes) {
    const ids = n.evidence.map((e) => e.paragraphId);
    if (!/[\u4e00-\u9fff]/u.test(n.text))
      throw new ExtractionValidationError(
        `${path}.text`,
        'LANGUAGE_INVALID',
        ids,
        '资本配置说明必须为中文',
      );
    if (path.includes('.investmentPlans[') && n.kind !== 'plan')
      throw new ExtractionValidationError(
        `${path}.kind`,
        'PLAN_KIND_MISMATCH',
        ids,
        '未来投资计划不能标为已发生事实',
      );
    if (
      (path.includes('.investmentRisks[') ||
        path.includes('.financingRisks[')) &&
      n.kind !== 'risk'
    )
      throw new ExtractionValidationError(
        `${path}.kind`,
        'RISK_KIND_MISMATCH',
        ids,
        '风险条目类型不匹配',
      );
    if (!path.includes('.financingActivities[')) continue;
    if (!n.activityType)
      throw new ExtractionValidationError(
        `${path}.activityType`,
        'FINANCING_TYPE_MISSING',
        ids,
        '融资行为必须区分已融资、额度、计划和余额',
      );
    if (
      n.activityType === 'actualFinancing' &&
      (n.kind !== 'fact' ||
        !hasActualFinancingEvidence(n.evidence.map((e) => e.quote)))
    )
      throw new ExtractionValidationError(
        path,
        'FINANCING_ACTUAL_EVIDENCE_INSUFFICIENT',
        ids,
        '未使用额度或计划不能作为实际融资；证据须明确支持已发生的发行、借入或偿还活动',
      );
    if (n.activityType === 'plan' && n.kind !== 'plan')
      throw new ExtractionValidationError(
        `${path}.kind`,
        'PLAN_KIND_MISMATCH',
        ids,
        '融资计划不能标为已发生事实',
      );
  }
  for (const [eventIndex, e] of data.acquisitions.events.entries()) {
    try {
      const text = e.evidence.map((x) => x.quote).join(' ');
      if (e.acquisitionPurpose) {
        const purpose = e.acquisitionPurpose.evidence
          .map((x) => x.quote)
          .join(' ');
        if (
          !/purpose|in order to|(?:to|will)\s+(?:expand|enhance|support|accelerate|strengthen|enable|improve|integrate|bring)|intended to|aimed at/i.test(
            purpose,
          ) ||
          (!purpose.toLowerCase().includes(e.targetName.toLowerCase()) &&
            !/this (?:acquisition|transaction)/i.test(purpose))
        )
          throw Error('目标业务介绍或一般收购理由不能作为具体收购目的');
      }
      if (
        !text.toLowerCase().includes(e.targetName.toLowerCase()) ||
        !/\b(acquir\w*|acquisition|merger)\b/i.test(text)
      )
        throw Error('收购对象或交易性质缺少直接证据');
      if (e.transactionStatus === 'completed' && !completed(text))
        throw Error('预计交割不能作为已完成收购');
      if (
        e.transactionStatus === 'terminated' &&
        !/\b(terminated|termination|abandoned)\b/i.test(text)
      )
        throw Error('终止状态缺少证据');
      if (e.considerationType === 'cashPlusDebt' && !/cash/i.test(text))
        throw Error('现金对价缺少证据');
      if (
        e.considerationType === 'cashPlusDebt' &&
        !/assum\w*[^.]{0,30}debt/i.test(text)
      )
        throw Error('承接债务缺少证据');
      if (
        e.considerationType === 'cashAndStock' &&
        !/\b(stock|shares)\b/i.test(text)
      )
        throw Error('承担债务不等于股票对价');
      if (e.transactionValue) {
        const v = e.transactionValue,
          quotes = v.evidence.map((x) => x.quote).join(' ');
        if (!quotes.includes(v.rawText))
          throw Error('交易对价必须保留原文表达');
        if (
          v.scope === 'total' &&
          /plus[^.]{0,40}assum\w*[^.]{0,25}debt/i.test(quotes)
        )
          throw Error('现金金额不能冒充包含承接债务的总对价');
      }
      if (e.transactionDate) {
        const d = e.transactionDate,
          text = d.evidence.map((x) => x.quote).join(' ');
        const pattern =
          d.precision === 'year'
            ? /^\d{4}$/
            : d.precision === 'month'
              ? /^\d{4}-(0[1-9]|1[0-2])$/
              : /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
        if (!pattern.test(d.value)) throw Error('交易日期与精度不一致');
        const [year, month, day] = d.value.split('-');
        if (!text.includes(year)) throw Error('交易年份缺少证据');
        if (
          month &&
          !text.includes(d.value) &&
          !new RegExp(`\\b${months[Number(month) - 1]}\\b`, 'i').test(text)
        )
          throw Error('交易月份缺少证据');
        if (day) {
          if (new Date(d.value).toISOString().slice(0, 10) !== d.value)
            throw Error('无效交易日期');
          const m = months[Number(month) - 1];
          if (
            !text.includes(d.value) &&
            !new RegExp(
              `(?:${m}\\s+${Number(day)}(?:,)?\\s+${year}|${Number(day)}\\s+${m}\\s+${year})`,
              'i',
            ).test(text)
          )
            throw Error('不能从月份补造具体日期');
        }
        if (d.type === 'completion' && !completed(text))
          throw Error('预计交割不是实际完成日期');
      }
    } catch (error) {
      throw locateValidationError(
        error,
        `capitalAllocation.acquisitions.events[${eventIndex}]`,
        e.evidence.map((x) => x.paragraphId),
        'ACQUISITION_RULE_VIOLATION',
      );
    }
  }
  return data;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function sameTarget(a: string, b: string, paragraphs: Paragraph[]) {
  if (a.toLowerCase() === b.toLowerCase()) return true;
  return paragraphs.some((p) =>
    new RegExp(
      `${escape(a)}\\s*\\(["“]${escape(b)}["”]\\)|${escape(b)}\\s*\\(["“]${escape(a)}["”]\\)`,
      'i',
    ).test(p.text),
  );
}
const uniqueEvidence = (xs: SecEvidence[]) => [
  ...new Map(xs.map((e) => [JSON.stringify(e), e])).values(),
];
function compatible(
  a: AcquisitionEvent,
  b: AcquisitionEvent,
  paragraphs: Paragraph[],
) {
  if (!sameTarget(a.targetName, b.targetName, paragraphs)) return false;
  if (
    a.transactionStatus !== b.transactionStatus &&
    a.transactionStatus !== 'unknown' &&
    b.transactionStatus !== 'unknown'
  )
    return false;
  if (
    a.considerationType !== b.considerationType &&
    a.considerationType !== 'unknown' &&
    b.considerationType !== 'unknown'
  )
    return false;
  const ad = a.transactionDate,
    bd = b.transactionDate;
  if (
    ad &&
    bd &&
    (ad.type !== bd.type ||
      (!ad.value.startsWith(bd.value) && !bd.value.startsWith(ad.value)))
  )
    return false;
  const av = a.transactionValue,
    bv = b.transactionValue;
  if (
    av &&
    bv &&
    (av.rawText !== bv.rawText ||
      (av.currency !== null &&
        bv.currency !== null &&
        av.currency !== bv.currency) ||
      (av.scope !== 'unknown' &&
        bv.scope !== 'unknown' &&
        av.scope !== bv.scope))
  )
    return false;
  return (
    a.evidence.some((x) =>
      b.evidence.some((y) => x.paragraphId === y.paragraphId),
    ) || !!(ad && bd && av && bv)
  );
}
export function mergeCapitalInformation(
  parts: CapitalAllocationInformation[],
  paragraphs: Paragraph[],
): CapitalAllocationInformation {
  const result = emptyCapitalInformation();
  for (const p of parts) {
    if (p.coverage === 'partial') {
      result.coverage = 'partial';
      result.coverageReason = [result.coverageReason, p.coverageReason]
        .filter(Boolean)
        .join('；')
        .slice(0, 500);
    }
    for (const key of Object.keys(
      result.reinvestment,
    ) as (keyof typeof result.reinvestment)[])
      result.reinvestment[key].push(...p.reinvestment[key]);
    for (const key of Object.keys(
      result.debtAndFinancing,
    ) as (keyof typeof result.debtAndFinancing)[])
      result.debtAndFinancing[key].push(...p.debtAndFinancing[key]);
    for (const e of p.acquisitions.events) {
      const old = result.acquisitions.events.find((x) =>
        compatible(x, e, paragraphs),
      );
      if (!old) {
        result.acquisitions.events.push(structuredClone(e));
        continue;
      }
      old.evidence = uniqueEvidence([...old.evidence, ...e.evidence]);
      if (
        e.transactionDate &&
        (!old.transactionDate ||
          e.transactionDate.value.length > old.transactionDate.value.length)
      )
        old.transactionDate = structuredClone(e.transactionDate);
      if (
        e.transactionValue &&
        (!old.transactionValue ||
          (old.transactionValue.scope === 'unknown' &&
            e.transactionValue.scope !== 'unknown') ||
          (old.transactionValue.currency === null &&
            e.transactionValue.currency !== null))
      )
        old.transactionValue = structuredClone(e.transactionValue);
      if (!old.acquisitionPurpose && e.acquisitionPurpose)
        old.acquisitionPurpose = structuredClone(e.acquisitionPurpose);
      if (old.transactionStatus === 'unknown')
        old.transactionStatus = e.transactionStatus;
      if (old.considerationType === 'unknown')
        old.considerationType = e.considerationType;
    }
  }
  for (const group of [result.reinvestment, result.debtAndFinancing])
    for (const key of Object.keys(group)) {
      const record = group as Record<
        string,
        CapitalAllocationInformation['reinvestment']['investmentAreas']
      >;
      record[key] = [
        ...new Map(record[key].map((n) => [JSON.stringify(n), n])).values(),
      ];
    }
  return validateCapitalInformation(result, paragraphs);
}
