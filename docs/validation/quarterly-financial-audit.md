# 现有季度财务数据准确性审计

审计日期：2026-11-12。范围：Alphabet（GOOGL，CIK 0001652044）、Apple（AAPL，0000320193）、Nvidia（NVDA，0001045810）现有 PostgreSQL 缓存，各最近 10 个季度、10 个年度。此次仅新增独立审计脚本、测试和本报告，未修改生产代码、数据库结构或数据，未启动财务刷新、公司完整更新或 AI 任务。

## 1. 结论

**不能对现有季度数据整体出具“全部准确、无需修改”的结论。** 季度能力已经完整实现，数据来源、期间拆分、现金流、利润率、余额时点和页面单位在本次样本中基本可靠；截图的 GOOGL 2026 Q3 指标能够追溯到 SEC CompanyFacts，并重现页面结果。但是存在一个已证实、会改变研究判断的错误：**NVDA FY2025 Q1 的 EPS YoY 混用了拆股前后口径，显示 -26.83%，不应作为有效同比使用。** 应优先修复这一点，不能因为原始 EPS 分别来自 SEC 就判定其可比。

另外，NVDA 的股数与 DPS 缓存未跟随现有提取能力更新，导致可靠披露仍显示缺失；NVDA 当前 CapEx/FCF 留空属于概念覆盖范围限制；GOOGL FY2025 收入四季合计有 100 万美元差异，尚未证明具体原因，需保留来源差异而不能人为调整。

**是否可用于基本面研究：有条件可以用于查看已经逐项核实的季度收入、利润率、现金流及期末余额；目前不适合无条件依赖全部季度同比和跨公司完整指标。修复 EPS 可比性、明确缓存缺失后，才能将季度模式整体标记为通过。** 无需重建季度功能或重构整个数据流程。

## 2. 审计方法、原始数据与证据

- 数据库只读事务读取三家公司完整财务行和 `sources`。审计前后比较三家公司公司行（包含收藏状态）、年度/季度财务行、全库已有 AI 摘要及任务的指纹，确认未改变。
- 原先 `/tmp/*-health-companyfacts.json` 已不在当前文件系统中。必要且仅必要地使用现有 `SecClient` 请求三份 CompanyFacts，保存到 `/tmp/quarterly-financial-audit/`，后续全部复用。额外读取两份原始 10-Q HTML：GOOGL 2026 Q3、NVDA FY2025 Q1，用于截图和拆股问题核对。共 5 次 SEC 请求，无全市场下载，无第三方财务数据。
- 对 30 条季度缓存递归核对 **993 次来源记录出现**（含公式输入中的重复引用，不代表 993 条不同事实），按 concept、unit、start/end、accn、filed、form、val 与原始 JSON 精确匹配。全部存在，未发现这些来源记录被伪造或指向错误期间。
- 独立检查期间边界、YTD 差分、毛利推导、利润率、FCF、债务分解、比率和 80 次已显示同比的算式及去年同财季标签。**算式正确不等于经济口径可比**；EPS 拆股缺陷正是反例。
- 在 SQL 只读事务中调用实际 `CompanyService.getCompany` 的缓存读取及序列化路径。唯一替换是把已存在公司的 `createMany(skipDuplicates)` 改为测试用无写入操作；SEC/重新采集依赖一旦被调用即抛错。没有向生产接口提交任何更新请求。
- 将实际服务返回值传给真实 React `FinancialAnalysis`，分别渲染年度/季度，逐张核对卡片格式化结果。逐公司核对 15 种图表序列，共 **45 次真实缓存图表渲染**，检查点数、null 缺口、横坐标和连线。未执行真实浏览器会话或真实页面初始化，避免审计带来自动任务副作用；不声称完成浏览器交互验收。

机器证据：[quarterly-financial-audit-evidence.json](quarterly-financial-audit-evidence.json)。包括每季值、来源方法、最新季度完整来源、缓存差异、同比选取的两期事实、年度交叉核对、源文件指纹及数据库未变指纹。

原始来源：

- [Alphabet CompanyFacts](https://data.sec.gov/api/xbrl/companyfacts/CIK0001652044.json)
- [Apple CompanyFacts](https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json)
- [Nvidia CompanyFacts](https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json)
- [GOOGL 2026 Q3 原始 10-Q](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000084/goog-20260930.htm)：合并资产负债表、利润表、现金流量表。
- [NVDA FY2025 Q1 原始 10-Q](https://www.sec.gov/Archives/edgar/data/1045810/000104581024000124/nvda-20240428.htm)：合并利润表、Note 4 每股收益、Note 15 拆股后续事项。

SEC 官方说明指出 CompanyFacts 按单位提供公司的标准概念事实，公司的财年和季度日期未必对应自然年。此次按原始 observation 日期核对，没有把 `frame` 当作财季依据。[SEC API 说明](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

## 3. 实际数据流程与存储

```text
SEC CompanyFacts（us-gaap）
  → SecService.getCompanyFacts：检查 CIK
  → FinancialService.normalize
  → normalizeCompanyFacts：标准字段、期间选取、确定性计算、sources
  → CompanyService：采集租约 + 完整事务 upsert
  → annual_financials / quarterly_financials
  → CompanyService.period：Decimal 转 API number，保留 null，校验流动资产合计来源
  → CompanyDetail.annual / quarterly
  → analysisPeriods(mode) → 指标卡片和 SVG 趋势
```

源码定位：

- [SEC 请求与 CIK 检查](../../apps/api/src/modules/sec/sec.service.ts#L83)
- [字段映射](../../apps/api/src/modules/financials/normalize-company-facts.ts#L28)
- [缓存读取及写入事务](../../apps/api/src/modules/company/company.service.ts#L213)
- [API 序列化](../../apps/api/src/modules/company/company.service.ts#L37)
- [Prisma 两套期间表](../../apps/api/prisma/schema.prisma)
- [前端年度/季度选择](../../apps/web/src/analysis/financial-analysis.ts#L254)

年度与季度共用同一次 CompanyFacts，不来自收入明细的 Inline XBRL，也不来自 AI。生产标准化函数、健康计算函数中没有按 GOOGL/AAPL/NVDA 名称或 CIK 分支的特殊规则。

两张财务表均以 `(companyCik, periodEnd)` 唯一、金额/比率用 `Decimal(32,8)`、来源用 JSON；不会因取消收藏删除财务行。写入前计算全部结果，再在同一事务保存公司状态与年度/季度行。API Decimal 转 number 会带来一般浮点舍入，但本次金额在安全整数范围，且卡片和数据库格式化一致；比率保存至 8 位小数，审计采用 `1e-7` 容差。

每次标准化保留最近 10 年/10 季，API 也各取 10 行；普通缓存访问没有重新标准化。因而“当前算法能提取某字段”不等于“旧数据库已填充该字段”，NVDA 正是实际案例。

### 申报、备用标签与重述选择

仅接受有效日期、有限数值、10-K/10-Q/20-F/40-F 及其修订申报，单位严格分 USD、USD/shares、shares。同一概念和期间优先最新 `filed`，相同时按 accn 排序。多个备用概念是**按映射优先级**选择，并非所有概念中无条件挑最新；如 GOOGL 2025 Q1 的优先收入标签仍来自原申报，但数值与后续 `Revenues` 的 90,234 百万美元一致。

年度标签取最早原始完整年报事实，避免后续比较年度的 `fy` 把历史年度重命名。季度按真实财年起点和期末日期推导，不直接使用历史事实上的申报 `fy/fp` 或自然年 `frame`。

对重述的保护并不完整：现金流差分允许跨申报沿用前一期 YTD；一般 EPS 同比仅检查概念/单位而未确认拆股基础。后者已造成实际错误；前者在本次样本未发现重大数值错误，但不能宣称已自动识别所有重述情形。

## 4. Q1–Q4 的处理

[期间锚点](../../apps/api/src/modules/financials/normalize-company-facts.ts#L494)来自完整年度的 start/end；尚未完成的财年优先以上年年末次日或原始 Q1 起点锚定。季度编号由距财年起点天数除以 91 并四舍五入取得，容差 20 天；独立季度允许 60–110 天。它支持本次样本的 52/53 周常见财年，但这是日期启发式，不能保证所有财年变更和过渡期。

| 财季 | 可加总期间指标                                    | EPS / 稀释股数 / DPS                      | 资产负债数据                   |
| ---- | ------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| Q1   | 优先精确 start/end 的三个月值；Q1 YTD 本身就是 Q1 | 仅对应独立季度直接披露                    | 精确该季度末的时点值           |
| Q2   | 优先直接季度值；无则 H1 − Q1                      | 不作累计相减                              | 同上                           |
| Q3   | 优先直接季度值；无则 9M − H1                      | 不作累计相减                              | 同上                           |
| Q4   | 优先直接季度值；无则 FY − 9M                      | 缺直接披露则 null；不使用 FY EPS − 9M EPS | 使用财年末余额，不相减、不累加 |

差分两端须同 concept、unit、财年起点，前一期结束日必须为本季起点前一天。优先同 accn 的前一期值，否则取不晚于本期申报的最新前一期值；缺端点则保留 null。

新增独立测试验证非自然年的 52 周和 53 周财年，Q1–Q4 日期/标签及 Q4 差分正确；没有把 14 周 Q4 当自然年季度。实际样本：Apple FY2026 从 2025-09-28 至 2026-09-26，NVDA FY2027 Q2 从 2026-04-27 至 2026-07-26，均已正确标记。

## 5. 四大模块逐项结果与 concept

以下标签均属 `us-gaap`，标签不等于可任意互换。

### Growth

| 指标        | 来源/计算                                                                                                                                                                      | 结果                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Revenue     | 优先 `RevenueFromContractWithCustomerExcludingAssessedTax`，再 `Revenues`、`SalesRevenueNet`、`RevenueFromContractWithCustomerIncludingAssessedTax`；直接季度或适用的 YTD 差分 | 样本期间与来源匹配；GOOGL FY2025 汇总有 1 百万美元差异，见下文 |
| Revenue YoY | 同财季、期末间隔 330–400 天，`(current/prior−1)×100`；基期须正；概念一致或经过至少两期一致重叠验证的收入标签桥接                                                               | 本次可显示值算式与同财季匹配；不是环比                         |
| Diluted EPS | `EarningsPerShareDiluted`，USD/shares，仅精确独立季度                                                                                                                          | 未发现累计 EPS 被相减；Q4 留空合理                             |
| EPS YoY     | 同财季，基期及本期 EPS 正；目前只按 concept/unit 判可比                                                                                                                        | **NVDA FY2025 Q1 不通过：拆股基础混用**                        |
| 历史趋势    | 数据库最近 10 季，按真实期末排序                                                                                                                                               | 图表忠实展示 API，包括上述错误同比；图表正确不代表该指标正确   |

季度 CAGR 由前端统一显示 `—`，属于现有明确设计，无需新增。

### Profitability

| 指标             | 来源/计算                                                                                                                                            | 结果                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Gross Margin     | `GrossProfit / Revenue ×100`；无直接毛利则从同申报、同币种、同期间的收入减 `CostOfRevenue` 或 `CostOfGoodsAndServicesSold`；YTD 情况使用成对成本端点 | 本次源期间与公式通过，不用总营业费用代替销售成本                                  |
| Operating Margin | `OperatingIncomeLoss / Revenue ×100`                                                                                                                 | 本次通过                                                                          |
| Net Margin       | `NetIncomeLoss`，备用 `ProfitLoss`，除同季度 Revenue ×100                                                                                            | 本次通过；三家公司使用可核对净利润，不混年度分母                                  |
| ROE              | 后端仅对年度使用年度净利润/平均期初期末权益；季度没有实现年化或 TTM ROE                                                                              | **30 条季度全部 null，前端强制 `—`，与 Tooltip 一致；不是计算失败，不要求改约定** |
| 利润率趋势       | 相应季度利润率，百分数                                                                                                                               | 通过；不把全年率当季度率，不对率求和                                              |

### Cash Flow & Financial Health

| 指标                  | 来源/计算                                                                                                                                                                                                | 结果                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| OCF                   | `NetCashProvidedByUsedInOperatingActivities`，直接季度或 YTD 差分                                                                                                                                        | 通过，未把 6M/9M 直接展示为单季                                                    |
| CapEx                 | `PaymentsToAcquirePropertyPlantAndEquipment`，直接或差分，现金支出为正；负数不转正而留 null                                                                                                              | GOOGL/AAPL 通过；NVDA 最近 10 季该标签不足，全部 null                              |
| FCF                   | 同季 OCF − CapEx                                                                                                                                                                                         | GOOGL/AAPL 通过，负 FCF 保留；NVDA 随 CapEx 缺失为 null                            |
| Cash                  | `CashAndCashEquivalentsAtCarryingValue`                                                                                                                                                                  | 精确季度末余额                                                                     |
| Marketable Securities | `MarketableSecuritiesCurrent`，备用 `ShortTermInvestments`                                                                                                                                               | 当前可交易证券；不含非流动投资，不把所有投资算现金                                 |
| Cash + Securities     | 上述两项还须与同申报 `CashCashEquivalentsAndShortTermInvestments` 明确总额一致，且 API 复核持久化证据                                                                                                    | GOOGL 截图通过；缺证据时 null，不擅加                                              |
| Total Debt            | 优先 `DebtCurrent`，否则 `LongTermDebtCurrent + (ShortTermBorrowings / ShortTermDebt / CommercialPaper)`；加 `LongTermDebtNoncurrent`。避免重复加 CP；必要时使用明确融资租赁字段从债务租赁合计中剔除租赁 | 不是 `Liabilities`。本次非空数值的原始端点与组合运算通过；部分季度因不完整组件留空 |
| Current Ratio         | `AssetsCurrent / LiabilitiesCurrent`                                                                                                                                                                     | 季度末余额，比率通过                                                               |
| Debt / Equity         | Total Debt / `StockholdersEquity`，权益须正                                                                                                                                                              | 季度末余额，比率通过                                                               |

健康计算优先同日期、同 accn、同 filed 快照，不对时点数据做 YTD 差分。完整债务缺失时，只有新旧重叠快照相符才可回退旧完整快照。[健康计算](../../apps/api/src/modules/financials/financial-health.ts)

**NVDA CapEx 是覆盖限制，不能草率修复：** CompanyFacts 有 `PaymentsToAcquireProductiveAssets`，其定义还包括软件及其他无形资产，并非现有纯 PP&E 标签的无条件同义词。FY2027 Q1 披露 1,757、H1 披露 4,434 百万美元；本次没有把差值 2,677 当正式现有口径的 CapEx。当前显示 `—` 比错误别名或补零正确。

### Shareholder Returns

| 指标               | 来源/计算                                                                   | 结果                                                      |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Stock Repurchases  | `PaymentsForRepurchaseOfCommonStock`，可加总金额直接/差分                   | 通过；GOOGL 2026 Q3 的零由原始累计零值产生，不是缺失补零  |
| Diluted Shares     | `WeightedAverageNumberOfDilutedSharesOutstanding`，shares，仅独立季度直接值 | 不累计相减、不用期末股数代替；Q4 缺失合理                 |
| Diluted Shares YoY | 同财季、同一 accn、两期直接股数且匹配被选中的值，再计算同比                 | 现有非空缓存计算通过，比 EPS 同比更保守                   |
| DPS                | `CommonStockDividendsPerShareDeclared`，USD/shares，仅独立季度已宣告金额    | 不混实际支付额；不从年度或 YTD 推算季度                   |
| DPS YoY            | 同财季、同 accn 的直接披露，两期值匹配，基期须正                            | GOOGL/AAPL 非空计算通过；基期零/缺失不产生假增长          |
| 两张趋势           | 回购金额/稀释股数切换不同单位；DPS 美元/股                                  | 数据点与 API 匹配，null 不绘制；NVDA 缓存缺失导致覆盖不足 |

`PaymentsOfDividendsCommonStock` / `PaymentsOfDividends` 是现金股息支付额，与 DPS 宣告口径分开，未用于补 DPS。没有使用 AI 或实际回购股数推算。

## 6. 截图逐项追溯：GOOGL FY2026 Q3

期间 **2026-07-01 至 2026-09-30**；CIK **0001652044**。主申报 **0001652044-26-000084**，10-Q，提交日 **2026-10-29**。下表金额单位为百万美元，EPS 为美元/股。

| 截图指标                  | 原始 SEC 事实与过程                                                                                                                                                     | 核对结果                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Revenue 127,577           | `Revenues`，2026-07-01→09-30，127,577,000,000 USD，主申报                                                                                                               | 一致                                |
| Revenue YoY 24.65%        | 同份主申报比较值：`Revenues` 2025-07-01→09-30 =102,346；`(127577/102346−1)×100=24.65264886%`                                                                            | 一致，去年同财季                    |
| Diluted EPS 2.12          | `EarningsPerShareDiluted`，2026-07-01→09-30，2.12 USD/shares，主申报                                                                                                    | 直接披露，一致                      |
| EPS YoY −26.13%           | 主申报对上年同季度披露 2.87；`(2.12/2.87−1)×100=−26.13240418%`                                                                                                          | 本项具有同份申报可比两期，一致      |
| OCF 42,290                | `NetCashProvidedByUsedInOperatingActivities`：2026-01-01→09-30=127,149（主申报），减 01-01→06-30=84,859（0001652044-26-000071，10-Q，2026-07-23）                       | 9M − H1 =42,290                     |
| CapEx 51,355              | `PaymentsToAcquirePropertyPlantAndEquipment`：同两份申报、同财年起点，9M=131,953，H1=80,598                                                                             | 9M − H1 =51,355，正支出口径         |
| FCF −9,065                | 上述独立季度 OCF − CapEx                                                                                                                                                | 42,290−51,355=−9,065                |
| Cash + Securities 265,098 | 主申报 2026-09-30：`CashAndCashEquivalentsAtCarryingValue`=56,334，`MarketableSecuritiesCurrent`=208,764；`CashCashEquivalentsAndShortTermInvestments` 明确总额=265,098 | 非重叠且同申报总额核对通过          |
| Total Debt 126,118        | 同日主申报：`CommercialPaper`=0；`LongTermDebtCurrent`=1,016；`LongTermDebtNoncurrent`=125,102                                                                          | 0+1,016+125,102=126,118，不是总负债 |
| Current Ratio 2.79        | 同日主申报：`AssetsCurrent`=374,665；`LiabilitiesCurrent`=134,501                                                                                                       | 2.78559267，页面四舍五入正确        |
| Debt / Equity 0.19        | 同日主申报：`StockholdersEquity`=677,549；126,118/677,549                                                                                                               | 0.18613857，页面四舍五入正确        |

OCF 与 CapEx 的 H1 来源：[2026 Q2 SEC 申报目录](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000071/0001652044-26-000071-index.html)。主申报现金流量表本来展示 9M；42,290 和 51,355 不必在原表中作为单季度行出现。独立季度数是有来源的确定性差分，不是仅凭 FCF 算式反推。

## 7. 三家公司与年度交叉核对

| 公司  | 缓存财务采集时间（UTC） | 最近季度              | 缓存 vs 当前同算法重算                                                          |
| ----- | ----------------------- | --------------------- | ------------------------------------------------------------------------------- |
| GOOGL | 2026-11-09 09:25:54     | FY2026 Q3，2026-09-30 | 本次比较的数值字段无差异；EPS 同比一般算法仍有全局限制                          |
| AAPL  | 2026-11-10 10:25:27     | FY2026 Q4，2026-09-26 | 无数值差异；Q4 EPS/股数/DPS 留空是正确保守行为                                  |
| NVDA  | 2026-11-05 09:44:15     | FY2027 Q2，2026-07-26 | 39 个字段差异，主要是旧缓存尚未填新股数/DPS；另一个历史证券快照差异；见问题清单 |

只对缓存中确有 Q1–Q4 的完整财年进行加总，金额单位百万美元：

| 公司 / 财年  |     Revenue：四季合计 / 年度 |        Net Income |               OCF |           CapEx |
| ------------ | ---------------------------: | ----------------: | ----------------: | --------------: |
| GOOGL FY2025 | **402,837 / 402,836，差 +1** | 132,170 / 132,170 | 164,713 / 164,713 | 91,447 / 91,447 |
| AAPL FY2025  |            416,161 / 416,161 | 112,010 / 112,010 | 111,482 / 111,482 | 12,715 / 12,715 |
| AAPL FY2026  |            478,834 / 478,834 | 132,175 / 132,175 | 145,097 / 145,097 |   9,041 / 9,041 |
| NVDA FY2025  |            130,497 / 130,497 |   72,880 / 72,880 |   64,089 / 64,089 |  缺失，不能核对 |
| NVDA FY2026  |            215,938 / 215,938 | 120,067 / 120,067 | 102,718 / 102,718 |  缺失，不能核对 |

五组完整财年的 Q4 Cash、Marketable Securities、Total Debt、Current Ratio、Debt/Equity 与对应年度期末相同，未发现时点余额被加总。没有对 EPS、ROE、利润率或余额求四季合计。

GOOGL FY2025 收入来源差异具体为：Q1 90,234，Q2 96,428，Q3 102,346；前两季合计 H1=186,662。SEC 的 9M 记录为 289,007，而 H1 + 独立 Q3 =289,008。Q4 使用 FY 402,836 −9M 289,007=113,829，因此四季合计多 1。直接季度、累计数、全年均能在 CompanyFacts 找到，后续对比申报也保留这些数字；**不是前端单位换算产生的差异，也不能仅凭这个差额认定算法错。** 它只有一个百万美元披露单位，可能涉及披露舍入/历史口径，但此次证据不足以确认原因。必须标为未完全勾稽，不能把任一季度减 1 来强制平衡。

GOOGL FY2026 尚不完整；AAPL FY2024 缓存只剩 Q3/Q4，GOOGL FY2024 只剩 Q2–Q4，未强行拼接完整财年。缓存仅最近 10 季，这是验证范围限制，不是遗漏季度被补零。

## 8. 实际问题、影响与最小建议

### P1：NVDA FY2025 Q1 EPS 同比拆股基础混用，必须修复后才能整体通过

[同比可比检查](../../apps/api/src/modules/financials/normalize-company-facts.ts#L636)只检查 concept/unit 集合；[EPS 增长计算](../../apps/api/src/modules/financials/normalize-company-facts.ts#L656)没有对拆股基础或同份申报比较值进行核实。

可复现原始记录：

| 期间                  | 被选/可用 EPS | accn / 申报日                    | 含义                                     |
| --------------------- | ------------: | -------------------------------- | ---------------------------------------- |
| 2024-01-29→2024-04-28 |      **0.60** | 0001045810-25-000116，2025-05-28 | 后续比较申报中的拆股后值；数据库当前选值 |
| 2023-01-30→2023-04-30 |      **0.82** | 0001045810-24-000124，2024-05-29 | 上年期间仍只留拆股前披露；数据库选作基期 |
| 2024-01-29→2024-04-28 |      **5.98** | 同一 0001045810-24-000124        | 与 0.82 在原始同一利润表并排披露的本期值 |

当前程序 `(0.60/0.82−1)×100=−26.82926829%`。而原始同份申报 `5.98/0.82−1` 为 **+629.26829268%**。该原始 10-Q Note 15 披露了十拆一事件；CompanyFacts 也有标准拆股比例记录。不能把这里的负增长用于经营判断，也不能通过手工把 0.82 除以 10 并补造未披露的 EPS 来掩盖问题。

**最小建议（本次未执行）：** EPS YoY 至少采用与稀释股数/DPS 相同的同申报、同期间、同拆股基础校验。无法为当前选值找到可比基期时返回 null。若使用其他申报的可靠比较对，应明确该比率来源与显示值的关系，不能静默混基。增加本案例回归测试后，再有选择地更新受影响缓存，无需改数据库 Schema 或重生成 AI。

### P2：NVDA 已有数据没有进入当前股东回报缓存，影响完整性

最近 10 季数据库的 Diluted Shares、Diluted Shares YoY、DPS、DPS YoY 全为空。用现有生产标准化器读取此次 CompanyFacts，可以得到 8 个独立季度的股数、8 个 DPS、7 个股数同比、7 个 DPS 同比，另有 8 个基本股数，合计 38 个字段差异。Q4 无直接披露仍保留缺失。

例如 FY2027 Q2：稀释股数 24,285 百万股、股数同比 −1.00684820%、DPS 0.25、DPS YoY 2400%，都有相应直接事实及同份申报对比。这里只说明提取能力与旧缓存差异，**不把它们写入数据库，也未因此自动刷新。** 旧缓存不存在这些字段的来源，不能仅凭采集时间推断是 SEC 最近才补数据，还是后续字段开发没有回填。

**最小建议：** 用户确认后，只通过现有财务专用更新/受控回填更新相关字段和 provenance；不要启动包含 AI 的完整更新。无需新增计算规则或 Schema。

### P3：NVDA 历史证券值与当前健康快照策略不同，不应直接称为错误金额

2025-01-26 的缓存 Marketable Securities=34,621 百万美元，来源 `0001045810-25-000230`（2025-11-19），在原始 CompanyFacts 中仍存在。当前健康算法选择较新的 `0001045810-26-000021` 快照，该快照未提供相同证券字段，而债务已完整，因此不触发旧快照回退，结果为 null。

这是 39 个差异中剩余的一项，反映旧来源选择与当前保守策略不同。**没有证据证明 34,621 本身错误，也不应将 null 改为 0。** 若后续刷新，可能出现该历史点消失；建议核对/记录快照变化，不能为保持曲线连续而混申报强行补值。本次不建议为此重构健康算法。

### 覆盖限制与未确认项

- NVDA CapEx/FCF 最近 10 季缺失：当前概念范围下合理，未经定义核实不增加宽泛备用标签。
- GOOGL 两个 Q4、AAPL 三个 Q4 的 EPS、稀释股数、DPS 缺直接标准化事实；NVDA 两个 Q4 也缺对应股数/DPS，全部保留 null。
- 季度 ROE 全部留空、季度 CAGR 留空：现有明确约定，无需修复。
- GOOGL Total Debt 2026-03-31、NVDA 2025-04-27/07-27 因不完整兼容债务组件留空；不能把缺失组件当作零。AAPL 10 季 Total Debt 非空。
- GOOGL FY2025 收入差 1 百万美元：记录异常而不强行认定错误；需要额外原文精度或历史口径说明才能归因。
- 此次不是全市场、全部历史修订或所有过渡财年的审计；不能以三家公司通过部分测试保证其他公司无误。

## 9. 图表与年度/季度切换

[趋势绘制](../../apps/web/src/analysis/FinancialTrendChart.tsx#L39)先按 `periodEnd` 排序，横坐标按真实日期距离计算，标签使用 `fiscalYear + fiscalQuarter`。缺失点返回 null；前一点缺失或季度间距超过 120 天时不连线。真实零值仍有点，没有用零补缺；百分比不再次乘 100；金额卡片百万美元、现金流/健康趋势亿美元、股数百万股、DPS 美元/股。

实际 30 个季度没有重复 periodEnd 或财季误标。45 次单序列渲染验证点数、缺口和排序；年度/季度各自渲染的所有可见卡片与真实服务输出格式化值一致。四大模块共用同一个 mode 和同一份已加载 detail 的两套数组，切换本身不请求 SEC，不把年度 CAGR/ROE 留在季度卡片中。当前图表会忠实展示数据库中的 NVDA 错误 EPS YoY，故“前后端一致”不能代替数据正确性。

未在审计中挂载真实 `CompanyDetails`：它包含现有初始化任务调用，非本次只读验证所必需。此次没有修改或触发该流程，没有浏览器控制台与真实交互结果可报告。

## 10. 执行、复现与修复边界

独立文件：

- [只读审计脚本](../../scripts/quarterly-financial-audit.cjs)：已有 CompanyFacts 缓存 + PostgreSQL 只读事务 + 真实后端序列化/React 渲染；不包含 SEC 请求或 AI 调用。
- [审计测试](../../scripts/quarterly-financial-audit.test.cjs)：52/53 周财年、Q4 还原和 NVDA 实际拆股问题的可复现记录。最后一项验证“错误确实存在”，**测试通过不表示生产缺陷已修复**。
- [机器证据](quarterly-financial-audit-evidence.json)：保留每季及来源供逐条检查。

```sh
npm run build
npm run test:web
# 缓存默认放在 /tmp/quarterly-financial-audit；可用 QUARTERLY_AUDIT_CACHE 指定目录
node scripts/quarterly-financial-audit.cjs
node --test scripts/quarterly-financial-audit.test.cjs
```

本次执行：独立审计完成，3 项审计测试通过；全仓 typecheck、Lint、测试、前后端 build 通过。后端 180 项通过、5 项跳过，前端 41 项通过。构建保留原有 Vite 大包警告，不影响此次审计结论。相关既有回归测试也覆盖 YTD 差分、Q4、累计 EPS 禁止差分、缺失端点、修订申报、季度 ROE/CAGR 隐藏及图表 null 缺口。

**此次不修复生产代码，不回填数据。** 建议仅在确认后先处理 P1 EPS 可比性，再处理 P2 缓存补齐。已核实的季度分解、利润率、FCF 和时点余额流程无需为“优化”而重写。
