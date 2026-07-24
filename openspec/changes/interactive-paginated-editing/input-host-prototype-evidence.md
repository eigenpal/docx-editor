# Hidden input-host prototype evidence (tasks 4.3 / 4.8)

Status: **approved on Desktop Chromium for the hidden input-host mechanism only** (task
**4.8**, 2026-07-24 review). Does **not** approve direct painted-page interaction,
`interactive-paginated`, feature-WYSIWYG, real CJK IME, mobile/virtual keyboard, Firefox, or
WebKit.

## Selected technique

The production edit surface mounts ProseMirror inside a **fixed-position clip shell**
(`packages/engine-binding/src/input-host.ts`):

1. A zero-footprint root (`position: fixed; width: 0; height: 0`) stays attached to the
   adapter-provided mount parent — **not** `display: none`, **not** detached.
2. A child clip shell (`overflow: hidden`, bounded non-zero `width`/`height`, `clip-path:
   inset(0)`) is repositioned in **client coordinates** near the engine caret rectangle.
3. **Visual hiding uses `opacity: 0` on the clip shell** — attached, focusable, non-duplicated
   on the painted page surface.
4. **`pointer-events: none` on root, clip shell, and mount** — focus/keyboard/composition remain
   programmatic.
5. ProseMirror mounts into the clip shell's inner mount node (`role="textbox"`, `tabindex="-1"`).
6. Minimum input bounds: **2×16 CSS px**.
7. Placement clamps into the scroll-container viewport from `EditorHost.getInteractionHostMetrics()`.
8. Styles via `element.style.setProperty` only.

After every completed layout publication, `createEditor` **reconciles** the overlay from live PM
selection/focus via `reconcileSelectionOverlayAfterLayout()` so the clip shell does not silently
retain a stale `applied` rectangle when the interaction frame is republished.

`InputHostPlacementReason` is defined once in `@docx-editor.dev/core-contract/interaction`.

## Chromium production-adapter gate (task 4.8)

Harness: `examples/shared/DocxAdapterHarness.{tsx,vue}` via `?realAdapter=1` (+ optional
`&zoom=`). Scroll target: `[data-testid="docx-editor-scroll"]`. Driver: `window.__docxAdapterDriver`
(`createEditorDriver`). Zoom control: `window.__docxAdapterHarness`.

### Reproducible commands (2026-07-24)

```bash
# RED (layout overlay — before reconcileSelectionOverlayAfterLayout)
bun test packages/engine-editor/test/layout-overlay-reconcile.test.ts
# Expected: frame.caret null after relayout; placementReason "noCaret"

# GREEN — layout overlay integration
bun test packages/engine-editor/test/layout-overlay-reconcile.test.ts
# 2/2 pass

# GREEN — paired public-adapter gate (12 tests)
bun run verify:real-adapter-gate

# GREEN — production load/paginate/save/reopen smoke (2 tests)
bun run verify:real-adapter-smoke

# GREEN — task 4.7 regression
bun run verify:a11y-tree

# Focused unit coverage
bun test packages/engine-editor/test/driver.test.ts \
  packages/engine-editor/test/host-metrics.test.ts \
  packages/engine-editor/test/set-selection.test.ts

bun test packages/engine-core/test/adapter-authority.test.ts
openspec validate interactive-paginated-editing --strict
git diff --check
```

### Measured results

| Gate | Result |
| --- | --- |
| `layout-overlay-reconcile.test.ts` | **2/2 pass** |
| `verify:real-adapter-gate` | **12/12 pass** |
| `verify:real-adapter-smoke` | **2/2 pass** |
| `verify:a11y-tree` | **9/9 + Lighthouse 1.0** |
| Unit driver/host-metrics/set-selection | **pass** |
| `adapter-authority.test.ts` | **14/14 pass** |
| Typechecks (engine-editor, react, vue, binding) | **pass** |

### Approval decision

**Approve** hidden input-host mechanism + paired React/Vue host wiring on **Desktop Chromium**.

### Explicit deferrals

- Direct painted-page interaction, `interactive-paginated`, feature-WYSIWYG
- Real CJK IME, mobile/virtual keyboard, Firefox, WebKit
- Diagnostic `?edit=1` route
- Mid-paragraph-start insert caret on painted surface (gate uses end-of-paragraph trusted input)

## Chromium accessibility-tree evidence (task 4.7)

Harness: `packages/engine-editor/browser/`. Command: `bun run verify:a11y-tree`. **9/9 pass**,
Lighthouse **1.0**. See prior sections in git history for harness detail; still required CI
regression alongside 4.8 adapter gates.
