# Repository Guidelines

## Project Structure

This repository uses npm workspaces. `apps/api/` contains the NestJS backend, SEC integration, and Jest tests. `apps/web/` contains the React, TypeScript, and Vite client. `packages/shared/` holds framework-independent API contracts. Preserve the requirements and technical design in `docs/v1/`.

## Architecture Boundaries

Keep the full SEC basic directory. List pagination, search, and favorites may read the directory and database caches only; they must never fetch Company Facts. Acquire single-company financial data only when a user opens its detail, and reuse PostgreSQL data on later visits. Favorites are independent of acquisition and keyed by CIK, so aliases share financial records and favorite state.

Use Prisma Migration for the companies, annual_financials, and quarterly_financials tables. Preserve user data; never reset a database or delete financial rows when unfavoriting. Use unique constraints, acquisition leases, and transactions to prevent duplicate or partially completed imports. Failed acquisitions must remain retryable.

Keep SEC retrieval, normalization, and deterministic financial calculations in the backend. Do not download companyfacts.zip or batch-fetch all companies. Annual and independent quarterly periods must be distinct; never treat YTD cash flow as a quarter or subtract cumulative diluted EPS. Keep missing values null and retain provenance. AI, Agent, business-segment, 8-K, and market-wide financial ranking features are outside this phase.

Shared contracts contain no NestJS, database access, or credentials. Check frontend callers and tests whenever API contracts change. Preserve the original V1 documents.

## Development Commands

Run `npm install` from the repository root and maintain only the root `package-lock.json`. Use `npm run dev:api` for port 3000 and `npm run dev:web` for port 5173. Vite proxies `/api` to the backend. `npm run build:api` and `npm run build:web` build each application independently and build shared contracts first.

Use `npm run typecheck`, `npm run lint`, and `npm test` before delivery. Run `npm run db:generate` and `npm run db:migrate` after configuring PostgreSQL. `npm run test:db` uses an isolated disposable schema. Backend tests use Jest; frontend API-client tests use Node's test runner. `npm run test:live` explicitly opts into real SEC requests. HTTP integration tests require permission to listen on local ports.

## Style and Contributions

Use strict TypeScript, two-space indentation, descriptive names, and small modules. Use Ant Design consistently for frontend forms, tables, pagination, feedback, and layout; keep custom CSS limited to page spacing and responsive adjustments. Follow ESLint and Prettier configuration. Name tests `*.spec.ts` in the API and `*.test.ts` in the web package. Keep commits focused with imperative subjects. Pull requests should explain behavior changes and validation; include screenshots for visible UI changes.

## Configuration and Scope

Keep backend secrets in ignored `apps/api/.env`; provide placeholders in `.env.example`. Never expose SEC contact configuration or proxy credentials through Vite environment variables. Keep applications independently buildable and deployable. Implement only the requested scope.
