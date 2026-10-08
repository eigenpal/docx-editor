# Office.js patterns for server agents

The public document model follows a documented subset of Word's Office.js API. Host creation, authentication, collaboration transport, and job lifetime belong outside that model.

## A complete server example

This function returns a DOCX containing one pending replacement. Supply the agent's author name. The `finally` block disposes the runtime after the job.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

export async function redlineQuote(
  bytes: Uint8Array,
  quote: string,
  replacement: string,
  author: string
): Promise<Uint8Array> {
  if (typeof replacement !== 'string' || replacement.length === 0) {
    throw new Error('Replacement text is required. Use an explicit deletion to remove the quote.');
  }
  const runtime = await DocxEditor.createServer(bytes, { author });
  try {
    await runtime.run(async (context) => {
      const matches = context.document.body.search(quote, { matchCase: true });
      matches.load('items');
      await context.sync();
      if (matches.items.length !== 1) throw new Error('Choose one unique quote');

      context.document.changeTrackingMode = 'TrackMineOnly';
      matches.items[0]!.insertText(replacement, 'Replace');
      await context.sync();
    });
    return await runtime.save();
  } finally {
    runtime.dispose();
  }
}
```

The same `run()` block works on `DocxEditor.createCollaborative(...)`. Its commits reach connected peers through the collaboration session. See the [complete Hocuspocus worker](https://github.com/eigenpal/docx-editor/blob/main/examples/server-agent-review/README.md#copyable-server-integration) for joining a room, waiting for outbound synchronization, and cleanup.

## Load deliberately and batch reads

Only load properties you will read. Navigation properties and property assignments do not need a preceding load. Use `load('items')` before iterating a collection. Queue member loads together, then sync once:

```ts
const snapshot = await runtime.run(async (context) => {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load('items');
  await context.sync();

  const page = paragraphs.items.slice(0, 40);
  for (const paragraph of page) paragraph.load('text');
  await context.sync();
  return page.map((paragraph) => paragraph.text);
});
```

This follows Microsoft's [split-loop and correlated-objects guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/correlated-objects-pattern). Bound model input and member-property loads. The collection's `items` load still enumerates its members; slicing the array does not paginate the collection on the server.

Supported read-derived proxies can share one `sync()` with their edits. For example, `body.getRange().insertText(text, 'Replace')` and `table.getCell(0, 0).value = text` resolve their reads before one atomic write transaction. This can use extra read-only transport calls. Every phase uses the same revision; concurrent changes cause `StaleDocument`.

Proxies returned by insertions require a completed `sync()` before dependent operations. Do not configure a newly inserted table, image, list, or text range before that sync. If a prerequisite fails, the runtime commits no queued writes. Completed prerequisite reads can remain loaded after a later command fails.

## Keep writes within one story

A story is the main body, a header, a footer, or another document text container. One `context.sync()` can write only one story. Writes across stories fail with `ConflictingChanges`. Reads from different stories can share a sync.

If the document has a primary header and footer, resolve both objects before formatting them. Then commit each story's writes separately:

```ts
await runtime.run(async (context) => {
  const section = context.document.sections.getFirst();
  await context.sync();
  const stories = [section.getHeader('Primary'), section.getFooter('Primary')];
  await context.sync();

  for (const story of stories) {
    story.font.name = 'Calibri';
    story.font.size = 10;
    await context.sync();
  }
});
```

Each write sync creates a separate transaction. Earlier successful transactions remain if a later transaction fails. Linked headers or footers can share content. Re-read that content before making a dependent edit through another section.

## Preserve Office.js enum property types

Like Office.js, `Document.changeTrackingMode` and `PageSetup.orientation` use unions of the enum and its string literals for both reads and writes. Enum constants and the corresponding string literals are accepted by the type system. This matches Microsoft's [change-tracking declaration](https://learn.microsoft.com/en-us/javascript/api/word/word.document#word-word-document-changetrackingmode-member) and [page-orientation declaration](https://learn.microsoft.com/en-us/javascript/api/word/word.pagesetup#word-word-pagesetup-orientation-member).

Let TypeScript infer a property's type, or use an indexed-access type when saving its value. An enum-only annotation is narrower than the Office.js property type:

```ts
import { ChangeTrackingMode, type Document } from '@docx-editor.dev/editor-api';

const mode = await runtime.run(async (context) => {
  context.document.load('changeTrackingMode');
  await context.sync();
  const current: Document['changeTrackingMode'] = context.document.changeTrackingMode;
  return current;
});
const trackingMine = mode === ChangeTrackingMode.trackMineOnly;
```

For orientation, use `PageSetup['orientation']` in the same way after loading and syncing that property. Type compatibility does not imply support for every enum value: `TrackAll` fails with `NotSupported` at `sync()`.

## Give each sync a purpose

A sync either supplies data for the next decision or commits a complete edit. Batch independent reads and writes. For progressive agent review, one completed suggestion per sync is intentional: peers see each suggestion as it is ready. For independent edits in different paragraphs, multiple edits can share one sync and one transaction. Edits that claim the same paragraph can conflict; reconsider their anchors between commits.

Always await sync. Do not replace sequential syncs with `Promise.all()` or `forEach(async ...)`. Use an explicit final sync when writes remain queued. Do not add an empty sync after a completed read-only batch. These conventions follow Microsoft's [application-specific API model](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model).

## Keep proxy lifetimes clear

Keep document proxies within their `runtime.run()` callback. Return plain text or structured snapshots to the model, not `Range` or `Paragraph` objects. Do not retain a proxy in a job record or reuse it after its run finishes. Explicit tracked-object adoption exists for advanced cases; fresh reads are simpler for background workers.

If model generation happens inside a run, commit against the revision that run read. If it happens outside, keep a validated snapshot and re-anchor in a new run. The example's tool adapter checks both the paragraph snapshot and document digest. On `StaleDocument`, read again and reconsider the proposal. Recheck the target before retrying.

## Use errors to recover deliberately

Use `isDocxEditorError(error)` and branch on `error.code`. `error.target` identifies the failing public member. Do not parse message strings. A failed sync does not apply its queued document edits or tracking-mode changes. Earlier successful syncs remain committed. Failed batches are discarded and are never automatically replayed.

| Code | Next action |
| --- | --- |
| `PropertyNotLoaded` | Load the named property and await sync before reading it. |
| `InvalidObjectPath` | Sync before using a newly returned proxy, or acquire a fresh proxy in a new run. |
| `StaleDocument` | Re-read, re-anchor, and reconsider the model proposal. |
| `ConflictingChanges` | Separate edits that claim the same paragraph and reconsider anchors between commits. |
| `NotSupported` | Check the host, tracking mode, author, and operation against the [tracking subset](#tracking-subset). |
| `NotImplemented` | Check the documented subset, including pending-revision boundaries. Reconsider the target; do not disable tracking. |
| `InvalidArgument` | Validate the argument and consult the member's JSDoc. |

## Tracking subset

| Intent | Office.js-compatible API |
| --- | --- |
| Track this agent's text edits | `context.document.changeTrackingMode = 'TrackMineOnly'` |
| Insert before or after a range | `range.insertText(text, 'Before')` or `'After'` |
| Replace a range | `range.insertText(text, 'Replace')` |
| Delete range content | `range.delete()` or `range.clear()` |
| Read the current mode | `document.load('changeTrackingMode')`, then sync and read the property |
| Make an intentional permanent edit | Explicitly set `changeTrackingMode = 'Off'` |

`Off` is the initial runtime mode. `TrackMineOnly` needs a configured author and persists for that runtime. It does not change peers' editing modes or save a document-wide policy. Browser tracked writes require the review module. The tracking property does not change the editor UI mode. `TrackAll` fails with `NotSupported`.

| Tracked edit | Supported behavior |
| --- | --- |
| Range text | Insert, replace, or delete text; adjacent sibling paragraphs work outside collaboration |
| Font and paragraphs | Track font, paragraph-format, and paragraph-style edits as property revisions |
| Paragraph insertion | Track inserted text and paragraph marks |
| Lists | Track creation, membership, and level changes; configure newly proposed definitions |
| Tables | Track complete insertion, cell values, row additions, and partial row deletions |
| Content controls | Wrap nonempty ordinary text in `PlainText`, `RichText`, or `DatePicker` controls outside collaboration |

Tracked range edits refuse table and wrapper boundaries. Collaborative tracked range edits must remain within one paragraph. Targets that touch foreign pending revisions refuse. Continuation can extend the runtime author's text and paragraph proposals. Simple fields with nested fields or other result containers refuse tracked deletion and replacement. Direct result runs remain supported.

An author can configure a complete proposed table while it has no foreign revisions. Existing table properties and columns require permanent edits. Tracked table and cell value replacement refuse in collaboration. Row deletion suggestions must leave a row without a pending deletion. Pending row or cell structure revisions refuse tracked row deletion with `NotImplemented`.

Accept keeps a proposed content control. Reject restores the original formatted text. The author can set the pending control's `tag` and `title`. Empty ranges, existing review markup, and other control structure changes refuse.

Established list definitions and page setup refuse tracked writes. Comments and revision decisions remain available. Never silently fall back to `Off` when an edit cannot be tracked.

When a person adopts an agent's suggestions, attribute them to that person with `revisions.setAuthor(author, revisions)`. This is a DocxEditor addition; Office.js has no author write. The changes stay pending. Never reject and reinsert suggestions to change their author.

Standard `insertText('', 'Replace')` means deletion, and an empty insertion is a no-op. Agent tools should require nonempty insertion/replacement text and expose deletion as an explicit model decision. The shipped worker does this. The [compatibility manifest](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/compat/manifest.json) records measured members and behavioral differences.

## Insert table rows

`TableRow.insertRows('Before', count, values)` and `'After'` support ordinary source rows beside unrelated merged headers. Merged source rows and crossing vertical merges refuse. Keep each row insertion as the only write in its sync. Sync before editing returned rows. For more information, see [Tables and cells](https://docx-editor.dev/docs/2.x/editor-api/tables).

## Pictures and page fields

Insert a manual line break with `range.insertBreak('Line', 'After')` or `\v` in inserted text. Call `await context.sync()` after queuing the write. Manual line breaks support `TrackMineOnly` and text edits in the same sync. Single-line content controls refuse manual line breaks. Reads report manual line breaks as `\v`, column breaks as U+000E, and paragraph separators as `\r`. Text writes refuse U+000E and paragraph separators. Do not flatten these characters before sending read text back to the document.

Insert PNG or JPEG images with `range.insertInlinePictureFromBase64(data, 'After')`. Sync before setting properties on the returned picture. Width and height use points. New pictures lock the aspect ratio. Set `lockAspectRatio = false` before setting independent dimensions. Set `altTextDescription` to describe the image. Deletion preserves shared media relationships.

Use `range.insertField('Before', 'TOC', '\\o "1-3" \\h')` to insert an inert TOC instruction. This call saves no calculated entries. TOC evaluation and code writes refuse.

Insert a page field with `range.insertField('After', 'Page')` or `'NumPages'`. Sync before using the returned field. `field.code = 'NUMPAGES'` changes its instruction; `field.updateResult()` computes and stores its result. These calls use separate syncs. Field updates can share a sync with other field updates. They cannot share a sync with layout-changing writes.

Headless field calculation requires an explicit `pagination.measurer` when creating the server runtime. Use measurements from the document's fonts. Browser runtimes use the editor's measured layout. Without pagination, `updateResult()` fails with `NotSupported`. Other field instructions remain inert. The authoring subset refuses unsupported field codes and formatting switches.

Character formatting also supports underline, strikethrough, exact Word-palette highlighting, subscript, and superscript. `font.underline = 'None'` removes an underline. Setting one script mode to `true` clears the other mode. The highlight setter keeps Office's pinned `string` type, although Microsoft documents runtime `null` for clearing. The runtime accepts this clearing value. The runtime rejects unsupported highlight colors.

The workflow tests cover both hosts and save/reopen: `model-font-editing.test.ts`, `model-pictures.test.ts`, `model-fields.test.ts`, and `model-picture-field-parity.test.ts`. The final test includes primary footer creation and a saved `NUMPAGES` result.

## Set document metadata

Use `context.document.properties` for core metadata. The supported string properties are `author`, `title`, `subject`, `keywords`, `comments`, and `category`. Batch independent assignments, then call `context.sync()`. Load explicit property names before reading them. Metadata writes require tracking mode `Off`.

Do not substitute revision author settings for document author metadata. Other document information and custom properties remain unchanged.

Collaborative writes require an existing core-properties part. If the input omits this part, set properties before joining collaboration. Concurrent creation of this package part cannot merge safely.

Load `properties.lastAuthor` to read the last saved author. This property has no setter. To remove all standard property parts, call `document.removeDocumentInformation('DocumentProperties')`, then `context.sync()`. Run this command alone. It removes core, extended, and custom properties, including the last author. It preserves document text, comments, revisions, and media. It does not anonymize their content. Other removal modes, tracked removal, and removal during collaboration refuse with `NotSupported`.
