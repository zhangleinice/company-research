# Revenue Breakdown：第一阶段技术验证

日期：2026-11-12。结论：**第一阶段尚未通过生产集成门槛，停止第二阶段。** 标准事实数值可以还原，但当前原型尚不能可靠自动证明所有候选事实的收入语义、维度层级和跨年可比性。候选命中率不等于准确率，本报告不宣称已完成跨公司精确率评估。

本次没有修改正式页面、NestJS 服务、Prisma schema、CompanyFacts 映射或业务表，没有调用 AI。工具仅复用现有 SecClient 和 latest10K，读取三家公司 Submissions、最新 10-K，以及每次申报实际引用的 schema、label、presentation、definition 文件。每家公司 5 个附件（HTML + schema + 3 个 linkbase），不下载附件全集、全市场 ZIP 或第三方数据。Submissions 另计一份；本地文件复跑会复用。原始 HTML 仅保存在 /tmp 验证缓存，不写数据库。

## 原始文件与结果

| 公司                                                                                             | 最新适用财年 | 申报日期   | 唯一候选事实 | 重复实例去重 | 冲突 | 生产批准 |
| ------------------------------------------------------------------------------------------------ | ------------ | ---------- | -----------: | -----------: | ---: | -------: |
| [alphabet](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm) | 2025         | 2026-02-05 |           38 |            9 |    0 |        0 |
| [apple](https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm)     | 2026         | 2026-11-03 |           45 |            3 |    0 |        0 |
| [nvidia](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm)   | 2026         | 2026-02-25 |           42 |            0 |    0 |        0 |

全部采用原文件 namespace URI，而非前缀或标签包含 Revenue 的关键词。只对白名单标准概念生成候选：RevenueFromContractWithCustomerExcludingAssessedTax、RevenueFromContractWithCustomerIncludingAssessedTax、Revenues、SalesRevenueNet；这只是技术候选门槛，绝非语义批准。自定义收入概念暂不纳入，不据此声明全量覆盖。XML 不解析外部实体。

校验 CIK scheme/值、Accession 与 SEC URL 路径、context、完整年度期间、USD unit、scale/sign/受支持 transformation；金额用 BigInt 还原为整美元字符串。不能精确还原的非整数 USD、未知 transformation、nil/continuation/target、typed dimension、负收入等均拒绝或不纳入。其他币种、分数事实、多文件 Inline Document Set 尚不支持。重复事实按概念、完整 dimension/member tuple、期间与单位去重，冲突金额隔离。输出保留原始 contextRef、所有维度、原始数值文本和申报来源。

## 原始行逐项对照样本

以下金额单位统一为**百万美元**，从 iXBRL scale=6 还原后换算；名称取本次申报 label linkbase 的官方 terseLabel。不是硬编码分类。此处仅列代表样本，所有候选及标签角色、原始表格行、来源/期间/维度保存在配套 JSON。最后一列为机械算术核对，**未批准作为生产 YoY**。

### alphabet

| 官方成员名称    | 较早两年 → 最近年度（按报告期末排序）                           | 最近一年算术 YoY，未批准 |
| --------------- | --------------------------------------------------------------- | -----------------------: |
| Google Services | 2023-12-31: 272,543 → 2024-12-31: 304,930 → 2025-12-31: 342,721 |                   12.39% |
| Google Cloud    | 2023-12-31: 33,088 → 2024-12-31: 43,229 → 2025-12-31: 58,705    |                   35.80% |
| Other Bets      | 2023-12-31: 1,527 → 2024-12-31: 1,648 → 2025-12-31: 1,537       |                   -6.74% |

### apple

| 官方成员名称 | 较早两年 → 最近年度（按报告期末排序）                           | 最近一年算术 YoY，未批准 |
| ------------ | --------------------------------------------------------------- | -----------------------: |
| iPhone       | 2024-09-28: 201,183 → 2025-09-27: 209,586 → 2026-09-26: 254,098 |                   21.24% |
| Mac          | 2024-09-28: 29,984 → 2025-09-27: 33,708 → 2026-09-26: 37,929    |                   12.52% |
| iPad         | 2024-09-28: 26,694 → 2025-09-27: 28,023 → 2026-09-26: 27,929    |                   -0.34% |
| Services     | 2024-09-28: 96,169 → 2025-09-27: 109,158 → 2026-09-26: 123,301  |                   12.96% |

### nvidia

| 官方成员名称         | 较早两年 → 最近年度（按报告期末排序）                          | 最近一年算术 YoY，未批准 |
| -------------------- | -------------------------------------------------------------- | -----------------------: |
| Compute & Networking | 2024-01-28: 47,405 → 2025-01-26: 116,193 → 2026-01-25: 193,479 |                   66.52% |
| Graphics             | 2024-01-28: 13,517 → 2025-01-26: 14,304 → 2026-01-25: 22,459   |                   57.01% |
| Data Center          | 2024-01-28: 47,525 → 2025-01-26: 115,186 → 2026-01-25: 193,737 |                   68.19% |

## 成功、失败与无法确认

**成功：** 三家公司均获得最近三个完整年度的标准收入候选，支持不同财年结尾；能还原官方成员标签、同次申报中的比较期间、USD 金额和原始表格行。无需公司专属解析规则即可读取事实。Alphabet 有业务分部、业务内产品类别、地区；Apple 有产品与服务、地理报告分部以及另一套国家收入；Nvidia 有报告分部、产品市场和地区。所有维度按完整 tuple 保留，未混合求和。三家公司标准标签候选无金额冲突，不代表其他概念不存在冲突。

**已确认不能直接展示的处理方式：**

- Alphabet 2025：Google Services 342,721 + Google Cloud 58,705 + Other Bets 1,537 = 402,963；报表总收入 402,836，差额为对冲损失 -127。不能用三个分部加总替代合并收入，亦不能将对冲金额算为业务收入。其他 equity/reclassification 维度上下文中也出现同一收入概念，概念命中本身不足以批准。
- Apple 2026：iPhone 254,098 + Mac 37,929 + iPad 27,929 + Wearables/Home/Accessories 35,577 = Products 355,533。Products 是总项，不能与子项和 Services 全部平铺加总。国家收入与地理报告分部也不能当成同一分组。OperatingSegments 与 CorporateNonSegment 属于额外合并维度，必须保留而非抹去。
- Nvidia 2026：Compute 162,361 + Networking 31,376 = Data Center 193,737。Data Center 和子项不能相加；Compute & Networking 报告分部（193,479）也不是 Data Center 产品市场（193,737）。相近名称与金额不代表同口径。

**尚无法确认、因此不集成：**

1. 当前只收集 definition/presentation 网络，尚未实现完整 Dimensions 约束处理（默认成员、继承、all/notAll、targetRole、prohibited/priority、域成员有效性等）。同一个 presentation role 中同时出现概念与成员，不足以证明该事实语义。
2. 对外客户收入、内部交易、对冲和合并抵销的语义尚未完成通用证明；本次没有把标签关键词或加总一致当作证明。
3. 官方标签可能同时有 standard/terse/verbose/documentation 等角色；正式展示必须按该表 preferredLabel 及层级选取，不能任意取最后一个标签。原型保留所有标签，没有擅自重命名。
4. 跨年同概念及完整 tuple 的比较可以核对算术，但分类变更、历史重述、表格范围变化尚未完整校验。因此不输出“已验证”的业务 YoY；候选 JSON 字段明确为 arithmeticYoYNotApproved。没有比较值或上年为零时为空。
5. 无法定义可信的全量事实分母，尚不能报告跨公司准确率。当前生产批准数为零是安全门控结果，不代表全部候选金额错误。

下一步应在独立验证层补齐 taxonomy/Dimensions/层级/外部客户收入判定，再对三份固定申报及更多反例重跑。只有按维度验证的子集达到门槛后才接入正式持久化和页面；当前不建表、不新增 API、不修改 Business。

## 复现与验证

```sh
node scripts/revenue-validation/fetch.cjs
node scripts/revenue-validation/links.cjs
node scripts/revenue-validation/audit.cjs
node --test scripts/revenue-validation/parser.test.cjs scripts/revenue-validation/live-cache.test.cjs
npm run typecheck
npm run lint
npm test
npm run build
```

fetch/links 仅在缓存不存在时请求 SEC。合成解析测试覆盖 QName/CIK/URL/单位/期间/格式/重复冲突/真实零值限制，实际缓存测试覆盖三份申报的手工对照值以及上述总项与调整陷阱。脚本位于 scripts，不接入应用模块；没有数据库或 AI SDK 依赖。

规范参考：[SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)、[SEC Inline XBRL](https://www.sec.gov/data-research/structured-data/inline-xbrl)、[Inline XBRL 1.1](https://specifications.xbrl.org/work-product-index-inline-xbrl-inline-xbrl-1.1.html)。
