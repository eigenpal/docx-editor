<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Replace as a tracked change

In a browser host, find the text with `editor.findMatches` and replace one match with the `replaceMatch` command. In suggesting mode, the replacement is a tracked change as the editor's `author`. The selection and the scroll position do not move.

```tsx
import { useDocxEditor } from '@docx-editor.dev/react';

export function ProposeTerm({ from, to }: { from: string; to: string }) {
  const editor = useDocxEditor();
  const run = () => {
    if (!editor || !editor.setEditingMode('suggesting').ok) return;
    const [match] = editor.findMatches(from, { matchCase: true });
    if (match) editor.exec({ type: 'replaceMatch', match, text: to });
  };
  return <button onClick={run}>Propose {to}</button>;
}
```

Suggesting mode needs an editor `author`. Without one, `setEditingMode('suggesting')` refuses. To replace every match in one undo step, use `editor.exec({ type: 'replaceAllMatches', query, text })`.

## Replace in a headless pipeline

In the editing API, set `document.changeTrackingMode` to `'TrackMineOnly'`, and then replace the found range with `insertText(text, 'Replace')`.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes, { author: 'Review bot' });
await runtime.run(async (context) => {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const found = context.document.body.search(from, { matchCase: true });
  found.load('items');
  await context.sync();
  found.items[0]?.insertText(to, 'Replace');
  await context.sync();
});
const saved = await runtime.save();
runtime.dispose();
```

Both paths save the same `w:del` and `w:ins` structure, with the same author and date format. Never turn tracking off to make a refused tracked edit succeed.
