# Word document automation

`@docx-editor.dev/editor-api` opens DOCX bytes, queues edits, and saves the edited document. This example fills template placeholders without a browser.

## Run the example

From the repository root, install dependencies and build the workspace packages:

```bash
bun install
bun run build:packages
bun run --filter './examples/automation' fill
```

The `fill` package script runs `fill-template.ts` with the sample input. It writes `examples/automation/filled.docx`.

## Use the API

The following example shows the server API directly. It is not the complete `fill-template.ts` script.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

const bytes = await Bun.file('template.docx').bytes();
const runtime = await DocxEditor.createServer(bytes, { author: 'Payroll bot' });
try {
  await runtime.run(async (context) => {
    const matches = context.document.body.search('{{name}}', { matchCase: true });
    matches.load('items');
    await context.sync();

    for (const match of matches.items) {
      match.insertText('Ada Lovelace', 'Replace');
    }
    await context.sync();
  });
  await Bun.write('out.docx', await runtime.save());
} finally {
  runtime.dispose();
}
```

The first sync retrieves the matching ranges. The second sync replaces only the placeholders and preserves surrounding text.

Bookmarks are discoverable from the story that owns them, without searching for target text first:

```ts
await runtime.run(async (context) => {
  const bookmarks = context.document.body.bookmarks;
  bookmarks.load();
  await context.sync();

  for (const bookmark of bookmarks.items) bookmark.load('name');
  await context.sync();
  console.log(bookmarks.items.map(({ name }) => name));
});
```

That collection covers the main body story only. Header and footer bodies have separate bookmark collections; there is no document-wide aggregation.

Follow these rules when you use the API:

- Load properties before reading them. Unsupported navigation-property `expand` values fail with `InvalidArgument`; load each navigation object or collection explicitly.
- Use `context.sync()` to execute queued commands. Batch independent edits before a sync.
- Keep proxies inside their `run()` callback. Return plain data when another part of your application needs the result.
- Use `getFirstOrNullObject()` or `getLastOrNullObject()` when an item might not exist. Check `isNullObject` after synchronization.

## Edit an open browser document

The browser subpath takes an editor that the host created with `@docx-editor.dev/react`, `@docx-editor.dev/vue`, or a plain page. It drives that editor in place. Edits land in the open document, with the reader's undo stack intact, so there is no `save()` here: the host saves the way it already did.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';

const runtime = DocxEditor.createBrowser(editor);
await runtime.run(async (context) => {
  const heading = context.document.body.paragraphs.getFirstOrNullObject();
  heading.load('text');
  await context.sync();

  if (!heading.isNullObject) heading.font.bold = true;
  await context.sync();
});
```

Import it from `/browser` deliberately: reaching a live editor means reaching the painted engine, and a server holding bytes should not pay for that.

## Set the author and check host capabilities

`createServer(bytes, { author })` names who comments are written as. It is required to write one at all: the file format makes the author mandatory, a server has no signed-in user, and a runtime opened without a name refuses the write rather than putting a placeholder into someone else's document.

Deletion needs no author. `Comment.delete()` removes the root thread and anchors; `CommentReply.delete()` removes only that reply. Queue several calls before one `sync()` to make them one atomic edit and one Undo unit in a browser. Browser comment writes require the EigenPal Pro License review module and a writable, attached editor. Use `Range.insertComment()` to create a root comment.

`runtime.capabilities` reports the available host features. `save` is false for a browser runtime. `selection` and `scrolling` are false for a server runtime. Server layout requires an explicitly configured text measurer. Branch on these values instead of the imported entry. The values do not change during the runtime.

## Office.js compatibility

The API implements a documented subset of the Word Office.js object model. It runs outside Office and requires no Microsoft package. Matching signatures do not guarantee full runtime compatibility.

For supported members and runtime differences, see [Office.js compatibility](../../docs/site/content/editor-api/office-js-api.mdx).
