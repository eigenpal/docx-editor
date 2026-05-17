# Vue Editor Performance Review (OpenSpec §10.4)

Branch: `1.0.0-release` @ `f5369eb`. **This is static analysis, not a profile run.**
The §10.4 task asks to "profile against a 200-paragraph fixture, compare to React"
and design.md Decision 16 specifies four scripted budgets (cold-start TTI ≤1500ms p95,
input-latency p95 within 10% of React, save round-trip within 5%, scroll-FPS ≥50).
None of the `scripts/perf/` files exist yet and no run is logged under `notes/perf/`.
This pass reasons about what a profile _would_ surface from source — it cannot
replace the actual measurement. Treat the verdict accordingly.

## Findings

1. **`packages/vue/src/components/BasicToolbar.vue:320-338`** — `ctx` computed
   reads `props.stateTick` and calls `extractSelectionContext(view.state)`.
   `stateTick` is bumped by `onSelectionUpdate` in `DocxEditorVue.vue:277-281`,
   which fires on **every** PM transaction (selection _and_ doc changes — see
   `useDocxEditor.ts:311`). For a 200-paragraph fixture with the cursor mid-doc,
   `extractSelectionContext` does a `doc.forEach` walk (`selectionTracker.ts:67`)
   that runs ~100 iterations per keystroke before its early-exit. **Severity:
   medium.** A profile would show `ctx` and its `currentAlignment` /
   `currentStyleLabel` / `inList` consumers re-running every keystroke.
   Mitigation: gate on `state.selection.eq()` + `state.doc.eq()` like the
   selectionTracker plugin already does at `selectionTracker.ts:255` — only
   bump `stateTick` when something the toolbar cares about changed.

2. **`packages/vue/src/components/BasicToolbar.vue:389-412`** — five separate
   `current*` computeds each call `readMarkAttr()`, which calls
   `getMarksFromState()` _separately_ — five independent traversals of
   `$from.marks()` (or `nodesBetween` at line 377 for non-empty selections)
   per keystroke. **Severity: medium.** A profile would show duplicated
   mark-walk overhead. Mitigation: one computed returning `{ fontFamily,
fontSize, textColor, highlight }` from a single `getMarksFromState()` call.

3. **`packages/vue/src/composables/useDocxEditor.ts:294`** —
   `cursorMarks.value = marks.map((m) => ({ name, attrs: { ...m.attrs } }))`
   allocated a new array + per-mark object + attrs spread on every transaction.
   It was exposed via the composable and threaded as a prop into
   `BasicToolbar`, but BasicToolbar never read it. **Fixed in this PR**: the
   ref, the per-transaction marks-extraction block, the composable return key,
   and the BasicToolbar prop are all gone. Removed ~25 lines of dead plumbing.

4. **`packages/vue/src/components/DocxEditorVue.vue:156-188`** — 30+ component
   imports at top-of-file. Every dialog (FindReplaceDialog, InsertTableDialog,
   InsertImageDialog, HyperlinkDialog, InsertSymbolDialog, ImagePropertiesDialog,
   PageSetupDialog, DocumentOutline, KeyboardShortcutsDialog) is eagerly
   imported but gated behind `v-if="show*"` flags (`:36-122`) and never renders
   until the user clicks a toolbar button. **Severity: medium.** A profile
   would show this primarily in cold-start TTI (Decision 16's first budget)
   and bundle size. Mitigation:
   `defineAsyncComponent(() => import('./FindReplaceDialog.vue'))` per dialog —
   one line per import.

5. **`packages/vue/src/composables/useDocxEditor.ts:296-308`** — every
   `transaction.docChanged` runs `runLayoutPipeline` (full re-measure +
   re-layout + DOM rebuild) **and** `fromProseDoc(newState.doc, document.value)`
   to compute `updatedDoc` for the `onChange` emit. The layout re-render is
   unavoidable for WYSIWYG fidelity, but `fromProseDoc` re-walks the entire
   doc on every keystroke regardless of whether the consumer's `onChange`
   actually does anything with the result. **Severity: medium-high.** A
   profile would show this as a major contributor to input-latency
   (Decision 16's second budget). Mitigation: debounce the `onChange` emit
   (e.g. trailing 100ms or `requestIdleCallback`) — autosave / dirty tracking
   don't need keystroke granularity. Cross-check against React's
   `PagedEditor.tsx` to see if it already debounces.

6. **`packages/vue/src/components/DocxEditorVue.vue:1244, 581-587`** — global
   `mousemove` on `window` for drag-to-select, always attached. The handler
   short-circuits on `if (!isDragging || dragAnchor === null) return` at line
   582 before doing real work. **Severity: low.** A profile would show ~1µs
   per move during non-drag. Cleaner: attach on mousedown, detach on mouseup
   like `AgentPanel.vue:193-195` does for `pointermove`. Not measurable.

7. **`packages/agent-use/src/vue/components/AgentChatLog.vue:16-32`** —
   `v-for="m in messages"` renders all messages every update. No
   virtualization. **Severity: low (parity).** The React side at
   `packages/agent-use/src/react/components/AgentChat.tsx:289` uses
   `messages.map(...)` with no virtualization either — parity match, not a Vue
   regression. Out of scope for §10.4 (compare to React); flag as future work
   for both adapters.

## Negative-confirmation sections

- **No findings — `useDocxEditor.ts:189-239` (layout pipeline).** Expensive but
  unavoidable; `Document` and `EditorView` are correctly `shallowRef` per §10.1.
- **No findings — `DocxEditorVue.vue:1052-1077` (`extractCommentsAndChanges`).**
  Does a full `pmDoc.descendants(...)` walk, but only on sidebar-open (`:752`),
  document-load (`:288, 299, 309`), and accept/reject change (`:1194, 1211`).
  Not in any hot path.
- **No findings — `useZoom.ts`, `useTableSelection.ts`, `useAutoSave.ts`.** Cheap
  computeds, manager-snapshot subscriptions. Nothing hot.
- **No findings — `AgentPanel.vue` pointermove listener (`:193-195`).** Attached
  on pointerdown, detached on pointerup. Correct.
- **No findings — `AgentTimeline.vue`.** Caps at `maxVisibleCalls=3` (`:97, 126`);
  `toolCalls.slice(-3)` is trivial.
- **No findings — `AgentComposer.vue`, `useAgentBridge.ts`.** One `canSend`
  computed; one bridge `computed`. Same shape as React's `useMemo`.
- **No findings — `selectedImage` shallowRef.** Confirmed §3.4 contract holds.
  No consumer mutates `selectedImage.value.*` in place — values are set
  wholesale at `DocxEditorVue.vue:526-531, 929-934`. Identity-stable reads
  downstream are safe.
- **No findings — `flush:'post'` watchers.** §10.1 already fixed
  `AgentChatLog.vue` (`:101-110`) and `AgentPanel.vue` (`:147-158`). No other
  DOM-measuring watchers exist in `DocxEditorVue.vue` — selection overlay runs
  in `onSelectionUpdate` callback, not a watcher.

## What to measure first

When §10.4 scripts get written, three concrete recordings would validate or
refute the findings above:

1. **Chrome DevTools Performance recording during a 200-keystroke session
   into a paragraph mid-fixture.** Load the 200-paragraph corpus, click into
   paragraph ~100, hold a key. Record 3 seconds. Look for: time-in-
   `extractSelectionContext`, time-in-`fromProseDoc`, time-in-`runLayoutPipeline`,
   GC pause frequency. Validates findings 1, 2, 5.
2. **Vue DevTools component-render profile during the same session.** Toggle
   "Highlight updates" — confirm whether `BasicToolbar` re-renders every
   keystroke (finding 1) and whether the `current*` computeds dirty-flag
   independently (finding 2). Run the same trace on React DevTools Profiler
   against the React adapter for direct comparison.
3. **Cold-start TTI from `bun run dev` mount → first paint of page 1**, with
   `large.docx` autoloaded. Lighthouse or `performance.mark`. Record bundle
   size before/after `defineAsyncComponent` on dialogs (finding 4). The
   ≤1500ms p95 budget in Decision 16 needs a baseline before it can fail or pass.

## Verdict

**Ship as-is for 1.0.0**, queue findings 1, 2, 4, 5 as a follow-up perf PR
once §10.4 measurement scripts land. Findings 3, 6, 7 are either no-action or
parity with React. Without a profile run, the medium-severity items remain
_plausibly_ hot — calling them blocking would be guessing. The next step is
the cold-start + input-latency scripts described in Decision 16, not more
static analysis.
