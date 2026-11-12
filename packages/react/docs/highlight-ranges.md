<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Highlight ranges

Call `useHighlights(name, source, options)` to mark text as a named set while a component is mounted. Highlights are local view state. They do not change the document and are not saved.

## Highlight matching text

The following component marks each whole-word match of a list of terms. Style the `glossary-term` class with your own CSS, or omit `className` for the default fill.

```tsx
import { useCallback } from 'react';
import { useHighlights, type Editor } from '@docx-editor.dev/react';

export function GlossaryMarks({ terms }: { terms: readonly string[] }) {
  // A stable function source, so the set refreshes only when `terms` changes.
  const findTerms = useCallback(
    (editor: Editor) => editor.findMatches(terms, { wholeWord: true }).flat(),
    [terms]
  );
  const { applied } = useHighlights('glossary', findTerms, { className: 'glossary-term' });
  return <span>{applied} marked</span>;
}
```

A function source runs again after each document change, so the marks follow the text. The set is removed when the component unmounts.

## Highlight ranges that you compute

Call `editor.getParagraphs()` to read every paragraph, including paragraphs on pages that have not been painted. The list covers body text, tables, content controls, headers, footers, notes, and supported text boxes. Repeated headers and footers appear once. To read one paragraph, call `editor.getParagraphText(blockId)`.

Each result has two texts:

- `keptText` is the text a reader sees. Check it for spelling. It leaves out tracked deletions, move sources, and optional hyphens.
- `text` holds the offsets that `setHighlights()` takes. It includes deleted text and placeholder characters.

`keptSpans` maps `keptText` to `text`. A word that crosses a tracked deletion needs one highlight for each kept span.

The following source checks each paragraph once. An unchanged paragraph returns the same object, so the cache skips it after the first check.

```ts
import type { Editor, HighlightRange, ParagraphText } from '@docx-editor.dev/core';

/** Highlight ranges for the `keptText` range from `from` to `to`. */
function keptRanges(paragraph: ParagraphText, from: number, to: number) {
  const ranges: HighlightRange[] = [];
  for (const span of paragraph.keptSpans) {
    const keptStart = Math.max(from, span.keptStart);
    const keptEnd = Math.min(to, span.keptStart + span.length);
    if (keptStart >= keptEnd) continue;
    const start = span.start + keptStart - span.keptStart;
    const length = keptEnd - keptStart;
    const expectedText = paragraph.text.slice(start, start + length);
    ranges.push({ blockId: paragraph.blockId, start, length, expectedText });
  }
  return ranges;
}

/** A highlight source that marks each word that `isMisspelled` rejects. */
export function spellingSource(isMisspelled: (word: string) => boolean) {
  const checked = new WeakMap<ParagraphText, HighlightRange[]>();
  return (editor: Editor): HighlightRange[] =>
    editor.getParagraphs().flatMap((paragraph) => {
      let ranges = checked.get(paragraph);
      if (!ranges) {
        ranges = [];
        for (const word of paragraph.keptText.matchAll(/[\p{L}\p{M}']+/gu)) {
          if (!isMisspelled(word[0])) continue;
          const end = word.index + word[0].length;
          ranges.push(...keptRanges(paragraph, word.index, end));
        }
        checked.set(paragraph, ranges);
      }
      return ranges;
    });
}
```

Pass the source to `useHighlights`. It runs again after each document change.

```tsx
import { useMemo } from 'react';
import { useHighlights } from '@docx-editor.dev/react';
import { spellingSource } from './spelling-source';

export function SpellingMarks({ isMisspelled }: { isMisspelled: (word: string) => boolean }) {
  // Create the source again only when the checker changes, so its cache survives renders.
  const source = useMemo(() => spellingSource(isMisspelled), [isMisspelled]);
  useHighlights('spelling', source, { className: 'spelling-error' });
  return null;
}
```

Offsets count UTF-16 code units and follow the editor's `fieldResults` setting. By default, each field is one U+FFFC character in both texts, including hyperlink fields. With `fieldResults: 'editable'`, supported saved field results are text. In `keptText`, a symbol character is U+FFFC and a non-breaking hyphen is U+2011. Hidden text is included.

If your checker is asynchronous, keep the paragraph object with each request. When the result arrives, compare that object with `editor.getParagraphText(paragraph.blockId)`. If they differ, the paragraph changed, so discard the result and check the new object.

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
