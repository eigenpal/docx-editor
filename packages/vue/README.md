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

## Which API for which job

| Job | Use |
| --- | --- |
| Build a review UI in the browser | The React or Vue adapter hooks, plus the review hooks and `DocxEditorReview` from `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue`. |
| Edit in a headless, server, or agent pipeline | The editing API in `@docx-editor.dev/editor-api`, which follows the Office.js object model. |

| Task | Browser host (React or Vue) | Headless, server, or agent |
| --- | --- | --- |
| [Comment on found text](https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text) | `editor.findMatches`, `editor.selectMatch`, then `useReview().comment` | `body.search`, then `Range.insertComment` |
| Reply to a thread | `useReview().reply(item, text)` | `Comment.reply(text)` |
| [Record a tracked replacement](https://www.docx-editor.dev/docs/2.x/recipes/tracked-replacement) | Suggesting mode, then `editor.exec({ type: 'replaceMatch', match, text })` | `document.changeTrackingMode = 'TrackMineOnly'`, then `Range.insertText(text, 'Replace')` |
| [Accept or reject a change](https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling) | `useReview().accept(item)` or `useReview().reject(item)` | `Revision.accept()` or `Revision.reject()` |
| [Open or reveal a change without scrolling](https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling) | `useReview().setActive(key, { reveal: false })` | Not applicable: no viewport |
| [Highlight ranges](https://www.docx-editor.dev/docs/2.x/recipes/highlight-ranges) | `useHighlights(name, source, options)` | Not applicable |
| [Custom review rail cards](https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards) | `DocxEditorReview` with `preset` set to `false`, `useReview().items`, `useStackedReviewPositions`, and `useReviewRailMetrics` | Not applicable |
| Comment-on-selection button | `DocxEditorReview.AddComment` as a direct child of `DocxEditorReview`, or `useEditorCommand('review.addComment')` | Not applicable |
| Page setup and paragraph dialogs from a custom toolbar | `DocxEditor.PageSetupDialog` or `DocxEditor.ParagraphDialog` with `open` and a close handler (`onClose` in React, `@close` in Vue); enable the button from `usePageSetup().isEnabled` or `useParagraphFormat().isEnabled` | `Section.pageSetup`, and `Paragraph` properties such as `alignment` |

The review hooks need `reviewModule()` from `@docx-editor.dev/pro` in the editor's modules, and an editor `author` for comments and tracked changes. The editing API takes its author from the `author` option of `DocxEditor.createServer`, imported from `@docx-editor.dev/editor-api`, or of `DocxEditor.createBrowser`, imported from `@docx-editor.dev/editor-api/browser`.

This package ships the task recipes in [`docs/index.md`](./docs/index.md). They are also on the site: [Task recipes](https://www.docx-editor.dev/docs/2.x/recipes).

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
