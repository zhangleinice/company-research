# Revenue Breakdown 第二轮验证：保留原始收入表格

## 结论

**可以不使用 AI，可靠还原这三份已缓存申报中一部分原始收入表格的项目名称、金额、最近三年数据和同表同比。** 本轮不再开发分类引擎或分级状态，也不推断父子关系。列式多分部矩阵等不能明确对应名称的部分直接跳过。正式页面、数据库和 NestJS 业务服务未修改；未经后续明确授权不集成。

## 最小解析规则

- 复用第一阶段的 QName/context、CIK、Accession/URL、单位、年度期间、transformation、scale/sign 和 BigInt 数字解析。未重新实现数字转换或重复下载文件。原有脚本/测试和缓存全部保留；中断前的 stage2-core.cjs 不再参与本轮流程。
- 在原 HTML 中精确定位 ix:nonFraction 的 id、contextRef、concept，读取同一原始行在第一个数值单元格之前的文字作为项目名称，仅去掉空白和独立货币符号；脚注、total/adjustment 原名及行序保留。不根据 label 关键词给公司重新分类。
- 保留原 table 序号、行序号、表头、完整原始行。tableIndex 和 rowIndex 均从 0 开始，是按固定 HTML DOM 计数，不是 SEC 报表编号；配套 JSON 提供 factId、来源 URL、完整 concept、context、dimension/member、期间和原金额。
- 表格必须包含标准产品/服务、分部或地理轴之一，作为本轮有限收入明细范围的筛选，不生成统一分类名称。排除只有合并总收入或衍生品重分类的无关表。自定义轴/自定义收入概念未支持，直接跳过，不声称全覆盖。
- 额外允许精确标准概念 RevenueNotFromContractWithCustomer，保留同一收入明细表中直接标记的对冲调整；可负数，仍按该行原名展示。它不能被当作普通客户收入。无维度的合计行仅保留在含收入明细的同一原始表中。
- 不跨表合并、跨行补齐或汇总项目，不计算占比；即使名称相同，也保留所属原表。同行出现不同概念或不同完整维度 tuple 时跳过整行，避免把不同业务列误叫成 Revenue。冲突金额不输出。
- 同比仅使用同一原始表、同一行、同一申报、同一 concept/完整维度 tuple/USD 单位，核对两期起止日期相隔 330–400 天、各期长度差最多 7 天（兼容 52/53 周），且上期为正数。数值按 (本期-上期)/上期×100% 计算，精度 8 位小数；无可比值时为 null。这里比较的是**本次申报并排披露的比较/重述后口径**，不声称历史原始申报从未重分类，也不把上年不同口径数据跨表拼接。
- 财年从最新申报 fiscalYear 和与 reportDate 的实际日期间隔确定，输出同时保留完整起止日期供核对，而非仅靠表头年份数字匹配。

金额单位：**百万美元**。`—` 为缺失/不可计算，不补零。以下每张表分别对应原始披露分组，行序保持原样；合计与调整项不另行计算或重新归类。

## alphabet：FY2025

[SEC 原始 10-K](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm)，Accession：`0001652044-26-000018`。

### 原表 tableIndex=94

原表头：Year Ended December 31, 202320242025

| 原始项目                                     |    2023 |    2024 |    2025 | 最近一年 YoY |
| -------------------------------------------- | ------: | ------: | ------: | -----------: |
| Google Search & other                        | 175,033 | 198,084 | 224,532 |       13.35% |
| YouTube ads                                  |  31,510 |  36,147 |  40,367 |       11.67% |
| Google Network                               |  31,312 |  30,359 |  29,792 |       -1.87% |
| Google advertising                           | 237,855 | 264,590 | 294,691 |       11.38% |
| Google subscriptions, platforms, and devices |  34,688 |  40,340 |  48,030 |       19.06% |
| Google Services total                        | 272,543 | 304,930 | 342,721 |       12.39% |
| Google Cloud                                 |  33,088 |  43,229 |  58,705 |       35.80% |
| Other Bets                                   |   1,527 |   1,648 |   1,537 |       -6.74% |
| Hedging gains (losses)                       |     236 |     211 |    -127 |     -160.19% |
| Total revenues                               | 307,394 | 350,018 | 402,836 |       15.09% |

### 原表 tableIndex=95

原表头：Year Ended December 31, 202320242025

| 原始项目               |    2023 |    2024 |    2025 | 最近一年 YoY |
| ---------------------- | ------: | ------: | ------: | -----------: |
| United States          | 146,286 | 170,447 | 194,229 |       13.95% |
| EMEA(1)                |  91,038 | 102,127 | 117,152 |       14.71% |
| APAC(1)                |  51,514 |  56,815 |  67,680 |       19.12% |
| Other Americas(1)      |  18,320 |  20,418 |  23,902 |       17.06% |
| Hedging gains (losses) |     236 |     211 |    -127 |     -160.19% |
| Total revenues         | 307,394 | 350,018 | 402,836 |       15.09% |

### 原表 tableIndex=162

原表头：Year Ended December 31, 202320242025 Revenues:

| 原始项目               |    2023 |    2024 |    2025 | 最近一年 YoY |
| ---------------------- | ------: | ------: | ------: | -----------: |
| Google Services        | 272,543 | 304,930 | 342,721 |       12.39% |
| Google Cloud           |  33,088 |  43,229 |  58,705 |       35.80% |
| Other Bets             |   1,527 |   1,648 |   1,537 |       -6.74% |
| Hedging gains (losses) |     236 |     211 |    -127 |     -160.19% |
| Total revenues         | 307,394 | 350,018 | 402,836 |       15.09% |

### 跳过的情况

- not a supported dimensional revenue breakdown table; consolidated/derivative-only disclosure omitted

## apple：FY2026

[SEC 原始 10-K](https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm)，Accession：`0000320193-26-000026`。

### 原表 tableIndex=22

原表头：Years Ended September 26,2026September 27,2025September 28,2024 Net sales:

| 原始项目        |    2024 |    2025 |    2026 | 最近一年 YoY |
| --------------- | ------: | ------: | ------: | -----------: |
| Products        | 294,866 | 307,003 | 355,533 |       15.81% |
| Services        |  96,169 | 109,158 | 123,301 |       12.96% |
| Total net sales | 391,035 | 416,161 | 478,834 |       15.06% |

### 原表 tableIndex=27

原表头：202620252024

| 原始项目                        |    2024 |    2025 |    2026 | 最近一年 YoY |
| ------------------------------- | ------: | ------: | ------: | -----------: |
| iPhone                          | 201,183 | 209,586 | 254,098 |       21.24% |
| Mac                             |  29,984 |  33,708 |  37,929 |       12.52% |
| iPad                            |  26,694 |  28,023 |  27,929 |       -0.34% |
| Wearables, Home and Accessories |  37,005 |  35,686 |  35,577 |       -0.31% |
| Services (1)                    |  96,169 | 109,158 | 123,301 |       12.96% |
| Total net sales                 | 391,035 | 416,161 | 478,834 |       15.06% |

### 原表 tableIndex=57

原表头：202620252024 Net sales:

| 原始项目        |    2024 |    2025 |    2026 | 最近一年 YoY |
| --------------- | ------: | ------: | ------: | -----------: |
| U.S.            | 142,196 | 151,790 | 167,746 |       10.51% |
| China (1)       |  66,952 |  64,377 |  82,378 |       27.96% |
| Other countries | 181,887 | 199,994 | 228,710 |       14.36% |
| Total net sales | 391,035 | 416,161 | 478,834 |       15.06% |

### 跳过的情况

- mixed concepts or dimensions in one original row
- not a supported dimensional revenue breakdown table; consolidated/derivative-only disclosure omitted

## nvidia：FY2026

[SEC 原始 10-K](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm)，Accession：`0001045810-26-000021`。

### 原表 tableIndex=54

原表头：Year Ended Jan 25, 2026Jan 26, 2025Jan 28, 2024 Geographic Revenue based upon Customer Headquarters Location (1):(In millions)

| 原始项目                    |   2024 |    2025 |    2026 | 最近一年 YoY |
| --------------------------- | -----: | ------: | ------: | -----------: |
| United States               | 31,533 |  77,482 | 149,617 |       93.10% |
| Taiwan (2)                  | 14,912 |  23,600 |  42,345 |       79.43% |
| China (including Hong Kong) | 12,330 |  25,048 |  19,677 |      -21.44% |
| Other                       |  2,147 |   4,367 |   4,299 |       -1.56% |
| Total revenue               | 60,922 | 130,497 | 215,938 |       65.47% |

### 原表 tableIndex=55

原表头：Year Ended Jan 25, 2026Jan 26, 2025Jan 28, 2024 Revenue by End Market:(In millions)

| 原始项目                   |   2024 |    2025 |    2026 | 最近一年 YoY |
| -------------------------- | -----: | ------: | ------: | -----------: |
| Data Center                | 47,525 | 115,186 | 193,737 |       68.19% |
| Compute                    | 38,950 | 102,196 | 162,361 |       58.87% |
| Networking                 |  8,575 |  12,990 |  31,376 |      141.54% |
| Gaming                     | 10,447 |  11,350 |  16,042 |       41.34% |
| Professional Visualization |  1,553 |   1,878 |   3,191 |       69.91% |
| Automotive                 |  1,091 |   1,694 |   2,349 |       38.67% |
| OEM and Other              |    306 |     389 |     619 |       59.13% |
| Total revenue              | 60,922 | 130,497 | 215,938 |       65.47% |

### 跳过的情况

- not a supported dimensional revenue breakdown table; consolidated/derivative-only disclosure omitted
- mixed concepts or dimensions in one original row

## 无法处理的例子与边界

- Apple 的地理分部表把 Americas、Europe 等放在列标题，数值行只写 Net sales；同一行混有不同成员。当前最小方案不做复杂表头矩阵还原，跳过，不输出一个虚构的 Net sales 业务。国家收入表采用行项目，可正常还原。
- Nvidia 的报告分部附注把 Compute & Networking、Graphics 放在列标题，同行含不同成员；跳过。相关 MDA 行式表的数值未能与本轮支持的已标记事实直接对应，不通过相同金额去猜测绑定。产品市场表按行披露，可还原 Data Center、Compute、Networking 等；保持其原有行序和名称，不把它们重复相加。
- Apple Products/Services 和 iPhone 等来自不同原表，不人为拼接一棵 Products 子树。Alphabet 广告总项、Google Services total、Total revenues 及 Hedging gains (losses) 原名保留，不把总项和明细相加。
- 不能确认任意额外文本脚注带来的所有业务范围变化。当前同比的依据是最新单次申报同一原始比较行及完整 XBRL 口径一致，不扩展为跨申报口径保证；需要跨表比较或明显不同期间/维度的行不给 YoY。
- 本轮不新增标准 taxonomy 下载、不解析任意自定义收入标签、不支持其他币种或非整数美元、多文件 Inline Document Set、typed dimension、continuation 等第一阶段未支持结构。失败/拒绝详情保存在 JSON，不用 AI 补齐。

## 复现与验证

```sh
node scripts/revenue-validation/table-audit.cjs
node --test scripts/revenue-validation/*.test.cjs
npm run typecheck
npm run lint
npx eslint scripts/revenue-validation
npm test
npm run build
```

本轮 table-audit 仅访问本地 HTML/metadata 和输出文件，没有网络、数据库或 AI 依赖。原始 HTML SHA256 与完整逐事实来源保存在 [配套 JSON](./revenue-breakdown-stage2-tables.json)。建议后续仅集成该有限的“原表行式披露”子集；列式复杂披露继续跳过，且必须另行获得正式集成授权。

本轮验证结果：15 项专项测试通过；后端 170 项、前端 35 项回归测试通过（5 项 opt-in 用例跳过）；类型检查、应用与验证脚本 Lint、构建通过。
