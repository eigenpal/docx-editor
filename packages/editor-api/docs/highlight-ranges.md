<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Highlight ranges

Call `useHighlights(name, source, options)` to mark text as a named set while a component is mounted. Highlights are local view state. They do not change the document and are not saved.

## Highlight matching text

The following component marks each whole-word match of a list of terms. Style the `glossary-term` class with your own CSS, or omit `className` for the default fill.

**React**

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

**Vue**

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

## Run the source again

A function source runs again after document changes. If it also reads your own state, call `refresh()` after that state changes. Examples are a word that you add to a dictionary, or a result that arrives from a server. The following component stops marking a term after you ignore it.

**React**

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

**Vue**

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

**React**

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

**Vue**

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
