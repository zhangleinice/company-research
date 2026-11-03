# 上市公司研究平台 V1 需求文档

## 1. 项目目标

做一个用于自己研究上市公司基本面的数据网站。

核心目的：

> 把公司的业务、核心财务数据、长期趋势、最新季度情况、经营变化原因和各业务线情况统一整理出来，减少研究公司时反复查阅 SEC、财报和其他网站的时间。

主要数据来源：

- SEC API / XBRL
- 10-K
- 10-Q
- 8-K

核心职责：

```text
10-K
→ 长期基本面

10-Q
→ 最新季度经营情况

8-K
→ 最新重大事件
```

10-K 重点使用：

```text
Item 1
→ 公司做什么

Item 7
→ 为什么经营情况发生变化

Item 8
→ 实际财务数据
```

---

# 2. 首页｜公司列表

首页用于：

- 浏览公司
- 搜索公司
- 行业筛选
- 分页
- 收藏 / 取消收藏
- 进入公司详情

首页只展示公司整体的核心指标，用于快速筛选，不承担完整研究功能。

## Annual / Quarterly

首页支持：

```text
[ Annual ] [ Quarterly ]
```

年度和季度使用独立表头，不强制字段完全一致。

### Annual

展示最新完整财年的核心数据：

| 字段             | 含义      |
| -------------- | ------- |
| Company        | 公司      |
| Ticker         | 股票代码    |
| Industry       | 行业      |
| Revenue        | 营业收入    |
| Revenue Growth | 营收增长率   |
| EPS            | 每股收益    |
| EPS Growth     | EPS 增长率 |
| FCF            | 自由现金流   |
| ROE            | 净资产收益率  |
| Net Margin     | 净利率     |
| Total Debt     | 总债务     |

### Quarterly

展示最新季度核心数据：

| 字段               | 含义       |
| ---------------- | -------- |
| Company          | 公司       |
| Ticker           | 股票代码     |
| Industry         | 行业       |
| Revenue          | 季度营业收入   |
| Revenue YoY      | 营收同比增长   |
| EPS              | 每股收益     |
| EPS YoY          | EPS 同比增长 |
| Net Income       | 净利润      |
| Operating Margin | 营业利润率    |
| Cash             | 现金       |
| Total Debt       | 总债务      |

如果未来接入行情数据，再补充：

- Price
- Market Cap
- PE

---

# 3. 收藏列表

用于保存真正感兴趣、准备进一步研究的公司。

功能：

- 查看收藏公司
- 搜索
- 行业筛选
- Annual / Quarterly 切换
- 取消收藏
- 进入公司详情

表头与首页保持一致。

---

# 4. 公司详情页

详情页是整个 V1 最核心的页面。

主要包含：

1. 公司基础信息
2. AI 业务概览
3. Company Financials
4. AI 管理层经营解读
5. Business Segments
6. Geographic Revenue
7. Major Events

---

# 5. 公司基础信息

展示：

- 公司名称
- 股票代码
- 行业
- 公司官网
- 财年

如果未来接入行情数据，可补充：

- 当前股价
- 市值
- PE

---

# 6. AI 业务概览｜10-K Item 1

数据来源：

> 10-K Item 1 — Business

AI 按固定结构提炼，不自行推测。

## 公司简介

简短说明：

- 公司主要做什么
- 核心商业模式
- 主要业务领域

## 核心业务

列出主要业务线，并分别用一句话说明。

## 主要产品 / 服务

提取最重要的代表性产品和服务。

## 主要收入来源

说明公司主要依靠哪些业务赚钱。

原则：

> AI 只压缩和整理公司已经披露的信息。

---

# 7. Company Financials｜公司整体财务

财务区域使用：

```text
[ Annual ] [ Quarterly ]
```

年度和季度：

- 数据独立
- 表头独立
- 图表独立
- 不混合在同一个列表中

---

# 8. Annual｜最近 10 个完整财年

主要用于：

> 看公司的长期增长、盈利能力、现金流和资产负债趋势。

## Annual 表格

| 字段                   | 含义      |
| -------------------- | ------- |
| Year                 | 财年      |
| Revenue              | 营业收入    |
| Revenue Growth       | 营收增长率   |
| EPS                  | 稀释 EPS  |
| EPS Growth           | EPS 增长率 |
| FCF                  | 自由现金流   |
| FCF Growth           | FCF 增长率 |
| Gross Margin         | 毛利率     |
| Operating Margin     | 营业利润率   |
| Net Margin           | 净利率     |
| ROE                  | 净资产收益率  |
| Cash                 | 现金      |
| Total Debt           | 总债务     |
| Shares Outstanding   | 总股本     |
| Book Value Per Share | 每股账面价值  |

默认：

> 最近 10 个完整财年。

公司上市不足 10 年，则展示全部可获得数据。

---

# 9. Quarterly｜最近 10 个季度

主要用于：

> 看公司最近两年左右是否出现新的经营变化、加速、减速或拐点。

## Quarterly 表格

| 字段               | 含义       |
| ---------------- | -------- |
| Quarter          | 财年季度     |
| Revenue          | 季度营业收入   |
| Revenue YoY      | 营收同比增长   |
| Operating Income | 营业利润     |
| Net Income       | 净利润      |
| EPS              | 稀释 EPS   |
| EPS YoY          | EPS 同比增长 |
| Operating Margin | 营业利润率    |
| Cash             | 现金       |
| Total Debt       | 总债务      |

默认：

> 最近 10 个季度。

季度和年度不强求完全相同的指标。

---

# 10. Item 8 原始财务数据

主要通过：

> 10-K / 10-Q + SEC XBRL

获取。

## 利润表

- Revenue｜营业收入
- Gross Profit｜毛利润
- Operating Income｜营业利润
- Net Income｜净利润
- Diluted EPS｜稀释后每股收益

## 资产负债表

- Cash & Cash Equivalents｜现金及现金等价物
- Marketable Securities｜可交易证券
- Current Assets｜流动资产
- Current Liabilities｜流动负债
- Total Assets｜总资产
- Total Liabilities｜总负债
- Shareholders' Equity｜股东权益
- Short-Term Debt｜短期债务
- Long-Term Debt｜长期债务

## 现金流

- Operating Cash Flow｜经营现金流
- CapEx｜资本支出
- Stock Repurchases｜股票回购
- Dividends Paid｜现金分红

## 股本

- Shares Outstanding｜发行在外股数

---

# 11. 程序计算指标

所有计算由程序完成，不使用 AI。

## 增长

- Revenue Growth
- Revenue CAGR（3 年 / 5 年）
- Net Income Growth
- EPS Growth
- EPS CAGR（3 年 / 5 年）
- FCF Growth
- FCF CAGR（3 年 / 5 年）

## 盈利能力

```text
Gross Margin
= Gross Profit / Revenue
```

```text
Operating Margin
= Operating Income / Revenue
```

```text
Net Margin
= Net Income / Revenue
```

```text
ROE
= Net Income / Average Shareholders' Equity
```

```text
ROA
= Net Income / Average Total Assets
```

## 自由现金流

```text
FCF
= Operating Cash Flow - CapEx
```

```text
FCF Margin
= FCF / Revenue
```

## 资产负债

```text
Total Debt
= Short-Term Debt + Long-Term Debt
```

```text
Net Debt
= Total Debt - Cash
```

```text
Debt / Equity
= Total Debt / Shareholders' Equity
```

```text
Current Ratio
= Current Assets / Current Liabilities
```

## 股本

```text
Shares Change
= (本期股本 - 上期股本) / 上期股本
```

```text
Book Value Per Share
= Shareholders' Equity / Shares Outstanding
```

---

# 12. 股东回报

重点展示：

- Stock Repurchases
- Dividends Paid
- Shares Outstanding
- Shares Change

通过：

> 实际股票回购金额 + 总股本变化

观察公司是否真正持续回购股票。

不单独解析 Item 5。

---

# 13. 财务趋势图

V1 不做大量图表。

重点只做：

## Growth Trend

一张核心增长趋势图：

- Revenue Growth
- EPS Growth
- FCF Growth

Annual：

> 最近 10 年

Quarterly：

> 根据季度数据展示 Revenue YoY、EPS YoY 等近期增长趋势。

同时在图表附近展示：

- Latest Growth
- 3Y CAGR
- 5Y CAGR

主要用于：

> 看增长是在加速、稳定还是减速。

当前 PE 暂时从嘉信查看，不接入行情数据。

---

# 14. AI 管理层经营解读｜Item 7

数据来源：

> 10-K Item 7 — MD&A
> 10-Q MD&A

主要回答：

> 为什么这些数字会发生变化？

AI 固定提炼：

## 主要增长驱动

- 收入为什么增长
- 哪些业务推动增长

## 主要压力 / 下降因素

- 哪些业务下降
- 哪些成本增加
- 哪些因素拖累利润

## 核心业务变化原因

解释主要业务线收入或利润变化原因。

## 利润率变化原因

解释利润率为什么改善或下降。

## 资本开支与投资重点

- CapEx 为什么变化
- 钱主要投向哪里

## 重要经营趋势

提炼管理层明确强调的长期或近期趋势。

原则：

> AI 只总结管理层明确披露的信息，不自行推测。

---

# 15. Business Segments｜业务分部

业务分部使用独立指标体系。

不复用公司整体的：

- EPS
- Cash
- Debt
- ROE
- FCF
- Book Value

因为这些通常属于公司级指标。

## Segment 表格

| 字段             | 含义         |
| -------------- | ---------- |
| Business       | 业务名称       |
| Revenue        | 业务收入       |
| Revenue Growth | 业务收入增长率    |
| Revenue Share  | 占公司总收入比例   |
| Segment Profit | 分部利润，如果披露  |
| Segment Margin | 分部利润率，如果披露 |

其中：

```text
Revenue Share
= Segment Revenue / Company Revenue
```

```text
Segment Margin
= Segment Profit / Segment Revenue
```

如果公司没有披露：

> 显示 N/A，不自行计算或猜测。

---

# 16. Segment Annual / Quarterly

业务分部同样可以支持：

```text
[ Annual ] [ Quarterly ]
```

Annual：

> 观察长期业务结构变化。

Quarterly：

> 观察最近哪些业务正在加速或减速。

季度没有披露某些字段时，允许字段为空。

不为了统一而强行补数据。

---

# 17. Geographic Revenue｜地区收入

如果公司披露地区收入，则展示：

| 字段             | 含义      |
| -------------- | ------- |
| Region         | 地区      |
| Revenue        | 地区收入    |
| Revenue Growth | 地区收入增长率 |
| Revenue Share  | 占总收入比例  |

主要用于判断：

> 公司收入主要来自哪些市场，以及不同地区增长情况如何。

---

# 18. 8-K｜重大事件

8-K 用于展示公司近期的重要事项。

展示：

- Filing Date
- 事件类型
- 标题
- AI 简短摘要
- SEC 原文入口

重点关注：

- 财报发布
- 重大并购
- 重大合同
- 大额融资 / 债务
- CEO / CFO 等关键管理层变动
- 重大资产变化
- 其他可能影响公司基本面的事件

AI 只说明：

> 发生了什么。

不判断：

- 利好 / 利空
- 是否值得买
- 股价会涨还是跌

---

# 19. AI 使用范围

V1 中 AI 只负责文本提炼：

```text
10-K Item 1
→ 公司业务概览

10-K Item 7
→ 年度经营变化原因

10-Q MD&A
→ 季度经营变化原因

8-K
→ 重大事件摘要
```

AI 不负责：

- 财务数字生成
- 财务公式计算
- 股票评分
- 买入 / 卖出建议
- 自行推测管理层未披露的信息

原则：

> 所有 AI 内容必须来自 SEC 原文。

---

# 20. 数据处理流程

## 财务数据

```text
SEC / XBRL
↓
获取原始数据
↓
统一字段
↓
区分 Annual / Quarterly
↓
程序计算指标
↓
数据库
↓
前端展示
```

## AI 文本

```text
10-K Item 1
→ AI 业务概览

10-K Item 7
→ AI 年度经营解读

10-Q MD&A
→ AI 季度经营解读

8-K
→ AI 重大事件摘要
```

---

# 21. 三套核心指标模板

V1 不设计一套万能指标。

固定使用三套独立模板：

## Company Annual

用于：

> 公司长期基本面。

最近 10 年。

## Company Quarterly

用于：

> 公司最新经营变化。

最近 10 个季度。

## Business Segment

用于：

> 看公司的钱由哪些业务赚来，增长来自哪里。

三套数据：

- 独立定义
- 独立表头
- 独立展示
- 不强制字段完全一致

---

# 22. 页面结构

```text
公司列表
├─ Annual
└─ Quarterly

收藏列表
├─ Annual
└─ Quarterly

公司详情
│
├─ 公司基础信息
│
├─ AI Business Overview
│   └─ 10-K Item 1
│
├─ Company Financials
│   ├─ Annual：最近10年
│   └─ Quarterly：最近10季度
│
├─ Growth Trend
│
├─ AI Management Commentary
│   ├─ Annual：10-K Item 7
│   └─ Quarterly：10-Q MD&A
│
├─ Business Segments
│   ├─ Annual
│   └─ Quarterly
│
├─ Geographic Revenue
│
└─ Major Events
    └─ 8-K
```

---

# 23. V1 最终研究逻辑

网站最终需要帮助回答：

> **这家公司是做什么的？**

看：

**10-K Item 1**

> **过去 10 年经营得怎么样？**

看：

**Annual Financials**

> **最近 10 个季度有没有出现新的变化？**

看：

**Quarterly Financials**

> 增长**速度是在加速还是减速？**

看：

**Growth Trend**

> **这些变化为什么发生？**

看：

**10-K / 10-Q Management Commentary**

> **公司的钱具体由哪些业务赚来？**

看：

**Business Segments**

> **最近有没有发生重大事项？**

看：

**8-K**

最终形成：

```text
业务
+
长期财务
+
近期季度
+
增长趋势
+
变化原因
+
业务结构
+
重大事件
```

作为 V1 的基本面研究框架。
