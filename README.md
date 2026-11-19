# Company Research V1

美股公司研究网站，使用 npm workspaces 管理 React + TypeScript + Vite + Ant Design 前端、NestJS 后端和 PostgreSQL + Prisma 缓存。SEC 请求和凭据仅在后端处理。

## 核心功能

- 公司目录、搜索、分页和收藏；按 CIK 关联，Ticker 别名共享财务记录和收藏状态。
- 公司详情：Business、Growth、Profitability、Cash Flow & Financial Health、Shareholder Returns、Revenue Breakdown 和 Management & Risks。
- 最近10个年度与10个独立季度的财务指标、历史趋势及 SEC 来源。
- 独立 DCF 公式计算页：TTM现金流、研究性FCFF基准、可编辑情景假设、折现及股权价值桥接；关键数据缺失时保留空值。
- SEC提供有效IR网址时显示投资者关系官网入口。
- 并购公告列表：FMP记录统一标记为“待核实”，不代表已确认的收购协议。

页面路由：`/companies`、`/favorites`、`/mergers`、`/companies/:ticker`、`/companies/:ticker/valuation`。首页重定向到公司列表。

## 项目结构

```text
apps/api/           NestJS服务、SEC集成、Prisma Schema/迁移、后端测试
apps/web/           React页面、图表、样式、前端测试
packages/shared/    API契约及独立DCF/股权桥接计算引擎
scripts/            数据库/代理测试、专项验证和研究脚本
docs/v1/            原始需求与技术设计（保留）
docs/validation/    有维护价值的验证报告与财务证据
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
- Business及Management & Risks摘要使用独立AI任务与持久化缓存；财务数字由后端确定性解析和计算，不由AI生成。
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

## 维护文档

- [原始需求](docs/v1/requirements.md)与[技术设计](docs/v1/technical-design.md)
- [AI研究流程](docs/ai-research.md)、[业务摘要](docs/business-summary.md)、[管理层与风险摘要](docs/management-summary.md)
- [收入明细](docs/revenue-breakdown.md)与[DCF设计及验证记录](docs/valuation-v1.md)
- [季度财务审计](docs/validation/quarterly-financial-audit.md)与[最小修复记录](docs/validation/quarterly-financial-fix.md)

历史验证文档记录当时实现与输入，当前页面行为以源码及测试为准。需要长期保留的验证证据放入 `docs/validation/`；临时截图、日志和浏览器输出放入被忽略的 `artifacts/`，避免误提交。
