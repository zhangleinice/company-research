# 上市公司研究平台 V1 需求文档

## 1. 项目目标

做一个用于自己研究上市公司的基本面数据网站。

核心目的：

> 把公司的基础信息、核心财务数据、历史趋势和各业务线情况统一整理出来，减少研究公司时到处查资料的时间。

数据主要来自：

- SEC API / XBRL
- 10-K / 10-Q

AI 只用于整理公司业务介绍和业务分部说明。

---

# 2. 首页｜公司列表

首页用于浏览和筛选公司。

## 功能

- 公司搜索
- 行业筛选
- 分页
- 收藏 / 取消收藏
- 点击进入公司详情

## 列表展示指标

| 指标 | 说明 |
|---|---|
| 公司名称 | Company Name |
| 股票代码 | Ticker |
| 行业 | Industry |
| 股价 | Price |
| 市值 | Market Cap |
| PE | 市盈率 |
| Revenue | 营业收入 |
| Revenue Growth | 营收增长率 |
| EPS | 每股收益 |
| EPS Growth | EPS 增长率 |
| FCF | 自由现金流 |
| ROE | 净资产收益率 |
| Net Margin | 净利率 |
| Debt | 总债务 |

首页主要用于快速查看公司整体情况，不展示过多详细数据。

---

# 3. 收藏列表

保存自己真正感兴趣、准备进一步研究的公司。

## 功能

- 查看收藏公司
- 搜索
- 行业筛选
- 取消收藏
- 点击进入公司详情

展示指标与首页基本一致。

以后研究公司时，可以主要从收藏列表进入。

---

# 4. 公司详情页

详情页是整个网站最核心的部分。

主要分为：

1. 公司概览
2. 公司整体财务
3. 业务分部
4. 地区收入

---

## 4.1 公司概览

展示：

- 公司名称
- 股票代码
- 行业
- 当前股价
- 市值
- PE
- 公司官网

### 公司简介

使用 AI 根据 10-K 整理一段简短介绍，包括：

- 公司主要做什么
- 主要产品 / 服务
- 主要业务线

控制在一小段文字即可。

---

# 5. 公司整体财务

默认查看最近 **5～10 年** 数据。

重点是：

> 看长期趋势，而不是只看最新一年。

---

## 5.1 增长

### Revenue

- 营业收入
- Revenue Growth
- 3 年 / 5 年 CAGR

### EPS

使用 Diluted EPS。

展示：

- EPS
- EPS Growth
- 3 年 / 5 年 CAGR

### Free Cash Flow

```text
FCF = Operating Cash Flow - CapEx
```

展示：

- FCF
- FCF Growth
- 3 年 / 5 年 CAGR

---

## 5.2 盈利能力

展示：

| 指标 | 含义 |
|---|---|
| Gross Margin | 毛利率 |
| Operating Margin | 营业利润率 |
| Net Margin | 净利率 |
| ROE | 净资产收益率 |

主要观察这些指标长期是：

- 上升
- 稳定
- 下降

---

## 5.3 现金流

展示：

- Operating Cash Flow
- Capital Expenditure
- Free Cash Flow
- FCF Margin

其中：

```text
FCF Margin = FCF / Revenue
```

---

## 5.4 资产负债

展示：

- Cash & Cash Equivalents
- Total Assets
- Total Liabilities
- Shareholders' Equity
- Short-Term Debt
- Long-Term Debt
- Total Debt
- Net Debt

其中：

```text
Total Debt
= Short-Term Debt + Long-Term Debt
```

```text
Net Debt
= Total Debt - Cash
```

另外展示：

- Debt / Equity
- Current Ratio

---

## 5.5 股本

展示：

- Shares Outstanding
- Shares Change

主要用于观察公司是否长期：

- 回购股票
- 增发股票

---

## 5.6 估值

展示：

- Market Cap
- PE
- P/B
- P/S
- FCF Yield
- Dividend Yield

其中：

```text
FCF Yield
= TTM FCF / Market Cap
```

---

# 6. 财务数据展示方式

核心指标尽量同时提供：

### 图表

用于看 5～10 年趋势。

主要图表：

- Revenue
- EPS
- FCF
- Gross Margin
- Operating Margin
- Net Margin
- ROE
- Cash
- Total Debt
- Shares Outstanding

### 表格

用于查看每一年的具体数字。

例如：

| Year | Revenue | Growth | EPS | FCF | Net Margin |
|---|---:|---:|---:|---:|---:|
| FY2026 | ... | ... | ... | ... | ... |
| FY2025 | ... | ... | ... | ... | ... |

---

# 7. 业务分部

这一部分用于回答：

> **这家公司具体靠哪些业务赚钱？**

按照公司财报实际披露的业务线展示。

例如一家公司可能有：

- iPhone
- Mac
- Services

或者：

- Advertising
- Cloud
- Subscription

不人为统一业务分类，以公司自己的 Segment / Product 分类为准。

---

## 每个业务线展示

### 基础说明

AI 根据 10-K 整理一小段：

> 这个业务具体是做什么的。

### 核心数据

- Segment Revenue
- Revenue Growth
- Revenue Share
- Segment Profit（如果公司披露）
- Segment Margin（如果公司披露）

其中：

```text
Revenue Share
= Segment Revenue / Company Revenue
```

同时展示业务线最近几年的收入趋势。

这样可以直接看到：

> 公司增长到底来自哪个业务。

---

# 8. 地区收入

如果公司有披露 Geographic Revenue，则展示。

每个地区：

- Revenue
- Revenue Growth
- Revenue Share

例如：

| 地区 | Revenue | Growth | Revenue Share |
|---|---:|---:|---:|
| Americas | ... | ... | ... |
| Europe | ... | ... | ... |
| Greater China | ... | ... | ... |

主要用于判断：

> 公司收入主要来自哪些市场，以及不同地区的增长情况。

---

# 9. 核心指标清单

最终 V1 主要保留下面这些指标。

## 增长

- Revenue
- Revenue Growth
- Revenue CAGR
- EPS
- EPS Growth
- EPS CAGR
- FCF
- FCF Growth
- FCF CAGR

## 盈利

- Gross Margin
- Operating Margin
- Net Margin
- ROE

## 现金流

- Operating Cash Flow
- CapEx
- FCF
- FCF Margin

## 资产负债

- Cash
- Total Assets
- Total Liabilities
- Shareholders' Equity
- Short-Term Debt
- Long-Term Debt
- Total Debt
- Net Debt
- Debt / Equity
- Current Ratio

## 股本

- Shares Outstanding
- Shares Change

## 估值

- Market Cap
- PE
- P/B
- P/S
- FCF Yield
- Dividend Yield

## 业务分部

- Segment Revenue
- Segment Revenue Growth
- Segment Revenue Share
- Segment Profit
- Segment Margin

## 地区

- Geographic Revenue
- Geographic Revenue Growth
- Geographic Revenue Share

---

# 10. 数据处理

数字：

```text
SEC / XBRL
↓
获取原始数据
↓
统一字段
↓
计算 Growth / FCF / ROE 等指标
↓
数据库
↓
前端展示
```

文字：

```text
10-K
↓
提取公司业务 / Segment 相关内容
↓
AI 压缩整理
↓
数据库
↓
前端展示
```

原则：

> **数字由 SEC 数据和程序计算，AI 不负责生成财务数字。**

---

# 11. V1 页面结构

最终就三个主要页面：

```text
公司列表
    ↓
公司详情

收藏列表
    ↓
公司详情
```

整个 V1 的核心流程就是：

> **浏览公司 → 收藏 → 查看详情 → 研究公司。**

公司详情解决两个核心问题：

> **公司整体经营得怎么样？**

以及：

> **公司的钱具体是从哪些业务和哪些地区赚来的？**