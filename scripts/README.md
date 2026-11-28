# 维护、审计与历史验证脚本

所有命令均从**仓库根目录**执行。此目录不是自动任务列表，不要递归执行全部脚本或全部 `*.test.*`。

## 分类与执行边界

- `maintenance/`：正式静态行业数据更新、离线缓存导入；随附测试只测试解析器。
- `audit/`：只读业务数据核查。部分脚本可输出本地报告，不代表完全没有文件写入。
- `repair/`：具有数据库/缓存修改能力的工具，即使默认是预览，也归入此类。执行前确认公司范围、备份及参数。
- `history/`：开发验收归档，保留原样本、固定 `/tmp` 输入及旧断言。`integration/` 中也保留仍有回归价值的显式集成测试，并不表示功能已退役。

**归档不等于安全执行**：`history/ai/` 包含付费接口、SEC访问和可写入的服务；`history/integration/` 会启动本地服务或创建、迁移、清除隔离数据库 schema。不得对生产连接运行。

## 执行前提

1. Node 版本遵循根 `package.json`。先安装工作区依赖；使用编译后 API 的工具需先 `npm run build:api`。仅依赖 shared 的工具可先 `npm run build:shared`。
2. 涉及前端 `.test-dist` 的脚本需先 `npm run test:web`，使编译文件与现有源码一致。前端测试会清理整个测试专用生成目录。
3. 数据库脚本需配置 `apps/api/.env` 或脚本读取的 `DATABASE_URL`；加载方式仍沿用各脚本原实现，不会统一自动注入环境变量。
4. SEC 工具需要后端 SEC 联系方式及可选代理配置；付费 AI 连接测试需要明确提供密钥。不要把凭据放进脚本、参数清单或文档。
5. 固定 `/tmp` 目录不在 Git 中，可能已被清理。缺少输入时停止，不以零值、重新抓取或写入生产数据补齐。
6. 对依赖已有公司缓存的本地 GET 验收，先确认公司已初始化；公司详情 GET 在缺缓存时可能触发 SEC 获取及写入，不能仅凭 HTTP GET 就认定只读。
7. 更新行业数据会替换前端 JSON，需要评审差异并重新构建；不是运行时网络接口。资本配置导入会替换单一 CIK 的本地派生缓存。

表中「网络」指 HTTP/SEC/AI 调用，包括本地 HTTP；数据库连接另列在输入依赖中，仍可能使用网络；「写入」明确区分业务数据库、业务缓存和验收输出。表格执行命令仅供说明，不得仅为文档检查而自动执行。

## 数据维护：`maintenance/`

| 脚本 | 用途 | 执行命令 | 输入依赖及限制 | 网络/SEC | 业务AI | 写入行为 |
|---|---|---|---|---|---|---|
| [`import-capital-flow-cache.cjs`](maintenance/import-capital-flow-cache.cjs) | 从已有 CompanyFacts 和申报文件导入资本配置派生缓存 | `node scripts/maintenance/import-capital-flow-cache.cjs --facts <文件> --filings <清单>` | API构建产物；数据库连接；已有样本记录；选项：--facts, --filings；必需 --facts <CompanyFacts.json> --filings <manifest.json>；manifest中的相对文件以manifest目录解析 | 无 | 无 | 替换 apps/api/data/capital-allocation/<CIK>.json |
| [`update-industry-pe.cjs`](maintenance/update-industry-pe.cjs) | 更新 Damodaran 美国盈利企业整体滚动 PE 静态数据 | `node scripts/maintenance/update-industry-pe.cjs` | 行业 JSON/Excel；选项：--file；官方Excel；--file <本地Excel> 可离线，仍会替换JSON | 默认访问 NYU；--file时无 | 无 | 替换前端行业JSON及临时文件 |
| [`update-industry-pe.test.cjs`](maintenance/update-industry-pe.test.cjs) | 离线测试 PE Excel 字段解析及静态数据 | `node --test scripts/maintenance/update-industry-pe.test.cjs` | 行业 JSON/Excel | 无 | 无 | 无业务写入 |
| [`update-industry-wacc.cjs`](maintenance/update-industry-wacc.cjs) | 更新 Damodaran 美国行业 WACC、Ke及非金融整体参考 | `node scripts/maintenance/update-industry-wacc.cjs` | 行业 JSON/Excel；选项：--file；官方Excel；--file <本地Excel> 可离线，仍会替换JSON | 默认访问 NYU；--file时无 | 无 | 替换前端行业JSON及临时文件 |
| [`update-industry-wacc.test.cjs`](maintenance/update-industry-wacc.test.cjs) | 离线测试 WACC/Ke Excel 解析及静态数据 | `node --test scripts/maintenance/update-industry-wacc.test.cjs` | 行业 JSON/Excel | 无 | 无 | 无业务写入 |

## 数据审计：`audit/`

| 脚本 | 用途 | 执行命令 | 输入依赖及限制 | 网络/SEC | 业务AI | 写入行为 |
|---|---|---|---|---|---|---|
| [`audit-annual-roic.cjs`](audit/audit-annual-roic.cjs) | 重放年度及扩展历史 ROIC 样本，与人工参考核对 | `node scripts/audit/audit-annual-roic.cjs` | API构建产物；仓库 SEC fixtures/manifest；选项：--extended, --output | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`audit-balance-sheet-normalization.cjs`](audit/audit-balance-sheet-normalization.cjs) | 核对权益、债务、现金及投资归一化证据 | `node scripts/audit/audit-balance-sheet-normalization.cjs` | API构建产物；仓库 SEC fixtures/manifest；选项：--output | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`audit-debt-disclosures.cjs`](audit/audit-debt-disclosures.cjs) | 离线核对债务附注提取与完整性核准 | `node scripts/audit/audit-debt-disclosures.cjs` | API构建产物；仓库 SEC fixtures/manifest；选项：--output | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`equity-bridge-audit.cjs`](audit/equity-bridge-audit.cjs) | 只读重算股权桥接并核对数据未被改写 | `node scripts/audit/equity-bridge-audit.cjs` | API构建产物；前端测试构建产物；数据库连接；已有样本记录 | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`equity-bridge-simple-audit.cjs`](audit/equity-bridge-simple-audit.cjs) | 核对历史保守桥接表的条件性结果 | `node scripts/audit/equity-bridge-simple-audit.cjs` | API构建产物；前端测试构建产物；数据库连接；已有样本记录 | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`equity-defaults-audit.cjs`](audit/equity-defaults-audit.cjs) | 核对股权调整默认值及计算结果 | `node scripts/audit/equity-defaults-audit.cjs` | API构建产物；前端测试构建产物；数据库连接；已有样本记录 | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`quarterly-financial-audit.cjs`](audit/quarterly-financial-audit.cjs) | 比对独立季度、EPS 和现金流归一化，输出审计报告 | `node scripts/audit/quarterly-financial-audit.cjs` | API构建产物；前端测试构建产物；数据库连接；已有样本记录；测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出；环境：QUARTERLY_AUDIT_CACHE, QUARTERLY_AUDIT_OUTPUT；固定输入/输出：`/tmp/quarterly-financial-audit` | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`quarterly-financial-audit.test.cjs`](audit/quarterly-financial-audit.test.cjs) | 验证财年、季度与已知历史 EPS 边界 | `node --test scripts/audit/quarterly-financial-audit.test.cjs` | API构建产物；环境：QUARTERLY_AUDIT_CACHE；固定输入/输出：`/tmp/quarterly-financial-audit` | 无 | 无 | 无业务写入 |
| [`simple-valuation-audit.cjs`](audit/simple-valuation-audit.cjs) | 核对默认 FCFF、增长率、行业资本成本及桥接 | `node scripts/audit/simple-valuation-audit.cjs` | API构建产物；前端测试构建产物；数据库连接；已有样本记录；行业 JSON/Excel；选项：--http | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |

## 数据修复：`repair/`

| 脚本 | 用途 | 执行命令 | 输入依赖及限制 | 网络/SEC | 业务AI | 写入行为 |
|---|---|---|---|---|---|---|
| [`audit-shareholder-returns.cjs`](repair/audit-shareholder-returns.cjs) | 核查股东回报字段；可定向回填 GOOGL | `node scripts/repair/audit-shareholder-returns.cjs` | API构建产物；数据库连接；已有样本记录；环境：SHARES_FACTS_DIR；选项：--backfill-googl | 无 | 无 | --backfill-googl更新年度/季度股东回报字段 |
| [`backfill-quality-cache.cjs`](repair/backfill-quality-cache.cjs) | 预览或回填四家样本的独立估值质量/桥接缓存 | `node scripts/repair/backfill-quality-cache.cjs` | API构建产物；数据库连接；已有样本记录；环境：DCF_CACHE_DIR；选项：--apply, --bridge-only, --ticker；必需 DCF_CACHE_DIR；仅已审计四家公司；--apply前核对备份 | 无 | 无 | 默认预览；--apply备份并写valuation_cache |
| [`diagnose-googl-cash-flow.cjs`](repair/diagnose-googl-cash-flow.cjs) | GOOGL cash-flow 历史诊断；--refresh 可触发财务刷新 | `node scripts/repair/diagnose-googl-cash-flow.cjs` | 数据库连接；已有样本记录；选项：--refresh；限定 GOOGL 历史验收，不是通用修复 | 本地API；--refresh会请求SEC | 无 | --refresh写财务数据库；默认诊断 |
| [`diagnose-googl-growth.cjs`](repair/diagnose-googl-growth.cjs) | GOOGL growth 历史诊断；--refresh 可触发财务刷新 | `node scripts/repair/diagnose-googl-growth.cjs` | 数据库连接；已有样本记录；选项：--refresh；限定 GOOGL 历史验收，不是通用修复 | 本地API；--refresh会请求SEC | 无 | --refresh写财务数据库；默认诊断 |
| [`diagnose-googl-health.cjs`](repair/diagnose-googl-health.cjs) | GOOGL health 历史诊断；--refresh 可触发财务刷新 | `node scripts/repair/diagnose-googl-health.cjs` | 数据库连接；已有样本记录；选项：--refresh；限定 GOOGL 历史验收，不是通用修复 | 本地API；--refresh会请求SEC | 无 | --refresh写财务数据库；默认诊断 |
| [`diagnose-googl-profitability.cjs`](repair/diagnose-googl-profitability.cjs) | GOOGL profitability 历史诊断；--refresh 可触发财务刷新 | `node scripts/repair/diagnose-googl-profitability.cjs` | 数据库连接；已有样本记录；选项：--refresh；限定 GOOGL 历史验收，不是通用修复 | 本地API；--refresh会请求SEC | 无 | --refresh写财务数据库；默认诊断 |
| [`owner-earnings-audit.cjs`](repair/owner-earnings-audit.cjs) | 核对保留的 Owner Earnings 后台；可回填输入元数据 | `node scripts/repair/owner-earnings-audit.cjs <本地事实目录>` | API构建产物；数据库连接；已有样本记录；选项：--output, --persist-inputs, --verify-api；必需位置参数 <local-companyfacts-dir>；仅 GOOGL/AAPL/MSFT/KO | --verify-api访问本地只读Owner Earnings接口 | 无 | --persist-inputs写年度来源元数据；可输出报告，不保存测试假设 |
| [`quarterly-financial-fix.cjs`](repair/quarterly-financial-fix.cjs) | 预览、备份并定向修复三家样本季度缓存 | `node scripts/repair/quarterly-financial-fix.cjs` | API构建产物；数据库连接；已有样本记录；环境：QUARTERLY_AUDIT_CACHE, QUARTERLY_FIX_OUTPUT；选项：--apply；固定输入/输出：`/tmp/quarterly-financial-audit`, `/tmp/quarterly-financial-fix/preview.json` | 无 | 无 | 默认预览报告；--apply备份并更新季度行 |
| [`seed-revenue-cache.cjs`](repair/seed-revenue-cache.cjs) | 导入 Alphabet、Apple、Nvidia 历史收入验收缓存 | `node scripts/repair/seed-revenue-cache.cjs` | API构建产物；数据库连接；已有样本记录；固定输入/输出：`/tmp/revenue-breakdown-validation/` | 无 | 无 | 直接创建必要公司行并导入收入缓存，无预览开关 |
| [`validate-dcf-v1.cjs`](repair/validate-dcf-v1.cjs) | 导入历史 DCF 验收样本的独立估值缓存 | `node scripts/repair/validate-dcf-v1.cjs` | API构建产物；数据库连接；已有样本记录；测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出；固定输入/输出：`/tmp/dcf-companyfacts-coverage/` | 无 | 无 | 直接upsert估值缓存并写验收报告，无预览开关 |
| [`verify-googl-dividends.cjs`](repair/verify-googl-dividends.cjs) | 核对 GOOGL 股息；可回填新字段及验证实际接口 | `node scripts/repair/verify-googl-dividends.cjs` | API构建产物；数据库连接；已有样本记录；环境：GOOGL_FACTS_PATH；选项：--backfill, --verify-api；固定输入/输出：`/tmp/googl-dividend-detail.json`, `/tmp/googl-health-companyfacts.json`；限定 GOOGL 历史验收，不是通用修复 | --verify-api访问本地API/Vite，缺缓存有采集风险 | 无 | --backfill更新股息字段；API验收输出/tmp文件 |

## 历史验证及显式集成工具：`history/`

| 脚本 | 用途 | 执行命令 | 输入依赖及限制 | 网络/SEC | 业务AI | 写入行为 |
|---|---|---|---|---|---|---|
| [`integration/database-cache.test.cjs`](history/integration/database-cache.test.cjs) | 隔离数据库验证缓存、别名、收藏及 ROIC 持久化 | `node --test scripts/history/integration/database-cache.test.cjs` | 仅隔离数据库连接；环境：DATABASE_URL | 无 | 无 | 创建/迁移/写入/删除随机隔离schema；绝不使用生产连接 |
| [`dcf-coverage/coverage.test.cjs`](history/dcf-coverage/coverage.test.cjs) | 核对已归档的十家公司 DCF 覆盖率证据 | `node --test scripts/history/dcf-coverage/coverage.test.cjs` | 测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出 | 无 | 无 | 无业务写入 |
| [`dcf-coverage/ocf-fcff.cjs`](history/dcf-coverage/ocf-fcff.cjs) | 重放历史 OCF/FCFF 标签与现金流覆盖调查 | `node scripts/history/dcf-coverage/ocf-fcff.cjs` | 测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出；固定输入/输出：`/tmp/dcf-companyfacts-coverage/XOM-facts.json`, `/tmp/ocf-fcff-validation/`, `/tmp/ocf-fcff-validation/NVDA-annual.html`, `/tmp/ocf-fcff-validation/XOM-facts-fresh.json` | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`dcf-coverage/ocf-fcff.test.cjs`](history/dcf-coverage/ocf-fcff.test.cjs) | 校验归档 OCF/FCFF 机器证据 | `node --test scripts/history/dcf-coverage/ocf-fcff.test.cjs` | 测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出 | 无 | 无 | 无业务写入 |
| [`dcf-coverage/verify.cjs`](history/dcf-coverage/verify.cjs) | 重建历史覆盖及计算证据（范围由所在目录确定） | `node scripts/history/dcf-coverage/verify.cjs` | 测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出；环境：DCF_CACHE_DIR；固定输入/输出：`/tmp/dcf-companyfacts-coverage` | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`ai/inspect-company-update.cjs`](history/ai/inspect-company-update.cjs) | GOOGL 更新流程历史验收；可调用初始化写入接口 | `node scripts/history/ai/inspect-company-update.cjs` | 数据库连接；已有样本记录；选项：--verify；固定输入/输出：`/tmp/company-update-live.log` | 本地API；缺缓存可能请求SEC | 无 | --verify调用初始化POST，可能写更新状态；详情GET须已有缓存 |
| [`ko-dcf/bridge-crosscheck.py`](history/ko-dcf/bridge-crosscheck.py) | 独立 Decimal 重算 KO 股权桥接 | `python3 scripts/history/ko-dcf/bridge-crosscheck.py` | 测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出 | 无 | 无 | 无业务写入 |
| [`ko-dcf/bridge.cjs`](history/ko-dcf/bridge.cjs) | 基于历史缓存重建 KO 条件性股权桥接验收 | `node scripts/history/ko-dcf/bridge.cjs` | 测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出；固定输入/输出：`/tmp/dcf-companyfacts-coverage/KO-facts.json`, `/tmp/ko-dcf-validation/annual.html` | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`ko-dcf/crosscheck.py`](history/ko-dcf/crosscheck.py) | 独立 Decimal 重算 KO DCF，输出交叉检查报告 | `python3 scripts/history/ko-dcf/crosscheck.py` | 测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出 | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`ko-dcf/verify.cjs`](history/ko-dcf/verify.cjs) | 重建历史覆盖及计算证据（范围由所在目录确定） | `node scripts/history/ko-dcf/verify.cjs` | API构建产物；测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出；固定输入/输出：`/tmp/dcf-companyfacts-coverage/KO-facts.json` | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`integration/owner-earnings-db.test.cjs`](history/integration/owner-earnings-db.test.cjs) | 隔离数据库验证研究假设保存、恢复及数据变化失效 | `node --test scripts/history/integration/owner-earnings-db.test.cjs` | API构建产物；仅隔离数据库连接；环境：DATABASE_URL | 无 | 无 | 创建/迁移/写入/删除随机隔离schema；绝不使用生产连接 |
| [`integration/proxy.test.mjs`](history/integration/proxy.test.mjs) | 启动本地测试 API/Vite，验证代理与缓存行为 | `node --test scripts/history/integration/proxy.test.mjs` | 仅隔离数据库连接 | 本地监听/API/Vite；SEC用mock | 无 | 测试环境，需本地端口权限；不对生产运行 |
| [`ui/render-googl-dividends.cjs`](history/ui/render-googl-dividends.cjs) | 从固定快照生成 GOOGL 分红/回购图表 HTML | `node scripts/history/ui/render-googl-dividends.cjs` | 前端测试构建产物；固定输入/输出：`/tmp/googl-dividend-detail.json`, `/tmp/googl-dividends-`, `/tmp/googl-repurchase-` | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`integration/revenue-integration.test.cjs`](history/integration/revenue-integration.test.cjs) | 隔离数据库验证收入缓存、并发及失败恢复 | `node --test scripts/history/integration/revenue-integration.test.cjs` | API构建产物；仅隔离数据库连接；环境：DATABASE_URL；固定输入/输出：`/tmp/revenue-breakdown-validation/` | 无 | 无 | 创建/迁移/写入/删除随机隔离schema；绝不使用生产连接 |
| [`revenue-validation/audit.cjs`](history/revenue-validation/audit.cjs) | 离线分析收入事实与维度网络，写入验收报告 | `node scripts/history/revenue-validation/audit.cjs` | 固定输入/输出：`/tmp/revenue-breakdown-validation` | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`revenue-validation/fetch.cjs`](history/revenue-validation/fetch.cjs) | 获取历史三家公司申报 HTML 及元数据 | `node scripts/history/revenue-validation/fetch.cjs` | API构建产物；固定输入/输出：`/tmp/revenue-breakdown-validation` | SEC | 无 | 写/tmp申报、元数据或附件 |
| [`revenue-validation/links.cjs`](history/revenue-validation/links.cjs) | 获取同一申报的 schema/linkbase 附件 | `node scripts/history/revenue-validation/links.cjs` | API构建产物；固定输入/输出：`/tmp/revenue-breakdown-validation/` | SEC | 无 | 写/tmp申报、元数据或附件 |
| [`revenue-validation/live-cache.test.cjs`](history/revenue-validation/live-cache.test.cjs) | 校验已保留的三家公司收入审计缓存 | `node --test scripts/history/revenue-validation/live-cache.test.cjs` | 固定输入/输出：`/tmp/revenue-breakdown-validation/` | 无 | 无 | 无业务写入 |
| [`revenue-validation/parser.cjs`](history/revenue-validation/parser.cjs) | 复用生产 Inline XBRL 解析器的模块入口 | `模块，不单独执行；由同目录审计/测试加载` | 仓库依赖；保持根目录执行 | 无 | 无 | 无业务写入 |
| [`revenue-validation/parser.test.cjs`](history/revenue-validation/parser.test.cjs) | 使用内存 fixture 测试收入解析、命名空间及金额 | `node --test scripts/history/revenue-validation/parser.test.cjs` | 仓库依赖；保持根目录执行 | 无 | 无 | 无业务写入 |
| [`revenue-validation/stage2-core.cjs`](history/revenue-validation/stage2-core.cjs) | 历史收入网络处理辅助模块 | `模块，不单独执行；由同目录审计/测试加载` | 仓库依赖；保持根目录执行 | 无 | 无 | 无业务写入 |
| [`revenue-validation/table-audit.cjs`](history/revenue-validation/table-audit.cjs) | 从原始收入表生成阶段二审计及文档 | `node scripts/history/revenue-validation/table-audit.cjs` | 测试夹具（apps/api/tests/fixtures/financial-evidence）／artifacts/validation 输出；选项：--test；固定输入/输出：`/tmp/revenue-breakdown-validation/` | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`revenue-validation/table-core.cjs`](history/revenue-validation/table-core.cjs) | 复用生产收入表解析器的模块入口 | `模块，不单独执行；由同目录审计/测试加载` | 仓库依赖；保持根目录执行 | 无 | 无 | 无业务写入 |
| [`revenue-validation/table.test.cjs`](history/revenue-validation/table.test.cjs) | 核对内存表格 fixture 与三家公司历史原表 | `node --test scripts/history/revenue-validation/table.test.cjs` | 固定输入/输出：`/tmp/revenue-breakdown-validation/` | 无 | 无 | 无业务写入 |
| [`ai/serve-update-review.cjs`](history/ai/serve-update-review.cjs) | 启动带上游请求计数的本地验收 API | `node scripts/history/ai/serve-update-review.cjs` | API构建产物 | 监听本地API；后续请求可访问SEC/AI | 随业务请求可能调用 | 随业务请求可能写DB/缓存，不是只读服务 |
| [`ai/test-ai-provider.cjs`](history/ai/test-ai-provider.cjs) | 使用模拟 fetch 核对真实 AI SDK 集成，不调用业务 AI | `node scripts/history/ai/test-ai-provider.cjs` | API构建产物 | 无 | 无 | 无业务写入 |
| [`ai/test-router-api.mjs`](history/ai/test-router-api.mjs) | 可选的真实付费 AI 提供商连通性测试 | `node scripts/history/ai/test-router-api.mjs` | 环境：AI_MODEL, ROUTER_API_KEY, ROUTER_BASE_URL | 真实AI提供商 | 是，可能付费 | 无数据库写入；终端输出结果 |
| [`ai/verify-ai-research.cjs`](history/ai/verify-ai-research.cjs) | 定位 GOOGL 最新申报；可显式付费生成并保存总结 | `node scripts/history/ai/verify-ai-research.cjs` | API构建产物；数据库连接；已有样本记录；选项：--generate | SEC；--generate还访问AI | --generate付费 | --generate保存AI总结/任务；默认只定位申报 |
| [`ui/verify-googl-health-ui.cjs`](history/ui/verify-googl-health-ui.cjs) | 读取 GOOGL API/数据库及历史事实，生成图表验收 HTML | `node scripts/history/ui/verify-googl-health-ui.cjs` | 前端测试构建产物；数据库连接；已有样本记录；固定输入/输出：`/tmp/googl-health-`, `/tmp/googl-health-companyfacts.json`；限定 GOOGL 历史验收，不是通用修复 | 本地API/Vite；缺缓存可能请求SEC | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`ui/verify-googl-profitability-ui.cjs`](history/ui/verify-googl-profitability-ui.cjs) | 从固定 GOOGL 快照生成盈利与资本回报验收 HTML | `node scripts/history/ui/verify-googl-profitability-ui.cjs` | 前端测试构建产物；固定输入/输出：`/tmp/googl-dividend-detail.json`, `/tmp/googl-profitability-`；限定 GOOGL 历史验收，不是通用修复 | 无 | 无 | 无业务写入；生成本地报告/HTML/证据 |
| [`ui/verify-revenue-api.cjs`](history/ui/verify-revenue-api.cjs) | 核对收入缓存、API、Vite代理及 React 表格 | `node scripts/history/ui/verify-revenue-api.cjs` | 前端测试构建产物；数据库连接；已有样本记录；固定输入/输出：`/tmp/revenue-`, `/tmp/revenue-ai-hash.txt` | 本地API/Vite；缺缓存可能请求SEC | 无 | 无业务写入；生成本地报告/HTML/证据 |

## 常用入口与安全验证

- `npm run update:wacc` / `npm run update:pe`：正式行业更新，**会联网并写JSON**，需显式执行。
- `npm run test:db`：隔离数据库验收，**会迁移及写测试数据库**，需显式执行。
- `npm run test:proxy`：本地监听与HTTP验收，需显式执行。
- 安全的离线相关测试：

```sh
node --test scripts/maintenance/update-industry-pe.test.cjs scripts/maintenance/update-industry-wacc.test.cjs scripts/history/dcf-coverage/coverage.test.cjs scripts/history/dcf-coverage/ocf-fcff.test.cjs scripts/history/revenue-validation/parser.test.cjs scripts/audit/quarterly-financial-audit.test.cjs
```

上述测试使用内存fixture、已提交证据、现有本地缓存；不补抓缺失文件。季度测试可能按原逻辑跳过缺少的历史样本。其他收入表/缓存测试需要固定 `/tmp/revenue-breakdown-validation`，不要通过通配符无条件执行。

## 保留限制

- 这些脚本中的特定公司、历史日期、旧模型假设及固定金额是既有验收条件，并非正式页面默认值；本轮未修改。
- `audit-shareholder-returns`、`owner-earnings-audit` 等虽名称含audit，但因具有写入选项归入repair。
- 输出报告不等于刷新生产缓存；如未提供输出路径，不应自行推测已有目录可重建。
- 核心设计仅维护 [PRD](../docs/PRD.md) 和 [TDD](../docs/TDD.md)。旧阶段文档已移除；仍被程序读取的4份机器证据保留在 `apps/api/tests/fixtures/financial-evidence/`。历史生成脚本的对应证据输出同步到该夹具路径，其他临时报告输出至 `artifacts/validation/`，不重新创建docs历史目录。历史脚本不作为现版本完整功能验收的唯一标准。
- `apps/web/scripts/clean-test-output.mjs` 属于前端测试生命周期，不属于根维护脚本，本轮保持原位置。
