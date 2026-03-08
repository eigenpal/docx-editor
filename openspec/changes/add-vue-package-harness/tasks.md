## 1. Project Setup

- [x] 1.1 Add `dev:vue` script to root `package.json`: `"dev:vue": "cd examples/vue && bun run dev"`
- [x] 1.2 Add `vue` and `@vitejs/plugin-vue` to Vue example devDependencies if missing, run `bun install`
- [x] 1.3 Copy `sample.docx` from `examples/vite/public/` to `examples/vue/public/` so the demo can load it on startup

## 2. Core Composable

- [x] 2.1 Create `packages/vue/src/composables/useDocxEditor.ts` — composable that manages the editor lifecycle: parse DOCX buffer → build ProseMirror state → create hidden PM view → paint pages via layout-painter → handle re-renders on state change
- [x] 2.2 Expose from composable: `editorView` ref, `save()` method, `destroy()` cleanup, `isReady` ref, `parseError` ref

## 3. Vue Components

- [x] 3.1 Create `packages/vue/src/components/DocxEditorVue.vue` — main editor SFC that uses `useDocxEditor`, renders hidden PM container + visible pages container, handles click-to-position mapping for selection
- [x] 3.2 Create `packages/vue/src/components/BasicToolbar.vue` — minimal toolbar with bold, italic, underline, and alignment buttons using ProseMirror commands
- [x] 3.3 Wire toolbar to editor view: pass `editorView` to BasicToolbar, dispatch commands on button click

## 4. Package Exports

- [x] 4.1 Update `packages/vue/src/index.ts` to export `DocxEditorVue` component and `useDocxEditor` composable
- [x] 4.2 Implement `renderAsync.ts` to mount `DocxEditorVue` into a container element using `createApp`

## 5. Example App

- [x] 5.1 Rewrite `examples/vue/src/App.vue` with working demo: header with Open/New/Save buttons, file name display, DocxEditorVue component
- [x] 5.2 Implement file open handler (file input → ArrayBuffer → pass to editor)
- [x] 5.3 Implement new document handler (createEmptyDocument from core → pass to editor)
- [x] 5.4 Implement save/download handler (call editor ref save → create download link)
- [x] 5.5 Load `sample.docx` on initial page load via fetch

## 6. Verification

- [x] 6.1 Run `bun run dev:vue`, verify page loads at localhost:5174 with sample document rendered
- [ ] 6.2 Verify typing, bold/italic/underline, and alignment work (requires manual browser testing)
- [ ] 6.3 Verify open file, new document, and save/download work (requires manual browser testing)
- [x] 6.4 Run `bun run typecheck` to confirm no type errors
