<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Highlight ranges

Call `useHighlights(name, source, options)` to mark text as a named set while a component is mounted. Highlights are local view state. They do not change the document and are not saved.

## Highlight matching text

The following component marks each whole-word match of a list of terms. Style the `glossary-term` class with your own CSS, or omit `className` for the default fill.

```vue
<script setup lang="ts">
import { useHighlights, type Editor } from '@docx-editor.dev/vue';

const props = defineProps<{ terms: readonly string[] }>();
// A source that reads props or refs runs again when they change.
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

A function source runs again after each document change, so the marks follow the text. The set is removed when the component unmounts.

## Highlight ranges that you compute

To mark ranges that `findMatches()` cannot find, such as misspelled words, read the paragraph text. `editor.getPaintedParagraphs()` returns the text of each paragraph on the painted pages. `editor.getParagraphText(blockId)` returns one paragraph. The offsets in `text` are the offsets that `setHighlights()` takes.

```ts
import type { Editor, HighlightRange } from '@docx-editor.dev/core';

function misspelledRanges(editor: Editor, isMisspelled: (word: string) => boolean) {
  const ranges: HighlightRange[] = [];
  for (const { blockId, text, deletions } of editor.getPaintedParagraphs()) {
    for (const word of text.matchAll(/\p{L}+/gu)) {
      const start = word.index;
      const deleted = deletions.some(
        (span) => start >= span.start && start < span.start + span.length
      );
      if (!deleted && isMisspelled(word[0])) {
        ranges.push({ blockId, start, length: word[0].length, expectedText: word[0] });
      }
    }
  }
  return ranges;
}
```

`text` includes tracked deletions. Use `deletions` to skip them. A field counts as one character. The painted pages change as the reader scrolls, so read the paragraphs again then.

## Configure a highlight set

| Argument or field | Description |
| --- | --- |
| `name` | The set name. Two sets with the same name replace each other's ranges. |
| `source` | The ranges, or a function of the editor that returns them. |
| `options.className` | CSS classes added to every mark of the set. |
| `options.activeIndex` | The range to show in the active color, such as the current result of your own search list. |
| `applied` | The number of ranges that resolve and paint. |

## Use highlights outside components

Call `watchHighlights(editor, name, source, options)` from `@docx-editor.dev/core/editor` to follow document changes. Call `stop()` on the returned watch to remove the set and stop watching. For a fixed set that does not refresh, call `editor.setHighlights`.

## See also

- [Highlight text ranges](https://www.docx-editor.dev/docs/2.x/guides/navigation#highlight-text-ranges)
- [React hooks](https://www.docx-editor.dev/docs/2.x/react/hooks#usehighlights)
- [Vue composables](https://www.docx-editor.dev/docs/2.x/vue/composables#usehighlights)
