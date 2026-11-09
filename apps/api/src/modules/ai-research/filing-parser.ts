import { load } from 'cheerio';

export const PARSER_VERSION = 'items-v2';
export type Item = 'Item 1' | 'Item 1A' | 'Item 7';
export interface Paragraph {
  id: string;
  text: string;
}
export type Sections = Record<Item, Paragraph[]>;
const titles: Record<Item, RegExp> = {
  'Item 1': /^business\b/i,
  'Item 1A': /^risk factors\b/i,
  'Item 7': /^management(?:[’']s)?\s+discussion/i,
};

/** Only full heading lines qualify; short TOC ranges are rejected. Fail closed. */
export function extractSections(html: string): Sections {
  const $ = load(html);
  $(
    'script,style,noscript,ix\\:header,[hidden],[style*="display:none"],[style*="display: none"]',
  ).remove();
  $('td,th').each((_, el) => {
    $(el).append(' | ');
  });
  $('p,div,tr,h1,h2,h3,h4,br,li').each((_, el) => {
    $(el).append('\n');
  });
  const lines = $('body')
    .text()
    .replace(/\u00a0/g, ' ')
    .split(/\n+/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const headings: { index: number; item: string; title: string }[] = [];
  lines.forEach((line, index) => {
    const match = /^item\s+(\d{1,2}[a-c]?)\s*[.：:\-–]?\s*(.*)$/i.exec(line);
    if (match && line.length < 240)
      headings.push({
        index,
        item: `Item ${match[1].toUpperCase()}`,
        title: match[2] || lines[index + 1] || '',
      });
  });
  const selected: { item: Item; start: number; end: number; text: string[] }[] =
    [];
  for (const item of Object.keys(titles) as Item[]) {
    const candidates = headings
      .flatMap((h, i) => {
        if (h.item !== item || !titles[item].test(h.title)) return [];
        const end = headings[i + 1]?.index;
        if (end === undefined) return [];
        const text = lines.slice(h.index + 1, end);
        const size = text.join(' ').length;
        return size >= 1500 ? [{ item, start: h.index, end, text, size }] : [];
      })
      .sort((a, b) => b.size - a.size);
    if (!candidates.length)
      throw new Error(`${item} 提取失败：未找到可验证的完整章节边界`);
    if (candidates[1] && candidates[1].size > candidates[0].size * 0.8)
      throw new Error(`${item} 存在多个相似章节，无法可靠定位`);
    selected.push(candidates[0]);
  }
  if (!(
    selected[0].end <= selected[1].start && selected[1].end <= selected[2].start
  ))
    throw new Error('10-K 章节顺序异常，拒绝分析');
  return Object.fromEntries(
    selected.map((s) => [
      s.item,
      s.text.map((text, i) => ({ id: `${s.item}:p${i + 1}`, text })),
    ]),
  ) as Sections;
}

export interface FilingMetadata {
  accessionNumber: string;
  fiscalYear: number;
  filingDate: string;
  reportDate: string;
  sourceUrl: string;
}
export function latest10K(data: unknown, cik: string): FilingMetadata {
  const input = data as {
    cik?: unknown;
    filings?: { recent?: Record<string, unknown[]> };
  };
  if (String(input?.cik).padStart(10, '0') !== cik)
    throw new Error('Submissions CIK 不匹配');
  const r = input.filings?.recent;
  if (!r || !Array.isArray(r.form)) throw new Error('Submissions 申报列表无效');
  const candidates = r.form
    .flatMap((form, i) => {
      const accessionNumber = r.accessionNumber?.[i],
        document = r.primaryDocument?.[i];
      const reportDate = r.reportDate?.[i],
        filingDate = r.filingDate?.[i];
      if (
        form !== '10-K' ||
        typeof accessionNumber !== 'string' ||
        !/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber) ||
        typeof document !== 'string' ||
        !/^[\w.-]+\.html?$/i.test(document) ||
        typeof reportDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) ||
        typeof filingDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)
      )
        return [];
      return [
        {
          accessionNumber,
          fiscalYear: Number(reportDate.slice(0, 4)),
          reportDate,
          filingDate,
          sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g, '')}/${document}`,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.reportDate.localeCompare(a.reportDate) ||
        b.filingDate.localeCompare(a.filingDate),
    );
  if (!candidates[0])
    throw new Error('未找到最新完整 10-K（不接受 10-K/A、10-Q 或 8-K）');
  return candidates[0];
}
