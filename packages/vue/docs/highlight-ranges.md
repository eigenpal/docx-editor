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

Call `editor.getParagraphs()` to read every paragraph, including paragraphs on pages that have not been painted. The list covers body text, tables, content controls, headers, footers, notes, and supported text boxes. Repeated headers and footers appear once. To read one paragraph, call `editor.getParagraphText(blockId)`.

Each result has three parts:

- `keptText` is the text a reader sees. Check it for spelling and grammar. It leaves out tracked deletions, move sources, hidden text, and optional hyphens. An object, such as a field, a picture, or a note reference, reads as U+FFFC, so treat U+FFFC as a word boundary.
- `text` holds the offsets that `setHighlights()` takes. It includes deleted and hidden text.
- `proofing` lists stretches of `keptText` with their language, such as `en-GB`, and a `noProof` flag. Skip text that has `noProof` set, and check other text in its own language.

To convert a `keptText` range to highlight ranges, call `keptTextRanges(paragraph, from, to)`. A word that crosses a tracked deletion or hidden text gets one range for each visible part.

The following module, `spelling-source.ts`, checks each paragraph once. An unchanged paragraph returns the same object, so the cache skips it after the first check.

```ts
import {
  keptTextRanges,
  type Editor,
  type HighlightRange,
  type ParagraphText,
} from '@docx-editor.dev/core';

const WORD = /[\p{L}\p{M}']+/gu;

/** Whether proofing tools should skip the `keptText` offset `at`. */
function skipped(paragraph: ParagraphText, at: number): boolean {
  return paragraph.proofing.some(
    (part) => part.noProof && at >= part.keptStart && at < part.keptStart + part.length
  );
}

/** A highlight source that marks each word that `isMisspelled` rejects. */
export function spellingSource(isMisspelled: (word: string) => boolean) {
  const checked = new WeakMap<ParagraphText, HighlightRange[]>();
  return (editor: Editor): HighlightRange[] =>
    editor.getParagraphs().flatMap((paragraph) => {
      let ranges = checked.get(paragraph);
      if (!ranges) {
        ranges = [];
        for (const word of paragraph.keptText.matchAll(WORD)) {
          if (skipped(paragraph, word.index) || !isMisspelled(word[0])) continue;
          const end = word.index + word[0].length;
          ranges.push(...keptTextRanges(paragraph, word.index, end));
        }
        checked.set(paragraph, ranges);
      }
      return ranges;
    });
}
```

Pass the source to `useHighlights`. It runs again after each document change.

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useHighlights } from '@docx-editor.dev/vue';
import { spellingSource } from './spelling-source';

const props = defineProps<{ isMisspelled: (word: string) => boolean }>();
// Create the source again only when the checker changes, so its cache survives updates.
const source = computed(() => spellingSource(props.isMisspelled));
useHighlights('spelling', source, { className: 'spelling-error' });
</script>
```

Offsets count UTF-16 code units and follow the editor's `fieldResults` setting. By default, each field is one U+FFFC character in both texts, including `HYPERLINK` fields. Link text in a `w:hyperlink` element is ordinary text. With `fieldResults: 'editable'`, supported saved field results are text. In `keptText`, a non-breaking hyphen is U+2011.

If your checker is asynchronous, keep the paragraph object with each request. When the result arrives, compare that object with `editor.getParagraphText(paragraph.blockId)`. If they differ, the paragraph changed, so discard the result and check the new object. Undo can return an earlier object, and its earlier result is still correct. Loading another document can reuse paragraph IDs, so discard pending results when you load a document.

## Run the source again

A function source runs again after document changes. If it also reads your own state, call `refresh()` after that state changes. Examples are a word that you add to a dictionary, or a result that arrives from a server. The following component stops marking a term after you ignore it.

```vue
<script setup lang="ts">
import { useHighlights, type Editor } from '@docx-editor.dev/vue';

const props = defineProps<{ terms: readonly string[] }>();
// A plain Set is not reactive, so the source does not run again by itself.
const ignored = new Set<string>();
const marks = useHighlights('terms', (editor: Editor) =>
  editor
    .findMatches(props.terms, { wholeWord: true })
    .flat()
    .filter((match) => !ignored.has(match.text))
);
function ignore(term: string) {
  ignored.add(term);
  marks.value.refresh();
}
</script>

<template>
  <button @click="ignore(props.terms[0] ?? '')">Ignore first term</button>
</template>
```

`refresh()` replaces a run that waits for typing to pause, so the source runs once. In React, the set updates at once, and `refresh` keeps its identity across renders. Call it from an effect or an event handler, not during render. In Vue, the set updates in the next flush, before the next paint. After the component unmounts, `refresh()` does nothing.

## Read highlights in the context menu

Call `useContextMenuHighlights(name)` in a row inside `ContextMenu.Start` to read the highlights that the menu is about. For a right-click, these are the highlights under the pointer. If the menu opens from the keyboard, with Shift+F10 or the Menu key, these are the highlights that contain the caret. Add your own fields to each range, and read them back from `range`. The following rows offer a replacement for a marked term, from a right-click or from the keyboard.

```vue
<script setup lang="ts">
import {
  DocxEditor,
  useContextMenuHighlights,
  useDocxEditor,
  type TextMatch,
} from '@docx-editor.dev/vue';

type TermRange = TextMatch & { readonly replacement: string };

// Pass `refresh` from the value of useHighlights('terms', ...).
const props = defineProps<{ recheck: () => void }>();
const editor = useDocxEditor();
const hits = useContextMenuHighlights<TermRange>('terms');

function replace() {
  const hit = hits.value[0];
  if (!hit || !editor.value) return;
  const result = editor.value.exec({
    type: 'replaceMatch',
    // Where the term is now, and the text it must still have.
    match: {
      blockId: hit.range.blockId,
      start: hit.start,
      length: hit.length,
      expectedText: hit.range.text,
    },
    text: hit.range.replacement,
  });
  // The text changed after the menu opened: check the document again.
  if (!result.ok && result.code === 'notFound') props.recheck();
}
</script>

<template>
  <DocxEditor.ContextMenu.Item
    v-if="hits[0]"
    :label="hits[0].range.replacement"
    @select="replace"
  />
</template>
```

A highlight moves with its text, so use the hit's `start` and `length`, not the offsets of `range`. The hook reads the highlights again when the document changes while the menu is open. A term that moves away from the pointer or the caret is no longer reported. `expectedText` makes the replacement refuse with `notFound` if the text changed anyway.

For a keyboard open, a highlight counts when the caret is inside it or at either end, in the same paragraph. For a range selection, the caret is the end where the selection stops. The hit's `rect` is the highlight's rectangle on the caret's line. The hook returns an empty array while the menu is closed. To tell a right-click from a keyboard open, call `useContextMenuAnchor()` and check `trigger`.

## Configure a highlight set

| Argument or field | Description |
| --- | --- |
| `name` | The set name. Two sets with the same name replace each other's ranges. |
| `source` | The ranges, or a function of the editor that returns them. |
| `options.className` | CSS classes added to every mark of the set. |
| `options.activeIndex` | The range to show in the active color, such as the current result of your own search list. |
| `applied` | The number of ranges that resolve and paint. |
| `refresh()` | Runs the source again, or applies an array again. |

## Use highlights outside components

Call `watchHighlights(editor, name, source, options)` from `@docx-editor.dev/core/editor` to follow document changes. Call `stop()` on the returned watch to remove the set and stop watching. For a fixed set that does not refresh, call `editor.setHighlights`.

## See also

- [Highlight text ranges](https://www.docx-editor.dev/docs/2.x/guides/navigation#highlight-text-ranges)
- [React hooks](https://www.docx-editor.dev/docs/2.x/react/hooks#usehighlights)
- [Vue composables](https://www.docx-editor.dev/docs/2.x/vue/composables#usehighlights)
