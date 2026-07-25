# Browser and platform evidence matrix

Frozen for `interactive-paginated-editing` task 1.5. Claims below reflect **executable CI**
automation and recorded manual evidence only. Unsupported platforms are explicitly out of scope
until listed here with tooling and acceptance criteria.

**Claim hierarchy:** M3–M6 record **internal/preview alpha** only. The **first formal public
`interactive-paginated` claim** is task **8.10** after async layout, virtualization, and
performance gates.

## Required first gate (automation)

| Evidence lane | Tooling | What it proves today | Status |
| --- | --- | --- | --- |
| Production adapter load/paginate/save/reopen | Playwright `Desktop Chrome` via `bun run verify:real-adapter-smoke` — config `e2e/editor-smoke.config.ts`, specs `e2e/react-real-adapter.smoke.spec.ts` and `e2e/vue-real-adapter.smoke.spec.ts`, helper `e2e/realAdapterSmoke.ts`, route `?realAdapter=1` | Public `@docx-editor.dev/react` and `@docx-editor.dev/vue` entries load a fixture, paint paginated `[data-page-index]` output, report editability, `save()` returns bytes, and save+reopen preserves text through the stable `EditorDriver` API | **Required CI gate** |
| Production adapter hidden input-host falsification | Playwright `Desktop Chrome` via `bun run verify:real-adapter-gate` — config `e2e/editor-smoke.config.ts`, specs `e2e/react-real-adapter.gate.spec.ts` and `e2e/vue-real-adapter.gate.spec.ts`, helpers `e2e/realAdapterGate.ts` + `e2e/realAdapterGateHelpers.ts`, route `?realAdapter=1` (+ optional `&zoom=`) | Public adapters expose one attached editable owner; painted pages are presentation-only; clip shell is attached/opacity-hidden/pointer-transparent/bounded; `authorizeCaret` (`setSelection` + `focus`) places shell on engine caret; trusted keyboard/composition input commits once; undo/scroll/relayout/zoom keep `placementReason==='applied'` aligned with `caretClientRect()`; save/reopen round-trips | **Required CI gate** (task 4.8) |
| Engine-editor accessibility-tree gate | `bun run verify:a11y-tree` — `packages/engine-editor/e2e/accessibility-tree.spec.ts` + Lighthouse harness | Single canonical editable owner; painted pages assistive-hidden; canonical text once in tree; trusted keyboard/composition on direct harness | **Required CI gate** (task 4.7) |
| Diagnostic split-mode edit smoke | Same Playwright config, specs `e2e/react-editor.smoke.spec.ts` and `e2e/vue-editor.smoke.spec.ts`, helper `e2e/editorSmoke.ts`, route `?edit=1` | Keyboard typing, undo/redo, and canonical commit through the **visible/hidden ProseMirror diagnostic pane** beside paginated preview; **not** the one-surface paginated interaction path | CI runs, **non-interactive-paginated evidence only** |

Chromium desktop is the only platform that may block merge for the production-adapter
lanes above until additional rows are ratified and wired into CI.

## Future named lanes (not automated until tasks land)

| Lane name | Task gate | Automated tooling (planned) | Manual tooling (planned) | Exact requirements | Status |
| --- | --- | --- | --- | --- | --- |
| **React one-surface alpha** | M3 (`M3.1`, `6.2`, `6.4`, `M2.3`) | `bun run test:e2e:react-one-surface-interaction` — **11 scenarios, all passing** | `openspec/changes/interactive-paginated-editing/evidence/m3/manual-chrome-checklist.md` on `http://localhost:5273/?realAdapter=1` after `bun run dev:react -- --port 5273 --strictPort` (vite binds IPv6 `[::1]`, so `127.0.0.1` refuses the connection) | `[data-testid="one-surface-click-target"]` center click → type/backspace → shift/double/drag → keyboard nav → paste → real CDP IME composition → undo/redo → **`Editor.save()`** reopen; no `authorizeCaret`-only proof | **AUTOMATED — passing (M3, 2026-07-25)** |
| **React one-surface alpha + polished shell** | M4 (`M4.0`–`M4.7`, `M4-R1`–`M4-R3`) | M3 spec regression; `bun run api:check` after M4.0 | `openspec/changes/interactive-paginated-editing/evidence/m4/inventory.md`, `openspec/changes/interactive-paginated-editing/evidence/m4/demo-boundary.md`, `openspec/changes/interactive-paginated-editing/evidence/m4/manual-chrome-shell.md` on `http://127.0.0.1:5273/?realAdapter=1` | M3 matrix passes; `Editor.can({ type: 'toggleMark', mark: 'bold' })` then `Editor.exec({ type: 'toggleMark', mark: 'bold' })`; **`Editor.save()`** for save; rulers via **`Editor.getPageGeometry()`** only; museum Apps reference-only | **Not automated** |
| **Vue one-surface alpha** | M5 (`M5.2`, `6.3`, `M5.1`) | `bun run test:e2e:vue-one-surface-interaction` — **11 scenarios, all passing** | `openspec/changes/interactive-paginated-editing/evidence/m5/verification-log.md` on `http://localhost:5274/` (vite binds IPv6 `[::1]`, so `127.0.0.1` refuses) | Same deterministic target + matrix as React | **AUTOMATED — passing (M5, 2026-07-25)** |
| **Paired bounded-document preview alpha** | M6 (`6.5`, `6.6`, `M6.1`, `M6-R1`, `M6-R2`) | `bun run test:e2e:paired-one-surface-interaction` — **7 scenarios comparing the adapters TO EACH OTHER, all passing** | `openspec/changes/interactive-paginated-editing/evidence/m6/manual-chrome-paired.md` on React `http://localhost:5273/` and Vue `http://localhost:5274/` (both now default, no query parameter) | Identical bounded-document matrix both adapters; demo off diagnostic split; **public manifest below `interactive-paginated`** | **AUTOMATED — passing (M6, 2026-07-25)** |
| **Formal public interactive-paginated** | **8.10** (after **7.x** + **8.1–8.9**) | Expanded paired specs + benchmark harness | `openspec/changes/interactive-paginated-editing/evidence/m8/benchmark.md` | Async coherence, virtualization, ratified 300–500-page budgets | **Not claimed** |

## Not yet automated (explicit gap)

| Claim | Current status |
| --- | --- |
| Direct pointer click/drag on the **paginated interaction surface** | **Both adapters: automated and passing**, and proven IDENTICAL by `test:e2e:paired-one-surface-interaction`. Still does not satisfy public `interactive-paginated` — that remains task **8.10** after async layout, virtualization, and the performance budgets |
| Typed editing on the **paginated interaction surface** (caret on painted pages) | **Both adapters: automated and passing** — a click places the caret, typing commits to the canonical model and repaints, and the resulting **painted text** is identical across adapters after a save-and-reopen round trip (`test:e2e:paired-one-surface-interaction`). This previously read "byte-identical across adapters", which no artifact supported: the paired spec compares painted `textContent`, not saved bytes or a checksum. Still does not satisfy public `interactive-paginated` |
| Clipboard paste initiated from the paginated surface | **Automated in both adapters** — React/Vue one-surface specs and the paired spec. Cut/copy from the painted surface remain **not automated**. |
| Keyboard navigation derived from engine page/line geometry on the paginated surface | **Automated in both adapters** — ArrowRight/Left/End/Home from a clicked caret, React and Vue one-surface specs |
| Caret placement after mid-word insert at paragraph start via painted surface | **Not claimed** — gate uses end-of-paragraph trusted input |
| Public **`interactive-paginated`** body-paragraph claim | **Not claimed** — first formal claim at task **8.10** only |

Diagnostic split-mode keyboard smoke (`?edit=1`) MUST NOT upgrade any row in this
table to `interactive-paginated`.

## Deferred gates (not CI-blocking yet)

| Surface | Tooling | Scope | Status |
| --- | --- | --- | --- |
| Desktop Firefox | Playwright (manual/local) | Production adapter lanes only until paginated interaction suite exists | Manual evidence only |
| Desktop WebKit (Safari) | Playwright (manual/local) | Production adapter lanes only until paginated interaction suite exists | Manual evidence only |
| Mobile Safari / iOS | Manual device or BrowserStack (not in repo) | Virtual keyboard, touch caret, scroll | **Unsupported claim** |
| Mobile Chrome / Android | Manual device or BrowserStack (not in repo) | Virtual keyboard, touch caret, scroll | **Unsupported claim** |
| IME composition (CJK) | Manual Chromium + later dedicated suite | Real candidate UI on paginated surface | **Not claimed** — gate uses synthetic lifecycle only |
| Screen reader / a11y tree (Firefox/WebKit/mobile) | Manual VoiceOver/NVDA + later automated tree checks | Single coherent document, focus, selection | Chromium harness + adapter gate only |

## Evidence categories vs platform

| Category | Chromium desktop (required) | Firefox/WebKit (deferred) | Mobile (unsupported) |
| --- | --- | --- | --- |
| Load / paginated paint / save / reopen (production adapters) | `verify:real-adapter-smoke` via `?realAdapter=1` | Manual | Not claimed |
| Hidden input-host mechanism (production adapters) | `verify:real-adapter-gate` via `?realAdapter=1` | Manual | Not claimed |
| React one-surface alpha (painted-page pointer/type) | Planned `test:e2e:react-one-surface-interaction` | Not claimed | Not claimed |
| Vue one-surface alpha | Planned `test:e2e:vue-one-surface-interaction` | Not claimed | Not claimed |
| Paired preview alpha (M6) | Planned `test:e2e:paired-one-surface-interaction` | Not claimed | Not claimed |
| Formal public `interactive-paginated` | Task **8.10** benchmark suite | Not claimed | Not claimed |
| Pointer / click / drag on paginated surface | **Not automated** | Not claimed | Not claimed |
| Typed edit on paginated surface | **Not automated** | Not claimed | Not claimed |
| Keyboard navigation on paginated surface | **Not automated** | Not claimed | Not claimed |
| Clipboard PASTE on paginated surface | Automated (React, Vue, paired) | Not claimed | Not claimed |
| Clipboard cut/copy on paginated surface | **Not automated** | Not claimed | Not claimed |
| Keyboard / undo / redo (diagnostic split `?edit=1` only) | `editorSmoke` — diagnostic, non-interactive-paginated | Manual | Not claimed |
| IME / composition | Synthetic lifecycle in adapter gate only | Manual Chromium only | Not claimed |
| Accessibility traversal | Engine harness + adapter gate (Chromium) | Manual | Not claimed |
| Virtual keyboard | N/A (desktop) | N/A | Not claimed |

## Honesty rules

- Paginated preview repaint plus production-adapter load/save/reopen satisfies **`rendered`**
  pipeline evidence only; it does **not** satisfy `interactive-paginated`.
- Task **4.8** approves only the hidden input-host mechanism on **Desktop Chromium**; it does
  **not** claim direct painted-page interaction, public `interactive-paginated`, or feature-WYSIWYG.
- **`authorizeCaret`**, programmatic `setSelection`, hardcoded coordinates, or whitespace clicks
  MUST NOT satisfy one-surface alpha or preview-alpha lanes.
- M3–M6 internal/preview alpha MUST NOT appear in public manifests as `interactive-paginated`.
  The first formal public claim is task **8.10** only.
- Toolbar formatting: `Editor.can` → `Editor.exec` for bold/italic/underline/undo/redo; save:
  **`Editor.save()`** directly.
- Rulers: **`Editor.getPageGeometry()`** only; margin/tab markers omitted or disabled.
- Diagnostic split (`?edit=1`) is not acceptance evidence for `interactive-paginated`.
- Retired `PagedEditor` demo Apps are museum/reference only until M6 demo switch.
- Adding a platform row requires naming runner, fixture set, and pass criteria in this file first.
