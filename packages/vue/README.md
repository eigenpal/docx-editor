# @eigenpal/docx-editor-vue

Vue 3 DOCX editor adapter for `@eigenpal/docx-editor-core`. The editor component, `renderAsync` mounting path, i18n, styles, composables, plugin host, and agent bridge ref are implemented for the 1.0 release train.

## Install

```bash
npm install @eigenpal/docx-editor-vue
```

`@eigenpal/docx-editor-core` is installed transitively by the Vue package. Add it to
your app only when your own code imports core APIs directly, for example
`createEmptyDocument` or `Document` types:

```bash
npm install @eigenpal/docx-editor-vue @eigenpal/docx-editor-core
```

Strict installers such as pnpm with peer auto-install disabled may also require
the ProseMirror peer dependencies listed in `package.json`.

The toolbar + dialog scoped styles ship as a separate CSS file. Import it once at your app entry — Vite's library mode doesn't auto-inject CSS imports, so without this the toolbar renders unstyled:

```ts
// main.ts
import '@eigenpal/docx-editor-vue/styles.css';
```

## Subpaths

The package exposes focused entry points for app authors who want only part of the Vue surface:

- `@eigenpal/docx-editor-vue` — editor component, `renderAsync`, public types.
- `@eigenpal/docx-editor-vue/ui` — toolbar primitives, pickers, sidebars, and dialogs.
- `@eigenpal/docx-editor-vue/composables` — Vue composables such as `useDocxEditor`, `useZoom`, and `useTableSelection`.
- `@eigenpal/docx-editor-vue/dialogs` — dialog SFCs as a smaller component barrel.
- `@eigenpal/docx-editor-vue/plugin-api` — Vue plugin host and plugin-facing types.
- `@eigenpal/docx-editor-vue/styles` — style constants, including `EDITOR_CSS_PATH` and z-index values.

## Architecture

For the per-component audit mapping every Vue SFC under `src/components/` to its React peer, the corresponding parity-matrix row, and an implementation status (`done` / `partial` / `missing` / `intentional-divergence`), see [`openspec/changes/vue-editor-robust-implementation/notes/audit.md`](../../openspec/changes/vue-editor-robust-implementation/notes/audit.md). When a PR moves a Vue component forward, bump the row in that audit alongside the matrix row in the spec.

The reactivity contract (`shallowRef` for PM `EditorView` / `Document` / Document-shaped trees; `ref` for primitives + flat snapshots; `flush: 'post'` for DOM-coupled watchers) is documented at [`openspec/changes/vue-editor-robust-implementation/notes/reactivity.md`](../../openspec/changes/vue-editor-robust-implementation/notes/reactivity.md).

## Quick Start

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor } from '@eigenpal/docx-editor-vue';
import '@eigenpal/docx-editor-vue/styles.css';

const buffer = ref<ArrayBuffer | null>(null);

async function loadFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  buffer.value = file ? await file.arrayBuffer() : null;
}
</script>

<template>
  <input type="file" accept=".docx" @change="loadFile" />
  <DocxEditor
    :document-buffer="buffer"
    document-name="Contract.docx"
    @change="(doc) => console.log('changed', doc)"
    @error="(error) => console.error(error)"
  />
</template>
```

`DocxEditor` and `DocxEditorRef` are the public names so React and Vue docs can share the same import shape with only the package name changing.

## renderAsync

```ts
import { renderAsync } from '@eigenpal/docx-editor-vue';

const editor = await renderAsync(file, document.getElementById('editor')!, {
  mode: 'editing',
  showToolbar: true,
});

const blob = await editor.save();
editor.destroy();
```

`DocxEditor`, `DocxEditorRef`, `DocxEditorHandle`, and `RenderAsyncOptions` are
the public names shared with the React package. Most docs can differ only by
package name:

```diff
- import { DocxEditor } from '@eigenpal/docx-editor-react';
+ import { DocxEditor } from '@eigenpal/docx-editor-vue';
```

## Component API

`<DocxEditor>` currently exposes these public props:

- `documentBuffer?: ArrayBuffer | null` — DOCX bytes to parse and mount.
- `document?: Document | null` — pre-parsed document model.
- `showToolbar?: boolean`, `showMenuBar?: boolean`, `showRuler?: boolean` — chrome toggles.
- `documentName?: string` — title-bar name.
- `documentNameEditable?: boolean`, `onDocumentNameChange?: (name) => void` — title-bar name editing controls.
- `readOnly?: boolean` — disables editing affordances.
- `mode?: 'editing' | 'suggesting' | 'viewing'` — React-compatible editing mode; `viewing` also makes the editor read-only.
- `initialZoom?: number`, `showZoomControl?: boolean` — toolbar controls. Pass `onPrint` to enable the File → Print menu entry; omit to hide.
- `fontFamilies?: Array<string | FontOption>` — custom font dropdown list.
- `toolbarExtra?: () => VNodeChild`, `renderLogo?: () => VNodeChild`, `renderTitleBarRight?: () => VNodeChild` — render-prop equivalents for React's toolbar customisation. In SFC templates, named slots (`title-bar-left`, `title-bar-right`, `toolbar-extra`) are usually more idiomatic.
- `className?: string`, `style?: StyleValue` — root element styling.
- `showOutline?: boolean`, `showOutlineButton?: boolean` — document outline controls.
- `disableFindReplaceShortcuts?: boolean` — lets the host keep Cmd/Ctrl+F and Cmd/Ctrl+H.
- `i18n?: Translations` — locale override merged with English fallback.
- `externalPlugins?: Plugin[]` — ProseMirror plugins mounted with the editor.

Emits:

- `change(document)` after editor content changes.
- `update:document(document)` for `v-model:document`.
- `error(error)` when parsing, layout, or save work fails.
- `ready()` after the editor finishes initial mount.
- `rename(name)` when the document name changes.
- `menu-action(action)` for top-level menu commands handled by the host.

Ref API:

- `save(): Promise<ArrayBuffer | null>`
- `setZoom(zoom): void`
- `getZoom(): number`
- `focus(): void`
- `scrollToPage(pageNumber): void`
- `scrollToPosition(pmPos): void`
- `openPrintPreview(): void`
- `print(): void`
- `loadDocument(document): void`
- `loadDocumentBuffer(buffer): Promise<void>`
- `destroy(): void`
- `getDocument(): Document | null`
- `getEditorRef(): { getDocument(): Document | null } | null`
- `addComment(options): number | null`
- `replyToComment(commentId, text, author): number | null`
- `resolveComment(commentId): void`
- `proposeChange(options): boolean`
- `scrollToParaId(paraId): boolean`
- `findInDocument(query, options?): FoundMatch[]`
- `getSelectionInfo(): SelectionInfo | null`
- `getComments(): Comment[]`
- `applyFormatting(options): boolean`
- `setParagraphStyle(options): boolean`
- `getPageContent(pageNumber): PageContent | null`
- `getTotalPages(): number`
- `getCurrentPage(): number`
- `onContentChange(listener): () => void`
- `onSelectionChange(listener): () => void`

The bridge-facing ref now satisfies `EditorRefLike` from `@eigenpal/docx-editor-agents/bridge`, so the same agent tools can attach to React or Vue. Vue also exposes the common React imperative helpers for zoom, scrolling, printing, and programmatic document loading. React-only `getAgent()` returns `null` in Vue because the Vue adapter uses the framework-agnostic bridge directly.

## Composables

`useDocxEditor(options)` is the lower-level lifecycle primitive behind the component. It returns `editorView`, `editorState`, `layout`, readiness/error refs, document loading methods, `save`, `focus`, `destroy`, `getDocument`, `getCommands`, and `reLayout`.

Before pushing parity-affecting editor changes, run the smoke subset against the parity demos:

```bash
bun run test:e2e:parity:smoke
```

`useAutoSave(document, options)` mirrors the React hook options: `storageKey`, `interval`, `enabled`, `maxAge`, `onSave`, `onError`, `onRecoveryAvailable`, `saveOnChange`, and `debounceDelay`.

## Scope — what's in v1, what's deferred

The Vue adapter targets the same editor surface as the React adapter (formatting, lists, tables, comments, tracked changes, find/replace, hyperlinks, images, page setup, printing, i18n, keyboard shortcuts, agent SDK via `@eigenpal/docx-editor-agents/vue`), but the OpenSpec parity matrix is still the source of truth for what is `done`, `partial`, or `missing`. Three things are explicitly **out of scope for 1.0** and tracked as follow-up issues:

| Feature                     | Why deferred                                                                                                                                                                                    | Tracking                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Third-party Vue plugins** | The cross-adapter plugin contract needs design work (Vue composable plugin shape diverges from the React hook-based shape). Built-in plugins (`templatePlugin`) work via core's contract today. | Spec §6.3 — follow-up issue at 1.0 ship                    |
| **Real-time collaboration** | The Yjs binding for the React adapter ships in 1.x; the Vue equivalent will follow on the same release.                                                                                         | Parity-matrix row "Real-time collaboration" → `omitted-v1` |
| **SSR / Nuxt module**       | The editor mounts a hidden `EditorView` and measures DOM at mount time — there's no SSR-clean path. Nuxt usage today wraps the editor in `<ClientOnly>` or `defineAsyncComponent`.              | Parity-matrix row "SSR / Nuxt module" → `omitted-v1`       |

If you need any of the above today, **prefer the React adapter** and follow the tracking issues for Vue parity.

## License

MIT. See [LICENSE](../../LICENSE) at the repo root.
