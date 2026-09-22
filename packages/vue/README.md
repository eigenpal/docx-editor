<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

# @docx-editor.dev/vue

Use Vue 3 components and composables to open, edit, and save DOCX files.

The shared engine handles document state, editing, layout, and rendering.

## Install

Install the adapter and its required engine peer:

```bash
npm install @docx-editor.dev/vue @docx-editor.dev/core
```

## Quick start

Import the stylesheet once and give the editor a container with a defined height:

```vue
<script setup lang="ts">
import { DocxEditor } from '@docx-editor.dev/vue';
import '@docx-editor.dev/vue/styles.css';
</script>

<template>
  <div style="height: 100vh">
    <DocxEditor document="blank" />
  </div>
</template>
```

To open a file, pass its `ArrayBuffer` or `Uint8Array` as `:document`.

## Composition API

Compose the editor root, viewport, and content when you need your own interface. Put custom controls inside the root:

```vue
<script setup lang="ts">
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/vue';
import '@docx-editor.dev/vue/styles.css';
import BoldButton from './BoldButton.vue';
</script>

<template>
  <DocxEditorRoot document="blank">
    <BoldButton />
    <DocxEditorViewport style="height: 80vh">
      <DocxEditorContent />
    </DocxEditorViewport>
  </DocxEditorRoot>
</template>
```

Define the button in `BoldButton.vue`. Composables must run in a descendant of `DocxEditorRoot` to access its editor. Destructure computed refs so Vue unwraps them in the template:

```vue
<script setup lang="ts">
import { useEditorCommand } from '@docx-editor.dev/vue';

const { execute, isEnabled, isActive } = useEditorCommand('text.bold');
</script>

<template>
  <button @mousedown.prevent :disabled="!isEnabled" :aria-pressed="isActive" @click="execute()">
    Bold
  </button>
</template>
```

The package also exports `useDocxEditor`, `useEditorState`, `useEditorEvent`, and `useFontFamily`.

## SSR and Nuxt

The editor requires browser APIs. For Nuxt, mount it inside `<ClientOnly>` and use a `.client.vue` component for its imports. For other server-rendered applications, import and mount the editor in the browser.

The Nuxt module remains a private workspace package. External applications should follow the [Nuxt guide](https://www.docx-editor.dev/docs/2.x/frameworks/nuxt).

## Docs and demo

- [Vue adapter docs](https://www.docx-editor.dev/docs/2.x/vue)
- [Composition guide](https://www.docx-editor.dev/docs/2.x/vue/composition)
- [Composables reference](https://www.docx-editor.dev/docs/2.x/vue/composables)
- Live demo: `bun run dev:vue` in the monorepo (`examples/vue`)

## Export Markdown and PDF

The adapter does not install either converter. Install only the formats your application uses.

Configure `menu.exporters` to enable **File > Export** with the conversion packages. Markdown downloads as one continuous document. PDF conversion requires a Node.js server. Missing converter handlers show an error with setup instructions. See [Export Markdown and PDF](https://www.docx-editor.dev/docs/2.x/guides/export).

## License

Apache-2.0
