# Engine Core Spike — POC result

Recorded after Milestone 5 Playwright finish line passed. This documents spike
evidence only; it does **not** claim production engine or adapter conformance.

## Playwright finish line

**Command**

```bash
cd packages/core/spike && bun run test:e2e
```

Equivalent:

```bash
cd packages/core/spike && bunx playwright test e2e/poc-finish-line.spec.ts --timeout=30000 --workers=1
```

**URL:** `http://localhost:5199/` (Vite POC dev server, strict port 5199)

**Result:** 1 passed (chromium) — load deterministic fixture → edit text → bold
selection → editable/replica convergence → `applyRemoteEdit` → actor-local undo
preserving remote suffix → save → inspect saved `word/document.xml` capsule bytes
→ reopen saved bytes through `EditorDriver.loadDocx` with semantic text,
bold/italic coverage, stable paragraph identity, and exact captured unsupported
capsule substring preservation.

## Supporting verification (same session)

| Check | Command | Result |
| --- | --- | --- |
| Spike unit tests | `bun run test:spike` | pass (608) |
| Spike oracle tests | `bun run test:spike:oracles` | pass (85) |
| Spike typecheck | `bun run typecheck:spike` | pass |
| POC browser build | `bun run build:spike:poc` | pass |
| OpenSpec strict validation | `openspec validate engine-core-spike --strict` | pass |

## Deferred risks (unchanged)

- Production document engine breadth (`document-engine` conformance)
- Former fifteen-gate / oracle re-freeze / synthetic layout / property-fuzz suites
- IME, full selection matrices, annotation anchors, browser/server command parity
- React/Vue adapter parity and production toolbar chrome
- v2 backend migration breadth beyond the one-paragraph POC scope
