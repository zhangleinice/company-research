# 固定 10-K AI 分析

此扩展由新的明确需求授权，保留 docs/v1 原文与财务计算规则。

## 运行

从仓库根安装依赖，配置忽略的 apps/api/.env 中 SEC 联系人、代理（可选）、DATABASE_URL。
ROUTER_API_KEY 只允许后端环境变量；也可从启动服务的 shell 注入，不可使用 VITE_*。
执行 npm run db:generate、npm run db:migrate，随后正常启动 API 和 web。
OpenAI SDK 是 API workspace 的生产依赖，根开发依赖保留独立连接测试用途。

## 接口

- GET /api/companies/:cik/ai/:section：仅查询本地缓存和任务；CIK 必须10位；section 为 business 或 management。绝不调用 SEC 或付费 AI。
- POST /api/companies/:identifier/ai/:section：body {"force":false}。从 Submissions 选择最新完整10-K，按 accession + section + promptVersion 命中则返回缓存；否则提取并生成。
- force:true 绕过摘要缓存，仍复用章节缓存。前端重新生成按钮有费用确认。
- 返回 status、error、summary、POST 的 cached。生成中重复 POST 返回409；轮询 GET 可恢复长任务状态。生成失败可再次点击，原有成功摘要不删除。

AI 固定使用 https://api.router.ai/v1 的 gpt-6.1-sol，只有后端读取密钥。模型供应商响应名称不构成来源认证。

## 数据与并发

新增 ai_filings、ai_summaries、ai_tasks，均以 CIK 关联 companies，外键 Restrict；现有金融数据和收藏不会清空。
章节缓存以 CIK + accession + parserVersion 唯一；摘要以 CIK + accession + section + promptVersion 唯一。
摘要保存 filingType、财年、申报日期、来源、模型、JSON、Token使用量、调用次数、耗时与时间戳。
数据库任务租约按 CIK + 模块排他，5分钟过期，每次模型调用前续租；模型请求90秒，显式429/5xx最多重试一次。网络超时不自动重试，以免隐性重复计费。提交摘要时以租约token进行事务校验，过期工作者不能覆盖结果。

## 提取与摘要约束

HTML通过受大小限制的现有SEC队列/代理客户端获取，移除脚本、隐藏XBRL，保留表格单元格分隔。使用标题、连续章节边界、最短正文和章节顺序拒绝目录；歧义或提取失败时停止，不能将错误章节交给AI。
范围固定Item 1、Item 1A、Item 7，不接受10-Q/8-K/10-K/A。

每段标记Item N:p序号，超长段加part后缀。每块最多约24,000字符，所有块依次提取事实并汇总，不截掉尾部；超过32块或汇总输入上限明确失败。字符限制是保守输入预算，不代表平台承诺的上下文Token上限；平台上下文错误按失败处理，不自动缩短原文。
JSON须通过Zod的五栏、中文结论、事实/观点/推断分类、证据数量等校验。每条证据quote必须是指定原文段落的逐字连续子串；虚构或改写引用拒绝保存。空栏目显示“未找到相关披露”。模型总结仍需人工核对：逐字引用验证不能数学证明中文结论必然由引文推出，无法保证穷尽长年报全部重要信息。

## 验证工具

npm run build:api 后，node scripts/verify-ai-research.cjs 验证最新GOOGL定位与章节边界（只读）；加 --generate 明确启用付费生成、数据库持久化、二次缓存与金融/收藏元数据不变检查。密钥通过环境变量提供，脚本不写入密钥。
测试覆盖目录排除、缺失/歧义失败、表格/隐藏内容、10-K选择和路径、引用校验、被动读取不付费、缓存命中、重复任务与失败释放、前端模块顺序和API方法。

## 2026-11-09 实际验收

Alphabet 2025 10-K，accession 0001652044-26-000018，申报日2026-02-05，报告期2025-12-31。实际下载Submissions及Archives原文，三章节提取成功。

最终prompt sec-research-v2：Business 3次调用，输入8,439、输出5,416 Token，89.566秒；Management & Risks 8次调用，输入52,893、输出29,942 Token，459.991秒。两模块均存入本地PostgreSQL，并重复生成请求命中相同记录及时间戳，未增加AI调用；财务更新时间与收藏状态不变。

计入调试阶段Business v1的3次调用（输入10,193、输出9,116）和Management v1的1次Schema拒绝（输入5,503、输出3,705），本次合计15次调用，输入77,028、输出48,179，共125,207 Token，均为平台响应报告值。失败的Management v1未保存摘要。

后端149项、前端23项测试通过，5项可选SEC live用例跳过；另实际执行本模块SEC/AI验证及隔离数据库回归通过。类型检查、Lint和API/Web构建通过。浏览器已验证业务摘要、证据展开、生成中/失败状态与重新生成费用提示。

限制：只对Alphabet做了真实年报AI全流程；其他公司HTML布局可能因边界无法可靠确认而明确失败。引用逐字校验不等于语义真实性证明，结论仍需研究者复核。
