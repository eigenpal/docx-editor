# Browser and platform evidence matrix

Frozen for `interactive-paginated-editing` task 1.5. Claims below reflect **executable CI**
automation and recorded manual evidence only. Unsupported platforms are explicitly out of scope
until listed here with tooling and acceptance criteria.

## Required first gate (automation)

| Evidence lane | Tooling | What it proves today | Status |
| --- | --- | --- | --- |
| Production adapter load/paginate/save/reopen | Playwright `Desktop Chrome` via `bun run verify:real-adapter-smoke` — config `e2e/editor-smoke.config.ts`, specs `e2e/react-real-adapter.smoke.spec.ts` and `e2e/vue-real-adapter.smoke.spec.ts`, helper `e2e/realAdapterSmoke.ts`, route `?realAdapter=1` | Public `@docx-editor.dev/react` and `@docx-editor.dev/vue` entries load a fixture, paint paginated `[data-page-index]` output, report editability, `save()` returns bytes, and save+reopen preserves text through the stable `EditorDriver` API | **Required CI gate** |
| Production adapter hidden input-host falsification | Playwright `Desktop Chrome` via `bun run verify:real-adapter-gate` — config `e2e/editor-smoke.config.ts`, specs `e2e/react-real-adapter.gate.spec.ts` and `e2e/vue-real-adapter.gate.spec.ts`, helpers `e2e/realAdapterGate.ts` + `e2e/realAdapterGateHelpers.ts`, route `?realAdapter=1` (+ optional `&zoom=`) | Public adapters expose one attached editable owner; painted pages are presentation-only; clip shell is attached/opacity-hidden/pointer-transparent/bounded; `authorizeCaret` (`setSelection` + `focus`) places shell on engine caret; trusted keyboard/composition input commits once; undo/scroll/relayout/zoom keep `placementReason==='applied'` aligned with `caretClientRect()`; save/reopen round-trips | **Required CI gate** (task 4.8) |
| Engine-editor accessibility-tree gate | `bun run verify:a11y-tree` — `packages/engine-editor/e2e/accessibility-tree.spec.ts` + Lighthouse harness | Single canonical editable owner; painted pages assistive-hidden; canonical text once in tree; trusted keyboard/composition on direct harness | **Required CI gate** (task 4.7) |
| Diagnostic split-mode edit smoke | Same Playwright config, specs `e2e/react-editor.smoke.spec.ts` and `e2e/vue-editor.smoke.spec.ts`, helper `e2e/editorSmoke.ts`, route `?edit=1` | Keyboard typing, undo/redo, and canonical commit through the **visible/hidden ProseMirror diagnostic pane** beside paginated preview; **not** the one-surface paginated interaction path | CI runs, **non-interactive-paginated evidence only** |

Chromium desktop is the only platform that may block merge for the production-adapter
lanes above until additional rows are ratified and wired into CI.

## Not yet automated (explicit gap)

| Claim | Current status |
| --- | --- |
| Direct pointer click/drag on the **paginated interaction surface** | **Not automated** — does not satisfy `interactive-paginated` |
| Typed editing on the **paginated interaction surface** (caret on painted pages) | **Not automated** — does not satisfy `interactive-paginated` |
| Clipboard cut/copy/paste initiated from the paginated surface | **Not automated** |
| Keyboard navigation derived from engine page/line geometry on the paginated surface | **Not automated** |
| Caret placement after mid-word insert at paragraph start via painted surface | **Not claimed** — gate uses end-of-paragraph trusted input |

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
| Pointer / click / drag on paginated surface | **Not automated** | Not claimed | Not claimed |
| Typed edit on paginated surface | **Not automated** | Not claimed | Not claimed |
| Keyboard navigation on paginated surface | **Not automated** | Not claimed | Not claimed |
| Clipboard on paginated surface | **Not automated** | Not claimed | Not claimed |
| Keyboard / undo / redo (diagnostic split `?edit=1` only) | `editorSmoke` — diagnostic, non-interactive-paginated | Manual | Not claimed |
| IME / composition | Synthetic lifecycle in adapter gate only | Manual Chromium only | Not claimed |
| Accessibility traversal | Engine harness + adapter gate (Chromium) | Manual | Not claimed |
| Virtual keyboard | N/A (desktop) | N/A | Not claimed |

## Honesty rules

- Paginated preview repaint plus production-adapter load/save/reopen satisfies **`rendered`**
  pipeline evidence only; it does **not** satisfy `interactive-paginated`.
- Task **4.8** approves only the hidden input-host mechanism and paired adapter host wiring on
  **Desktop Chromium** through public adapter builds; it does **not** claim direct painted-page
  interaction, `interactive-paginated`, feature-WYSIWYG, real CJK IME, mobile/virtual keyboard,
  Firefox, or WebKit.
- Diagnostic split edit/preview mode (`?edit=1`) is not acceptance evidence for
  `interactive-paginated`, `feature-wysiwyg`, or any paginated-surface pointer/keyboard row.
- Adding a platform row requires naming the runner, fixture set, and pass criteria
  in this file before implementation claims reference it.
