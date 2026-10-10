<p align="center">
  <a href="https://www.docx-editor.dev/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-light.svg" />
      <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-light.svg" alt="DOCX Editor by EigenPal" width="320" height="90" />
    </picture>
  </a>
</p>

# @docx-editor.dev/vue

Use Vue 3 components and composables to open, edit, and save DOCX files.

The shared engine handles document state, editing, layout, and rendering.

## Features

- [Open, edit, and save documents](https://www.docx-editor.dev/docs/2.x/vue/props).
- [Compose your editor interface](https://www.docx-editor.dev/docs/2.x/vue/composition).
- [Connect controls through composables](https://www.docx-editor.dev/docs/2.x/vue/composables).
- [Translate editor controls](https://www.docx-editor.dev/docs/2.x/i18n).

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
- [Export Markdown and PDF](https://www.docx-editor.dev/docs/2.x/guides/export)
- [Print documents](https://www.docx-editor.dev/docs/2.x/guides/print)
- Live demo: `bun run dev:vue` in the monorepo (`examples/vue`)

## License

Apache-2.0
