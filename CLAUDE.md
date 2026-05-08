# kk-lrms Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-19

## Active Technologies
- TypeScript 5.x / Node.js 20+ LTS + Next.js 15 (App Router), React 19, NextAuth.js v5, SWR, Recharts, shadcn/ui, Tailwind CSS 4, better-sqlite3, pg (001-kk-lrms-app)
- PostgreSQL 16+ (production cache), SQLite in-memory (unit tests) (001-kk-lrms-app)

## Project Structure

```text
src/
  app/           # Next.js App Router pages and API routes
  components/    # Reusable UI components (ui/, dashboard/, patient/, charts/, shared/)
  db/            # Database abstraction layer (adapter, schema-sync, tables/, seeds/)
  services/      # Centralized business logic (cpd-score, partogram, sync, webhook, audit)
  lib/           # Shared utilities (auth, bms-api, sse-manager, utils)
  types/         # TypeScript type definitions
  config/        # Configuration (risk-levels, hospitals, database)
  hooks/         # SWR data fetching hooks
tests/
  unit/          # Vitest + SQLite in-memory
  integration/   # Integration tests
  e2e/           # Playwright E2E tests
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x / Node.js 20+ LTS: Follow standard conventions

## Recent Changes
- 001-kk-lrms-app: Partograph time-series ingestion (HOSxP ipt_labour_partograph + webhook), Pascal CDSS port, 4-panel chart, dashboard severity dot
- 001-kk-lrms-app: BMS Session API architecture with per-hospital tunnel URLs, SQL query data access, polling-based sync
- 001-kk-lrms-app: Webhook API for non-HOSxP hospitals (incremental/full_snapshot modes, API key auth, auto-discharge)
- 001-kk-lrms-app: Kiosk monitor mode (fullscreen dark theme, large fonts, risk glow shadows)
- 001-kk-lrms-app: Public about page with system overview and webhook API documentation

<!-- MANUAL ADDITIONS START -->

## Constitution Compliance (v1.0.0)

Full constitution: `.specify/memory/constitution.md`

### I. Code Quality & Safety
- TypeScript strict mode mandatory; `any` requires written justification
- All builds MUST pass with zero warnings before task completion
- PDPA compliance for all patient data; encrypt name/cid fields at rest
- Validate inputs at system boundaries; use parameterized queries
- No hardcoded conditions for prompts or data lookup

### II. Test-Driven Development (NON-NEGOTIABLE)
- Write tests FIRST — Red-Green-Refactor strictly enforced
- Unit test each task before moving on (Vitest + SQLite in-memory)
- E2E tests MUST produce detailed debug logs (network, console, UI, errors)
- Never suppress errors or bypass failures; investigate root causes
- False-passing tests MUST be documented and investigated

### III. Reusable Components & DRY Architecture
- Never duplicate code — extract shared components and utilities
- CpdBadge, RiskIndicator, ConnectionStatus, VitalSignGauge: build once, reuse everywhere
- When a pattern appears twice, extract it; three times, it MUST already be shared

### IV. Centralized Business Logic
- Business rules live in `src/services/`, never in UI or route handlers
- CPD score calculation: single service function in `src/services/cpd-score.ts`
- Partogram logic: centralized in `src/services/partogram.ts`
- Risk thresholds/colors: defined once in `src/config/risk-levels.ts`
- Data transformation: dedicated mapping in `src/services/sync.ts`

### V. Informative UX & Progress Reporting
- Every operation shows progress (spinners, counts, status badges)
- Error messages MUST be actionable — what went wrong AND what to do (in Thai)
- Color coding (green/yellow/red) consistent across ALL screens
- Always display last sync timestamp from HOSxP per hospital
- Print views MUST show data source and timestamp

### VI. Performance & Real-Time Reliability
- Dashboard updates within 30 seconds of HOSxP data change
- BMS Session API SQL queries within 2 seconds; SSE broadcast within 5 seconds
- Support 200 concurrent users
- Offline: display cached data with "Offline — Last sync: [timestamp]"
- Server-side polling (30s per hospital) via BMS Session API + SSE broadcast to clients

### Version Control Discipline
- Commit after every completed task to prevent loss of work
- Clear, descriptive commit messages (state "why" not just "what")
- Never commit secrets (.env, API keys, JWT tokens)
- All tests MUST pass before merge to main

### Development Workflow
- Use skills: brainstorming, TDD, feature-dev, debugging, code-review, verification-before-completion
- Plan before coding on multi-step tasks
- Review before merge

<!-- MANUAL ADDITIONS END -->

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
