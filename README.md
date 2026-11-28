# Company Research V1

美股公司研究网站，使用 npm workspaces 管理 React + TypeScript + Vite + Ant Design 前端、NestJS 后端和 PostgreSQL + Prisma 缓存。SEC 请求和凭据仅在后端处理。

## 核心功能

- 公司目录、搜索、分页和收藏；按CIK关联，Ticker别名共享财务记录和收藏状态。
- 公司详情：Business Model、Enterprise Quality、Management、Valuation四个业务Tab。
- 企业质量：Growth、Profitability & Capital Returns、Cash Flow、Financial Health；年度／独立季度指标、趋势图及适用的ROIC。
- 管理层：最新完整财年的资本配置图，以及股息、回购、业务投资、收购、债务融资详细分析。
- 估值：DCF、PE & PEG两个Tab，保留参数调整、来源说明与固定安全边际参考；不接入股价／市值行情。
- 并购候选列表：FMP记录标记为待核实，不代表已确认的收购协议。

页面路由：`/companies`、`/favorites`、`/mergers`、`/companies/:ticker`。首页重定向到公司列表；旧`/companies/:ticker/valuation`路径兼容重定向。Owner Earnings和旧Management & Risks不属于当前正式前端功能，相关后台能力保留。

## 项目结构

```text
apps/api/           NestJS服务、SEC集成、Prisma Schema/迁移、后端测试
apps/web/           React页面、图表、样式、前端测试
packages/shared/    API契约及独立DCF/股权桥接计算引擎
scripts/            分类维护、审计、修复与历史验证脚本（见 scripts/README.md）
docs/PRD.md         当前产品需求与业务规则
docs/TDD.md         当前技术架构、数据处理及维护约束
artifacts/          可再生成的临时截图、浏览器记录等（Git忽略）
```

## 安装与配置

要求 Node.js >= 22.12、npm 10+ 和 PostgreSQL。项目使用 Prisma 6.19，依赖统一安装在仓库根目录，维护根 `package-lock.json`。

```bash
npm install
```

新环境复制配置模板；已有 `.env` 时保留原文件：

```bash
cp apps/api/.env.example apps/api/.env
```

在 `apps/api/.env` 配置：

- `DATABASE_URL`：可访问的PostgreSQL数据库。
- `SEC_USER_AGENT`：包含真实联系邮箱的SEC请求标识。
- `SEC_PROXY_URL`：可选HTTP代理；本地无代理时留空。
- `PORT`：后端端口，默认3000。
- `ROUTER_API_KEY`、`ROUTER_BASE_URL`、`AI_MODEL`：可选AI摘要配置。
- `FMP_API_KEY`：可选并购列表配置。

不要将服务端凭据配置为 `VITE_*`，也不要提交 `.env`。先创建配置所指向的数据库，再生成客户端并应用迁移：

```bash
npm run db:generate
npm run db:migrate
npm run db:status
```

保留全部已应用迁移，不使用数据库重置来更新项目。

## 本地启动与构建

在两个终端分别启动：

```bash
npm run dev:api
```

```bash
npm run dev:web
```

访问 `http://localhost:5173`。Vite将 `/api` 代理到后端 `http://localhost:3000`；生产部署需要配置同域API反向代理及React Router的历史路由回退。

```bash
npm run build
npm start
```

`npm start` 启动后端；前端静态文件位于 `apps/web/dist/`，需由静态服务器部署。也可独立执行 `npm run build:api` 和 `npm run build:web`。

## 数据与计算约定

- 列表、搜索和收藏只读取基础目录及数据库缓存，不获取Company Facts。首次进入详情按需获取单家公司财务数据，后续访问复用PostgreSQL缓存；取消收藏不删除财务记录。
- 顶部更新操作沿用现有后台任务流程，可能包含AI摘要处理。财务专项验证脚本与付费AI操作应分别理解，不应为测试随意触发完整更新。
- Company Facts用于财务指标；Submissions定位申报并提供公司资料。收入明细复用10-K Inline XBRL中的原始行式披露，保留表格、行序、名称及来源，不跨表加总。
- Business及Management摘要使用独立AI任务与持久化缓存；Item 1A后台保留，但没有独立Risks前端。财务数字由确定性代码取得和计算，不由AI生成。
- 期间流量与期末余额分开处理；适用流量可用可靠YTD端点差分得到单季度，EPS和加权平均股数不做简单累计相减。缺失值保持 `null`，保留原始概念、期间及申报来源。
- DCF假设与SEC事实分开标识，不将OCF−CapEx直接当作已核准FCFF，不将未知资产、债务或索偿默认为零。
- 不下载全市场Company Facts ZIP，不进行全市场财务预取。旧批量同步入口已停用，离线解析工具及测试夹具保留。

## 检查与测试

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

专项集成检查：

```bash
npm run test:proxy
npm run test:db
```

`test:proxy` 使用模拟上游与本地HTTP服务验证Vite转发；`test:db` 使用独立、临时PostgreSQL schema，不重置应用schema。运行前需允许本机端口监听，并为数据库测试配置有效的 `DATABASE_URL`。

`npm run test:live` 显式启用真实SEC与数据库验收，可能获取并保存单家公司财务缓存，不属于默认单元测试。`scripts/` 中的其他专项脚本不一定由 `npm test` 覆盖；部分依赖历史本地缓存、支持数据库写入或付费AI选项，执行前阅读脚本说明。

## 核心文档与维护

- [产品需求（PRD）](docs/PRD.md)：功能、指标字典、估值政策及V1边界。
- [技术设计（TDD）](docs/TDD.md)：数据逻辑图、代码组织、归一化、持久化、接口、并发和部署约束。
- [维护脚本说明](scripts/README.md)：脚本用途、命令、输入依赖与联网／写入风险。

`docs/`仅保留PRD和TDD，不再维护历史阶段设计与验收文档。仍被历史测试／交叉验证读取的机器证据保留在`apps/api/tests/fixtures/financial-evidence/`，不是正式页面默认数据；其他临时报告、截图和日志写入被忽略的`artifacts/`。

企业质量`GET /api/companies/:ticker/valuation/quality`只读数据库；普通财务、独立估值和本地资本配置缓存并非统一自动刷新。旧缓存缺少字段时保留缺失。离线回填工具的范围、预览／写入选项及备份要求见脚本说明，不为检查而触发完整更新、生产重建或付费AI。
