# 上市公司研究平台 V1 技术方案

## 1. 技术目标

V1 采用前后端分离架构。

核心原则：

- React 只负责 UI、交互和数据展示
- NestJS 负责所有业务逻辑
- 前端不直接调用 SEC / OpenAI / Brave
- SEC 原始数据统一经过后端标准化
- 所有财务指标由程序计算，不交给 AI
- AI 主要处理非结构化文本
- AI Tool 与具体模型厂商尽量解耦
- OpenAI / Claude / Gemini 可以切换
- 不使用 LangChain / LangGraph
- 不自行实现底层 Agent Runtime
- 使用 Vercel AI SDK 作为 AI 统一抽象层

---

# 2. 整体技术栈

## Frontend

```text
React
TypeScript
Vite
```

主要负责：

- 公司列表
- 收藏列表
- 公司详情
- Annual / Quarterly 切换
- 财务表格
- Growth Trend 图表
- AI 总结内容展示

---

## Backend

```text
Node.js
TypeScript
NestJS
```

NestJS 负责：

- REST API
- SEC API 调用
- Filing 获取与解析
- XBRL 数据处理
- 财务数据标准化
- 财务指标计算
- 数据缓存 / 持久化
- AI 调用
- Agent / Tools
- Brave Search

Nest 的 Module / Provider / Dependency Injection 结构用于隔离不同业务模块。

---

## Database

```text
PostgreSQL
```

主要存储：

- Company
- Filing
- Annual Financials
- Quarterly Financials
- Business Segments
- Geographic Revenue
- AI Summaries
- Major Events
- Watchlist

---

## AI

```text
Vercel AI SDK
```

用途：

- 模型统一调用
- Structured Output
- Tool Calling
- Agent Loop
- Streaming
- Agent
- Telemetry

AI SDK 作为模型抽象层：

```text
Vercel AI SDK
        ↓
┌───────────┬───────────┬───────────┐
│ OpenAI    │ Anthropic │ Google    │
│ GPT       │ Claude    │ Gemini    │
└───────────┴───────────┴───────────┘
```

业务代码不直接依赖具体模型。

AI SDK 7 已支持多 Provider、Tools、Agent、Structured Output、Telemetry、Tool Approval 和更长流程的 Agent Runtime。

---

## Search

```text
Brave Search API
```

主要作为 Agent 的网页搜索 Tool。

V1 SEC 数据仍然优先使用官方 SEC 数据源。

搜索主要用于：

- 公司官网资料
- 必要的补充信息
- 后续研究 Agent

---

# 3. 系统整体架构

```text
                    React
                      │
                      │ HTTP
                      ▼
               NestJS Controller
                      │
                      ▼
              Application Service
                      │
        ┌─────────────┼──────────────┐
        │             │              │
        ▼             ▼              ▼
   Company        Financial       Filing
   Service         Service        Service
        │             │              │
        └──────┬──────┴───────┬─────┘
               │              │
               ▼              ▼
          PostgreSQL       SEC Service
                              │
                              ▼
                         SEC EDGAR/XBRL


                 AI / Agent 部分

              AI Application Service
                      │
                      ▼
                Vercel AI SDK
                      │
                Agent / Tools
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
    SEC Tools    Financial Tools Search Tools
        │             │             │
        ▼             ▼             ▼
   SEC Service   Financial      Brave Search
                  Service
```

---

# 4. NestJS 模块划分

V1 按业务领域拆 Module。

```text
src/
├── modules/
│   ├── company/
│   ├── financial/
│   ├── filing/
│   ├── sec/
│   ├── segment/
│   ├── geography/
│   ├── watchlist/
│   ├── ai/
│   ├── agent/
│   └── search/
│
├── common/
├── database/
├── config/
└── main.ts
```

Nest 官方推荐使用 Module 对相关能力进行封装，由 Provider 和依赖注入管理模块之间的依赖关系。

---

# 5. Company Module

负责公司的基础信息。

```text
CompanyModule
├── CompanyController
├── CompanyService
└── CompanyRepository
```

数据：

```text
Company
├── id
├── cik
├── ticker
├── name
├── industry
├── website
├── fiscalYearEnd
└── updatedAt
```

主要 API：

```http
GET /companies
GET /companies/:ticker
```

首页的：

- 搜索
- 行业筛选
- 分页

都在该模块完成。

---

# 6. SEC Module

SEC Module 专门负责与 SEC 通信。

不要把 SEC API 请求写进 CompanyService 或 FinancialService。

结构：

```text
SecModule
├── SecClient
├── SecService
├── SecMapper
└── SecTypes
```

主要负责：

```text
Company Submissions
Company Facts
10-K
10-Q
8-K
XBRL
Filing HTML
```

内部能力例如：

```text
getCompanySubmissions(cik)

getCompanyFacts(cik)

getFilings(cik)

getLatestFiling(cik, form)

getFilingDocument(accessionNumber)
```

SEC 返回什么，SecService 就负责什么。

不在这一层计算：

- ROE
- FCF
- Margin
- Growth

---

# 7. Filing Module

Filing Module 负责处理：

```text
10-K
10-Q
8-K
```

主要任务：

- Filing 元数据
- 下载 Filing
- 保存 accession number
- 提取指定 Section
- 保存原始文本

例如：

```text
10-K
├── Item 1
├── Item 7
└── Item 8

10-Q
└── MD&A

8-K
└── Events
```

接口：

```text
getLatest10K()
getLatest10Q()
getRecent8K()

getItem1()
getItem7()
getQuarterlyMdna()
```

Filing 原文应该缓存。

避免每次调用 AI 都重新下载 SEC 文档。

---

# 8. Financial Module

这是 V1 最重要的核心模块之一。

职责：

```text
SEC XBRL
↓
字段映射
↓
期间判断
↓
数据标准化
↓
指标计算
↓
最终 Financial Model
```

---

# 9. 财务数据分三套模型

不设计一个万能 Financial Model。

固定分成：

```text
Annual Financials

Quarterly Financials

Segment Financials
```

---

# 10. Annual Financial Model

年度数据：

```ts
AnnualFinancial
```

核心字段：

```text
fiscalYear

revenue
revenueGrowth

eps
epsGrowth

operatingCashFlow
capex
fcf
fcfGrowth

grossProfit
grossMargin

operatingIncome
operatingMargin

netIncome
netMargin

roe

cash
totalDebt

sharesOutstanding

bookValuePerShare
```

默认保存最近：

```text
10 个完整财年
```

---

# 11. Quarterly Financial Model

季度数据独立处理。

```ts
QuarterlyFinancial
```

字段：

```text
fiscalYear
fiscalQuarter

revenue
revenueYoY

operatingIncome
netIncome

eps
epsYoY

operatingMargin

cash
totalDebt
```

默认：

```text
最近 10 个季度
```

Quarterly 不要求与 Annual 字段完全一致。

---

# 12. Quarterly 数据特别处理

SEC 10-Q 中：

```text
Income Statement
Cash Flow
Balance Sheet
```

的期间含义并不完全一样。

尤其现金流部分经常是：

```text
Q1
3 months

Q2 filing
6 months YTD

Q3 filing
9 months YTD
```

所以不能直接把所有 XBRL value 当成单季度数据。

例如：

```text
Q2 Standalone
= H1 YTD - Q1
```

```text
Q3 Standalone
= 9M YTD - H1 YTD
```

这一逻辑必须在：

```text
FinancialNormalizer
```

中完成。

前端不需要知道这些 SEC 细节。

---

# 13. XBRL Mapping

不能假设所有公司的 XBRL Concept 都完全一致。

设计：

```text
内部标准字段
        ↓
多个候选 XBRL Concept
```

例如：

```text
revenue
↓
RevenueFromContractWithCustomerExcludingAssessedTax
Revenues
SalesRevenueNet
...
```

维护：

```ts
XbrlConceptMap
```

概念结构：

```text
revenue
├── primary concepts
├── fallback concepts
└── company override
```

如果无法可靠识别：

```text
null
```

而不是猜。

---

# 14. Financial Calculator

所有衍生指标由独立 Calculator 完成。

```text
FinancialCalculator
```

例如：

```text
Revenue Growth
EPS Growth
FCF
FCF Growth

Gross Margin
Operating Margin
Net Margin

ROE
ROA

Total Debt
Net Debt

Debt / Equity
Current Ratio

Shares Change
Book Value Per Share

CAGR
```

例如：

```text
FCF
= Operating Cash Flow - CapEx
```

```text
Book Value Per Share
= Shareholders' Equity / Shares Outstanding
```

AI 不参与这些计算。

---

# 15. Segment Module

Segment 单独建模。

不要强行复用 AnnualFinancial。

```text
BusinessSegment
├── companyId
├── period
├── periodType
├── name
├── revenue
├── revenueGrowth
├── revenueShare
├── profit
└── margin
```

支持：

```text
Annual

Quarterly
```

但某公司没有披露时：

```text
profit = null
margin = null
```

不推算不存在的数据。

---

# 16. Geography Module

主要数据：

```text
GeographicRevenue
├── companyId
├── region
├── fiscalYear
├── revenue
├── growth
└── revenueShare
```

公司没有披露：

```text
直接为空
```

---

# 17. AI 架构

AI 不应该成为业务系统的中心。

业务系统：

```text
SEC
Financial
Company
Database
```

即使完全关闭 AI，也应该可以正常工作。

AI 主要作为：

```text
非结构化文本处理层
+
后续研究 Agent
```

---

# 18. AI Provider 抽象

业务代码不要写：

```text
OpenAI
Claude
Gemini
```

统一通过：

```text
AI SDK
```

调用。

概念结构：

```text
AIService
    │
    ▼
ModelProvider
    │
    ├── OpenAI
    ├── Anthropic
    └── Google
```

配置：

```text
AI_PROVIDER=openai

AI_MODEL=...
```

以后可以调整为：

```text
AI_PROVIDER=anthropic
```

业务逻辑不需要修改。

Vercel AI SDK 的核心定位就是统一 TypeScript AI API，并支持多 Provider 切换。

---

# 19. Structured Output

AI 不返回随意文本。

所有需要进入数据库或 UI 的 AI 输出都定义 Schema。

例如：

```ts
BusinessSummary
```

结构：

```text
companySummary

coreBusinesses[]
├── name
└── description

products[]

revenueSources[]
```

---

Item 7：

```text
ManagementCommentary

growthDrivers[]
pressures[]

businessChanges[]
├── business
└── reason

marginChanges[]

capexChanges[]

longTermTrends[]
```

---

8-K：

```text
MajorEvent

eventType
title
summary
filingDate
source
```

这样：

```text
AI
↓
Structured Object
↓
Schema Validation
↓
Database
↓
Frontend
```

而不是：

```text
AI
↓
一大段 Markdown
↓
前端自己解析
```

---

# 20. Tool 架构

Tool 是 AI / Agent 可以访问业务系统的入口。

Tool 不承担核心业务逻辑。

例如：

```text
getCompany()
getLatestFiling()
getFilingSection()
getAnnualFinancials()
getQuarterlyFinancials()
getBusinessSegments()
getMajorEvents()
searchWeb()
```

结构：

```text
Agent
↓
Tool
↓
Service
↓
Database / SEC / Brave
```

不要：

```text
Agent
↓
直接访问 SEC
```

也不要：

```text
Tool
↓
自己重新实现 Financial 逻辑
```

---

# 21. Tool 示例

```text
getAnnualFinancials

Input
├── ticker

Output
├── fiscalYear
├── revenue
├── revenueGrowth
├── eps
├── epsGrowth
├── fcf
├── roe
└── ...
```

内部实际执行：

```text
Tool
↓
FinancialService.getAnnualFinancials()
```

这样同一套 FinancialService 可以同时服务：

```text
REST API

Agent Tool

后台任务
```

---

# 22. Agent 架构

V1 不需要一开始做复杂 Multi-Agent。

先做一个：

```text
StockResearchAgent
```

它可以拥有：

```text
SEC Tools
Financial Tools
Search Tools
```

例如：

```text
用户：
研究一下 KO 最近的经营情况

Agent
↓
getAnnualFinancials("KO")
↓
getQuarterlyFinancials("KO")
↓
getLatestFiling("KO", "10-Q")
↓
getFilingSection(...)
↓
需要时 searchWeb(...)
↓
生成结果
```

Agent Runtime 使用 Vercel AI SDK。

不自己实现底层 Agent Loop。

AI SDK 7 已经提供 Agent、Tool runtime、tool approval、runtime context、telemetry 等能力。

---

# 23. AI 与普通 Workflow 分开

不是所有 AI 功能都需要 Agent。

例如：

```text
Item 1
→ 固定 AI Summary

Item 7
→ 固定 AI Summary

8-K
→ 固定 AI Summary
```

这些更适合普通：

```text
generate structured output
```

不需要 Agent 自主决策。

真正需要：

```text
模型自己决定下一步做什么
```

时才使用 Agent。

---

# 24. API 设计

前端只调用 Nest API。

## Company

```http
GET /api/companies

GET /api/companies/:ticker
```

支持：

```text
search
industry
page
pageSize
period
```

---

## Financial

```http
GET /api/companies/:ticker/financials/annual

GET /api/companies/:ticker/financials/quarterly
```

---

## Segment

```http
GET /api/companies/:ticker/segments/annual

GET /api/companies/:ticker/segments/quarterly
```

---

## Geography

```http
GET /api/companies/:ticker/geography
```

---

## AI Summary

```http
GET /api/companies/:ticker/business-summary

GET /api/companies/:ticker/management-commentary
```

---

## Events

```http
GET /api/companies/:ticker/events
```

---

## Watchlist

```http
GET    /api/watchlist

POST   /api/watchlist/:ticker

DELETE /api/watchlist/:ticker
```

---

## Agent

```http
POST /api/agent/research
```

Agent API 与普通公司数据 API 分开。

---

# 25. 数据库设计

核心表：

```text
companies

filings

annual_financials

quarterly_financials

business_segments

geographic_revenues

business_summaries

management_commentaries

major_events

watchlist
```

---

# 26. 原始数据与标准化数据分离

不要只保存最终计算结果。

建议至少区分：

```text
Raw SEC Data
↓
Normalized Financial Data
↓
Calculated Metrics
```

这样以后字段映射错误时：

```text
不需要重新下载 SEC
```

可以直接重新执行：

```text
normalize
+
calculate
```

---

# 27. 数据更新策略

SEC 财务数据并不是实时行情。

因此不需要用户每次打开页面都访问 SEC。

流程：

```text
用户访问公司
↓
查询数据库
↓
存在有效数据
→ 直接返回

不存在 / 已过期
↓
SEC 获取
↓
标准化
↓
计算
↓
保存
↓
返回
```

---

# 28. Filing 更新

根据 SEC Filing 判断是否出现新文件。

例如：

```text
latest accession number
```

与数据库比较。

如果没有变化：

```text
不重新解析
```

如果发现：

```text
新 10-K
新 10-Q
新 8-K
```

再启动相应处理。

---

# 29. AI 缓存

AI Summary 不应每次页面刷新重新生成。

例如：

```text
10-K accession number
+
Item
+
model version
+
prompt version
```

作为 AI Summary 的版本信息。

只在：

```text
新 Filing
或
Prompt 更新
```

时重新生成。

这样可以大幅降低：

- Token 成本
- 响应时间
- 输出随机变化

---

# 30. 错误处理

需要区分：

```text
SEC API Error

XBRL Mapping Error

Missing Financial Data

AI Provider Error

Search Provider Error

Database Error
```

例如某公司没有 Gross Profit：

```text
grossProfit = null
grossMargin = null
```

不能因为一个字段缺失导致整个公司接口失败。

---

# 31. 数据可信度原则

财务数字优先级：

```text
SEC XBRL
>
SEC Filing
>
其他数据源
>
AI
```

AI 永远不作为：

```text
Revenue
EPS
FCF
Debt
Margin
```

等财务数字的权威来源。

---

# 32. Logging / Observability

后端记录：

```text
SEC Request

Filing Processing

XBRL Mapping

Financial Calculation

AI Request

Tool Call

Agent Step

Error
```

AI 部分至少记录：

```text
provider
model
promptVersion
duration
tokenUsage
toolCalls
status
```

AI SDK 7 已提供更完整的 lifecycle callbacks 和 telemetry 能力，可以用于 Agent 和模型调用观测。

---

# 33. 项目目录

推荐 monorepo：

```text
stock-research/
│
├── docs/
│   └── v1/
│       ├── requirements.md
│       └── technical-design.md
│
├── apps/
│   │
│   ├── web/
│   │   ├── src/
│   │   └── package.json
│   │
│   └── api/
│       ├── src/
│       │   ├── modules/
│       │   │   ├── company/
│       │   │   ├── sec/
│       │   │   ├── filing/
│       │   │   ├── financial/
│       │   │   ├── segment/
│       │   │   ├── geography/
│       │   │   ├── watchlist/
│       │   │   ├── ai/
│       │   │   ├── agent/
│       │   │   └── search/
│       │   │
│       │   ├── common/
│       │   ├── config/
│       │   ├── database/
│       │   └── main.ts
│       │
│       └── package.json
│
├── packages/
│   └── shared/
│       ├── types/
│       └── schemas/
│
├── package.json
└── README.md
```

---

# 34. Shared Package

前后端可以共享：

```text
DTO
Type
Enum
Schema
```

例如：

```text
AnnualFinancialDTO

QuarterlyFinancialDTO

BusinessSegmentDTO

BusinessSummaryDTO
```

避免前后端重复定义数据结构。

---

# 35. Node 版本

建议项目统一使用：

```text
Node.js 24 LTS
```

或者至少满足最新 NestJS / AI SDK 的运行要求。

当前 AI SDK 7 要求 Node.js 22+；当前 Nest 文档对 Node 22 分支及 CLI 也有更具体的最低版本要求。

新项目直接使用较新的 LTS 可以减少工具链兼容问题。

---

# 36. 开发顺序

V1 不要同时开发所有模块。

建议：

## Phase 1：基础工程

```text
Monorepo
↓
React
↓
NestJS
↓
PostgreSQL
↓
基础 API
```

---

## Phase 2：SEC 数据

首先只选一个公司，例如：

```text
GOOG
```

跑通：

```text
Ticker
↓
CIK
↓
Company Facts
↓
10-K
↓
Annual Financials
```

---

## Phase 3：Annual Financials

完成：

```text
Raw XBRL
↓
Mapping
↓
Normalization
↓
Calculation
↓
Annual API
↓
React Table
```

先把 Annual 做稳定。

---

## Phase 4：Quarterly

再处理：

```text
10-Q
↓
Period normalization
↓
Standalone Quarter
↓
Quarterly Financials
```

这是 SEC 数据处理中相对更复杂的一部分。

---

## Phase 5：Segment / Geography

完成：

```text
Business Segment

Geographic Revenue
```

---

## Phase 6：AI

接入：

```text
Vercel AI SDK
```

第一步只做：

```text
Item 1
→ Business Summary
```

然后：

```text
Item 7
→ Management Commentary

8-K
→ Major Events
```

---

## Phase 7：Tools

将已经成熟的 Service 包装成 Tool：

```text
getCompany

getAnnualFinancials

getQuarterlyFinancials

getLatestFiling

getFilingSection

getBusinessSegments

searchWeb
```

---

## Phase 8：Agent

最后再组合：

```text
StockResearchAgent
```

这时 Agent 调用的所有底层能力都已经成熟。

---

# 37. 核心架构原则

整个 V1 最重要的技术原则：

```text
React
只负责 UI

NestJS
负责业务逻辑

SEC Service
负责原始数据

Financial Service
负责标准化财务数据

Calculator
负责公式

AI
负责非结构化文本

Tools
负责把业务能力暴露给 Agent

Vercel AI SDK
负责统一模型与 Agent Runtime

PostgreSQL
负责持久化
```

Agent 不应该成为系统架构的中心。

正确关系：

```text
                 ┌──── REST API ──── React
                 │
Business Services
                 │
                 └──── Tools ─────── Agent
```

也就是说：

> Web 页面和 Agent 共用同一套核心业务能力。

即使未来更换：

```text
GPT
→ Claude
→ Gemini
```

甚至未来不使用 Vercel AI SDK，

以下核心部分仍然不需要重写：

```text
SEC 数据获取
XBRL 映射
财务标准化
指标计算
数据库
REST API
业务逻辑
```

AI 只是整个系统中的可替换能力层，而不是系统本身。