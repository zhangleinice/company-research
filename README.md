# Company Research V1

npm workspaces Monorepo：React + TypeScript + Vite + Ant Design 前端、NestJS 后端、PostgreSQL + Prisma 持久化缓存。SEC 请求仅在后端执行。

## 当前数据架构

```text
首页 / 搜索 / 翻页 → SEC 基础目录缓存 + PostgreSQL 中已有指标
收藏 / 取消收藏   → PostgreSQL，仅更新收藏标记
首次进入详情     → 单公司 Company Facts → 年度/独立季度标准化 → 计算 → PostgreSQL
再次进入详情     → PostgreSQL，不重复获取 Company Facts
```

首页保留全部 SEC 公司，每页默认 10 条。没有缓存的公司显示基础信息、`未获取` 和 `—`；成功获取后显示已保存的指标与更新时间。Annual / Quarterly 独立切换。收藏按 CIK 关联，GOOG、GOOGL 等同一公司的 Ticker 别名共享财务缓存和收藏状态。

没有全市场财务预取、后台 ZIP 下载、AI、Agent 或财务指标全市场排名。目录每 24 小时按需更新一次；它只包含基础信息，不等于下载财务数据。行业仅展示从 SEC submissions 获取并保存的可靠值，否则为空。

## 目录

```text
apps/api/
  prisma/schema.prisma           # companies / annual_financials / quarterly_financials
  prisma/migrations/             # Prisma SQL 迁移历史
  src/modules/company/          # 基础目录合并、分页、搜索、详情和收藏
  src/modules/sec/              # SEC HTTP、Ticker/CIK、Company Facts、submissions
  src/modules/financials/        # 年度、季度期间识别和确定性指标计算
  src/modules/prisma/            # Prisma 数据库访问及生命周期
  tests/
apps/web/src/                   # Ant Design 列表、收藏、详情和增长趋势
packages/shared/                # 共享契约；同时输出 ESM 和 CommonJS
docs/v1/                        # 原有需求、技术设计文档，保留未改动
scripts/                        # 代理、数据库集成测试
```

## 安装与本地数据库

要求 Node.js >= 22.12、npm 10+、PostgreSQL 16。当前后端先固定 Prisma 6.19，迁移使用 `prisma migrate deploy`，不要混用其他大版本的 CLI。

在根目录安装依赖（只有一个根 `package-lock.json`）：

```bash
npm install
```

Clash HTTP / Mixed 端口为 7897 时，可在安装及 Prisma 引擎下载前配置终端代理：

```bash
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export NO_PROXY=localhost,127.0.0.1
npm install --proxy=http://127.0.0.1:7897 --registry=https://registry.npmjs.org
```

已有 `apps/api/.env` 会保留 SEC 邮箱及代理。新环境才复制：

```bash
cp apps/api/.env.example apps/api/.env
```

配置以下值，数据库用户名、密码、端口以本机实际设置为准：

```dotenv
DATABASE_URL="postgresql://rocky@localhost:5432/company_research?schema=public"
SEC_USER_AGENT="company-research your-real-email@your-domain.com"
SEC_PROXY_URL=http://127.0.0.1:7897
SEC_TIMEOUT_MS=15000
PORT=3000
```

不需要代理时移除 `SEC_PROXY_URL`。后端按文件位置读取 `.env`；不要将服务端凭据放入 `VITE_*`。

Homebrew PostgreSQL 的首次本地准备示例：

```bash
brew services start postgresql@16
createdb company_research
npm run db:generate
npm run db:migrate
npm run db:status
```

如果数据库已存在，不必重复 `createdb`。本次迁移只创建新的表、枚举和索引，没有清空、重建或删除用户数据的操作；不要运行 `prisma migrate reset`。后续开发表结构时使用 `npm run db:migrate:dev -- --name descriptive_name`，提交生成的 migration。

## 启动与操作

停止迁移前的旧进程，在根目录的两个终端分别运行：

```bash
npm run dev:api
```

```bash
npm run dev:web
```

打开 `http://localhost:5173`：

1. 首屏显示 SEC 全部公司目录及数据库中已有的财务指标。
2. 按名称或 Ticker 搜索，不会下载财务数据。
3. 可直接收藏尚未获取数据的公司，在“我的收藏”中查看。
4. 点击公司名称打开详情，首次访问获取该公司财务数据；失败可重试。
5. 返回列表后重新读取数据库，已获取行自动展示指标；正在获取的可见行只轮询列表状态，不触发新的财务获取。
6. 再次打开详情直接读取缓存；取消收藏不会删除公司或财务记录。

Vite 将 `/api` 转发到 `http://localhost:3000`。生产环境需要部署层的同域反向代理，Vite 开发代理不用于生产。

## API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/companies?page=1&limit=10&q=Apple&mode=annual` | 服务端目录搜索、分页，合并已有指标；不获取财务数据 |
| GET | `/api/companies/search?q=GOOG` | 最多 20 条基础搜索结果：Ticker / CIK / 名称 |
| GET | `/api/companies/favorites?page=1&mode=quarterly` | 数据库中的收藏列表，不获取财务数据 |
| GET | `/api/companies/:tickerOrCik` | 公司详情；首次按需获取，随后读取数据库 |
| GET | `/api/companies/:tickerOrCik/annual` | 最近 10 个完整年度；沿用详情缓存机制 |
| GET | `/api/companies/:tickerOrCik/quarterly` | 最近 10 个独立季度；沿用详情缓存机制 |
| PATCH | `/api/companies/:tickerOrCik/favorite` | JSON：`{"isFavorite":true}` 或 `false` |
| GET | `/api/companies/financials` | 与公司目录列表兼容的入口，已不读取旧本地摘要 |
| GET | `/api/health` | 服务状态 |

`mode` 只能为 `annual` / `quarterly`，分页上限 100。列表中 `financial: null` 表示该模式暂没有缓存。`financialStatus` 为 `NOT_FETCHED`、`FETCHING`、`READY` 或 `FAILED`。缓存获取失败不会标记 READY，重新进入详情或点击重试可再次获取。

CIK 唯一约束保证每家公司只有一条缓存主体；年度和季度分别以 `(companyCik, periodEnd)` 唯一。首次创建使用冲突忽略插入；获取使用数据库状态与 5 分钟租约认领，防止多进程重复导入；事务内验证租约并保存所有期间，失败不会留下半套 READY 数据。进程中断后的过期租约可在下次进入详情时恢复。

本阶段不自动更新 READY 数据，也不提供删除缓存或强制全量刷新功能。

## 财务口径

- 最近 10 个年度与 10 个独立季度分别保存；计算增长和 CAGR 时先使用完整可用历史，再截取展示范围。
- 根据实际 `start` / `end`、单位、Concept 和申报版本识别期间，不能直接按 `fy` 取值：历史比较记录可能携带后续申报的 fiscal-year focus。
- 同 Concept、单位和期间选择最新披露版本；保留原始值、期间、单位、申报表类型、日期、accession，以及差分/计算来源。
- Q1 使用三个月值；Q2/Q3 的可加总流量字段优先直接三个月值，否则使用同财年起点的 YTD 差分；Q4 可用全年减前三季度累计值。缺少对应累计端点时返回 null。
- EPS 不可加总。没有独立季度稀释 EPS 时为 null，不能用全年/累计 EPS 相减，也不按比例估算。
- 资产负债表字段使用期间结束日的时点数据，不做累计差分。
- 第一阶段映射 USD / US-GAAP 常用标签；非 USD、未映射概念和短过渡财年不猜测。无可支持期间时获取失败并保留可重试状态。
- Revenue / EPS / FCF 增长率：年度对比上一完整年，季度对比去年同季度；基期需大于零，且 Concept/单位可比。CAGR 需正值及匹配年距。
- FCF = Operating Cash Flow − 购建 PP&E CapEx；不包含并购或无形资产投资。缺失、异常负号 CapEx 不计算 FCF。
- ROE / ROA 使用年度净利润除以期初、期末权益 / 资产的平均值；缺少期初数则为 null，不用期末数代替。季度不简单年化 ROE / ROA。
- Total Debt 仅在当前与非当前债务组成充分时计算，不将缺失债务当零；现金不擅自加上投资。
- SQL 使用 Decimal 保存指标，API 返回数字。金额原值为美元；页面金额显示百万美元，EPS、股本和每股指标单独显示；百分比使用百分点，例如 12.5 表示 12.5%。缺失为 `—`，实际零值保持 0。

原始指标包括利润表、现金、资产负债权益、现金流、回购分红及股本；计算指标包含利润率、增长率、CAGR、FCF、ROE/ROA、债务比率与每股账面价值，均来自现有 V1 文档。没有 AI 计算或额外行情指标。

## 检查与测试

```bash
npm run typecheck
npm run lint
npm run build:api
npm run build:web
npm test
npm run test:proxy
npm run test:db
npm run test:live
```

- 普通单元测试使用合成数据，不连接真实 SEC。HTTP 集成测试需要允许监听本机端口。
- `test:db` 使用实际 PostgreSQL 和 Prisma Migration，但创建随机的专用测试 schema，使用 GOOG/AAPL/KO 合成 Company Facts 验证持久化、重复请求、别名、收藏及失败重试。只清理本次创建的测试 schema，不重置应用 schema。
- `test:live` 使用 `.env` 的真实 SEC 与 PostgreSQL，验证 GOOG、AAPL、KO；已有缓存会被复用，不清空现有用户数据。

当前验证状态：Prisma 6.19 客户端已生成，用户本机已成功执行初始迁移；根 lockfile 已包含 Prisma 依赖。全仓类型检查、前后端构建和 lint 已通过。工具沙箱仍不能监听本机端口或连接本机 PostgreSQL，因此 HTTP 集成、真实 SQL 流程和 GOOG/AAPL/KO 的真实 SEC 落库验收需在本机终端执行 `npm run test:db`、`npm run test:proxy`、`npm run test:live`。不能将合成数据测试视为真实 SEC/SQL 验收通过。

## 旧全量方案

`sync:sec` npm 入口已移除，旧 `src/sync-sec.ts` 即使直接执行也只报停用提示，不下载 ZIP。历史纯解析工具、本地 ZIP / JSON、测试 fixture 保留，但不再被生产模块或列表接口调用。不会将历史全市场财务摘要自动导入 PostgreSQL。`docs/v1` 原文保留；本次数据架构以这里和当前任务为准。


## 模块化公司详情页

详情采用单页纵向滚动：公司基本信息 → Business 占位 → Growth → Profitability → Cash Flow → Financial Health → Management & Risks 占位 → Valuation 占位。没有宽财务表、全字段展开表或新的路由；首页展示、数据库缓存、收藏和搜索沿用原流程。

顶部一个 Annual / Quarterly 开关同步控制四个模块。每个模块包含最新报告期的核心卡片、可悬停查看公式的指标说明、响应式 SVG 历史图和少量辅助数据。图表复用原 GrowthChart 的实现方式，日期升序排列，缺失值不连线，金额单位为百万美元，EPS 为美元/股，比例统一为百分数。

Growth 展示 Revenue、EPS、同比和年度 CAGR；季度 CAGR 保留缺失，不借用年度值。Profitability 展示利润率和利润变化，季度不显示未经验证的 ROE/ROA。Cash Flow 展示 OCF、CapEx、FCF、利润质量对比以及回购/分红；Financial Health 展示报告期末现金、债务、仅扣现金的净债务及流动性。

本次检查了 CapEx 的标准 PP&E 字段映射、起止期间匹配、YTD 差分和空值保护，没有用宽泛的投资现金流或旧年数补齐缺失。新增回归测试覆盖缺少最新年 CapEx、缺少 Q1 累计端点时 Q2 CapEx/FCF 必须为 null。后端生产解析、Prisma Schema 和已有缓存均未改动；具体公司缓存中缺失值的原始来源仍需在能连接本机数据库的环境核对。

GOOG、NVDA、AAPL 的模块顺序与展示回归使用明确标记的合成数据，不代表真实 SEC 数值已被重新获取或核验。可在本机运行 `npm run test:live` 验证真实缓存；该测试保留已有数据库记录。


## Growth 口径衔接与单公司缓存更新

增长计算原先要求两期来源的 Concept 字符串完全相同，因而标签切换可能让 Revenue 仍有数值、YoY/CAGR 却为空。现在只对 `Revenues`、`SalesRevenueNet`、`RevenueFromContractWithCustomerExcludingAssessedTax` 做有证据的桥接：原始 Facts 至少有两个同单位、相同起止期间的重叠观测，最新披露值一致且没有冲突，才允许衔接；含税收入不会自动混接。未经证实或有差异的标签仍不计算。

Revenue/EPS CAGR 使用实际相隔 3/5 年的报告期端点，不依赖数组位置；EPS YoY 的非正终值保留缺失。图表与顶部卡片始终读取同一行后端指标，前端不补算增长率。Revenue 图采用亿美元，数据点 Tooltip 同时显示美元原值；同比图可选择 Revenue、EPS 或两者对比，不发起新网络请求。

修复不会偷偷刷新 READY 缓存。需要更新单家公司时，在本机执行：

```bash
curl -X POST http://localhost:3000/api/companies/GOOGL/refresh
```

该入口复用 CIK 租约和事务，仅重新获取这一家公司，不删除数据库或收藏。刷新失败保留旧指标和更新时间；普通详情 GET 继续优先读取缓存。成功后重新加载详情或返回列表，即可读取同一份更新结果。

已核对 Alphabet 10-K：2025/2024 营收分别为 402836/350018 百万美元，稀释 EPS 为 10.81/8.04；2022 营收 282836、EPS 4.56；2020 营收 182527、拆股调整后 EPS 2.93。对应计算结果为 Revenue YoY 15.09%、Revenue CAGR 3Y 12.51% / 5Y 17.15%、EPS YoY 34.45%、EPS CAGR 3Y 33.34% / 5Y 29.83%。这些是披露数值的公式校验，并非本机缓存已刷新成功的证明。

来源：[2025 10-K](https://d18rn0p25nwr6d.cloudfront.net/CIK-0001652044/e6a3f2b6-bb98-4f54-900f-2a8794a582cf.html)、[2024 10-K 财务报表](https://www.sec.gov/Archives/edgar/data/1652044/000165204425000014/R5.htm)、[2022 10-K 财务报表](https://www.sec.gov/Archives/edgar/data/1652044/000165204423000016/R5.htm)。当前工具环境无法读取本机 PostgreSQL 或取得 Alphabet 原始 Company Facts，具体缓存的标签组合及刷新后的最终结果仍需通过上述单公司刷新和本机真实联调确认。

## Profitability 解析与验证

盈利模块保留四张卡片和两张历史图；利润率、利润图分别支持全部对比或单指标切换，切换只改变本地展示。利润图使用亿美元，Tooltip 保留报告起止日期及美元原值，负值和缺失区间沿用现有图表处理。

`GrossProfit` 优先使用直接披露。缺失时，仅将同申报 accession、申报日期、币种和起止期间的总收入与 `CostOfRevenue` / `CostOfGoodsAndServicesSold` 配对计算。不会使用 `CostsAndExpenses`、单独商品或服务成本、含税收入来补齐。独立季度沿用可靠的 YTD 端点差分，两个成本端点须采用同一 Concept；没有完整端点时保留 null。计算输入保存在 `sources.grossProfit`，无需新增数据库字段。

年度 ROE 使用与净利润归属口径对应的期初、期末平均权益，ROA 使用平均资产。余额优先取净利润所在申报，且不使用晚于净利润的申报版本；缺少可靠余额时留空。季度不展示 ROE/ROA。

对照 [Alphabet 2025 SEC 收入报表及 XBRL 定义](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/R5.htm)，Revenue 402836、Cost of revenues 162535（百万美元），计算 Gross Profit 240301、Gross Margin 59.65%；Operating Income 129039、Net Income 132170，利润率分别为 32.03% / 32.81%。净利润高于营业利润有财报支持：其他收益净额 29787 减所得税 26656，净增 3131。根据 [2025 10-K 资产负债表](https://d18rn0p25nwr6d.cloudfront.net/CIK-0001652044/e6a3f2b6-bb98-4f54-900f-2a8794a582cf.html)，平均权益 (325084+415265)/2、平均资产 (450256+595281)/2，对应 ROE 35.70%、ROA 25.28%。

本地更新和核验（先确保后端已加载新代码）：

```bash
node scripts/diagnose-googl-profitability.cjs --refresh 2>&1 | tee /tmp/company-research-googl-profitability.log
```

该脚本只通过现有 POST 接口刷新 GOOGL，检查 PostgreSQL、API 和 2025 披露计算值，并输出计算来源；普通详情 GET 仍读取缓存。单元测试使用披露数值构造的 fixtures，不等于真实 SEC / 数据库联调。若执行工具受本机网络权限限制，必须以本机命令的 PASS 日志确认真实更新。

## Cash Flow 检查与展示

现金流模块保留 OCF、CapEx、FCF、FCF Margin 四张卡片及公式说明。两张趋势图分别支持 OCF/CapEx/FCF 和 Net Income/OCF 的对比或单项切换，金额使用亿美元，Tooltip 保留美元原值及报告期间，切换不发起网络请求。辅助区新增 `capexToOcf`（百分数）：仅当同期间的 CapEx 有效且 OCF > 0 时计算；该比例需结合企业成长阶段理解，不是越低越好。

新增比例由后端读取已缓存的原始字段后确定性计算，共享契约将其作为可选字段，因此旧缓存可直接使用、无需数据库迁移。前端不计算比例；解析结果也保留比例计算来源。现有 SEC 映射与季度机制保持：OCF 使用 `NetCashProvidedByUsedInOperatingActivities`，CapEx 使用 `PaymentsToAcquirePropertyPlantAndEquipment`，不包括收购、净投资现金流或未支付的资本开支；优先独立季度，其次可靠的 YTD 差分，Q4 为全年减前九个月。缺少端点时保留 null，FCF YoY 比较去年同期。

[Alphabet 2025 SEC 现金流表及 XBRL 定义](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/R10.htm)披露：OCF 164713、PP&E 现金支出 91447、Net Income 132170、回购现金支出 45709、分红现金支出 10049（百万美元）。据此 FCF 73266、FCF Margin 18.19%、CapEx/OCF 55.52%；2024 年 OCF 125299 减 CapEx 52535 得到 FCF 72764，对应 2025 FCF YoY 0.69%。这些是披露核算值，真实缓存更新须以本地诊断日志为准。

```bash
node scripts/diagnose-googl-cash-flow.cjs --refresh 2>&1 | tee /tmp/company-research-googl-cash-flow.log
```

先确保后端已加载最新代码。脚本仅刷新 GOOGL，通过 Prisma 读取年度与季度数据，比较缓存/API、2025 披露值与 Q4 原始累计端点，检查收藏状态保留；不验证浏览器画面。测试覆盖缺少 Q3 端点、独立季度优先、非自然财年、无效分母、负现金流与图表缺失区间。AAPL/NVDA 标签的测试为合成回归，不代表实时公司数据已核验。

## Financial Health 口径与已验证结果

财务健康模块仍保留四张核心卡片；趋势图增加全部对比/Cash/Total Debt 切换，使用亿美元。辅助区增加经 SEC 披露合计核验的现金及流动可交易证券合计、扣除此合计的调整后净债务。前端不计算或猜测流动性资产；旧缓存没有核验来源时，新字段为空，不需要数据库迁移。

余额使用同一期末、同一申报的 USD 时点数据，不做 YTD 差分。Current Ratio 要求流动负债为正，Debt/Equity 要求股东权益为正。Net Debt（仅扣现金）允许负值。债务采用账面值，不使用本金面值、公允价值或总负债替代；商业票据已包括在短期借款合计时不重复相加。历史非流动债务与融资租赁合计，只有存在同申报的融资租赁总额及流动部分，才明确剔除非流动租赁，接到不含租赁的债务口径上。若后续比较申报漏报某个组成，仅在所有重叠余额及债务输入核对一致后，复用较早完整快照；缺失永不当零。来源与政策保留在财务记录 `sources`。

Alphabet [2025 资产负债表](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/R3.htm)和[债务附注](https://d18rn0p25nwr6d.cloudfront.net/CIK-0001652044/e6a3f2b6-bb98-4f54-900f-2a8794a582cf.html)已核对：Cash 30708、流动可交易证券 96135、合计 126843、Total Debt 48543、仅扣现金净债务 17835、流动资产 206038、流动负债 102745、权益 415265（百万美元）。Current Ratio 2.0053、Debt/Equity 0.1169；扣除经核验流动性资产的净债务为 -78300。流动证券与现金分列，不含非流动/不可交易投资；流动分类不代表证券全部在一年内到期。2025 年新增美元及欧元票据，债务上升是真实变化。

实际获取 GOOGL 单公司 Company Facts 并通过现有 POST 接口刷新成功，缓存时间 `2026-11-07T08:15:10.141Z`。已检查所有返回年度/季度财务健康数据与 PostgreSQL 一致、首页指标同步、重复 GET 不更新获取时间、收藏状态保留。历史债务 2020/2021/2022 年恢复为 13831/12844/12857 百万美元；2018 年仍缺可靠流动债务组成，保持 null。2021 年最新比较申报缺当前到期部分，采用核对重叠余额后一致的较早快照。

已使用真实 AAPL/NVDA Company Facts 做解析与计算回归（未写入这两家公司数据库），并确认 GOOGL 原有 Growth/Profitability/Cash Flow 年度指标未改变。完整测试含 HTTP 集成测试通过；真实 API 的年度/季度前端服务端渲染也通过。浏览器连接服务不可用，实际屏幕展示未直接验证。
