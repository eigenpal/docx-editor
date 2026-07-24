# Hidden input-host prototype evidence (task 4.3)

Status: **prototype only** — browser approval is deferred to task **4.8**. This record
documents the selected clipping/repositioning technique and the platform questions the
4.8 falsification gate must answer.

## Selected technique

The production edit surface mounts ProseMirror inside a **fixed-position clip shell**
(`packages/engine-binding/src/input-host.ts`):

1. A zero-footprint root (`position: fixed; width: 0; height: 0`) stays attached to the
   adapter-provided mount parent — **not** `display: none`, **not** detached.
2. A child clip shell (`overflow: hidden`, bounded non-zero `width`/`height`, `clip-path:
   inset(0)`) is repositioned in **client coordinates** near the engine caret rectangle.
3. **Visual hiding uses `opacity: 0` on the clip shell** — the host remains attached,
   non-`display:none`, and programmatically focusable; PM text is not visibly duplicated on
   the painted page surface. **4.8 must falsify** whether opacity-hidden content still leaks
   to assistive technology or IME candidate UI in unintended ways.
4. **`pointer-events: none` on root, clip shell, and mount** so painted-page clicks are not
   intercepted; focus/keyboard/composition remain programmatic. **4.8 must falsify** whether
   platforms still route IME/clipboard correctly when pointer hit targets are disabled.
5. ProseMirror mounts into the clip shell's inner mount node (`role="textbox"`,
   `tabindex="-1"`).
6. Minimum input bounds: **2×16 CSS px** so the host is never zero-size.
7. Placement clamps into a deterministic viewport rect supplied by the editor host scroll
   container (or typed fallback rect).
8. Styles are applied exclusively through `element.style.setProperty` — no file-derived
   HTML/CSS string interpolation.

Placement accepts only caret geometry whose **interaction frame identity matches** the
currently published frame. Stale, pending, read-only, and no-caret cases retain the last
safe bounded rectangle and report a typed placement reason (`staleFrame`, `pendingLayout`,
`readOnly`, `noCaret`, `fallback`).

## Assistive-document policy (prototype)

Until task **4.6** lands the engine semantic/accessibility projection:

- The hidden ProseMirror input host is the **sole accessible editing projection**.
- The controller exposes `data-assistive-policy="sole-editing-projection"` and
  `data-painted-pages-assistive-role="presentation"` so adapters mark painted pages as
  presentation-only and do **not** expose a second editable document to assistive technology.
- The mount node carries `role="textbox"`; painted output must not also declare document
  editing semantics (verified in unit tests; adapter wiring lands in task 6).

## Semantic selection sync (task 4.2)

PM-free APIs in `packages/engine-binding/src/semantic-sync.ts` resolve reviewed
`SemanticTarget` / `SemanticSelection` values to store-backed anchors using **canonical
traversal ownership** (table cells and structural blocks reject even when callers omit
roles). `EditSurface` applies the ProseMirror selection **before** focus, retains semantic
intent only after successful PM dispatch, clears retained intent on local edits/history,
and preserves intent across blur/owned-popup/external reconciliation. Invalid/read-only/stale
targets return typed rejections rather than stale PM positions.

## Browser hypotheses requiring task 4.8 evidence

| Hypothesis | Why it matters | Current status |
| --- | --- | --- |
| **`opacity: 0` hides duplicate visible PM text without breaking focus/IME** | Core visual-hiding bet | Unit-tested inline styles only |
| **`pointer-events: none` prevents hit interception while preserving keyboard/IME** | One-surface click routing | Unit-tested `elementFromPoint` only |
| IME candidate UI anchors near the repositioned clip shell on **Desktop Chromium** | CJK input viability | **Not measured** |
| Composition survives layout repaints without duplicate/dropped text | Task 4.4 suite | **Not measured** |
| Virtual keyboard placement tracks the caret on **mobile Safari/Chrome** | Mobile matrix | **Not claimed** |
| Focus transfer from painted-page click reaches hidden host with synced selection | Task 6 wiring | **Not automated** |
| Scroll/zoom reposition every frame without focus loss | Adapter lifecycle | **Not measured** |
| Accessibility tree exposes **one** coherent editable document | Task 4.7 | **Measured (Chromium harness)** — 9/9 Playwright a11y-tree specs pass; painted pages `aria-hidden`; one `[contenteditable="true"]` owner; canonical text appears once in `ariaSnapshot`; Lighthouse accessibility score **1.0** on harness |
| Clipboard/beforeinput when host is viewport-clamped at edges | Task 4.5 | **Not measured** |

## Chromium accessibility-tree evidence (task 4.7)

Harness: `packages/engine-editor/browser/` (production `createEditor`, hidden PM host,
positioned painted pages, localized Spanish fixtures). Tests:
`packages/engine-editor/e2e/accessibility-tree.spec.ts`.

### Reproducible commands (2026-07-24)

```bash
# Bounded Chromium accessibility-tree gate (Playwright + Lighthouse; does not run general E2E)
cd packages/engine-editor && bun run verify:a11y-tree

# Playwright only
cd packages/engine-editor && bun run test:e2e:a11y-tree

# Lighthouse harness wrapper (starts/waits/stops Vite on 127.0.0.1:5299 when needed)
cd packages/engine-editor && bun run test:lighthouse:a11y-harness

# Focused unit coverage for this task
bun test packages/engine-editor/test/set-selection.test.ts packages/engine-editor/test/lighthouse-a11y-gate.test.ts
bun test packages/engine-binding/test/input-events.test.ts -t "Shift-ArrowRight"
```

### Measured results (2026-07-24)

| Gate | Result |
| --- | --- |
| Playwright `accessibility-tree.spec.ts` | **9/9 passed** (~2.5s, 1 worker, Chromium) |
| Lighthouse accessibility score | **1.0** (`failedAuditIds: []`) |
| `set-selection` unit test | **pass** |
| `lighthouse-a11y-gate` unit test | **pass** |
| `Shift-ArrowRight` binding unit test | **pass** |
| `packages/engine-editor` typecheck | **pass** |
| `git diff --check` | **pass** (no whitespace errors) |

Lighthouse summary written to
`packages/engine-editor/test-results/lighthouse/a11y-harness-lighthouse-summary.json`:

```json
{
  "url": "http://127.0.0.1:5299/",
  "accessibilityScore": 1,
  "failedAuditIds": [],
  "failedAuditTitles": [],
  "note": "Harness-only audit; app-shell issues outside this change are not claimed fixed."
}
```

CI: `.github/workflows/ci.yml` runs `bun run verify:a11y-tree` after `bunx playwright install chromium`
(without starting the full editor-smoke E2E suite).

| Check | Chromium result |
| --- | --- |
| Single canonical editable owner | One `[contenteditable="true"]`; zero `[role=document]` landmarks |
| Painted pages assistive-hidden | Container + children `aria-hidden="true"`, `presentation-only` marker |
| Canonical text once in tree | `ariaSnapshot` on mount counts one occurrence per paragraph string |
| Reading order / empty / Unicode | Full mount `ariaSnapshot` matches `- paragraph: primera línea` / empty / Unicode; observation entries `['primera línea', '', 'café ñ 日本語']` |
| Localized name | `aria-label="Documento de prueba"` when supplied; attribute absent when omitted |
| Editable vs view mode | Editable focus authorized; view mode `contenteditable="false"`, focus rejected |
| Read-only atoms | `role="img"` + localized `aria-label`; perceivable via `getByLabel` |
| Focus + native selection | After `setSelection` + `focus()` + trusted `Shift+ArrowRight` ×3: non-collapsed selection with exact block id and grapheme offsets **0→3** |
| Accepted native input | `setSelection` caret + `focus()` + Playwright `type('Z')`; revision increases; one owner; one tree text instance |
| Composition lifecycle | `compositionstart` → trusted `type('X')` → `compositionupdate` → `compositionend`; revision increases; one owner throughout |
| Lifecycle coherence | After blur, accepted input, composition, external reload, relayout, container swap, and destroy: `ariaSnapshot` + owner count **1** (or **0** after destroy) with no duplicate editable state |
| Stable snapshot | `- paragraph: primera línea` / empty paragraph / `- paragraph: café ñ 日本語` |

Public `setSelection` exec maps to `EditSurface.syncSemanticSelection` (frame-bound semantic targets);
harness uses this path to authorize caret placement before trusted keyboard/composition events.
No PM/view test hooks are exposed to Playwright.

Lighthouse gate: `packages/engine-editor/scripts/lighthouse-a11y-gate.ts` exits non-zero when
accessibility score &lt; 1 or any scored audit has `score &lt; 1`. Wrapper:
`packages/engine-editor/scripts/run-lighthouse-a11y-harness.mjs`.

**4.7 limitations deferred to 4.8:** real browser IME/mobile/virtual-keyboard approval,
public React/Vue adapter builds, and painted-page pointer hit transfer remain unapproved.
Composition tests use synthetic `compositionstart`/`update`/`end` with trusted Playwright
`type()` for the committed glyph (desktop Chromium harness path only).

- No browser/platform approval is claimed before task **4.8**.
- Diagnostic split-pane edit mode (`?edit=1`) is unrelated to this technique and must not
  serve as acceptance evidence.
- Adapter one-surface composition (task 6) is not wired; React/Vue still use retired off-screen
  body-host positioning until that milestone.
