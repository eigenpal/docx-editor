# Inline TOC Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an accessible left-floating manual refresh button for every table of contents and provide identical behavior in React and Vue.

**Architecture:** Core retains advisory staleness comparison, but a shared painter helper decorates every painted TOC boundary with a left-floating pointer control. React and Vue render matching accessible proxy actions outside the painted pages tree and invoke a forced per-position regeneration after painted-pages-ready events.

**Tech Stack:** TypeScript, ProseMirror, shared DOM painter, React, Vue, Bun tests, Playwright.

## Global Constraints

- The refresh control is created for every editable TOC and appears while its boundary is hovered, selection-focused, or represented by keyboard focus.
- Advisory stale detection never hides, disables, or suppresses a user-requested regeneration.
- Runtime stale checks must not mutate PM state, history, OOXML, measurement, or pagination.
- Remove the load-time browser confirmation prompt; retain context-menu and public-ref updates.
- Use shared core logic and shared core CSS; React and Vue adapters remain thin and behaviorally identical.
- Use translated `contextMenu.updateTableOfContents` copy for the accessible proxy's native name and both controls' tooltips.
- The visible control is a 32px white floating action button 8px left of the TOC boundary, using the editor's floating-comment visual language.
- Build DOM with `createElement`/`createElementNS`, datasets, attributes, and `textContent`; never interpolate document-derived values into HTML.

---

## File structure

- Modify `packages/core/src/prosemirror/toc.ts`: expose normalized stale-result comparison while reusing the existing generator.
- Modify `packages/core/src/prosemirror/__tests__/toc.test.ts`: cover result-difference stale detection.
- Create `packages/core/src/painter-model/tocRefresh.ts`: synchronize refresh controls into all painted TOC boundaries.
- Create `packages/core/src/painter-model/tocRefresh.test.ts`: cover DOM creation/removal and accessibility contracts.
- Modify `packages/core/src/painter-model/index.ts`: export the shared synchronization helper.
- Modify `packages/core/src/styles/editor.css`: style the shared refresh control with existing editor tokens.
- Modify `packages/react/src/components/DocxEditor/ContentControlWidgets.tsx`: synchronize and delegate React refresh interactions.
- Modify `packages/react/src/components/DocxEditor.tsx`: pass layout, update action, and translated label.
- Modify `packages/react/src/components/DocxEditor/hooks/useTableOfContentsActions.ts`: remove confirm-based prompting.
- Modify `packages/vue/src/components/ContentControlWidgets.vue`: synchronize and delegate Vue refresh interactions.
- Modify `packages/vue/src/components/DocxEditor.vue`: pass layout, update action, and translated label.
- Modify `packages/vue/src/composables/useTableOfContentsActions.ts`: remove confirm-based prompting.
- Modify `e2e/tests/parity/toc-insertion-update.spec.ts`: verify all-TOC reveal, forced activation, accessibility, and cleanup in both adapters.
- Modify `.changeset/add-toc-regeneration.md`: include the inline refresh affordance in the existing unreleased TOC feature note.

### Task 1: Result-based TOC stale detection

**Files:**

- Modify: `packages/core/src/prosemirror/toc.ts`
- Modify: `packages/core/src/prosemirror/__tests__/toc.test.ts`

**Interfaces:**

- Produces: `findStaleTableOfContentsBlocks(doc: PMNode, layout?: PageLayout | null): TocBlockInfo[]`.
- The function returns existing `TocBlockInfo` values and performs no transaction or mutation.
- Existing `findTableOfContentsBlocks` and `hasTableOfContentsNeedingUpdate` remain backward-compatible.

- [ ] **Step 1: Add failing stale-result unit tests**

Build a current TOC with `updateTableOfContents`, then assert:

```ts
expect(findStaleTableOfContentsBlocks(currentDoc, layout)).toHaveLength(0);
expect(findStaleTableOfContentsBlocks(renamedHeadingDoc, layout)).toHaveLength(1);
expect(findStaleTableOfContentsBlocks(changedLevelDoc, layout)).toHaveLength(1);
expect(findStaleTableOfContentsBlocks(addedHeadingDoc, layout)).toHaveLength(1);
expect(findStaleTableOfContentsBlocks(removedHeadingDoc, layout)).toHaveLength(1);
expect(findStaleTableOfContentsBlocks(changedPageLayoutDoc, changedLayout)).toHaveLength(1);
expect(findStaleTableOfContentsBlocks(unrelatedBodyEditDoc, layout)).toHaveLength(0);
```

Retain explicit assertions that dirty and empty imported fields are stale.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
bun test packages/core/src/prosemirror/__tests__/toc.test.ts
```

Expected: FAIL because `findStaleTableOfContentsBlocks` is not defined.

- [ ] **Step 3: Implement normalized result comparison**

Refactor heading collection/result generation only enough to reuse them. Compare each TOC's current generated paragraphs with desired entries normalized to:

```ts
type TocEntrySignature = {
  text: string;
  level: number;
  href: string | null;
  pageNumber: number | null;
};
```

Preserve dirty/empty detection as an immediate stale reason. When layout is absent, compare heading text/level/href but do not declare a difference solely because page numbers cannot be resolved. Scope desired headings through the TOC instruction's outline range and exclude headings inside all TOCs.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
bun test packages/core/src/prosemirror/__tests__/toc.test.ts
```

Expected: PASS.

### Task 2: Shared painted refresh affordance

**Files:**

- Create: `packages/core/src/painter-model/tocRefresh.ts`
- Create: `packages/core/src/painter-model/tocRefresh.test.ts`
- Modify: `packages/core/src/painter-model/index.ts`
- Modify: `packages/core/src/styles/editor.css`

**Interfaces:**

- Consumes: `findTableOfContentsBlocks(doc)`.
- Produces:

```ts
export interface SyncTocRefreshOptions {
  doc: PMNode;
  label: string;
}

export function syncTocRefreshButtons(container: HTMLElement, options: SyncTocRefreshOptions): void;
```

- Buttons use `.layout-toc-refresh`, `data-toc-refresh`, and `data-toc-position`.

- [ ] **Step 1: Add failing DOM synchronization tests**

Create a painted container with `.layout-block-sdt-box[data-sdt-group-id="sdt@5"]` and a `.layout-block-sdt-label`. Assert synchronization:

```ts
const button = container.querySelector<HTMLButtonElement>('[data-toc-refresh]');
expect(button?.dataset.tocPosition).toBe('5');
expect(button?.getAttribute('aria-hidden')).toBe('true');
expect(button?.tabIndex).toBe(-1);
expect(button?.title).toBe('Update table of contents');
expect(button?.querySelector('svg')).not.toBeNull();
```

Call synchronization twice and assert one button per boundary. Assert a current TOC still receives a button. Remove the TOC or call cleanup and assert obsolete buttons/classes are removed. Verify non-TOC SDTs remain unchanged.

- [ ] **Step 2: Run helper tests to verify RED**

Run:

```bash
bun test packages/core/src/painter-model/tocRefresh.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement safe DOM synchronization**

For each TOC block, match boundaries by exact `dataset.sdtGroupId === \`sdt@${block.pos}\``. Append a pointer-only button directly to each matching boundary, set its translated title and `aria-hidden`/`tabIndex=-1`attributes, and construct the circular-arrow icon with`createElementNS`. Remove old classes/buttons before rebuilding so repeated calls are idempotent and layout replacements cannot leave old controls.

- [ ] **Step 4: Add shared token-based styles**

Style `.layout-toc-refresh` as a 32px white floating action button positioned 8px left of the boundary's top edge. Match the floating comment action's radius, border, shadow, hover treatment, and existing `--doc-*` tokens. Keep `pointer-events: auto`; reveal it through `.is-active`, `.is-focused`, `:focus-within`, or proxy-focus class. Do not add adapter CSS.

- [ ] **Step 5: Run helper and CSS parity tests**

Run:

```bash
bun test packages/core/src/painter-model/tocRefresh.test.ts
bun run check:adapter-css-thin
```

Expected: PASS.

### Task 3: React/Vue integration and parity

**Files:**

- Modify: `packages/react/src/components/DocxEditor/ContentControlWidgets.tsx`
- Modify: `packages/react/src/components/DocxEditor.tsx`
- Modify: `packages/react/src/components/DocxEditor/hooks/useTableOfContentsActions.ts`
- Modify: `packages/vue/src/components/ContentControlWidgets.vue`
- Modify: `packages/vue/src/components/DocxEditor.vue`
- Modify: `packages/vue/src/composables/useTableOfContentsActions.ts`
- Modify: `e2e/tests/parity/toc-insertion-update.spec.ts`
- Modify: `.changeset/add-toc-regeneration.md`

**Interfaces:**

- React `ContentControlWidgetsProps` adds `getLayout`, `onUpdateTableOfContents(position)`, and `tocUpdateLabel`.
- Vue `ContentControlWidgets` props add `layout`, `onUpdateTableOfContents`, and `tocUpdateLabel`.
- Both adapters call `syncTocRefreshButtons` after their own `docx-editor-*:painted-pages-ready` event.

- [ ] **Step 1: Extend parity E2E with failing interaction assertions**

For each adapter:

1. Insert and initially generate a current TOC.
2. Assert `[data-toc-refresh]` exists but is not visible before hover/focus.
3. Hover the current TOC boundary and assert the left-floating refresh control is visible.
4. Rename an existing heading and click the pointer control; assert the renamed entry appears.
5. Assert the control still exists after the second layout/update pass.
6. Focus the accessible proxy outside every `aria-hidden="true"` ancestor, move the pointer away, and activate it with Space.
7. Verify multiple TOCs map each proxy and pointer control to the correct position.

- [ ] **Step 2: Run parity E2E to verify RED**

Run:

```bash
npx playwright test e2e/tests/parity/toc-insertion-update.spec.ts --timeout=30000 --workers=2
```

Expected: FAIL because no inline refresh control exists.

- [ ] **Step 3: Integrate React**

On `docx-editor-react:painted-pages-ready`, call the shared synchronizer with the live `EditorView.state.doc` and translated label. Render one native accessible proxy per TOC outside `.paged-editor__pages`; proxy focus mirrors a visible focus class onto the matching painted control. Delegate pointer mousedown/click from `.layout-toc-refresh`, protect PM selection, and invoke forced `onUpdateTableOfContents(position)`.

Remove `promptedRef`, prompt signatures, and `window.confirm` from `useTableOfContentsActions`; retain the update function and second-pass scheduling.

- [ ] **Step 4: Integrate Vue with the same behavior**

On `docx-editor-vue:painted-pages-ready`, call the same synchronizer. Mirror React's pointer delegation, accessible proxies, focus mapping, cleanup, locale updates, and position parsing. Remove the prompt watcher/signature state while preserving insert handling and second-pass scheduling.

- [ ] **Step 5: Update the existing TOC changeset**

Use:

```md
Add Table of Contents insertion and regeneration: insert a TOC from the Insert menu, manually refresh any TOC from a left-floating control in React and Vue, preserve page numbers and hyperlinked bookmarks, and update TOCs through the public editor ref.
```

- [ ] **Step 6: Run focused and final verification**

Run:

```bash
bun run format
bun run typecheck
bun run check:adapter-css-thin
bun test packages/core/src/prosemirror/__tests__/toc.test.ts packages/core/src/painter-model/tocRefresh.test.ts
npx playwright test e2e/tests/parity/toc-insertion-update.spec.ts --timeout=30000 --workers=4
```

Expected: all commands exit 0.

- [ ] **Step 7: Verify both demos with the browser agent**

Start the existing demo server, load the React and Vue parity routes, and repeat the stale-heading flow. Inspect computed visibility and button accessible names before hover, during hover, and after refresh. Confirm no browser confirmation dialog appears.

- [ ] **Step 8: Commit the implementation**

Stage only the implementation, tests, plan, and changeset update, then commit:

```bash
git commit -m "feat: add inline TOC regeneration"
```
