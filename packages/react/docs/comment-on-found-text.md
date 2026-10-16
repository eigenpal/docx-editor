<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Comment on found text

In a browser host, find the text with `editor.findMatches`, select the first match with `editor.selectMatch`, and then call `useReview().comment`. The comment is written as the editor's `author`, so set `author` on the editor and add `reviewModule()` to its modules. `selectMatch` opens the header, footer, or note that holds the match, so a match in any story works.

```tsx
import { useDocxEditor } from '@docx-editor.dev/react';
import { useReview } from '@docx-editor.dev/pro/react';

export function CommentOnTerm({ term }: { term: string }) {
  const editor = useDocxEditor();
  const { comment } = useReview();
  const run = () => {
    const [match] = editor?.findMatches(term, { wholeWord: true }) ?? [];
    if (match && editor?.selectMatch(match).ok) comment(`Define "${term}".`);
  };
  return <button onClick={run}>Comment on {term}</button>;
}
```

`comment` returns `false` when the editor refuses the write. Read `useReview().lastRefusal` for the diagnostic code.

## Comment in a headless pipeline

On a server or in an agent pipeline, search the body and call `Range.insertComment`. The runtime writes the comment as its `author` option.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes, { author: 'Review bot' });
await runtime.run(async (context) => {
  const found = context.document.body.search(term, { matchWholeWord: true });
  found.load('items');
  await context.sync();
  found.items[0]?.insertComment(`Define "${term}".`);
  await context.sync();
});
const saved = await runtime.save();
runtime.dispose();
```

Both paths save the same comment markup: the same `w:comment` attributes, the same date format, and the same range markers.

## Reply to a thread

To answer an existing comment, call `useReview().reply(item, text)` in a browser host, or `Comment.reply(text)` in the editing API.
