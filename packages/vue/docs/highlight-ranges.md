<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Highlight ranges

Use `useHighlights(name, source, options)` to mark text as a named set while a component is mounted. A function source runs again after document changes, so the marks follow the text. Highlights are view state. They do not change the document and are not saved.

```vue
<script setup lang="ts">
import { useHighlights, type Editor } from '@docx-editor.dev/vue';

const props = defineProps<{ terms: readonly string[] }>();
const result = useHighlights(
  'glossary',
  (editor: Editor) => editor.findMatches(props.terms, { wholeWord: true }).flat(),
  { className: 'glossary-term' }
);
</script>

<template>
  <span>{{ result.applied }} marked</span>
</template>
```

A function source that reads props or refs runs again when they change.

Use a unique `name` for each set. Two calls with the same name replace each other's ranges. Set `activeIndex` in the options to show one range in the active color, for example the current result of your own search list.

Outside a component, call `watchHighlights(editor, name, source, options)` from `@docx-editor.dev/core/editor`, or `editor.setHighlights` for a fixed set.
