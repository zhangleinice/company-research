# 季度财务数据最小修复

日期：2026-11-12。仅处理季度 EPS YoY 的拆股可比性，以及 NVDA 已可可靠提取的四个季度股东回报字段。原审计结论见 [quarterly-financial-audit.md](quarterly-financial-audit.md)。本次没有修改 UI、Prisma Schema、年度公式、CompanyFacts 字段映射、Revenue Breakdown、Business 或 Management & Risks。

## 修复结果

**本轮两个问题已修复。** NVDA FY2025 Q1 保持直接披露的拆股调整后 EPS **0.60**，错误的 EPS YoY **−26.82926829% → null**，页面显示 `—`，历史同比图也不再绘制该错误点。没有把 +629.27% 写入系统，没有换回拆股前 EPS，也没有自行补造拆股调整值。

NVDA 最近 10 季中，按原始 SEC CompanyFacts 回填 **8 个 Diluted Shares、7 个 Diluted Shares YoY、8 个 DPS、7 个 DPS YoY，共 30 个字段值**。两个 Q4 及无法证明比较基础的同比继续缺失。所有其他季度数值、全部年度记录、公司/收藏、AI 摘要/任务、年报缓存及收入明细缓存均在逐字段校验中保持不变。

## 1. EPS 同比规则

生产改动仅在 [normalize-company-facts.ts](../../apps/api/src/modules/financials/normalize-company-facts.ts) 的 `calculateGrowth` 中：

1. 年度保持原来计算；季度 EPS YoY 不再走仅检查 concept/unit 的一般增长分支。
2. 独立季度 EPS 的选择完全不变；不对 FY 或 YTD EPS 相减。
3. 从已读取的标准 `EarningsPerShareDiluted`、USD/shares 事实中，查找**同一 accn、同 filed、同 form** 并列披露的本期及去年同财季两期直接值。两期 start/end 必须精确匹配已选季度；正值条件保持原约定。
4. 本期值必须等于页面采用的当期 EPS，比较值也须匹配已选去年同期 EPS。可在较早的同份申报中找到两期，但不能为获得同比而换用不同数值或拆股基础。
5. 成立才计算 `(currentEPS/priorEPS−1)×100`，保存两条完整 SEC 事实、公式、比较期末及选择政策到 `sources.epsGrowth`。
6. 找不到匹配比较对时返回 null，在 `sources.epsGrowth` 记录不可比较的原因及原有两期来源。没有公司名称、CIK、拆股日期、比例或 EPS 金额特判。

这是保守校验，允许少显示同比，不能保证所有披露都能找到可用比较对。

### NVDA 实际案例

原错误使用后续申报中的 0.60（2024-01-29 至 2024-04-28；`0001045810-25-000116`）与仍为旧拆股基础的 0.82（2023-01-30 至 2023-04-30；`0001045810-24-000124`）比较。

[原始同份 10-Q](https://www.sec.gov/Archives/edgar/data/1045810/000104581024000124/nvda-20240428.htm)中的 5.98 和 0.82 具有共同披露基础，算式约为 +629.27%，但 **5.98 不等于当前显示的 0.60**。因此该对不能用来给当前卡片生成同比。保留 0.60、同比留空符合本次准确性优先的要求。

GOOGL、AAPL 最近各 10 季的 EPS 与 EPS YoY 数值均未改变。对三家完整 CompanyFacts 使用修复前/后标准化器的结果进行比较：全部年度结果（含来源）相同；季度除 NVDA 上述一个 EPS YoY 外，所有已有数值和其他来源均相同。

## 2. 为什么使用定向回填

已检查 [CompanyService 的财务专用刷新](../../apps/api/src/modules/company/company.service.ts)：它复用 CompanyFacts 标准化，但 upsert 会更新整行年度/季度数据。当前重算会使 NVDA 2025-01-26 的历史 Marketable Securities 从 34,621 百万美元变为 null，超出本次授权范围。因此没有调用刷新端点，也没有触发顶部完整更新。

[定向回填脚本](../../scripts/quarterly-financial-fix.cjs)直接复用现有生产标准化器处理审计时已保存的三份 CompanyFacts；没有新的 SEC 请求或 AI 调用。默认只预览，显式 `--apply` 才提交。

- 在事务内按固定顺序锁定三家公司，拒绝正在采集或存在活动后台任务的公司。
- 每条待回填值都检查 CIK、期间、单位、concept、accn、filed、form、原始值；同比检查同申报两期及公式。
- 只更新三家公司季度 `epsGrowth` 及对应来源；只为 NVDA 补充指定四字段的 null 值与来源，不覆盖未知的既有非空值。
- 先写本地备份，再在一个 Serializable 事务中提交字段补丁。
- 提交前读取全表快照，与“旧快照仅叠加允许字段”的预期逐字段深比较；任何多余变化都会抛错并回滚。
- 再次预览得到 **0 行待更新、0 数值变化**，回填可重复执行而不会重复写入。

### 备份和精确差异

备份位于本机被 Git 忽略的目录：

`apps/api/data/backups/quarterly-financial-fix-1794491945653/`

包含 `before.json`（写入前全表记录）、`plan.json`（字段补丁及完整来源）、`after.json`（校验后的全表记录）。文件权限 0600，目录权限 0700。没有输出数据库连接信息。

[完整字段差异](quarterly-financial-fix-diff.json)记录 30 条季度行更新：**31 个数值变化**（30 个股东回报空值补齐＋1 个错误 EPS YoY 清空），其余 22 条行只补充 EPS 同比可追溯来源；不是 30 行财务数据被整体替换。所有年度、其他季度字段和来源均保持原样。

## 3. NVDA 回填前后

以下四字段回填前均为 null；下表为提交后结果。股数单位百万股，DPS 美元/股，同比为百分数。

| 财年 / 季度 | 期末       | Diluted Shares |   Shares YoY |   DPS | DPS YoY |
| ----------- | ---------- | -------------: | -----------: | ----: | ------: |
| FY2027 Q2   | 2026-07-26 |         24,285 | −1.00684820% |  0.25 |   2400% |
| FY2027 Q1   | 2026-04-26 |         24,391 | −0.89390923% |  0.01 |      0% |
| FY2026 Q4   | 2026-01-25 |              — |            — |     — |       — |
| FY2026 Q3   | 2025-10-26 |         24,483 | −1.17461855% |  0.01 |      0% |
| FY2026 Q2   | 2025-07-27 |         24,532 | −1.27173213% |  0.01 |      0% |
| FY2026 Q1   | 2025-04-27 |         24,611 | −1.12093210% |  0.01 |    150% |
| FY2025 Q4   | 2025-01-26 |              — |            — |     — |       — |
| FY2025 Q3   | 2024-10-27 |         24,774 | −0.66559743% |  0.01 |    150% |
| FY2025 Q2   | 2024-07-28 |         24,848 | −0.58414019% |  0.01 |    150% |
| FY2025 Q1   | 2024-04-28 |         24,890 |            — | 0.004 |       — |

数据来源仍是标准标签：

- `WeightedAverageNumberOfDilutedSharesOutstanding`，shares，独立季度加权平均值。
- `CommonStockDividendsPerShareDeclared`，USD/shares，独立季度已宣告股息。
- 同比来自同申报直接事实；没有从期末股数、累计 EPS、现金分红总额、年度 DPS 或其他数字推测。

详细事实和最新季度来源见 [修复后审计证据](quarterly-financial-fix-evidence.json)；历史行的完整新来源见备份 `plan.json`，以及季度表中持久化的 `sources`。源文件指纹保存在差异文件，原始 SEC URL 列于原审计报告。

## 4. 未改变的内容和剩余覆盖限制

- NVDA 2025-01-26 Marketable Securities **仍为 34,621 百万美元**，保留原来源；没有采用当前重算的 null。
- NVDA 8 个 basicShares 空值不在本次四字段范围，仍保留；不是此次回填遗漏。
- NVDA CapEx/FCF 仍缺失，没有加入 `PaymentsToAcquireProductiveAssets` 等更宽标签。
- GOOGL FY2025 四季收入比年度多 100 万美元的原始差异完整保留，没有人为调平。
- 季度 ROE/CAGR 继续显示 `—`；Q4 没有直接 EPS/股数/DPS 时继续 null。
- 原有健康快照、现金与证券合计口径、债务、利润率、现金流计算不变；缺失债务组件不补零。
- 本次只验证三家公司已覆盖期间，不等于全市场或全部拆股/重述场景均已认证；不能比较的 EPS 同比会主动留空。

重算与缓存之间剩余 **9 个已知差异**，正是上述 8 个未授权 basicShares 与 1 个保留的历史证券值；并无新的未解释字段覆盖。

## 5. 文件变更与测试

生产文件仅一处：

- `apps/api/src/modules/financials/normalize-company-facts.ts`：季度 EPS 同比校验及来源。

测试/工具/证据：

- `apps/api/tests/quarterly-eps.spec.ts`：实际 SEC 审计记录回归；同申报可比对、跨申报不确定、拆股不混基、普通季度保持、Q4 缺失、非同比和年度不变。
- `apps/api/tests/fixtures/quarterly-eps-audit.json` 及 fixtures README：仅保留所需原始 EPS/收入事实，离线运行，不作为产品 fallback。
- `scripts/quarterly-financial-fix.cjs`：受控预览、备份、字段级事务和全表保护校验。
- `scripts/quarterly-financial-audit.cjs`：新增核对 EPS 同比来源、允许指定输出文件，原审计机器证据不被覆盖。
- `scripts/quarterly-financial-audit.test.cjs`：把原缺陷复现断言更新为 EPS 保留 0.60、同比必须 null，继续核对 52/53 周财年。
- 本报告、字段差异、修复后审计证据及 [实际 API 验收记录](quarterly-financial-fix-api.json)。

执行结果：

| 检查                                                     | 结果                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm run typecheck`                                      | 通过                                                               |
| `npm run lint`                                           | 通过                                                               |
| `npm test`                                               | 后端 187 通过、5 跳过；前端 41 通过                                |
| `npm run build`                                          | API / Web 均通过；原有 Vite 大包警告保留                           |
| `node --test scripts/quarterly-financial-audit.test.cjs` | 3 项通过                                                           |
| 修复后三家公司只读审计                                   | 30 季来源、公式、期间及 45 次图表渲染通过；仅保留已说明的 9 个差异 |
| 真实 NestJS GET 与 Vite 代理                             | 三家公司各 10 年/10 季与数据库一致                                 |
| EPS YoY 历史 SVG                                         | NVDA 错误季度不再有数据点，不补零、不跨缺口连接                    |
| 数据保护                                                 | 全部非季度表与备份前一致；季度表仅允许字段及其来源变化             |
| 幂等预览                                                 | 0 行、0 数值变化                                                   |

本地 API 已在确认无活动后台任务后重启，加载新构建；只调用缓存 GET 验证，没有提交初始化、刷新或 AI 操作。没有真实浏览器交互验收，使用实际 API 返回值和现有 React 组件完成验证。

## 6. 最终判断

**本次发现并纳入范围的季度问题已经修复。** 在 Alphabet、Apple、Nvidia 的现有缓存和本次验证范围内，年度及季度四大财务模块可以稳定用于已覆盖指标的基本面研究：原有可靠数据保持不变，错误比较不再展示，可靠股东回报数据已入库。仍须按 `—` 理解数据未覆盖或不可比较，不能把缺失当成零或把当前结果当作全市场准确性保证。

本轮到此停止，不扩展未授权的字段映射、财务指标或 UI。
