# Browser and platform evidence matrix

Frozen for `interactive-paginated-editing` task 1.5. Claims below reflect **existing**
automation and recorded manual evidence only. Unsupported platforms are explicitly
out of scope until listed here with tooling and acceptance criteria.

## Required first gate (automation)

| Evidence lane | Tooling | What it proves today | Status |
| --- | --- | --- | --- |
| Production adapter load/paginate/save/reopen | Playwright `Desktop Chrome` via `bun run test:e2e:editor` — config `e2e/editor-smoke.config.ts`, specs `e2e/react-real-adapter.smoke.spec.ts` and `e2e/vue-real-adapter.smoke.spec.ts`, helper `e2e/realAdapterSmoke.ts`, route `?realAdapter=1` | Public `@docx-editor.dev/react` and `@docx-editor.dev/vue` entries load a fixture, paint paginated `[data-page-index]` output, report editability, `save()` returns bytes, and save+reopen preserves text through the stable `EditorDriver` API | **Required CI gate** |
| Diagnostic split-mode edit smoke | Same Playwright config, specs `e2e/react-editor.smoke.spec.ts` and `e2e/vue-editor.smoke.spec.ts`, helper `e2e/editorSmoke.ts`, route `?edit=1` | Keyboard typing, undo/redo, and canonical commit through the **visible/hidden ProseMirror diagnostic pane** beside paginated preview; **not** the one-surface paginated interaction path | CI runs, **non-interactive-paginated evidence only** |

Chromium desktop is the only platform that may block merge for the production-adapter
lane above until additional rows are ratified and wired into CI.

## Not yet automated (explicit gap)

| Claim | Current status |
| --- | --- |
| Direct pointer click/drag on the **paginated interaction surface** | **Not automated** — does not satisfy `interactive-paginated` |
| Typed editing on the **paginated interaction surface** (caret on painted pages) | **Not automated** — does not satisfy `interactive-paginated` |
| Clipboard cut/copy/paste initiated from the paginated surface | **Not automated** |
| Keyboard navigation derived from engine page/line geometry on the paginated surface | **Not automated** |

Diagnostic split-mode keyboard smoke (`?edit=1`) MUST NOT upgrade any row in this
table to `interactive-paginated`.

## Deferred gates (not CI-blocking yet)

| Surface | Tooling | Scope | Status |
| --- | --- | --- | --- |
| Desktop Firefox | Playwright (manual/local) | Production adapter lane only until paginated interaction suite exists | Manual evidence only |
| Desktop WebKit (Safari) | Playwright (manual/local) | Production adapter lane only until paginated interaction suite exists | Manual evidence only |
| Mobile Safari / iOS | Manual device or BrowserStack (not in repo) | Virtual keyboard, touch caret, scroll | **Unsupported claim** |
| Mobile Chrome / Android | Manual device or BrowserStack (not in repo) | Virtual keyboard, touch caret, scroll | **Unsupported claim** |
| IME composition (CJK) | Manual Chromium + later dedicated suite | Composition start/update/end, candidate anchoring on paginated surface | Falsification gate task 4.x |
| Screen reader / a11y tree | Manual VoiceOver/NVDA + later automated tree checks | Single coherent document, focus, selection | Falsification gate task 4.x |

## Evidence categories vs platform

| Category | Chromium desktop (required) | Firefox/WebKit (deferred) | Mobile (unsupported) |
| --- | --- | --- | --- |
| Load / paginated paint / save / reopen (production adapters) | `realAdapterSmoke` via `?realAdapter=1` | Manual | Not claimed |
| Pointer / click / drag on paginated surface | **Not automated** | Not claimed | Not claimed |
| Typed edit on paginated surface | **Not automated** | Not claimed | Not claimed |
| Keyboard navigation on paginated surface | **Not automated** | Not claimed | Not claimed |
| Clipboard on paginated surface | **Not automated** | Not claimed | Not claimed |
| Keyboard / undo / redo (diagnostic split `?edit=1` only) | `editorSmoke` — diagnostic, non-interactive-paginated | Manual | Not claimed |
| IME / composition | Not automated | Manual Chromium only | Not claimed |
| Accessibility traversal | Not automated | Manual | Not claimed |
| Virtual keyboard | N/A (desktop) | N/A | Not claimed |

## Honesty rules

- Paginated preview repaint plus production-adapter load/save/reopen satisfies **`rendered`**
  pipeline and interaction evidence only; it does **not** satisfy `interactive-paginated`.
- Diagnostic split edit/preview mode (`?edit=1`) is not acceptance evidence for
  `interactive-paginated`, `feature-wysiwyg`, or any paginated-surface pointer/keyboard row.
- Adding a platform row requires naming the runner, fixture set, and pass criteria
  in this file before implementation claims reference it.
