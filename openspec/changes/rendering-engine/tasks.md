## Verification checklist

- [x] Convert OOXML lengths to CSS pixels using the documented standard ratios.
- [x] Wrap text with resolved fonts, tabs, indentation, spacing, and floating-object exclusion areas.
- [x] Honor section page size, margins, columns, and start behavior without phantom pages.
- [x] Honor explicit page breaks, keep behavior, widow/orphan behavior, and paragraph spacing.
- [x] Split tables according to row constraints, repeated headers, and vertical merges.
- [x] Place footnotes, headers, footers, text boxes, and floating drawings without corrupting body flow.
- [x] Stamp painted DOM with document-position ranges and scope body versus header/footer queries.
- [x] Keep caret and selection rectangles correct across lines, pages, scrolling, virtualization, and zoom.
- [x] Keep one active editing region and preserve body/header/footer focus hand-off.
- [x] Verify the stable DOM-facing package API with real DOCX fixtures.
- [x] Build the core, React, and Vue packages and check emitted JavaScript and declarations.
- [x] Run type checking and focused rendering/selection tests.

## Executed acceptance evidence (2026-07-15)

- `bun run build:packages` — passed for all published packages.
- `PLAYWRIGHT_BASE_URL=http://localhost:6173 npx playwright test e2e/tests/body-multi-column-pagination.spec.ts --project=chromium --timeout=30000 --workers=1` — 1 passed.
- `npx playwright test e2e/tests/vue/hf-body-focus-handoff.spec.ts e2e/tests/vue/issue-763-caret-multipage-table.spec.ts --project=vue --timeout=30000 --workers=1` — 2 passed.
- `bun run check:package-artifacts` — passed, including ESM/CJS `core/api` loading and CJS private-require resolution.
- `SKIP_CONSUMER_INSTALL_BUILD=1 bun run check:consumer-install` — passed fresh packed Vue and React typecheck/build consumers.
- `bun run typecheck` — passed for all workspace packages.
- Prettier write/check passed for the changed acceptance tests, validation scripts, and this evidence file.
