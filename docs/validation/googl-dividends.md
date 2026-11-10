> Historical record: superseded by [the CompanyFacts-only independent module validation](./shareholder-returns.md). Issuer-disclosure zero-filling described below has been removed.

# GOOGL shareholder returns validation — 2026-11-10

Only GOOGL's actual financial data was checked in this change. Existing synthetic regression tests remain in the full test suite; live SEC tests were not enabled. No full company update endpoint or paid AI API was invoked.

## Basis and observations

Input: the previously acquired GOOGL CompanyFacts cache (`/tmp/googl-health-companyfacts.json`, modified 2026-11-07). The parser uses US-GAAP `CommonStockDividendsPerShareDeclared`, unit `USD/shares`, exact period dates, and latest filing per period. This is **declared ordinary cash DPS**, not paid cash per share, preferred dividends, or total dividends paid. There is no fallback to those different measures.

- 2016–2023 annual DPS: 0, based on Alphabet's explicit disclosure that it had never declared or paid cash dividends. These are not zeros inferred from missing XBRL facts.
- 2024 annual DPS: $0.60. YoY is null because the prior DPS was zero.
- 2025 annual DPS: $0.83. YoY: `(0.83 / 0.60 - 1) × 100 = 38.33333333%`.
- Latest independent quarter, 2026 Q3: DPS $0.22, YoY 4.76190476% versus $0.21 in 2025 Q3.
- Quarterly DPS uses directly disclosed independent quarters only. In this CompanyFacts cache, 2024/2025 Q4 direct DPS is absent and remains null; annual or YTD DPS is never presented as a quarter.
- Missing observations remain null. A zero-base YoY remains null, including years before the first dividend.

Verified absence is scoped to Alphabet's CIK and periods from its succession date through 2024 Q1, before its first cash dividend declaration. Sources:

- [2023 10-K, Item 5 Dividend Policy](https://www.sec.gov/Archives/edgar/data/1652044/000165204424000022/goog-20231231.htm)
- [2024 Q1 10-Q, first declaration on April 25, 2024](https://s206.q4cdn.com/479360582/files/doc_financials/2024/q1/goog-10-q-q1-2024.pdf)
- [2025 10-K](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm)

## Diluted shares

The running API process was an old build and omitted the new share metrics even though PostgreSQL had them. Restarting the API with the current build resolved the omission.

CompanyFacts provides consolidated standard-tag annual diluted weighted average shares for 2022–2025: 13.159, 12.722, 12.447, 12.230 billion respectively. Earlier consolidated values are absent from this cache; EPS notes include class-specific disclosures, which this change does not aggregate or estimate. Those periods remain null. Quarter shares require direct quarter observations; Q4 remains null where absent. No weighted average shares are derived by subtracting annual/YTD values.

## Persistence and verification

Migration adds nullable `dividendsPerShare` and `dpsGrowth` to both financial tables. A GOOGL-only transaction updates these and the previously added share fields in existing rows, preserving all other columns, provenance, company/favorite state, AI summary records and AI task records. The existing normal import flow will persist the metrics on future user-authorized financial refreshes.

Commands:

- `node scripts/verify-googl-dividends.cjs --backfill` — cached GOOGL financial fields only; asserts unchanged unrelated data.
- `node scripts/verify-googl-dividends.cjs --verify-api` — checks PostgreSQL, NestJS and Vite proxy equality without update requests.
- `node scripts/render-googl-dividends.cjs` — renders real GOOGL API data in both modes after the web test compile; checks cards, charts, units, zero and missing values.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Computer Use was reset and a fresh session attempted. Browser host unavailable; native Chrome returned a stopped-session error. Actual browser layout could not be inspected. React rendering verification was used as the available fallback, without claiming browser acceptance.
