# DCF单卡片最终简化验收

估值路由不变，页面只保留一张Ant Design Card，内部按FCF、假设、折现、股权和每股公式顺序展示。默认增长率5%、WACC10%、永续增长率3%，均标为研究情景。没有复选框、计算按钮、调整表格、SEC来源表格或Alert。

已删除ValuationAdjustments组件。底层DCF引擎、财务接口和缓存没有修改；只调整ValuationPage、前端参数适配器、相关样式和组件测试。终值稳定增长是页面明确展示的模型情景约定，不再需要交互确认。显式填写正研究性FCFF及其依据即可自动计算条件情景；不填写时不会采用FCF冒充FCFF。股权桥接仍调用原验证器，缺失及未核实口径继续阻止每股结果，不自动确认资产/索偿、不补0。

## GOOGL实际缓存

通过现有生产valuationBaseline函数读取前轮保存的CompanyFacts/Submissions缓存：TTM 2025-10-01至2026-09-30，OCF179,551、CapEx159,804、FCF19,747百万美元；FCFF仍为null。截图使用这些真实缓存数据的离线API夹具和真实React页面，不读写数据库、不请求SEC或AI。

本机独立无头Chrome实际验证：

- DOM中恰好一张Card、一张五行表，无checkbox、Alert。
- 默认参数5/10/3，历史FCF显示19,747。
- 未提供FCFF时，显示历史事实与缺失原因，预测/EV/每股不编造结果。
- 手工输入演示FCFF20,000及明确条件假设后，无需确认即产生五年预测及EV；该20,000不是SEC事实或正式估值结论。
- 改预测增长5%到6%，首年FCFF从21,000变为21,200；WACC降至3%时正确拦截；股权桥接不足时每股保持null。
- 1280px桌面和390px手机宽度正常，无横向溢出和捕获的运行异常。

类型检查、Lint、构建通过；后端214项通过、5项环境测试跳过；清理旧测试编译产物后，前端48项通过。共享引擎原有数学及桥接测试保持通过。

截图：[默认GOOGL](dcf-final-googl.png)、[明确研究性FCFF后的计算](dcf-final-googl-scenario.png)、[手机布局](dcf-final-googl-mobile.png)。[浏览器检查记录](dcf-final-browser.json)。
