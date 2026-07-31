# Vue Reactivity Audit — 1.0.0-release

Scope: the merged Vue surface in `packages/agent-use/src/vue/**` and `packages/vue/src/**`.
Read against design.md Decisions 5–6 (shallowRef on PM/Document, manual triggerRef
where needed). No code changes proposed here — recommendations only.

## What we use today

The Vue surface leans on `ref` + `computed` almost exclusively, with two correct
uses of `shallowRef` in `useDocxEditor.ts` (the `Document` model and the
`EditorView` instance). There is no `reactive` anywhere, no `markRaw`, and no
`triggerRef` — the design's "shallow + manual trigger" recipe is implemented as
"shallow + treat the PM doc as an opaque pointer that we re-read via `view.state`
on every transaction." DOM-coupled effects use `nextTick(...)` rather than
`watch(..., { flush: 'post' })` (one exception in `AgentPanel.vue`).
SSR/import-time reads are properly guarded behind `typeof window/document`.

## Findings

1. **`packages/vue/src/components/DocxEditorVue.vue:238`** —
   `selectedImage = ref<ImageSelectionInfo | null>(null)` stores an
   `HTMLElement` reference inside a deep `ref`. Vue will wrap the DOM node
   in a reactive Proxy on assignment, which both costs proxy traversal on
   every read and risks subtle behavior changes when the element is later
   compared by identity (e.g. inside `findImageElement` results, or
   `ImageSelectionOverlay`'s prop comparison). **Severity: medium.** Recommended
   fix: `shallowRef`, or store `pmPos` only and look the element up on demand.

2. **`packages/vue/src/components/DocxEditorVue.vue:228-229`** —
   `comments = ref<Comment[]>([])` and
   `trackedChanges = ref<TrackedChangeEntry[]>([])` deeply proxy
   `Comment` objects whose `content` field is a recursive `Paragraph[]`
   tree (same shape as the Document model the design said to keep shallow).
   The list is rebuilt with `[...doc.package.comments]` on every mutation,
   so per-item proxies are short-lived but rebuilt frequently. **Severity:
   medium.** Recommended fix: `shallowRef` + reassign on edit (the code
   already reassigns rather than mutating in place, so this is a one-line
   swap).

3. **`packages/vue/src/components/DocxEditorVue.vue:237`** —
   `outlineHeadings = ref<HeadingInfo[]>([])` is rebuilt wholesale by
   `collectHeadings(view.state.doc)` and never mutated in place.
   **Severity: low.** Recommended fix: `shallowRef` for symmetry with #2.

4. **`packages/vue/src/components/DocxEditorVue.vue:1032,1124,1142,1151,1160,1169`** —
   `extractCommentsAndChanges()` first assigns `comments.value =
doc.package?.comments ?? []` (aliasing the document's own array), then
   handlers later assign `comments.value = [...doc.package.comments]`
   (cloning) while _also_ mutating `doc.package.comments` (`c.done = true`
   at line 1150, `.push(...)` at 1123/1141, `.filter(...)` at 1168).
   Reactivity still fires because of the reassignment, but the alias-vs-clone
   inconsistency makes intent murky and would break under `shallowRef`
   without an explicit clone. **Severity: low.** Recommended fix: pick one
   pattern (always clone) — orthogonal to #2.

5. **`packages/agent-use/src/vue/components/AgentChatLog.vue:91-101`** —
   the watcher that auto-scrolls to the latest message uses default `flush:
'pre'` and compensates with `nextTick(scrollToEnd)`. Functionally fine,
   but `flush: 'post'` would let the watcher run after the DOM has the new
   bubble and drop the `nextTick`. The `AgentPanel.vue` close-transition
   watcher at line 140 already uses `flush: 'post'` correctly — these two
   should match. **Severity: low.** Recommended fix: `{ flush: 'post' }`,
   remove the inner `nextTick`.

6. **`packages/agent-use/src/vue/components/AgentChatLog.vue:103-119`** —
   `ensureKeyframes()` injects a `<style>` element into `document.head` on
   first mount and never removes it. The ID guard makes it idempotent across
   remounts so this is not a leak per instance, but it does mean the
   stylesheet outlives the component tree. **Severity: low.** Acceptable as
   shipped; flag only if the package is meant to be fully tree-droppable.

7. **`packages/vue/src/composables/useAutoSave.ts:27-29`** —
   `status`, `lastSaveTime`, `hasRecoveryData` are plain `ref`s.
   `lastSaveTime` is a `Date`, which becomes a reactive Proxy. Low cost
   (Dates have no enumerable own props worth tracking) and templates
   typically read `.toISOString()` once. **Severity: low.** Recommended
   fix optional: `shallowRef` for `lastSaveTime`.

8. **No findings — `useDocxEditor.ts`.** `Document` and `EditorView` are
   correctly `shallowRef`. Plain `ref` is used for `isReady`, `parseError`,
   and `cursorMarks` (a small array of `{ name, attrs }` snapshots, rebuilt
   on each transaction — proxying is cheap and reassignment fires properly).

9. **No findings — `useAgentBridge.ts`.** `computed(() =>
editorRef.value ? createEditorBridge(...) : null)` matches the React
   `useMemo([editorRef, author])` shape exactly. `unref(author)` correctly
   normalizes `MaybeRef<string>`. Module-level `TOOL_SCHEMAS` is pure data,
   SSR-safe.

10. **No findings — listener cleanup.** `AgentPanel.vue` (190-194),
    `DocxEditorVue.vue` (1242-1247), `useAutoSave.ts` (74-77),
    `useTableSelection.ts` (27-29) all pair `addEventListener` /
    `subscribe` / `setInterval` with matching `onBeforeUnmount` removal.
    `caretBlinkInterval` in `DocxEditorVue.vue:316,323-326` is also cleared
    on overlay reset and unmount.

11. **No findings — SSR / hydration.** All `window`/`document` reads are
    behind `typeof window/document !== 'undefined'` guards
    (`AgentPanel.vue:118`, `AgentChatLog.vue:105`, `AIContextMenu.vue:105`).
    No module-level DOM access; `DocxEditorVue.vue`'s direct DOM use is
    inside `onMounted` / event handlers only.

12. **No findings — destructuring.** `useZoom()` and `useDocxEditor()`
    return refs/computeds, and call sites in `DocxEditorVue.vue:240-276`
    destructure them at the composable boundary (where Vue's auto-unwrap
    on returned refs preserves reactivity). Nothing destructures
    `props` or a `reactive()` proxy in a way that would lose reactivity.

## Verdict

**Ship as-is for 1.0.0; address #1 and #2 in a follow-up patch PR.** The
design's shallowRef contract is honored where it matters most (the PM
`Document` and `EditorView`); the remaining `ref`-on-tree-shaped-data sites
in `DocxEditorVue.vue` are correctness-safe and only mildly wasteful. None
of the findings are user-visible bugs, and none block the rename train.
