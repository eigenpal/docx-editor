# Vue example

This Vue 3 and Vite app uses the Vue adapter and the shared editor engine.

## Run the example

From the repository root, run:

```bash
bun install
bun run dev:vue
```

Open `http://localhost:5174`.

`src/main.ts` starts the app and loads `src/ComposedEditorDemo.vue`.
`src/styles.css` imports the editor stylesheet and adds demo styles.

## Add the editor to Vue

Install the adapter and its engine peer:

```bash
npm install @docx-editor.dev/vue @docx-editor.dev/core
```

Import the stylesheet once. Then pass `"blank"` to create an empty document:

```vue
<script setup lang="ts">
import { DocxEditor } from '@docx-editor.dev/vue';
import '@docx-editor.dev/vue/styles.css';
</script>

<template>
  <DocxEditor document="blank" />
</template>
```

To open a real file, read it as an `ArrayBuffer` or `Uint8Array` and pass it as
`:document`.

For more information, see the
[Vue adapter guide](https://www.docx-editor.dev/docs/2.x/vue).
