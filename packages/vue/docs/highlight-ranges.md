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

Call `editor.getParagraphs()` to read paragraphs across document stories, including pages that have not been painted. Call `editor.getParagraphText(blockId)` to read one. Body text, tables, content controls, headers, footers, notes and supported text boxes are included. Repeated headers and footers appear once.

Check `keptText` for spelling. It excludes tracked deletions and move-from revisions, while retaining insertions. The `keptSpans` map gives the model offsets that `setHighlights()` takes. A word spanning a deletion needs a separate highlight for each kept span.

```ts
import type { Editor, HighlightRange } from '@docx-editor.dev/core';

function misspelledRanges(editor: Editor, isMisspelled: (word: string) => boolean) {
  const ranges: HighlightRange[] = [];
  for (const { blockId, text, keptText, keptSpans } of editor.getParagraphs()) {
    for (const word of keptText.matchAll(/\p{L}+/gu)) {
      if (!isMisspelled(word[0])) continue;
      for (const span of keptSpans) {
        const from = Math.max(word.index, span.keptStart);
        const to = Math.min(word.index + word[0].length, span.keptStart + span.length);
        if (from >= to) continue;
        const start = span.start + from - span.keptStart;
        ranges.push({
          blockId,
          start,
          length: to - from,
          expectedText: text.slice(start, start + to - from),
        });
      }
    }
  }
  return ranges;
}
```

All offsets use UTF-16 code units and match the editor's `fieldResults` setting. In the default mode, each field is one U+FFFC character in both texts, including hyperlink fields. With `fieldResults: 'editable'`, supported saved field results appear as text.

Read again after a `change` event. Results are immutable, and unchanged paragraph nodes return the same objects. Hosts can cache checks by object identity. Scrolling does not require another check. For asynchronous checks, confirm the paragraph object is still current before setting highlights.

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
