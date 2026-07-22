# Vue reactivity model — what we use today

This is the per-decision answer to spec §3.3: "Identify the reactivity model
#245 uses (ref vs reactive vs shallowRef for ProseMirror state)".

## Summary

| Owner                                    | What it holds                                     | Reactivity primitive                   | Why                                                  |
| ---------------------------------------- | ------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `useDocxEditor.ts`                       | `Document` (parsed model)                         | `shallowRef`                           | Tree-shaped, reassigned wholesale on each parse      |
| `useDocxEditor.ts`                       | `EditorView` (PM view)                            | `shallowRef`                           | Opaque PM internals — must not be proxied            |
| `useDocxEditor.ts`                       | `EditorState` access                              | _not stored_                           | Re-read via `view.state` on every transaction        |
| `useDocxEditor.ts`                       | `cursorMarks`                                     | `ref<Array>`                           | Flat snapshot, recomputed on each transaction        |
| `useDocxEditor.ts`                       | `isReady`, `parseError`                           | `ref<boolean>` / `ref<Error>`          | Primitives; no proxy cost                            |
| `DocxEditorVue.vue`                      | `comments`, `trackedChanges`, `outlineHeadings`   | `shallowRef<Array>`                    | Document-shaped trees, always reassigned             |
| `DocxEditorVue.vue`                      | `selectedImage`                                   | `shallowRef<{ element: HTMLElement }>` | Identity comparisons must see the raw DOM node       |
| `DocxEditorVue.vue`                      | UI flags (`showSidebar`, `showFindReplace`, etc.) | `ref<boolean>`                         | Trivial state                                        |
| `useAutoSave.ts`                         | `status`, `lastSaveTime`, `hasRecoveryData`       | `ref`                                  | Primitives + Date                                    |
| `useTableSelection.ts`                   | `selection`                                       | `ref`                                  | Small POJO, mutated in place rarely                  |
| Agent UI (`packages/agent-use/src/vue/`) | All panel state — width, drag, expanded           | `ref<primitive>`                       | No tree shapes; all primitives                       |
| Agent UI                                 | `messages` (consumer-side)                        | _consumer choice_                      | Library accepts any `MaybeRef<AgentMessage[]>` shape |
| `useAgentBridge.ts`                      | `bridge`                                          | `computed`                             | Mirrors React `useMemo([editorRef, author])`         |

## What's deliberately absent

- **`reactive()`** — never used. Vue's shallow reactive primitives (`shallowRef`,
  `shallowReactive`) cover every use site without the `reactive()` deep-proxy
  tax. Adding `reactive()` later would require a global decision; until
  then, the codebase stays consistent.
- **`triggerRef()`** — design Decision 6 mentions it as a tool for forcing
  re-render after in-place mutation of a `shallowRef`'s contents. The
  current code never mutates a `shallowRef`'s value in place — every
  update reassigns `.value` — so `triggerRef` isn't needed. If a future
  hot-path optimization wants in-place mutation on `Document` or
  `comments`, it would land alongside `triggerRef`.
- **`markRaw()`** — never used. We don't pass non-reactive instances
  (PM `EditorView`, third-party SDK clients) into `reactive()` containers
  where escape hatches would be needed.
- **`watchEffect()`** — not used in the agent UI or editor surface. All
  watchers are explicit `watch([...sources], cb, { flush })` so the
  dependency set is visible and ordering is deterministic.

## Watcher flush policy

DOM-coupled effects use `{ flush: 'post' }` — see `AgentPanel.vue:140`
(close transition class) and `AgentChatLog.vue:91-101` (auto-scroll on new
messages). Pre-flush watchers run before DOM updates and would read stale
layout, so the contract for any effect that reads or measures the DOM is:
post-flush, no `nextTick` dance.

## Compliance with design.md

The proposed contract in `design.md` Decision 5/6 says: shallowRef on the
PM `Document` and `EditorView`; `triggerRef` if we ever mutate in place.
We honor part 1 (shallowRef on both) and dodge part 2 by always
reassigning. The audit at `notes/reactivity-review.md` enumerates the few
remaining sites that should also be `shallowRef` (now applied in the
follow-up patch) — after which every tree-shaped piece of state in the
adapter follows the contract.

## What contributors should remember

1. **PM types are opaque.** Never wrap an `EditorView`, `EditorState`,
   `Transaction`, or `Plugin` in `ref()` / `reactive()`. Use
   `shallowRef` if the value needs reactivity, otherwise hold it in a
   plain `let` inside `<script setup>`.
2. **Document-shaped data is shallow.** Anything matching the shape
   `{ paragraphs: [...] }` or that quacks like a Document — use
   `shallowRef` and reassign on change.
3. **DOM-coupled watchers are post-flush.** If your watcher reads or
   triggers layout, write `{ flush: 'post' }` so the DOM is settled.
4. **Listeners pair with `onBeforeUnmount`.** Every `addEventListener` /
   `setInterval` / `subscribe` has a matching cleanup. Audit confirmed
   this holds today.
5. **No `reactive()`** — keep the codebase shallow-only until there's a
   measured reason to add deep reactivity.
