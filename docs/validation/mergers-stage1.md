# 并购套利第一阶段

2026-11-17 完成交易列表；无交易详情、价差、套利计算、AI 或其他数据源。

## 实际接口验证

指定 FMP `stable/mergers-acquisitions-latest?page=0&limit=100` 返回 HTTP 402：

> Premium Query Parameter: 'Special Parameters : The values for 'limit' must be between 0 and 5 based on your current subscription. Please visit our subscription page to upgrade your plan at https://financialmodelingprep.com/

同一接口 `page=0&limit=5` 返回 HTTP 200，真实数组字段为：`symbol`、`companyName`、`cik`、`targetedCompanyName`、`targetedCik`、`targetedSymbol`、`transactionDate`、`acceptedDate`、`link`。目标 CIK/Ticker 可以为 null。

因此接口本身可用，仅请求条数受限；没有升级套餐或切换来源。当前版本只导入最近 5 条，不声称导入了 100 条或完整市场。`transactionDate` 在 UI 标为“日期（FMP，待核实）”，没有根据字段名称擅自确认其为协议签署日或首次公告日。SEC 链接包括 S-4 等披露文件，全部记录标记“待核实”，不认定已签署正式收购协议。

## 实现

- `/mergers` 为左侧平级导航，保留公司列表、收藏及详情返回路由。
- `GET /api/mergers?page=1&limit=10`：1 起始分页，limit 1–100。本地分页与 FMP 上游 limit 不同。
- 首次访问从 FMP 读取、清洗并入库；之后仅查 PostgreSQL。本阶段不增加定时同步或手动刷新功能。空成功结果也记为已检查，失败则回滚并可重试。
- 后端仅读取 `apps/api/.env` 的 `FMP_API_KEY`；实际 Key 位于忽略文件中，前端不接触 Key。错误对 Key 脱敏，不记录请求 URL。
- 新增 `merger_deals`、`merger_imports`，通过增量 Prisma Migration 创建，不修改已有业务表。
- 校验必需名称、有效日期和 HTTPS SEC Archives 链接；可空字段保留 null。以双方 CIK/名称、日期及来源链接生成确定性键，批内与数据库唯一约束双重去重。同一公司在不同披露中的记录不会被擅自合并为单笔已确认交易。
- PostgreSQL advisory lock 串行化首次导入，完整事务避免并发重复请求或部分保存。成功导入 5 条。

## 验证

- 后端 191 项测试通过、5 跳过，前端 42 项通过；类型检查、Lint、API/Web 构建通过。保留原有 Vite 大包警告。
- 新增测试覆盖真实字段清洗、去重、null、拒绝无效链接/日期、分页参数、缓存不读 Key/请求 FMP、402 脱敏和失败不写入。
- 实际 PostgreSQL 导入 5 条；分页第 1/2 页各取 2 条，缓存命中在禁用 Key 获取的情况下成功。
- 实际 NestJS 与 Vite 代理 `/api/mergers?page=2&limit=2` 均返回 HTTP 200、total=5、2 条记录。
- 原公司、年度/季度财务、AI 摘要/任务/年报、收入明细表导入前后指纹一致，收藏不受影响。

机器证据见 [mergers-stage1.json](mergers-stage1.json)。未触发完整公司更新或任何付费 AI 调用。
