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

## Check spelling and grammar

Call `editor.getParagraphs()` to read every paragraph, including paragraphs on pages that have not been painted. The list covers body text, tables, content controls, headers, footers, notes, and supported text boxes. Repeated headers and footers appear once. To read one paragraph, call `editor.getParagraphText(blockId)`.

The list is empty until a document opens. A large document opens in steps, so read the list again after each `change` event. A function source of `useHighlights` does this for you.

### Choose the text to check

Each paragraph has three parts:

- `acceptedText` is the paragraph text with every tracked change accepted. Insertions are in, and tracked deletions and move sources are out. Hidden text and optional hyphens are left out too. Check spelling and grammar in this text.
- `text` holds the offsets that `setHighlights()` takes and that the caret reports. It includes deleted and hidden text.
- `proofing` lists stretches of `acceptedText` with their language, such as `en-GB`, and a `noProof` flag. Skip text that has `noProof` set, and check other text in its own language. East Asian characters and complex-script text have their own language tags.

In `acceptedText`, a tab reads as `\t` and a line break as `\n`. An object, such as a picture, a note reference, a symbol, or a field, reads as U+FFFC. Treat all three as word boundaries. To check the saved text of fields, read `editor.getParagraphs({ fields: 'result' })`. That read does not change how the editor addresses fields.

`acceptedText` does not depend on the review display mode. In the `original` mode, the page shows the text with every change rejected, so a mark on inserted text does not show.

A tracked change can make a word misspelled, for example a deletion of one letter in the middle of the word. If `acceptedTextRanges()` returns more than one range for a word, a tracked change or hidden text splits it. Tell the reader that the word reads this way after the changes are accepted.

### Mark misspelled words

The following module, `spelling.ts`, checks each paragraph once. An unchanged paragraph returns the same object, so the cache skips it after the first check. Each word gets one mark from the start of its first part to the end of its last part, so a word that a deletion splits shows one mark. The source skips the word at the caret, because the reader is still typing it.

```ts
// spelling.ts
import {
  acceptedOffsetFromText,
  acceptedTextRanges,
  type Editor,
  type HighlightRange,
  type ParagraphText,
} from '@docx-editor.dev/core';

/** Your checker. `lang` is the language tag of the word, or null. */
export interface SpellChecker {
  isMisspelled(word: string, lang: string | null): boolean;
  suggest(word: string, lang: string | null): readonly string[];
}

/** One mark for one misspelled word, with what a fix needs. */
export type SpellingRange = HighlightRange & {
  /** The word as `acceptedText` reads it. */
  readonly word: string;
  /** Where the word starts in `acceptedText`. */
  readonly acceptedStart: number;
  readonly suggestions: readonly string[];
};

const WORD = /[\p{L}\p{M}']+/gu;

function check(paragraph: ParagraphText, checker: SpellChecker): SpellingRange[] {
  const marks: SpellingRange[] = [];
  for (const match of paragraph.acceptedText.matchAll(WORD)) {
    const from = match.index;
    const stretch = paragraph.proofing.find(
      (part) => from >= part.acceptedStart && from < part.acceptedStart + part.length
    );
    if (!stretch || stretch.noProof) continue;
    const word = match[0];
    if (!checker.isMisspelled(word, stretch.lang)) continue;
    // One range per visible part of the word. The mark covers all of them.
    const parts = acceptedTextRanges(paragraph, from, from + word.length);
    const first = parts[0];
    const last = parts.at(-1);
    if (!first || !last) continue;
    const end = last.start + last.length;
    marks.push({
      blockId: paragraph.blockId,
      start: first.start,
      length: end - first.start,
      expectedText: paragraph.text.slice(first.start, end),
      word,
      acceptedStart: from,
      suggestions: checker.suggest(word, stretch.lang),
    });
  }
  return marks;
}

/** A highlight source that marks each misspelled word, except the word at the caret. */
export function spellingSource(checker: SpellChecker) {
  const checked = new WeakMap<ParagraphText, SpellingRange[]>();
  return (editor: Editor): SpellingRange[] => {
    const caret = editor.getSelectionRange()?.head;
    return editor.getParagraphs().flatMap((paragraph) => {
      let marks = checked.get(paragraph);
      if (!marks) {
        marks = check(paragraph, checker);
        checked.set(paragraph, marks);
      }
      if (caret?.blockId !== paragraph.blockId) return marks;
      // The caret counts in `text`; the marks count in `acceptedText`.
      const at = acceptedOffsetFromText(paragraph, caret.offset);
      return marks.filter(
        (mark) => at < mark.acceptedStart || at > mark.acceptedStart + mark.word.length
      );
    });
  };
}

/**
 * Replace a marked word. `at` is where the mark is now, such as a context menu hit.
 * Returns false when the text changed: check the document again.
 */
export function fixWord(
  editor: Editor,
  mark: SpellingRange,
  replacement: string,
  at: { readonly start: number } = mark
): boolean {
  const paragraph = editor.getParagraphText(mark.blockId);
  if (!paragraph) return false;
  const result = editor.exec({
    type: 'replaceAcceptedText',
    blockId: mark.blockId,
    start: acceptedOffsetFromText(paragraph, at.start),
    length: mark.word.length,
    text: replacement,
    expectedText: mark.word,
  });
  return result.ok;
}
```

`fixWord` runs the `replaceAcceptedText` command. It compares the word with the replacement and edits only the letters that differ, so the tracked changes of other authors stay where they are. A fix of a word that a deletion splits edits each part and is one undo step. In suggesting mode, the fix is a tracked change under the editor's author. If the word changed since it was checked, `expectedText` makes the command return `notFound` and change nothing.

### Fix words from the context menu

The following component marks misspelled words and offers the suggestions for the word under a right-click. It runs the source again when the caret moves to another paragraph, so the word that the reader typed gets its mark.

```tsx
import { useMemo, useRef } from 'react';
import {
  DocxEditor,
  useContextMenuHighlights,
  useDocxEditor,
  useEditorEvent,
  useHighlights,
} from '@docx-editor.dev/react';
import { fixWord, spellingSource, type SpellChecker, type SpellingRange } from './spelling';

function SuggestionRows({ recheck }: { recheck: () => void }) {
  const editor = useDocxEditor();
  const [hit] = useContextMenuHighlights<SpellingRange>('spelling');
  if (!hit || !editor) return null;
  return (
    <>
      {hit.range.suggestions.map((suggestion) => (
        <DocxEditor.ContextMenu.Item
          key={suggestion}
          label={suggestion}
          // The hit says where the mark is now, after edits before it.
          onSelect={() => fixWord(editor, hit.range, suggestion, hit) || recheck()}
        />
      ))}
    </>
  );
}

// Render inside DocxEditor.Viewport. Pass a stable `checker`.
export function SpellingMarks({ checker }: { checker: SpellChecker }) {
  const source = useMemo(() => spellingSource(checker), [checker]);
  const { refresh } = useHighlights('spelling', source, { className: 'spelling-error' });
  const caretParagraph = useRef<string | undefined>(undefined);
  useEditorEvent('selectionChange', (snapshot) => {
    const blockId = snapshot.selectionRange?.head.blockId;
    if (blockId === caretParagraph.current) return;
    caretParagraph.current = blockId;
    refresh();
  });
  return (
    <DocxEditor.ContextMenu>
      <DocxEditor.ContextMenu.Start>
        <SuggestionRows recheck={refresh} />
      </DocxEditor.ContextMenu.Start>
    </DocxEditor.ContextMenu>
  );
}
```

To fix words from a side list, keep the marks that the source returned, and call `fixWord(editor, mark, suggestion)` from the list. Build the list again after each `change` event. If `fixWord` returns false, the word changed, so check the document again.

### Check text asynchronously

If your checker runs on a server, keep the paragraph object and the document identity with each request. The document identity is `editor.getDocumentHandle().loadId`. It is new on every `load()`, which can reuse block IDs. When the result arrives, discard it if the `loadId` changed, or if `editor.getParagraphText(paragraph.blockId)` returns another object. Undo can return an earlier object, and its earlier result is still correct.

```ts
import type { Editor, ParagraphText } from '@docx-editor.dev/core';

/** Check one paragraph on a server. Resolves to null when the result is stale. */
export async function checkRemotely(
  editor: Editor,
  paragraph: ParagraphText,
  request: (text: string) => Promise<readonly { start: number; length: number }[]>
) {
  const loadId = editor.getDocumentHandle().loadId;
  const issues = await request(paragraph.acceptedText);
  const current = editor.getParagraphText(paragraph.blockId);
  if (editor.getDocumentHandle().loadId !== loadId || current !== paragraph) return null;
  return issues;
}
```

A result can still go stale between the check and a fix. Pass the checked text as `expectedText` to `replaceAcceptedText`, so a stale fix returns `notFound` and changes nothing.

### Check terminology

To find a term, search `acceptedText`, not `editor.findMatches()`. Search finds the text that a tracked deletion removes, and it misses a term that a deletion splits. The following function marks each occurrence of a term with one mark.

```ts
import { acceptedTextRanges, type Editor, type HighlightRange } from '@docx-editor.dev/core';

export function termMarks(editor: Editor, term: string): HighlightRange[] {
  const marks: HighlightRange[] = [];
  for (const paragraph of editor.getParagraphs()) {
    for (let at = paragraph.acceptedText.indexOf(term); at >= 0;) {
      const parts = acceptedTextRanges(paragraph, at, at + term.length);
      const first = parts[0];
      const last = parts.at(-1);
      if (first && last) {
        const end = last.start + last.length;
        marks.push({
          blockId: paragraph.blockId,
          start: first.start,
          length: end - first.start,
          expectedText: paragraph.text.slice(first.start, end),
        });
      }
      at = paragraph.acceptedText.indexOf(term, at + term.length);
    }
  }
  return marks;
}
```

To replace a term, run `replaceAcceptedText` with the term's offset in `acceptedText` and the term as `expectedText`.

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
| `unavailable` | The number of ranges that do not resolve or paint. While a large document lays out in the background, it includes ranges on pages that are not laid out yet, and it updates as they are. |
| `refresh()` | Runs the source again, or applies an array again. |

## Use highlights outside components

Call `watchHighlights(editor, name, source, options)` from `@docx-editor.dev/core/editor` to follow document changes. Call `stop()` on the returned watch to remove the set and stop watching. For a fixed set that does not refresh, call `editor.setHighlights`.

## See also

- [Highlight text ranges](https://www.docx-editor.dev/docs/2.x/guides/navigation#highlight-text-ranges)
- [React hooks](https://www.docx-editor.dev/docs/2.x/react/hooks#usehighlights)
- [Vue composables](https://www.docx-editor.dev/docs/2.x/vue/composables#usehighlights)
