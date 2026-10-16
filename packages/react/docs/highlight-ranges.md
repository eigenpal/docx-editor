<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Highlight ranges

Use `useHighlights(name, source, options)` to mark text as a named set while a component is mounted. A function source runs again after document changes, so the marks follow the text. Highlights are view state. They do not change the document and are not saved.

```tsx
import { useCallback } from 'react';
import { useHighlights, type Editor } from '@docx-editor.dev/react';

export function GlossaryMarks({ terms }: { terms: readonly string[] }) {
  const findTerms = useCallback(
    (editor: Editor) => editor.findMatches(terms, { wholeWord: true }).flat(),
    [terms]
  );
  const { applied } = useHighlights('glossary', findTerms, { className: 'glossary-term' });
  return <span>{applied} marked</span>;
}
```

Keep a function source stable with `useCallback`.

Use a unique `name` for each set. Two calls with the same name replace each other's ranges. Set `activeIndex` in the options to show one range in the active color, for example the current result of your own search list.

Outside a component, call `watchHighlights(editor, name, source, options)` from `@docx-editor.dev/core/editor`, or `editor.setHighlights` for a fixed set.
