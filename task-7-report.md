# Task 7 Review Round 2

## Red/Green Evidence

### H1: forgotten-export allowlist policy

Red:

- `bun test ./scripts/__tests__/api-extractor-forgotten-exports.test.ts ./scripts/__tests__/public-docs-surface.test.ts`
  initially failed because `scripts/lib/api-extractor-forgotten-exports.mjs` and
  `scripts/lib/public-docs-surface.mjs` did not exist.
- `bun run --filter '@docx-editor.dev/agents' api:check` initially passed with
  warning-only forgotten exports and printed 39 unnameable symbols, so new
  leaks were not gated.

Green:

- `bun test ./scripts/__tests__/api-extractor-forgotten-exports.test.ts ./scripts/__tests__/public-docs-surface.test.ts`
  now passes (`6 pass, 0 fail`).
- `bun run --filter '@docx-editor.dev/agents' api:extract` now succeeds while
  enforcing the reviewed allowlist policy.
- `bun run --filter '@docx-editor.dev/agents' api:check` now succeeds while
  enforcing the same policy, with the current reviewed internal/plumbing
  allowlist at 34 known warnings.

Notes:

- The editor API entry no longer leaks `createServer`, `createBrowser`,
  `AutomationCapabilities`, or `DocxEditorInstance` through public signatures.
- The remaining reviewed allowlist is explicit and entry-specific.
- Package-owned public model/capability exports are protected from being added
  to that allowlist.
- The command evidence below retains the package name in use when it was
  recorded. The current package is `@docx-editor.dev/editor-api`.

### H2: public docs surface and stale package claims

Red:

- `node scripts/check-public-docs-surface.mjs` initially failed after the gate
  was strengthened, reporting stale React/Vue package subpaths such as
  `@docx-editor.dev/react/ui`, `@docx-editor.dev/react/hooks`,
  `@docx-editor.dev/react/dialogs`, `@docx-editor.dev/react/plugin-api`,
  `@docx-editor.dev/vue/ui`, `@docx-editor.dev/vue/composables`,
  `@docx-editor.dev/vue/dialogs`, and `@docx-editor.dev/vue/plugin-api`.

Green:

- `node scripts/check-public-docs-surface.mjs` now passes:
  `✓ public docs surface: 4 documented contract groups exported`.
- `bun run check:public-docs-surface` now passes.
- The obsolete plugin docs section was removed from docs navigation and the
  corresponding files were deleted.

### H2 follow-up: current public markdown outside docs/site/content

Red:

- After the first H2 fix, `node scripts/check-public-docs-surface.mjs` still
  missed stale current-doc claims outside `docs/site/content`, including
  `README.md`, `docs/PROPS.md`, `docs/TOOLBAR.md`, and
  `packages/nuxt/README.md`.
- Once the scan widened to root/docs/package markdown, the gate failed on the
  remaining removed-surface claims and the leftover top-level `docs/plugins/*`
  pages.
- `bun test ./scripts/__tests__/public-docs-surface.test.ts` was extended first
  and failed red because `findRemovedSurfaceClaims()` did not exist yet.

Green:

- `bun test ./scripts/__tests__/public-docs-surface.test.ts` now passes with
  the new regression covering current public markdown outside the docs site.
- `node scripts/check-public-docs-surface.mjs` now scans the site docs, root
  `README.md`, current `docs/*.md`, package markdown, and example markdown,
  while excluding generated `*.api.md`, changelogs, and OpenSpec/archive
  content.
- The stale removed-surface claims were rewritten or deleted from the repo
  README, standalone docs pages, the Nuxt README, and the obsolete top-level
  plugin docs.

## Scoped Verification

- `bun run --filter '@docx-editor.dev/agents' build`
- `bun run --filter '@docx-editor.dev/agents' api:extract`
- `bun run --filter '@docx-editor.dev/agents' api:check`
- `bun run --filter '@docx-editor.dev/agents' typecheck`
- `bun test ./scripts/__tests__/api-extractor-forgotten-exports.test.ts ./scripts/__tests__/public-docs-surface.test.ts`
- `bun run check:public-docs-surface`
- `bun run check:parity`
- `bunx prettier --write ...` on the touched scripts, docs, and editor API files
- `bun test ./scripts/__tests__/public-docs-surface.test.ts`
- `node scripts/check-public-docs-surface.mjs`
