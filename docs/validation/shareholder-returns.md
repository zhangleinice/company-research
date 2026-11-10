# Independent Shareholder Returns module — 2026-11-10

## Changes

The fifth financial module follows Financial Health and contains six metrics in two rows and three responsive side-by-side charts (stacked on smaller screens). Cash Flow retains OCF, CapEx, FCF, FCF margin/growth, CapEx/OCF and the net-income/OCF comparison. The existing annual/quarterly selector controls all five modules. Business and Management & Risks code and cached summaries were not changed.

The normalization implementation is issuer-independent. The previous `verifiedNoDividend` rule has been removed. A Prisma data migration clears only DPS values/provenance created by that narrative-disclosure rule, not SEC facts or financial rows. It adds no columns and does not touch favorites or AI tables. CompanyFacts explicit zeros remain zero; absence is null even where a narrative filing might establish no dividends. No narrative filing or HTML parsing is used by this feature.

## Sources and periods

| Metric | CompanyFacts US-GAAP concept / calculation | Unit and policy |
| --- | --- | --- |
| Stock Repurchases | `PaymentsForRepurchaseOfCommonStock` | USD cash outflow; not shares bought or authorization |
| Diluted Shares | `WeightedAverageNumberOfDilutedSharesOutstanding` | `shares`, weighted average during exact period; not ending shares |
| Diluted Shares YoY | `(current / prior-year same-period - 1) * 100` | Percentage points; direct observations reconciled in a common accession and matching latest values; positive denominator |
| Dividends Paid | Prefer `PaymentsOfDividendsCommonStock`; otherwise existing `PaymentsOfDividends` mapping | USD cash outflow. Total tag definition includes common, preferred and noncontrolling distributions; fallback is disclosed in UI and provenance |
| DPS | `CommonStockDividendsPerShareDeclared` | `USD/shares`, declared ordinary cash dividends; no paid/preferred-DPS substitution |
| DPS YoY | `(current DPS / prior-year same-period DPS - 1) * 100` | Same-accession reconciliation matching latest figures; zero/missing base produces null |

The SEC CompanyFacts description of `PaymentsOfDividends` was checked in the cached source: cash outflows for distributions/dividends to common, preferred and noncontrolling shareholders. Its scope must not be interpreted as common-only DPS. No unverified new concept mappings were introduced.

Money flows use exact annual/quarterly dates, with the existing same-concept/unit YTD subtraction where supported for cash payments. Weighted shares and DPS require directly reported independent quarters, never annual/YTD averages substituted as a quarter. Latest filed/ accession observations take precedence; all sources retain concept, unit, dates and accession. No stock-split estimates are generated. Missing historical data produces gaps; share counts can retain different reported split bases, as disclosed by the UI.

## GOOGL-only actual-data validation

Input: previously fetched CompanyFacts cache, modified 2026-11-07, CIK `0001652044`. No other company's real financial data was validated or refreshed. Existing synthetic regression tests were run; live SEC tests were not enabled. There were no complete update requests, paid AI calls, or narrative filing retrievals.

| 2025 metric | Exact normalized/API result |
| --- | ---: |
| Stock Repurchases | $45,709,000,000 |
| Diluted Shares | 12,230,000,000 |
| Diluted Shares YoY | -1.74339198% |
| Dividends Paid | $10,049,000,000 (`PaymentsOfDividends`, total scope) |
| Declared DPS | $0.83 |
| DPS YoY | 38.33333333% versus 2024 $0.60 |

Annual availability in the ten cached periods (2016–2025):

- Repurchases: 10/10.
- Diluted shares: 4/10 (2022–2025); share YoY: 2023–2025. Other periods remain null.
- DPS: 2/10 (2024–2025). 2016–2023 are null, not inferred zeros.
- Dividends Paid: explicit zeros in 2016, 2017, 2022 and 2023; positive values in 2024–2025; missing in 2018–2021. No zero-filling from another field or a narrative report.
- Latest ten independent quarters are retained. Where direct Q4 share/DPS facts are absent, values remain null. Latest 2026 Q3 has DPS $0.22 and diluted shares 12,368,000,000.

## Verification

- Transactional cache backfill updates only GOOGL shareholder fields/provenance in existing periods. Hash checks confirm other financial columns/provenance, company/favorite state, summaries and task records remain unchanged.
- `node scripts/verify-googl-dividends.cjs --verify-api` compares all shareholder fields in both period sets across normalization, PostgreSQL, NestJS and Vite proxy responses, and validates selected raw facts by concept/unit/accession/dates/value.
- `node scripts/render-googl-dividends.cjs` uses the actual GOOGL API snapshot to render both modes: five financial modules; no shareholder cards/charts in Cash Flow; six metric cards and exactly three SVG charts in the fifth module; correct units and missing values.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` passed. Backend: 165 passed, five opt-in cases skipped; frontend: 29 passed.

Computer Use was reset and a new session attempted. Browser host remained unavailable, and native Chrome returned a stopped-session error. Actual viewport spacing, interactive browser switching and console errors could not be directly inspected. React rendering checks cover both annual and quarterly output but do not constitute actual browser layout/console acceptance.
