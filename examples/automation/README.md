# Document automation

`@docx-editor.dev/editor-api` drives a document through a batching object model. Nothing here
needs a framework, and the server half needs no browser: it opens DOCX bytes, edits them and
writes them back.

```bash
bun run examples/automation/fill-template.ts examples/remix/public/sample.docx out.docx
```

## The shape of it

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes, { author: 'Payroll bot' });
try {
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items'); // 1. ask for the collection's items
    await context.sync(); //      2. receive those items

    for (const paragraph of paragraphs.items) {
      paragraph.load('text'); // 3. ask for each item's text
    }
    await context.sync(); //      4. receive the text

    for (const paragraph of paragraphs.items) {
      if (paragraph.text.includes('{{name}}')) paragraph.insertText('Ada Lovelace', 'Replace');
    }
    await context.sync(); //      5. apply the edits all-or-nothing
  });
  await Bun.write('out.docx', await runtime.save());
} finally {
  runtime.dispose();
}
```

The first sync retrieves the collection's items. Only then are the individual paragraphs
available to ask for their text, so the second sync retrieves those property values.

Four rules carry most of the API:

- **Read what you asked for.** A property you did not `load()` throws instead of answering
  `undefined`, so a typo is a failure at the read and not a wrong document three steps later.
  Navigation-property `expand` is not supported yet: non-empty values fail with
  `InvalidArgument`, so load the navigation object or collection explicitly.
- **`sync()` is the only round trip.** Everything between two syncs is one ordered batch that
  either applies whole or not at all.
- **Objects live inside `run`.** They are proxies into a document the runtime owns; keeping one
  past the callback, or past `dispose()`, is an error rather than a stale read. To keep a proxy
  across syncs deliberately, use `context.trackedObjects`.
- **Ask before you assume.** `getFirstOrNullObject` and `getLastOrNullObject` answer an object whose `isNullObject` is
  `true` instead of throwing, which is the difference between "no such heading" and a crash.

## In a page, on a document already open

The browser subpath takes an editor the host already created — from
`@docx-editor.dev/react`, `@docx-editor.dev/vue`, or a plain page — and drives it in place.
Edits land in the open document, with the reader's undo stack intact, so there is no `save()`
here: the host saves the way it already did.

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

Import it from `/browser` deliberately: reaching a live editor means reaching the painted
engine, and a server holding bytes should not pay for that.

## Authorship, and asking what the host can do

`createServer(bytes, { author })` names who comments are written as. It is required to write one
at all: the file format makes the author mandatory, a server has no signed-in user, and a
runtime opened without a name refuses the write rather than putting a placeholder into someone
else's document.

Not every host can do everything, and `runtime.capabilities` says which — `save` is false for a
browser runtime, `selection`, `scrolling` and `layout` are false for a server one. Branch on it
rather than on which entry you imported; it is frozen for the life of the runtime, so one read
stays true.

## What this is, and is not

The Office.js Word-shaped DocxEditor API is compatible with a documented subset of Word's
JavaScript object model, so a call site written against that vocabulary compiles here. It is
not Office.js, does not run in an Office add-in host, and depends on no Microsoft package.
Every type in the surface is authored in this repository.

The supported subset, and the omissions that matter (tables, images, repeating sections and
custom XML mapping), are listed in
[`docs/site/content/editor-api/office-js-api.mdx`](../../docs/site/content/editor-api/office-js-api.mdx).
