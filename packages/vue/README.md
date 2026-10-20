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

### Custom unsupported content

Register components under `DocxEditor` or `DocxEditor.Root`. Each declaration
handles matching unsupported content, including opaque inline and block elements.

```vue
<DocxEditor :document="bytes">
  <DocxEditor.UnsupportedElement
    :match="(element) => element.namespaceUri === 'urn:my-widgets'"
    :layout="{ width: 180, height: 48 }"
  >
    <template #default="{ element }">
      <MyWidget :element="element" />
    </template>
  </DocxEditor.UnsupportedElement>
  <DocxEditor.UnsupportedElement>
    <template #default="{ element }">
      <MyPlaceholder :label="element.label" />
    </template>
  </DocxEditor.UnsupportedElement>
</DocxEditor>
```

The first mounted matching declaration wins. Prop updates retain its priority.
Removing and mounting a declaration again gives it a later priority. To disable a
specific renderer temporarily, keep it mounted and change `match`, or use
matchers that do not overlap.
Omit `match` for a catch-all. Use source metadata in predicates; geometry is not
available before pagination. Return empty slot content to keep the default placeholder.
An empty result does not select the next declaration.

`UnsupportedElement` exposes `nodeId`, `ownerPartName`, `namespaceUri`,
`localName`, `source`, `placement`, and `label`. `bounds` describes the reserved
box after layout. Optional `drawing` and `equation` records provide specialized
metadata. Treat source content as read-only and untrusted.

`layout` reserves width and height in document points for opaque elements.
Source placement determines inline or block flow. Without `layout`, opaque
inline elements reserve 120 × 24 points; blocks reserve 240 × 96 points.
Dimensions must be positive, finite, and at most 100,000 points.
Drawing and equation fallbacks retain their existing geometry.
Unmatched opaque content retains its existing invisible behavior.
Properties, metadata, and nested payloads inside unsupported elements are not
independent content occurrences.

Components retain framework context and local state across same-page repaints.
They can remount when pagination, virtualization, or document changes remove an
occurrence. Keep durable application data outside the component.
Prop updates and declaration removal preserve document edits and undo history.
Custom rendering does not change saved DOCX content.
