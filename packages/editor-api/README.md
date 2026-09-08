<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/editor-api"><img src="https://img.shields.io/npm/v/@docx-editor.dev/editor-api.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/editor-api"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/editor-api.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/LICENSE.md"><img src="https://img.shields.io/badge/license-EigenPal_Pro_Evaluation_1.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/editor-api

`@docx-editor.dev/editor-api` edits DOCX files through a supported subset of Word's
JavaScript object model, including paragraphs, ranges, comments, and revisions.
Use `load()` to queue reads and `sync()` to apply each batch atomically.

Run the API on a server over DOCX bytes or in the browser against an open editor.
See [Office.js compatibility](https://www.docx-editor.dev/docs/2.x/editor-api/office-js-api)
for supported members and differences from Word.

```bash
npm install @docx-editor.dev/editor-api @docx-editor.dev/core
```

Server use requires Node.js `^20.16.0 || >=22.3.0`.

## On a server

The default entry needs no browser and nothing to mount. It opens DOCX bytes, edits them, and
hands them back.

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(await readFile('contract.docx'), {
  author: 'Review bot',
});
try {
  const filled = await runtime.run(async (context) => {
    const matches = context.document.body.search('{{cap}}', { matchCase: true });
    matches.load();
    await context.sync(); //  one round trip: now you know what was found

    for (const match of matches.items) match.insertText('$500k', 'Replace');
    await context.sync(); //  one atomic batch: all of the writes, or none
    return matches.items.length;
  });
  console.log(`replaced ${filled}`);
  await writeFile('contract.filled.docx', await runtime.save());
} finally {
  runtime.dispose();
}
```

`createServer` finishes its bounded parse before its promise resolves and does not retain the input
`Uint8Array`; you may reuse or transfer that buffer afterward. Every `save()` returns a fresh,
caller-owned `Uint8Array`, so transferring or mutating one result does not affect the runtime or a
later save. Detached edits remain detached until your application explicitly loads the returned
bytes into a live editor.

## Create tracked changes on a server

Start with the [Office.js developer guide](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/OFFICE_JS_GUIDE.md) for a complete server example and batching conventions.

Set `document.changeTrackingMode = 'TrackMineOnly'`, then use standard Word editing methods.
Supply the agent's `author` when opening the server or collaborative runtime:

```ts
await runtime.run(async (context) => {
  const matches = context.document.body.search('within 7 days');
  matches.load('items');
  await context.sync();
  if (matches.items.length !== 1) throw new Error('Choose a unique target');

  context.document.changeTrackingMode = 'TrackMineOnly';
  const replacement = matches.items[0]!.insertText('within 30 days', 'Replace');
  await context.sync();
  replacement.load('text');
  await context.sync();
});
```

Use `range.insertText(text, 'Before' | 'After')` for insertions, and `range.delete()` or
`range.clear()` for deletions. `insertText()` returns the inserted range. Mode assignments
and edits commit together at `sync()`; failed batches preserve the previous mode and document.
Load `document.changeTrackingMode` before reading it. `Off` is the initial mode.

This is a supported Office.js subset. `TrackMineOnly` applies to this server host and persists
across its `run()` calls. It does not change peers' tracking settings or save a document-wide
tracking policy. `TrackAll` and browser-host mode control explicitly refuse with `NotSupported`.
Tracked text edits support one paragraph, including table-cell text. They refuse targets touching
pending revisions. Structural and formatting mutations under tracking also refuse. Comments and
revision decisions remain available. Set `Off` explicitly when permanent edits are intended.

See the [server-agent review example](../../examples/server-agent-review/README.md) for Hocuspocus,
stale-read handling, and the review lifecycle.

## In the browser

The browser entry takes an editor the host already created, from `@docx-editor.dev/react` or a
plain page, and drives it in place. Edits land in the open document with the reader's undo
stack intact. There is no `save()`: the host saves as it already did.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';

const runtime = DocxEditor.createBrowser(editor, { author: 'Demo Reviewer' });
await runtime.run(async (context) => {
  const heading = context.document.body.paragraphs.getFirstOrNullObject();
  heading.load('text');
  await context.sync();

  if (!heading.isNullObject) heading.font.bold = true;
  await context.sync();
});
```

Use the `/browser` entry for an open editor. Use the root entry on servers to exclude
browser rendering code from the bundle.

`author` is optional for ordinary edits. Supply it for `Range.insertComment()`,
`Comment.reply()`, and server-side `TrackMineOnly` mode. A missing identity refuses with `NotSupported`; a
live comment write also requires the Pro review module and a writable editing mode. There is no
static comment-write capability because those conditions are dynamic, so callers should handle the
typed refusal from the call or `sync()`.

`range.insertComment(text)` creates a top-level comment over that exact range and returns the new
`Comment`. Collapsed ranges create insertion-point comments. Empty text and ranges crossing table
cells are refused; duplicate author names are ordinary OOXML and are not deduplicated.

`Comment.delete()` removes a root comment, its replies, and its anchors. `CommentReply.delete()`
removes only that reply and preserves the parent and siblings. Several deletes queued before one
`sync()` are one atomic transaction and one browser Undo unit. Browser comment writes require the
Pro review module and a writable, attached editor; server writes are provided by this Pro-licensed
runtime. Root creation follows the same browser gate and is one Undo unit.

`document.revisions` is the main-body story. `Body.revisions` is story-scoped: a header, footer,
or note collection names that story only. `items` contains revisions this API can publish as typed
Word objects. Structural cards whose exact subtype cannot be named are omitted from `items` and
remain preserved in the file. Collection membership is not the collection decision set:
`acceptAll()` and `rejectAll()` still resolve every store-resolvable revision in that story —
including a complete tracked row — and refuse atomically if any `readOnly` or otherwise unsupported
revision remains. They never resolve only the listed subset. Handle a `NotImplemented` refusal and
leave the document unchanged, or let a reviewer resolve the remaining markup in Word. Browser
decisions join the editor's Undo stack, with one collection decision as one Undo unit.

## Programming model

- A property you did not `load()` throws instead of answering `undefined`, so a typo fails at
  the read rather than producing a wrong document later.
- `sync()` is the only round trip. Everything queued between two syncs is one ordered batch,
  applied atomically.
- Proxies remain valid across `sync()` calls within a `run()`. To reuse a proxy in a later
  run, add it to `context.trackedObjects` and pass it to `runtime.run(object, callback)`.
  No proxy remains valid after `dispose()`.
- `getFirstOrNullObject` / `getLastOrNullObject` answer an object whose `isNullObject` is
  `true`, which is the difference between "no such heading" and a crash.
- Review timestamps come from untrusted, optional OOXML attributes. `Comment.creationDate`,
  `CommentReply.creationDate`, and `Revision.date` are `Date | null`; narrow `null` before calling
  `Date` methods.

`runtime.capabilities` says what the host behind a runtime can do: `save` is false in the
browser; `selection`, `scrolling` and `layout` are false on a server. It is frozen for the
life of the runtime, so one read stays true.

## Entries

| Entry                                 | Use when                                             |
| ------------------------------------- | ---------------------------------------------------- |
| `@docx-editor.dev/editor-api`         | Servers, workers, build scripts: bytes in, bytes out |
| `@docx-editor.dev/editor-api/browser` | A page, driving an editor the host already created   |

Both entries export the same vocabulary — the lifecycle types, the object model and the error
type — so consumer code compiles against either. They differ by one member: `createBrowser`.

## Office.js compatibility

The API is compatible with a documented subset of Word's JavaScript object model, so a call
site written against that vocabulary compiles here. It is not Office.js: it does not run in an
Office add-in host and depends on no Microsoft package. Every type in the surface is authored
in this repository.

The supported subset and its documented omissions (tables, images, repeating sections, custom
XML mapping) are listed in
[the Office.js compatibility page](https://www.docx-editor.dev/docs/latest/editor-api/office-js-api).

Upgrading from the reviewer/bridge/MCP/chat surfaces this package used to ship? See
[MIGRATION.md](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/MIGRATION.md).

## Packages

| Package                                                                                    | Description                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react)           | React adapter. `<DocxEditor>`, provider primitives, hooks, and compound chrome.                   |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core)             | Framework-agnostic engine: OOXML read/write, canonical document tree, layout, paint.              |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n)             | Shared locale strings and types.                                                                  |
| [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro)               | Tracked changes, comments, and custom nodes.                                                      |
| [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) | Office.js-compatible editing API: a batching object model, on a server or against an open editor. |

## License

This package is licensed under the [EigenPal Pro License](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/LICENSE.md), and you can compare and buy license and support levels on the [pricing page](https://www.docx-editor.dev/pricing).

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
