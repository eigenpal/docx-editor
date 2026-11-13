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

Offsets count UTF-16 code units and follow the editor's `fieldResults` setting. By default, each field is one U+FFFC character in both texts, including `HYPERLINK` fields. Link text in a `w:hyperlink` element is ordinary text. With `fieldResults: 'editable'`, supported saved field results are text. In `keptText`, a non-breaking hyphen is U+2011.

If your checker is asynchronous, keep the paragraph object with each request. When the result arrives, compare that object with `editor.getParagraphText(paragraph.blockId)`. If they differ, the paragraph changed, so discard the result and check the new object. Undo can return an earlier object, and its earlier result is still correct. Loading another document can reuse paragraph IDs, so discard pending results when you load a document.

## Run the source again

A function source runs again after document changes. If it also reads your own state, call `refresh()` after that state changes. Examples are a word that you add to a dictionary, or a result that arrives from a server. The following component stops marking a term after you ignore it.

```tsx
import { useCallback, useRef } from 'react';
import { useHighlights, type Editor } from '@docx-editor.dev/react';

export function TermMarks({ terms }: { terms: readonly string[] }) {
  const ignored = useRef(new Set<string>());
  const findTerms = useCallback(
    (editor: Editor) =>
      editor
        .findMatches(terms, { wholeWord: true })
        .flat()
        .filter((match) => !ignored.current.has(match.text)),
    [terms]
  );
  const { refresh } = useHighlights('terms', findTerms);
  const ignore = (term: string) => {
    ignored.current.add(term);
    refresh();
  };
  return <button onClick={() => ignore(terms[0] ?? '')}>Ignore first term</button>;
}
```

`refresh()` replaces a run that waits for typing to pause, so the source runs once. In React, the set updates at once, and `refresh` keeps its identity across renders. Call it from an effect or an event handler, not during render. In Vue, the set updates in the next flush, before the next paint. After the component unmounts, `refresh()` does nothing.

## Read highlights in the context menu

Call `useContextMenuHighlights(name)` in a row inside `ContextMenu.Start` to read the highlights that the menu is about. For a right-click, these are the highlights under the pointer. If the menu opens from the keyboard, with Shift+F10 or the Menu key, these are the highlights that contain the caret. Add your own fields to each range, and read them back from `range`. The following rows offer a replacement for a marked term, from a right-click or from the keyboard.

```tsx
import {
  DocxEditor,
  useContextMenuHighlights,
  useDocxEditor,
  useHighlights,
  type Editor,
  type TextMatch,
} from '@docx-editor.dev/react';

type TermRange = TextMatch & { readonly replacement: string };

function ReplacementRows({ recheck }: { recheck: () => void }) {
  const editor = useDocxEditor();
  const [hit] = useContextMenuHighlights<TermRange>('terms');
  if (!hit || !editor) return null;
  const replace = () => {
    const result = editor.exec({
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
    if (!result.ok && result.code === 'notFound') recheck();
  };
  return <DocxEditor.ContextMenu.Item label={hit.range.replacement} onSelect={replace} />;
}

// Render inside DocxEditor.Viewport. Pass a stable `findTerms`, such as one from useCallback.
export function TermMenu({ findTerms }: { findTerms: (editor: Editor) => TermRange[] }) {
  const { refresh } = useHighlights('terms', findTerms);
  return (
    <DocxEditor.ContextMenu>
      <DocxEditor.ContextMenu.Start>
        <ReplacementRows recheck={refresh} />
      </DocxEditor.ContextMenu.Start>
    </DocxEditor.ContextMenu>
  );
}
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
