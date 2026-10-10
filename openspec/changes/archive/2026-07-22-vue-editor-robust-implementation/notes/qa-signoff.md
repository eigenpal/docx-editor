# Vue Un-Stub QA Evidence

Run date: 2026-05-12

## Automated Gates

- `bun run typecheck` passed.
- `bun run check:parity && bun run i18n:validate && bun run check:feature-parity` passed.
- `bun run test:e2e:parity --timeout=30000 --workers=4` passed: 28 parity tests across React and Vue.
- `bun run parity:perf` passed. Local runs write ignored artifacts under
  `test-results/perf/`; set `PERF_WRITE_ARTIFACTS=1` when a PR needs committed
  perf evidence under `notes/perf/`.
- `bun run parity:prepublish` passed.

## Visual Evidence

Local Chromium visual checks loaded `e2e/fixtures/example-with-image.docx` into
both adapters. The PR should attach preview-deployment screenshots as reviewer
evidence once the branch deploys.

## Manual Scope

Validated locally through Playwright-driven browser sessions:

- Mount and rendered pages
- Agent bridge comment insertion
- Bold formatting through the shared bridge
- Text insertion through the shared bridge
- Save round-trip returning DOCX bytes
- Agent panel and timeline parity

The local automation covers Chromium. Firefox/WebKit and keyboard-only checks
remain manual PR-review evidence because the preview deployment is the durable
surface reviewers can reproduce.
