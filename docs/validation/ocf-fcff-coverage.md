# OCF 出发的 FCF / 简化 FCFF 可行性验证

验证日：2026-11-18。仅研究，不改业务代码、数据库或 Schema，不安装依赖，不调用 AI，不开发估值。复用上轮 20 个 CompanyFacts/Submissions JSON、TTM 端点选择及 SEC 数值转换；额外读取 10 家最新申报 HTML、NVDA 对应完整年报，并对 XOM 重读 CompanyFacts/Submissions（共 13 个必要新响应）。原文件保存在 `/tmp/dcf-companyfacts-coverage` 和 `/tmp/ocf-fcff-validation`。

## 1. 结论与覆盖表

**仅 CompanyFacts 加上原始披露口径核对，9/10 家可以计算有明确范围的 TTM OCF−现金资本支出；额外使用 XOM 原始申报的标准 Inline XBRL 后为 10/10。严格限定旧版纯 PP&E 标签则仍为 7/10。不能把这些范围不同的历史现金 FCF 直接当统一 FCFF。**

**本次没有公司同时完成现金利息/费用调节和可使用税盾税率的验证，批准的简化 FCFF 为 0/10，全部 null。** 这是本次证据的批准范围，不等于经济上无法估计 FCFF。历史 ETR 可算、费用可取，都不等于已证明利息税盾。

| 公司  | TTM OCF        | 现金 CapEx       | TTM FCF            | 利息费用 TTM             | 利息税盾税率充分？ | 简化 FCFF |
| ----- | -------------- | ---------------- | ------------------ | ------------------------ | ------------------ | --------- |
| GOOGL | 可用           | 可用¹            | 可计算¹            | 可取费用；未核准现金调节 | 否；需人工核对     | null      |
| AAPL  | 可用           | 可用¹            | 可计算¹            | 标准端点不完整           | 否；需人工核对     | null      |
| MSFT  | 可用           | 可用¹            | 可计算¹            | 可取费用；未核准现金调节 | 否；需人工核对     | null      |
| KO    | 可用           | 可用¹            | 可计算¹            | 可取费用；未核准现金调节 | 否；需人工核对     | null      |
| WMT   | 可用           | 可用¹            | 可计算¹            | 可取费用；未核准现金调节 | 否；需人工核对     | null      |
| AMZN  | 可用           | 原文核准替代范围 | 可计算¹            | 可取费用；未核准现金调节 | 否；需人工核对     | null      |
| NVDA  | 可用           | 原文核准替代范围 | 可计算¹            | 可取费用；未核准现金调节 | 否；需人工核对     | null      |
| TSLA  | 可用           | 可用¹            | 可计算¹            | 可取费用；未核准现金调节 | 否；需人工核对     | null      |
| XOM   | CF缺；原文可补 | CF缺；原文可补   | 仅原文补充后可计算 | 标准端点不完整           | 否；需人工核对     | null      |
| CAT   | 可用           | 可用¹            | 可计算¹            | 标准端点不完整           | 否；需人工核对     | null      |

¹ FCF 采用表内明确的现金支出口径，未包括所有非现金租赁/供应商融资及其他再投资；CAT 的 PP&E 行尤其明确排除了出租给他人的设备。不能据此称“完整再投资后的无杠杆自由现金流”。

## 2. 实际计算：百万美元

| 公司            | TTM 起止                |     OCF |   CapEx |     FCF | 简化 FCFF |
| --------------- | ----------------------- | ------: | ------: | ------: | --------- |
| GOOGL           | 2025-10-01 → 2026-09-30 | 179,551 | 159,804 |  19,747 | null      |
| AAPL            | 2025-09-28 → 2026-09-26 | 145,097 |   9,041 | 136,056 | null      |
| MSFT            | 2025-10-01 → 2026-09-30 | 195,878 | 135,921 |  59,957 | null      |
| KO              | 2025-09-27 → 2026-10-02 |  16,227 |   1,945 |  14,282 | null      |
| WMT             | 2025-08-01 → 2026-07-31 |  42,923 |  29,414 |  13,509 | null      |
| AMZN            | 2025-10-01 → 2026-09-30 | 168,300 | 215,192 | -46,892 | null      |
| NVDA            | 2025-07-28 → 2026-07-26 | 134,360 |   7,354 | 127,006 | null      |
| TSLA            | 2025-10-01 → 2026-09-30 |  18,710 |  15,407 |   3,303 | null      |
| XOM（原文补充） | 2025-07-01 → 2026-06-30 |  59,727 |  29,174 |  30,553 | null      |
| CAT             | 2025-10-01 → 2026-09-30 |  14,184 |   2,910 |  11,274 | null      |

TTM 规则继续为 FY＋本年 YTD−去年可比 YTD，最新完整年报则直接作为 TTM；三端同 concept、同 USD，当前/上年 YTD 同一申报，使用真实财年日期及 52/53 周同期。OCF 与 CapEx 的 TTM start/end 必须相同，支出使用正值、FCF 可以为负。所有公式、端点、单位、accn、filed、来源链接见 [机器证据](ocf-fcff-coverage.json)。

### AMZN 与 NVDA 的替代标签核对

- **AMZN**：最新 10-Q 现金流量表中，`PaymentsToAcquireProductiveAssets` 实际对应现金购买 PP&E。本年 9M 为 175,670、上年 9M 为 92,297 百万美元，TTM 为 215,192；原表还直接披露同一 TTM 的 215,192，可交叉核对。此处 FCF =168,300−215,192=**−46,892**。公司自己的净资本支出 FCF 还扣除处置回款和供应商激励，因此不能将这个毛支出定义的数值冒充公司口径 FCF。融资租赁本金、非现金获得设备也不能自动混入本行。
- **NVDA**：同一标准标签在该公司原表明确包括 PP&E **和无形资产**。本年 H1=4,434、去年 H1=3,122、完整 FY=6,042，TTM=7,354，三端分别与最新 10-Q 和对应年报核对。FCF=134,360−7,354=**127,006**。核准的是公司实际披露的宽口径现金购买额，不是证明该标签对所有公司都等同纯 PP&E。
- 本次没有修改产品的 CapEx 映射；替代只用于独立验证，机器证据保留原行、context 和金额。

## 3. 利息与税率：为何未批准简化 FCFF

| 公司  | 实际费用 concept / TTM（百万美元）         | 历史 TTM ETR² | 特别需要核对的事项                                                                                                    |
| ----- | ------------------------------------------ | ------------: | --------------------------------------------------------------------------------------------------------------------- |
| GOOGL | us-gaap:InterestExpenseNonoperating / 3076 |        18.06% | 另有资本化利息 TTM 1,146；不得把已计入资产支出的资本化利息再次当经营现金利息加回。实际付息桥接不足。                  |
| AAPL  | null                                       |        16.99% | InterestExpense 最后只到 2023 财年，不能拿旧利息或“其他损益净额”替代当前；新原文未恢复完整费用/付息两期。             |
| MSFT  | us-gaap:InterestExpenseNonoperating / 3223 |        19.68% | 费用可取，但当期现金利息的完整 TTM 端点缺失，财务租赁及资本化部分需调节。                                             |
| KO    | us-gaap:InterestExpense / 1529             |        17.36% | InterestExpense 与 Nonoperating 的一致数值不能相加；现金付息 TTM 不完整，仍需扣除非现金费用及税务调节。               |
| WMT   | us-gaap:InterestExpenseDebt / 1859         |        23.25% | InterestExpenseDebt 仅债务费用，租赁利息是否完整覆盖、费用与现金的差额未核准。                                        |
| AMZN  | us-gaap:InterestExpenseNonoperating / 4484 |        22.33% | 存在费用及大额租赁融资；资本化/现金付息及递延税的桥接不完整。                                                         |
| NVDA  | us-gaap:InterestExpenseNonoperating / 464  |        16.05% | 非经营利息费用不是已验证的现金利息；股权激励税收等会影响历史 ETR，不能直接视为债务税盾。                              |
| TSLA  | us-gaap:InterestExpenseNonoperating / 348  |        22.19% | 非经营费用可取，租赁/特定融资及资本化口径需要核对，历史 ETR 不证明税盾可利用。                                        |
| XOM   | null                                       |          null | 最新费用和现金付息在原文中均存在，但 CompanyFacts 未纳入本期；原文另区分资本化利息，未做完整 TTM 费用—现金—税盾调节。 |
| CAT   | null                                       |        22.68% | 原文分别披露金融产品与非金融产品利息；简单加回全部利息会改变金融业务经营现金流含义，不能用旧 InterestPaidNet 顶替。   |

² 历史 ETR = **同一 TTM 的 IncomeTaxExpenseBenefit ÷ 税前持续经营利润**，没有平均季度税率，也没有把所得税费用当税率。税前利润尝试标准 `IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest` 及 `...MinorityInterestAndIncomeLossFromEquityMethodInvestments`，保留各自含义；该比率仅提供会计历史背景，不是批准的边际/可使用利息抵扣税率。`taxShieldRate` 始终 null。未拿联邦名义税率或会计 ETR 武断填入公式。

费用尝试 `InterestExpense`、`InterestExpenseNonoperating`、`InterestExpenseDebt`、`InterestAndDebtExpense`、`InterestExpenseDebtExcludingAmortization`；付息独立检查 `InterestPaid`、`InterestPaidNet`、`InterestPaidCapitalized`，资本化检查 `InterestCostsCapitalized`。前两类绝不混用。7/10 家能取得所列费用口径 TTM，但没有一家从这些付息标准标签取得本次最新完整 TTM（历史年度有数不算最新）。各标签最后覆盖期、定义及缺少的端点保存在证据的 `interestAttempts`。

US GAAP 经营现金流一般包含非资本化现金付息；资本化利息可能随购建资产归入投资现金流，融资租赁本金通常另列融资。当前 OCF 是否已扣除的是**现金利息**，不能仅看到利润表有费用就按同额加回。费用还可能含折溢价/融资成本摊销、应计未付项、净额或合并金融业务。原始申报已读取，但没有凭未出现某术语就认定其金额为零。

因此本次不计算未经证明的 `FCF + 费用 × (1−T)`，也不将“简化估算”标签用来代替口径核实。需要逐项取得现金桥接和合理税务假设后，才适合展示带假设的估算结果。

## 4. XOM 缺失原因：不是期间选错或标签无法映射

两次读取 Submissions 均给出最新 10-Q：`0000034088-26-000093`，2026-08-03 提交、报告期末 2026-06-30。原文 DocumentPeriodEndDate 及 context 同样为 6 月 30 日，没有按自然季度猜日期。

同一原文中存在标准 `NetCashProvidedByUsedInOperatingActivities` 和 `PaymentsToAcquirePropertyPlantAndEquipment` 的 H1 两期数：OCF 32,260 / 24,503；CapEx 12,997 / 12,181 百万美元。但原响应及重新请求的 CompanyFacts 中，同名标准标签均只到 2026-03-31，未包含本次 accn。**可确定为本次聚合接口响应未覆盖原始申报已有事实，不能归咎于自定义标签或 TTM 公式。尚未验证 HTTP 上游/代理缓存头，不能进一步断言具体是 SEC 索引同步延迟还是传输缓存问题。**

使用原始 Inline XBRL 的 H1 数据与已存在 CompanyFacts 的 FY2025 相同概念数值补充：OCF=51,970＋32,260−24,503=59,727；CapEx=28,358＋12,997−12,181=29,174；FCF=**30,553**。两期同 context 的实体 CIK、单位、日期和金额已经核对。这个补充值单独保存，**不计入 CompanyFacts-only 的 9/10**；没有用旧 Q1 值冒充最新。

## 5. 最简单且可靠的后续方案

1. 历史层先做**有来源、明确 CapEx 范围的 OCF−现金资本支出**，本轮 9/10（加 XOM 原文补充 10/10），比 EBIT 路径依赖完整 D&A 和经营 ΔNWC 更适合当前数据源。它是历史现金 FCF，不自动等同 FCFF 或 FCFE。
2. 保存毛/净支出、无形资产、处置和激励是否包含，以及非现金租赁和金融业务范围。CAT 现有资本支出行排除出租设备，不应以这一减法声称覆盖全部再投资；AMZN 则要区别公司自行披露的净额 FCF。
3. 企业估值层另设利息—现金桥接、融资租赁/金融业务调整与税盾假设，未通过时 FCFF 为 null；不要只因已得到历史 ETR 就启用企业折现。
4. 仍需要按需读取原始申报。有些缺口是**标准标签在 CompanyFacts 未收录**（XOM），有些可能是非标准标签或分部/费用组合（CAT）；并非只能靠新第三方源或 AI。AMZN/NVDA 的问题则可通过标准标签加原表范围核对解决，不需按公司写生产特判。
5. 本次不修改当前产品映射、财务缓存或数据库。验证只说明计算可行性，不是开发 DCF 的授权。

## 6. 来源、复现与检查

- [GOOGL 原始 10-Q，2026-09-30](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000084/goog-20260930.htm)（提交 2026-10-29）
- [AAPL 原始 10-K，2026-09-26](https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm)（提交 2026-11-03）
- [MSFT 原始 10-Q，2026-09-30](https://www.sec.gov/Archives/edgar/data/789019/000119312526436133/msft-20260930.htm)（提交 2026-10-28）
- [KO 原始 10-Q，2026-10-02](https://www.sec.gov/Archives/edgar/data/21344/000162828026067844/ko-20261002.htm)（提交 2026-10-28）
- [WMT 原始 10-Q，2026-07-31](https://www.sec.gov/Archives/edgar/data/104169/000010416926000154/wmt-20260731.htm)（提交 2026-08-28）
- [AMZN 原始 10-Q，2026-09-30](https://www.sec.gov/Archives/edgar/data/1018724/000101872426000040/amzn-20260930.htm)（提交 2026-10-30）
- [NVDA 原始 10-Q，2026-07-26](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/nvda-20260726.htm)（提交 2026-08-26）
- [TSLA 原始 10-Q，2026-09-30](https://www.sec.gov/Archives/edgar/data/1318605/000162828026066775/tsla-20260930.htm)（提交 2026-10-22）
- [XOM 原始 10-Q，2026-06-30](https://www.sec.gov/Archives/edgar/data/34088/000003408826000093/xom-20260630.htm)（提交 2026-08-03）
- [CAT 原始 10-Q，2026-09-30](https://www.sec.gov/Archives/edgar/data/18230/000001823026000057/cat-20260930.htm)（提交 2026-11-04）

- NVDA 年度端点：[2026-01-25 年报](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm)。
- 利息披露规则背景：[FASB 2025 年利息研究备忘录](https://storage.fasb.org/PCC%20Topic%204%20Public%20Meeting%20Interest%20Method%20Memo%2020250926.pdf)提及 ASC 230 对净资本化金额后付息披露及非现金折价摊销的区别。
- `node scripts/dcf-coverage/ocf-fcff.cjs`：读取已有缓存，使用复用的 TTM 逻辑和数值转换，生成机器证据，不请求网络或数据库。`node --test scripts/dcf-coverage/ocf-fcff.test.cjs`：5 项检查涵盖期间/单位、两类 CapEx 原表匹配、XOM 补充、负 FCF、税率/付息不混用。
- TypeScript、Lint、项目回归测试及独立验证测试通过。原始 HTML 仅在本地临时目录，证据包含来源、context、事实值、期间、申报日和计算公式；不导入业务数据库。
