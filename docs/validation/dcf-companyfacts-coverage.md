# SEC CompanyFacts：DCF 财务指标覆盖验证

验证日：2026-11-18。10 家公司，实际请求并读取各自 CompanyFacts 和 Submissions；复用现有 SecClient 的 User-Agent、代理、超时和限速机制，串行请求。原先季度审计原始缓存已不存在，本次共读取 20 个必要 JSON，随后仅使用本地缓存。未连接数据库、未修改业务代码/Schema、未调用 AI、未计算 FCFF/WACC/终值/股价。

## 1. 公司覆盖情况

可用＝最新公开 10-K/10-Q 对应 TTM 或最新申报内的有效时点值可取得；部分＝存在相关标签/完整候选，但范围、组合或分类仍需确认，正式值保持 null；缺失＝在本次尝试的标准标签中未能取得可靠最新值，并不表示经济意义为零。

| 公司  | 最新报告期末 | 收入 | 营业利润* | 税费 | D&A  | CapEx | OCF  | ΔNWC | 现金 | 短期投资 | 流动债务 | 非流动债务 | 期末股数 |
| ----- | ------------ | ---- | --------- | ---- | ---- | ----- | ---- | ---- | ---- | -------- | -------- | ---------- | -------- |
| GOOGL | 2026-09-30   | 可用 | 可用      | 可用 | 部分 | 可用  | 可用 | 部分 | 可用 | 可用     | 可用     | 可用       | 可用     |
| AAPL  | 2026-09-26   | 可用 | 可用      | 可用 | 可用 | 可用  | 可用 | 部分 | 可用 | 可用     | 可用     | 可用       | 可用     |
| MSFT  | 2026-09-30   | 可用 | 可用      | 可用 | 部分 | 可用  | 可用 | 部分 | 可用 | 可用     | 部分     | 可用       | 可用     |
| KO    | 2026-10-02   | 可用 | 可用      | 可用 | 可用 | 可用  | 可用 | 部分 | 可用 | 可用     | 部分     | 部分       | 可用     |
| WMT   | 2026-07-31   | 可用 | 可用      | 可用 | 部分 | 可用  | 可用 | 部分 | 可用 | 缺失     | 可用     | 可用       | 可用     |
| AMZN  | 2026-09-30   | 可用 | 可用      | 可用 | 可用 | 部分  | 可用 | 部分 | 可用 | 可用     | 可用     | 可用       | 可用     |
| NVDA  | 2026-07-26   | 可用 | 可用      | 可用 | 可用 | 部分  | 可用 | 部分 | 可用 | 缺失     | 可用     | 可用       | 可用     |
| TSLA  | 2026-09-30   | 可用 | 可用      | 可用 | 部分 | 可用  | 可用 | 部分 | 可用 | 可用     | 可用     | 部分       | 可用     |
| XOM   | 2026-06-30   | 缺失 | 缺失      | 缺失 | 缺失 | 缺失  | 缺失 | 缺失 | 缺失 | 缺失     | 缺失     | 缺失       | 缺失     |
| CAT   | 2026-09-30   | 可用 | 可用      | 可用 | 可用 | 可用  | 可用 | 部分 | 可用 | 缺失     | 缺失     | 缺失       | 可用     |

*营业利润 OperatingIncomeLoss 是可核实的 EBIT 代理，并非已完成非经营收益、金融业务及租赁重分类的估值 EBIT。税费也是会计所得税费用，不是经营性现金税或边际税率。上述“可用”只确认对应会计字段和期间，不代表已经可直接送入估值模型。

## 2. 指标覆盖率

仅“可用”计入直接或可靠计算覆盖数；部分项不算成功，禁止用候选值替代 null。

| 指标       | 可用 / 10 | 部分 / 10 | 缺失 / 10 |
| ---------- | --------: | --------: | --------: |
| 收入       |         9 |         0 |         1 |
| 营业利润*  |         9 |         0 |         1 |
| 税费       |         9 |         0 |         1 |
| D&A        |         5 |         4 |         1 |
| CapEx      |         7 |         2 |         1 |
| OCF        |         9 |         0 |         1 |
| ΔNWC       |         0 |         9 |         1 |
| 现金       |         9 |         0 |         1 |
| 短期投资   |         6 |         0 |         4 |
| 流动债务   |         6 |         2 |         2 |
| 非流动债务 |         6 |         2 |         2 |
| 期末股数   |         9 |         0 |         1 |

## 3. 实际 TTM 与时点选取

- 先读 Submissions 的最新 10-K/10-Q（含修订），按 reportDate、filingDate 排序锚定本次最新报告期，而不是挑一个“有数值”的旧季度冒充最新。
- 最近完整年度作为基准；最新申报本身为完整年度时，年度就是 TTM；否则计算 **最新完整 FY＋本年 YTD−上年可比 YTD**。按真实财年 start/end 配对，允许 52/53 周同期长度相差最多 8 天，不按自然年季度或 frame 推算。
- 三端必须使用同一个标准 concept 和 USD；当前及去年可比 YTD 必须出现在同一份最新申报。年度记录按精确日期取截至最新申报日的最新版本；保留各端来源，不宣称已完成所有跨申报会计政策/重述调节。缺端点则 null，不对非可加总指标套差分。
- 现金、投资、债务按最新申报 accn 和期末精确匹配，不做 TTM，不用旧期余额填补。股数优先同期期末 CommonStockSharesOutstanding；否则允许该份申报较晚封面日期的 dei:EntityCommonStockSharesOutstanding，并明确记录实际日期，不使用加权平均稀释股数。
- ShortDebt 口径含短债和一年内到期长期债务；有明确融资租赁子项时剔除，并保留运算输入。LongDebt 限定非流动部分，不能把 LongTermDebt 总额、债务租赁合计直接映射成非流动纯有息债务，也不能重复加商业票据。

| 公司  | 收入 TTM 起止           | 收入 TTM（百万美元） | 实际收入 concept                                            |
| ----- | ----------------------- | -------------------: | ----------------------------------------------------------- |
| GOOGL | 2025-10-01 → 2026-09-30 |               471098 | us-gaap:Revenues                                            |
| AAPL  | 2025-09-28 → 2026-09-26 |               478834 | us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax |
| MSFT  | 2025-10-01 → 2026-09-30 |               346445 | us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax |
| KO    | 2025-09-27 → 2026-10-02 |                51054 | us-gaap:Revenues                                            |
| WMT   | 2025-08-01 → 2026-07-31 |               728466 | us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax |
| AMZN  | 2025-10-01 → 2026-09-30 |               797455 | us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax |
| NVDA  | 2025-07-28 → 2026-07-26 |               302970 | us-gaap:Revenues                                            |
| TSLA  | 2025-10-01 → 2026-09-30 |               103570 | us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax |
| XOM   | —                       |                 null | —                                                           |
| CAT   | 2025-10-01 → 2026-09-30 |                77773 | us-gaap:Revenues                                            |

所有成功项的金额、单位、全部输入期间、filed、form、accn、SEC 申报链接和实际 concept，均保存在 [机器证据 JSON](dcf-companyfacts-coverage.json) 的 `companies[].metrics` 中。`attempts` 单独记录历史标签存在性、定义和最后覆盖期，不与最新可用混为一谈。

## 4. 缺失与部分覆盖明细

下表列出非充分覆盖项；各标签的历史存在性、最后覆盖期及完整失败端点见机器证据 `attempts`，没有把旧数据当最新数据。

| 公司       | 缺失/部分指标            | 已尝试的主要标签与原因                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GOOGL      | D&A 部分                 | `DepreciationDepletionAndAmortization`、`DepreciationAndAmortization` 无完整最新值；`Depreciation` 可构建 TTM，`AmortizationOfIntangibleAssets` 的 TTM 端点不完整。                                                                                                                                                                                       |
| MSFT       | D&A、短债部分            | 折旧与无形摊销均有值，但完整范围待核对；`DebtCurrent` 缺最新值，`LongTermDebtCurrent` 有值，`ShortTermBorrowings`/`ShortTermDebt`/`CommercialPaper` 未形成完整同快照组合。                                                                                                                                                                                |
| KO         | 短债、长债部分           | `DebtCurrent`、`LongTermDebtNoncurrent` 缺最新值；`LongTermDebtAndCapitalLeaseObligationsCurrent` 与 `LongTermDebtAndCapitalLeaseObligations` 包含租赁，`NotesAndLoansPayable` 又包括流动/非流动部分，不能直接相加当纯有息债务。                                                                                                                          |
| WMT        | D&A 部分；短期投资缺失   | `DepreciationDepletionAndAmortization`、`DepreciationAndAmortization`、单独折旧/摊销未形成完整值；`DepreciationAmortizationAndAccretionNet` 有值但含 accretion。`MarketableSecuritiesCurrent`、`ShortTermInvestments`、现金与短投合计未取得完整最新短投值。                                                                                               |
| AMZN、NVDA | CapEx 部分               | `PaymentsToAcquirePropertyPlantAndEquipment` 无最新完整 TTM；`PaymentsToAcquireProductiveAssets` 有值但口径更宽，不能强行替代。另检查 `PaymentsToAcquireIntangibleAssets`/`PaymentsToAcquireSoftware`，不将它们默认补零或擅自组合。                                                                                                                       |
| NVDA       | 短期投资缺失             | `MarketableSecuritiesCurrent`、`ShortTermInvestments` 未取得最新期末值，也无可用现金+短投总额；历史证券值不前移填充。                                                                                                                                                                                                                                     |
| TSLA       | D&A、长债部分            | `Depreciation` 有 TTM，但合计 D&A 和完整摊销端点不足；`LongTermDebtNoncurrent` 没有最新值，`LongTermDebt` 总额未与流动/租赁口径可靠分解。                                                                                                                                                                                                                 |
| CAT        | 短期投资、短债、长债缺失 | 尝试 `MarketableSecuritiesCurrent`、`ShortTermInvestments`、`DebtCurrent`、`LongTermDebtCurrent`、`ShortTermBorrowings`、`ShortTermDebt`、`CommercialPaper`、`LongTermDebtNoncurrent`、债务/租赁合计；未取得可批准的完整最新值，金融业务相关自定义披露仍待原文核对。                                                                                      |
| XOM        | 全部所需最新指标缺失     | 最新 Submissions 锚定 2026-06-30，但所试标准概念尚未匹配该份申报；部分概念最后只覆盖 2026-03-31 或更早。已尝试本报告全部核心标签、收入备用标签、D&A 分项、宽口径 CapEx、投资/债务备用字段及两类实际股数。不能用旧期数据伪装最新，也不能断言其原始财报未披露。                                                                                             |
| 其余 9 家  | ΔNWC 部分                | 检查 `AccountsReceivableNetCurrent`、`InventoryNet`、`PrepaidExpenseCurrent`、`OtherAssetsCurrent`、`AccountsPayableCurrent`、`AccruedLiabilitiesCurrent`、`OtherLiabilitiesCurrent`、`ContractWithCustomerLiabilityCurrent`、`AssetsCurrent`、`LiabilitiesCurrent`，并读取真实存在的相关 `IncreaseDecreaseIn...` 现金流行；仍不足以批准完整经营性 ΔNWC。 |

AAPL 除 ΔNWC 外，本次列出的会计数据均取得最新值；这不代表已经完成经营税、租赁、超额现金和股数稀释等估值调整。

## 5. 最终建议与语义边界

**CompanyFacts 适合作为基础数据源，但本次不能证明仅靠它就能对这 10 家公司统一、无人工判断地计算标准 FCFF。** 关键障碍是经营性 ΔNWC 的定义和重分类，其次是 D&A 完整性、CapEx 范围，以及最新申报与标准事实覆盖不同步。

### D&A、CapEx 与多标签组合

- AAPL、KO、AMZN、NVDA、CAT 的 `DepreciationDepletionAndAmortization` 能组成完整最新 TTM；不得再叠加其组成部分，否则重复计算。
- GOOGL：`Depreciation` TTM 为 27,995 百万美元；`AmortizationOfIntangibleAssets` 虽有最新季度事实，但缺本规则所需完整 TTM 端点。不能把只有折旧的数值当 D&A。
- MSFT：折旧 TTM 38,300、无形资产摊销 TTM 4,200 百万美元均存在。两者可能组合为候选，但尚未核实软件、生产性资产/租赁相关摊销的范围及是否全部包含；本次不批准简单相加为完整 D&A，不伪称数值已校验。
- TSLA：存在折旧 TTM 5,670 百万美元，完整摊销范围仍未确认；不能因为标准标签历史存在就自动补零。
- WMT：`DepreciationAmortizationAndAccretionNet` TTM 15,093 百万美元可取得，但还包含 accretion，不是纯 D&A 的无条件等价标签。
- AMZN、NVDA：`PaymentsToAcquireProductiveAssets` 有完整 TTM 候选，但标准定义包括软件和其他无形资产，不能直接替换 PP&E-only CapEx。扩展为“全部经营再投资”需先统一软件资本化及租赁政策，不是简单改标签。
- KO 短期投资能由同申报同日期的 `CashCashEquivalentsAndShortTermInvestments − CashAndCashEquivalentsAtCarryingValue` 可靠取得 231 百万美元；不能用 `MarketableSecurities` 的未分流动/非流动总额代替。
- 短债可能需要 `LongTermDebtCurrent + ShortTermBorrowings/CommercialPaper`，商业票据若已包含在短借总额中不能再加；债务租赁合计需有明确子项才能分拆。未提供组件不是组件为零。

### ΔNWC 为什么没有批准值

本次 9 家能取得部分 TTM 首尾经营资产负债余额或现金流变动行，但完整 ΔNWC 仍为 null。需要先决定哪些应收、存货、预付、应付、应计、合同负债属于经营用途，剔除现金/投资、融资债务、非经营税项等。`OtherAssetsCurrent` / `OtherLiabilitiesCurrent` 通常无法仅凭统一标签完成分类。

`本期NWC − 去年同期NWC` 的余额变动还会混入并购、处置、汇兑、重分类；现金流量表的 `IncreaseDecreaseIn...` 又常按经营现金流方向表示，不能直接不改符号相加。这些是不同定义的 ΔNWC，不应拼凑缺失分项。尤其 CAT 有金融业务、AMZN/零售有大量经营负债，不能用 `Current Assets − Current Liabilities` 一刀切。

### 是否补充原始申报解析

建议对缺失/部分项按需补充同份 10-K/10-Q 的原始结构化 XBRL 及现金流/营运资本附注核对，特别是 XOM 最新期缺失、D&A 合计与子项调节、债务租赁分类、经营性其他资产负债。优先结构化事实及定义，不用 AI 猜数字，不需要下载全市场 ZIP。此次没有实现或请求这些额外解析流程；因此“部分”不得据此升级为“可用”。

`OperatingIncomeLoss` 仅是会计营业利润代理，含金融业务或非经营项目时需要进一步调整。`IncomeTaxExpenseBenefit` 包括当期和递延税，会受到投资收益、一次性税务等影响，不能当作经营现金税，更不能直接作为 WACC 的税率。OCF 在 US GAAP 下通常已经包含部分利息与税，**OCF−CapEx 也不自动等于无杠杆 FCFF**。

### 现有结构的最小调整建议（本次不实施）

1. 现有年度/季度表已有 Revenue、Operating Income、OCF、CapEx、Cash、Securities、Debt、Shares 与 `sources`；复用，不复制一套公司数据。
2. 后续只在确需时增加税费与核准 D&A 字段，另保存组成项/计算政策；ΔNWC 最好保留分项、经营分类及调整，而不是只存一个缺少口径的总数。
3. TTM 从完整年度和 YTD 事实计算。现有最近 10 个季度缓存可能缺 Q4 或某些新增标签，不能仅依赖四条季度行机械求和；需保留原始 YTD 端点/来源，或在财务采集时增加最小 provenance 缓存。
4. 候选与批准值、历史存在与最新可用分别记录；保留 concept、unit、start/end、accn、filed、公式和版本。所有未批准值为 null，零值只接受明确披露或可靠计算。
5. 股数记录实际 as-of 日期与股类覆盖范围；目前实际流通股不等于未来期权稀释后的估值股数。投资和债务也应保留流动/非流动、受限/非受限及租赁范围，不能把所有现金或投资都认定为可分配的超额现金。

## 6. 复现与验证

- 独立验证脚本：`scripts/dcf-coverage/verify.cjs`；读取 `/tmp/dcf-companyfacts-coverage/{Ticker}-facts.json` 与 `-submissions.json`，可用 `DCF_CACHE_DIR` 更换目录。原始响应保留在本机临时目录，机器证据记录 SHA-256 和 SEC 链接。
- `node scripts/dcf-coverage/verify.cjs` 重建机器证据；`node --test scripts/dcf-coverage/coverage.test.cjs` 校验 10 家样本、期间/单位/公式、最新与历史区别、null 及覆盖率统计。
- 全仓 TypeScript、Lint、原有测试通过；独立验证测试 5 项通过。未安装新依赖，没有生产代码或数据库写入，不运行任何估值功能。
- 源头限制参考 [SEC CompanyFacts/API 说明](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)：标准 taxonomy、全实体事实和财务日历限制。CompanyFacts 不包含所有自定义标签，也不提供全部分部维度；本次缺失不能外推为原始财报从未披露。
