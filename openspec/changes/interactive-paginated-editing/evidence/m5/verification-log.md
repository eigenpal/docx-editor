# M5 verification log

Milestone: **M5 — Vue one-surface wiring and shell**
Recorded: 2026-07-25. Branch `spec/greenfield-pipeline`.

| Task | Commit |
| --- | --- |
| 6.3 | `checkpoint-50f6f445` |
| M5.1 | `checkpoint-f196491e` |
| M5.2 | `checkpoint-3c59b526` |

## Gate commands

| Command | Result |
| --- | --- |
| `bun run verify:real-adapter-smoke` | **2 passed** |
| `bun run verify:real-adapter-gate` | **12 passed** |
| `bun run test:e2e:vue-one-surface-interaction` | **11 passed** |
| `bun run test:e2e:react-one-surface-interaction` | **11 passed** (regression) |
| `bun run check:parity-contract` | **Parity check passed** |
| `bun run check:adapter-css-thin` | **Pass** |
| `openspec validate … --strict` | **valid** |
| `git diff --check` / `git diff --cached --check` | **clean** |
| `bun run typecheck` | Fail — unchanged pre-existing `@docx-editor.dev/nuxt` TS5097 |

Every package typechecks individually: `engine-editor`, `engine-binding`,
`engine-layout`, `engine-core`, `react`, `vue`, `engine-output`.

## Two real defects this milestone surfaced

### 1. The input host never followed the caret on scroll

`verify:real-adapter-gate` dropped from 12/12 to 11/12 on the scenario "undo,
scroll, and explicit relayout preserve applied placement and semantic identity".

Measured in Chrome: after `scrollTop = 48`, the caret client rect moved from
y=304 to y=256 while the input host stayed at y=304 — a 48px drift, exactly the
scroll distance. The gate requires the two within 3px.

The engine re-placed the input host on selection and layout changes but never on
scroll, and scrolling moves the caret in client space without touching either.
**The gate previously passed vacuously**: before the M4 shell, the harness had
its own scrolling wrapper, so `scrollTop` on `docx-editor-scroll` moved nothing
and the assertion compared two unchanged rectangles. The shell made that element
genuinely scrollable and exposed a latent defect.

Fixed in `create-editor`: the engine watches its scroll container and re-places
the host, because the engine owns input-host policy and every adapter would
otherwise have to remember to.

### 2. `check:parity-contract` was measuring nothing

It failed with `Could not locate DocxEditorRef in docs/api/docx-editor-vue/index.api.md`.
This was **not** snapshot staleness. Two separate causes:

- The checker looked for `export type DocxEditorRef ` — the retired alias form
  (`type DocxEditorRef = EditorRefLike & { ... }`). The greenfield Vue rebuild
  declares a plain `interface`, matching React, which is *stricter* parity. The
  checker now accepts either and only reports null when both are absent.
- The contract itself was pre-greenfield: it enumerated ~44 props and ~21 ref
  methods (`documentBuffer`, `commentsSidebarOpen`, `externalPlugins`,
  `showRuler`, `print`, `scrollToCommentId`, …) that neither adapter has
  exported since the strip at `checkpoint-701c1a9f`. Nearly every entry reported as missing
  from **both** sides — the gate was measuring a package that no longer exists.

Rewritten to the real surface, and the checker's field extractor now accepts
method-style members (`getEditor(): Editor | null`) as well as property-style
ones. It previously matched only `name:`, so a ref **method** could be added or
dropped on one adapter and the gate would not notice.

Neither preserve-listed API snapshot was touched: both fixes are in tracked
files (`scripts/check-parity-contract.mjs`, `scripts/parity/parity.contract.json`).

## Adapter parity as it now stands

| Surface | React | Vue |
| --- | --- | --- |
| `DocxEditorRef` members | `exec, focus, getDocumentHandle, getEditor, load, save, snapshot` | identical |
| `DocxEditorProps` paired | `author, document, locale, mode, zoom` | identical |
| React-only declarations | `className`, `onChange`, `onReady` | Vue uses native `class` fallthrough and `change`/`ready` **emits** — the capability exists on both, only the declaration differs |

## Vue interaction scenarios

All 11 passed **on the first run**, with no Vue-specific debugging. Vue consumes
the same event bridge, overlay geometry, and click target as React, so the bugs
M3 found (pointermove `button: -1`, the click that concludes a drag) were fixed
once and Vue never had them.

## Gate status

| M5-R1 requirement | Status |
| --- | --- |
| `verify:real-adapter-smoke` | Pass |
| `verify:real-adapter-gate` | Pass |
| `test:e2e:vue-one-surface-interaction` | Pass |
| `check:parity-contract` | **Pass — after repairing a gate that measured nothing** |
| `bun run typecheck` | Fail — pre-existing nuxt TS5097, outside this change |
| Strict validation, diff checks | Pass |
