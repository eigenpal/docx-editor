# Nuxt example

This repository example uses the private `@docx-editor.dev/nuxt` workspace
module. The module wraps the Vue adapter for Nuxt 3 and Nuxt 4.

## Run the example

From the repository root, build the Vue and Nuxt packages before you start Nuxt:

```bash
bun install
bun run build:packages:vue
bun run dev:nuxt
```

Open `http://localhost:3002`.

## Use the workspace module

Register the module in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@docx-editor.dev/nuxt'],
});
```

The module auto-imports `<DocxEditor>` as a client-only component.
It also injects the editor stylesheet.

```vue
<template>
  <DocxEditor document="blank" author="Demo Reviewer" />
</template>
```

`app.vue` shows the complete workspace example.
It imports `DocxEditorToolbar` from `@docx-editor.dev/vue`.
It passes document bytes, review modules, an author, and a `ready` handler.

## Use Nuxt outside this repository

The workspace module has `"private": true`, so npm does not publish it.
External applications must use the published Vue adapter with a client-only
component.

Follow the
[Nuxt integration guide](https://www.docx-editor.dev/docs/2.x/frameworks/nuxt).
