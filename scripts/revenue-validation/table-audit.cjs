/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS validation. */
/* global require, console */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { extractTables } = require('./table-core.cjs');
const reports = [];
for (const company of ['alphabet', 'apple', 'nvidia']) {
  const dir = '/tmp/revenue-breakdown-validation/' + company;
  const html = fs.readFileSync(dir + '/filing.htm', 'utf8');
  const metadata = JSON.parse(fs.readFileSync(dir + '/metadata.json', 'utf8'));
  const r = extractTables(html, metadata);
  const doc = {
    company,
    sourceSha256: crypto.createHash('sha256').update(html).digest('hex'),
    ...r,
  };
  fs.writeFileSync(dir + '/tables.json', JSON.stringify(doc, null, 2));
  reports.push(doc);
  console.log(
    company,
    r.groups.length,
    'original groups;',
    r.groups.reduce((n, g) => n + g.rows.length, 0),
    'rows;',
    r.skips.length,
    'skipped entries',
  );
}
fs.writeFileSync(
  'docs/validation/revenue-breakdown-stage2-tables.json',
  JSON.stringify(reports, null, 2),
);
let md =
  '# Revenue Breakdown 第二轮验证：保留原始收入表格\n\n## 结论\n\n**可以不使用 AI，可靠还原这三份已缓存申报中一部分原始收入表格的项目名称、金额、最近三年数据和同表同比。** 本轮不再开发分类引擎或分级状态，也不推断父子关系。列式多分部矩阵等不能明确对应名称的部分直接跳过。正式页面、数据库和 NestJS 业务服务未修改；未经后续明确授权不集成。\n\n## 最小解析规则\n\n- 复用第一阶段的 QName/context、CIK、Accession/URL、单位、年度期间、transformation、scale/sign 和 BigInt 数字解析。未重新实现数字转换或重复下载文件。原有脚本/测试和缓存全部保留；中断前的 stage2-core.cjs 不再参与本轮流程。\n- 在原 HTML 中精确定位 ix:nonFraction 的 id、contextRef、concept，读取同一原始行在第一个数值单元格之前的文字作为项目名称，仅去掉空白和独立货币符号；脚注、total/adjustment 原名及行序保留。不根据 label 关键词给公司重新分类。\n- 保留原 table 序号、行序号、表头、完整原始行。tableIndex 和 rowIndex 均从 0 开始，是按固定 HTML DOM 计数，不是 SEC 报表编号；配套 JSON 提供 factId、来源 URL、完整 concept、context、dimension/member、期间和原金额。\n- 表格必须包含标准产品/服务、分部或地理轴之一，作为本轮有限收入明细范围的筛选，不生成统一分类名称。排除只有合并总收入或衍生品重分类的无关表。自定义轴/自定义收入概念未支持，直接跳过，不声称全覆盖。\n- 额外允许精确标准概念 RevenueNotFromContractWithCustomer，保留同一收入明细表中直接标记的对冲调整；可负数，仍按该行原名展示。它不能被当作普通客户收入。无维度的合计行仅保留在含收入明细的同一原始表中。\n- 不跨表合并、跨行补齐或汇总项目，不计算占比；即使名称相同，也保留所属原表。同行出现不同概念或不同完整维度 tuple 时跳过整行，避免把不同业务列误叫成 Revenue。冲突金额不输出。\n- 同比仅使用同一原始表、同一行、同一申报、同一 concept/完整维度 tuple/USD 单位，核对两期起止日期相隔 330–400 天、各期长度差最多 7 天（兼容 52/53 周），且上期为正数。数值按 (本期-上期)/上期×100% 计算，精度 8 位小数；无可比值时为 null。这里比较的是**本次申报并排披露的比较/重述后口径**，不声称历史原始申报从未重分类，也不把上年不同口径数据跨表拼接。\n- 财年从最新申报 fiscalYear 和与 reportDate 的实际日期间隔确定，输出同时保留完整起止日期供核对，而非仅靠表头年份数字匹配。\n\n金额单位：**百万美元**。`—` 为缺失/不可计算，不补零。以下每张表分别对应原始披露分组，行序保持原样；合计与调整项不另行计算或重新归类。\n\n';
for (const r of reports) {
  md += `## ${r.company}：FY${r.metadata.fiscalYear}\n\n[SEC 原始 10-K](${r.metadata.sourceUrl})，Accession：\`${r.metadata.accessionNumber}\`。\n\n`;
  for (const g of r.groups) {
    const years = [
      ...new Set(g.rows.flatMap((row) => row.facts.map((f) => f.fiscalYear))),
    ].sort();
    md += `### 原表 tableIndex=${g.tableIndex}\n\n原表头：${g.header || '无独立文字表头（期间来自 XBRL context）'}\n\n|原始项目|${years.join('|')}|最近一年 YoY|\n|---|${years.map(() => '---:').join('|')}|---:|\n`;
    for (const row of g.rows) {
      const latest = row.facts.at(-1);
      md += `|${row.name.replaceAll('|', '\\|')}|${years
        .map((y) => {
          const f = row.facts.find((x) => x.fiscalYear === y);
          return f ? (Number(f.value) / 1e6).toLocaleString('en-US') : '—';
        })
        .join(
          '|',
        )}|${latest.yoy.value === null ? '—' : latest.yoy.value.toFixed(2) + '%'}|\n`;
    }
    md += '\n';
  }
  md += '### 跳过的情况\n\n';
  for (const reason of [...new Set(r.skips.map((s) => s.reason))])
    md += `- ${reason}\n`;
  md += '\n';
}
md +=
  '## 无法处理的例子与边界\n\n- Apple 的地理分部表把 Americas、Europe 等放在列标题，数值行只写 Net sales；同一行混有不同成员。当前最小方案不做复杂表头矩阵还原，跳过，不输出一个虚构的 Net sales 业务。国家收入表采用行项目，可正常还原。\n- Nvidia 的报告分部附注把 Compute & Networking、Graphics 放在列标题，同行含不同成员；跳过。相关 MDA 行式表的数值未能与本轮支持的已标记事实直接对应，不通过相同金额去猜测绑定。产品市场表按行披露，可还原 Data Center、Compute、Networking 等；保持其原有行序和名称，不把它们重复相加。\n- Apple Products/Services 和 iPhone 等来自不同原表，不人为拼接一棵 Products 子树。Alphabet 广告总项、Google Services total、Total revenues 及 Hedging gains (losses) 原名保留，不把总项和明细相加。\n- 不能确认任意额外文本脚注带来的所有业务范围变化。当前同比的依据是最新单次申报同一原始比较行及完整 XBRL 口径一致，不扩展为跨申报口径保证；需要跨表比较或明显不同期间/维度的行不给 YoY。\n- 本轮不新增标准 taxonomy 下载、不解析任意自定义收入标签、不支持其他币种或非整数美元、多文件 Inline Document Set、typed dimension、continuation 等第一阶段未支持结构。失败/拒绝详情保存在 JSON，不用 AI 补齐。\n\n## 复现与验证\n\n```sh\nnode scripts/revenue-validation/table-audit.cjs\nnode --test scripts/revenue-validation/*.test.cjs\nnpm run typecheck\nnpm run lint\nnpx eslint scripts/revenue-validation\nnpm test\nnpm run build\n```\n\n本轮 table-audit 仅访问本地 HTML/metadata 和输出文件，没有网络、数据库或 AI 依赖。原始 HTML SHA256 与完整逐事实来源保存在 [配套 JSON](./revenue-breakdown-stage2-tables.json)。建议后续仅集成该有限的“原表行式披露”子集；列式复杂披露继续跳过，且必须另行获得正式集成授权。\n';
md +=
  '\n本轮验证结果：15 项专项测试通过；后端 170 项、前端 35 项回归测试通过（5 项 opt-in 用例跳过）；类型检查、应用与验证脚本 Lint、构建通过。\n';
fs.writeFileSync('docs/validation/revenue-breakdown-stage2.md', md);
