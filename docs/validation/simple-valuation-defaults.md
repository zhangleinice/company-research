# Simple DCF defaults

Policy: `simple-valuation-defaults-v2`. Valuation units remain USD millions; all shared rates are decimal fractions, with percentages formatted only by the UI.

- GET `/api/companies/:ticker/valuation/simple-inputs` reads existing annual financial rows and the independent valuation cache. It never acquires CompanyFacts or writes financial/research records. It reuses the existing single-company SEC profile cache to obtain SIC and incorporation jurisdiction; a first profile lookup may fetch SEC submissions. Metadata failure leaves eligibility unknown.
- Latest TTM is the initial FCFF basis. Annual OCF, PP&E CapEx and operating income require full-year, reported USD source records. Annual interest is selected by its actual complete period from existing cached underlying interest facts. No quarterly/YTD/TTM aggregate is relabeled as annual interest. Missing interest is never zero.
- The existing FCFF research validator is reused. Optional tax input leaves its historical 21% default behavior intact. An eligibility pass at 0% tests the maximum possible FCFF for nonnegative interest; the selected tax is then applied without intermediate rounding. Known cash-interest/expense discrepancies continue to block automatic approximation. Capitalized interest is not separately added back.
- US incorporation is a geographic applicability proxy for the simplified federal 21% assumption, not proof of a company's actual marginal tax shield, entity tax status, or deduction availability. Foreign/unknown jurisdiction does not receive an automatic 21%. Effective tax uses current TTM tax expense/positive pretax income and rejects rates outside [0,1].
- Growth uses six continuous complete years for five intervals; the three-interval reference uses four years. Original stored CAGR comparison approvals are retained as a gate; the unrounded CAGR is recomputed from source amounts, not the rounded database percentage. Invalid/nonpositive endpoints and missing history return null. Nonpositive intermediate FCF does not automatically become a growth default. 50% YoY FCF and CapEx changes are warnings only: no clipping, discount factor, or fixed 5% fallback.
- `npm run update:wacc` downloads Damodaran's official US `wacc.xls`, reads `Industry Averages` / exact `Cost of Capital`, preserves the official nonfinancial aggregate, workbook version date and SHA256, validates coverage and rates, then atomically replaces `apps/web/src/data/industry-wacc-us.json`. `-- --file /path/wacc.xls` permits offline replay. Rebuild/deploy the web bundle after annual updates. This is not an automatic background market-data feed.
- SIC mappings are a project research crosswalk, not Damodaran's official taxonomy. Exact SIC mappings take precedence over explicitly configured approximations. SIC 7370 uses an explicitly labeled Computer Services approximation. Unmatched valid nonfinancial SICs (including broad 2080) use the official US Total Market (without financials) aggregate. Missing SIC and financial SICs never receive this automatic fallback. The source tier and rationale remain visible in the WACC tooltip. Manual industry and rate changes are independent of the source snapshot; financial SIC applicability checks remain in the original DCF engine.
- USD terminal growth defaults to the Federal Reserve's 2% long-term PCE inflation objective, representing a simplified mature-state approximately zero real-growth scenario. The original strict WACC > terminal-growth check remains mandatory.

The OCF path has not been fully normalized for nonoperating investment returns, extraordinary claims, leases or SBC. Annual bases may lag the current valuation date and no extra stub-period cash flow/discount is inferred. Cash stock required for operations is handled only in the existing equity bridge; it is not deducted again from forecast FCFF. The equity bridge continues to block incomplete per-share valuations.

Sources:

- https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.html
- https://www.stern.nyu.edu/~adamodar/pc/datasets/wacc.xls
- https://www.irs.gov/instructions/i1120
- https://www.federalreserve.gov/faqs/economy_14400.htm

Validation:

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
- `node --test scripts/update-industry-wacc.test.cjs`
- `node scripts/simple-valuation-audit.cjs /path/to/existing-sec-submissions-cache docs/validation/simple-valuation-audit.json`

The last command expects existing `roic-{TICKER}-sub.json` SEC profile files for GOOGL/AAPL/MSFT/KO and existing PostgreSQL financial rows. It forbids network acquisitions and checks financial/valuation/Owner Earnings record hashes before and after. It does not save test hypotheses.

Forecast FCFF is computed before discount/terminal validation. Missing WACC leaves five valid forecast cash flows available; discount/PV, terminal value and EV remain unavailable. Valid WACC permits forecast PV even when terminal assumptions are unresolved. The discounted cash flow/terminal/equity formulas are unchanged. Only the unified reset button remains; ordinary caveats live in tooltips.
