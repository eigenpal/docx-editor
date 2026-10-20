<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

# @docx-editor.dev/vue

Vue 3 adapter for the docx-editor.dev editor.

It is a thin renderer over the editor contract in `@docx-editor.dev/core`. It supplies the DOM host, constructs the editor with `createEditor`, and paints the engine's positioned display list. All editing, querying, and geometry go through the `Editor` facade. The adapter holds no editing-engine state of its own.

## Install

```bash
npm install @docx-editor.dev/vue @docx-editor.dev/core
```

## Quickstart

```vue
<script setup lang="ts">
import { DocxEditor } from '@docx-editor.dev/vue';
</script>

<template>
  <DocxEditor :document="docxBytes" />
</template>
```

`<DocxEditor>` is the full packaged editor. When you need your own chrome, compose `DocxEditorRoot`, `DocxEditorViewport`, and `DocxEditorContent`, then add toolbar, menu, and navigation parts from the same package root.

## Composition API

```vue
<script setup lang="ts">
import {
  DocxEditorRoot,
  DocxEditorViewport,
  DocxEditorContent,
  DocxEditorToolbar,
  useEditorCommand,
} from '@docx-editor.dev/vue';

const bold = useEditorCommand('text.bold');
</script>

<template>
  <DocxEditorRoot :document="docxBytes">
    <DocxEditorToolbar>
      <button @mousedown.prevent :disabled="!bold.isEnabled" @click="bold.execute()">Bold</button>
    </DocxEditorToolbar>
    <DocxEditorViewport>
      <DocxEditorContent />
    </DocxEditorViewport>
  </DocxEditorRoot>
</template>
```

Every composable the packaged chrome uses is public: `useDocxEditor`, `useEditorState`, `useEditorCommand`, `useEditorEvent`, `useFontFamily`, and the rest on the package root.

## SSR and Nuxt

The editor is client-only. On the server, `DocxEditorRoot` skips instance
creation. Mount the editor inside `<ClientOnly>` or load it with
`defineAsyncComponent`.

The Nuxt module remains a private workspace package. External applications
should follow the [Nuxt guide](https://www.docx-editor.dev/docs/2.x/frameworks/nuxt).

## Docs and demo

- [Vue adapter docs](https://www.docx-editor.dev/docs/2.x/vue)
- [Composition guide](https://www.docx-editor.dev/docs/2.x/vue/composition)
- [Composables reference](https://www.docx-editor.dev/docs/2.x/vue/composables)
- Live demo: `bun run dev:vue` in the monorepo (`examples/vue`)

## License

Apache-2.0

### Custom unsupported-content placeholders

Use the `unsupportedElement` scoped slot on `DocxEditor` or `DocxEditor.Content`:

```vue
<DocxEditor :document="bytes">
  <template #unsupportedElement="{ element }">
    <MyPlaceholder :kind="element.kind" :label="element.label" />
  </template>
</DocxEditor>
```

The slot receives an `UnsupportedElement` with `kind`, `nodeId`, `label`, and
its drawing or equation layout record. Drawing records include `resource` and
`placeholderGraphicKind` for selecting a component by failure or graphic type.
An empty slot, including a false `v-if` branch, keeps the default placeholder.
Slot content updates with your reactive state. Components retain Vue context and
local state across same-page repaints. They unmount when their element, page,
document, or slot disappears. The existing layout box and saved DOCX remain
unchanged. Invisible unknown XML is outside this hook.
