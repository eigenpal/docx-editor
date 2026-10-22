# Office.js patterns for server agents

The public document model follows a documented subset of Word's Office.js API. Host creation, authentication, collaboration transport, and job lifetime belong outside that model.

Use this API for headless, server, and agent pipelines. To build a review UI in a React or Vue host, use `useReview()` and `DocxEditorReview` from `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue` instead. For the task-by-task choice, see `docs/index.md` in this package.

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

To load members and one of their properties in one sync, use an `items/` path and bound the collection with `top`:

```ts
const snapshot = await runtime.run(async (context) => {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load({ select: 'items/text', top: 40 });
  await context.sync();
  return paragraphs.items.map((paragraph) => paragraph.text);
});
```

`collection.load('text')` means the same as `collection.load('items/text')`. Only one navigation level works: `items/font/bold` and `font/bold` fail with `InvalidArgument`.

Supported read-derived proxies can share one `sync()` with their edits. For example, `body.getRange().insertText(text, 'Replace')` and `table.getCell(0, 0).value = text` resolve their reads before one atomic write transaction. This can use extra read-only transport calls. Every phase uses the same revision; concurrent changes cause `StaleDocument`.

Proxies returned by insertions require a completed `sync()` before dependent operations. Do not configure a newly inserted table, image, list, or text range before that sync. If a prerequisite fails, the runtime commits no queued writes. Completed prerequisite reads can remain loaded after a later command fails.

## Keep writes within one story

A story is the main body, a header, a footer, or another document text container. Text and formatting writes in one `context.sync()` must target one story. Writes to multiple stories fail with `ConflictingChanges`. Reads from different stories can share a sync.

Bookmark removal is an exception: `Document.deleteBookmark()` and `Bookmark.delete()` can share a sync with writes to another story. Inserting a bookmark can also move an existing name from another story in the same transaction.

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

A sync either supplies data for the next decision or commits a complete edit. Batch independent reads and writes. For progressive agent review, one completed suggestion per sync is intentional: peers see each suggestion as it is ready. For independent edits in different paragraphs, multiple edits can share one sync and one transaction. Edits that claim the same paragraph can conflict; reconsider their anchors between commits. A range read before an earlier sync changed text before its end fails with `StaleDocument`, so search again in that paragraph before the next suggestion.

Always await sync. Do not replace sequential syncs with `Promise.all()` or `forEach(async ...)`. Use an explicit final sync when writes remain queued. Do not add an empty sync after a completed read-only batch. These conventions follow Microsoft's [application-specific API model](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model).

### Make a browser decision one undo step

Each sync that writes is its own undo step. In the browser runtime, a decision that also uses editor methods can be one undo step. Pass an open handle from `editor.beginHistoryGroup()` as run options. Every sync in the run joins the group, and so does each editor write that receives the same handle:

```ts
const decision = editor.beginHistoryGroup();
try {
  // Reply first: the card's key no longer exists after the change is accepted.
  const reply = editor.replyToReviewItem(key, 'Accepted; see the new term.', {
    historyGroup: decision,
  });
  const accepted = editor.acceptReviewItem(key, { historyGroup: decision });
  if (!reply.ok || !accepted.ok) throw new Error('The review card was refused.');
  await runtime.run({ historyGroup: decision }, async (context) => {
    const ranges = context.document.body.search('30 days');
    ranges.load('items');
    await context.sync();
    const target = ranges.items[0];
    if (!target) throw new Error('The document has no "30 days" text.');
    target.insertText('45 days', 'Replace');
    await context.sync();
  });
} finally {
  decision.end();
}
```

This option is DocxEditor infrastructure with no Office.js equivalent. Server and collaborative runtimes refuse it with `NotSupported`. A closed handle, or a handle from another editor, refuses with `InvalidArgument` and target `historyGroup` before the callback runs, and nothing is written. The whole run is one write of the group: after it finishes, `decision.lastOutcome` is `split` if any of its syncs split the group. Do not reuse a handle after `end()`; begin a new one.

### Preview a change before the user accepts it

In the browser runtime, `runtime.preview(callback)` shows the edits of a callback in the page without writing them. The callback uses the same Office.js calls as `run()`. Its reads see the preview, so write the callback as you would write the final edit. Call the model before the preview, not inside it: the editor stays editable while the callback runs.

```ts
const proposal = await model.propose(clauseText);
const preview = await runtime.preview(async (context) => {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const ranges = context.document.body.search(proposal.find, {
    matchCase: true,
  });
  ranges.load('items');
  await context.sync();
  if (ranges.items.length !== 1) throw new Error('Choose one deadline.');
  ranges.items[0]!.insertText(proposal.replace, 'Replace');
  await context.sync();
});
preview.reveal();
// Keep the preview, not its proxies. Decide later:
await preview.commit({ rebase: true }); // or preview.discard()
```

`commit()` replays the recorded batches as one undo step. It never runs the callback again. Every replayed read must match its preview result. If the live document changed, `commit()` refuses with `StaleDocument` and keeps the preview open. That refusal writes nothing.

`commit({ rebase: true })` applies the recorded edits to the current document. Ranges follow their text. A changed read result or replacement target causes a refusal. The live editor can also refuse the commit, for example if permissions change. Commit validates all recorded batches on a fresh document copy before writing. A validation refusal ends the preview without changing live content or undo and redo history.

Editor event listeners and preview status listeners run after replay and its history group finish. They observe the completed edit. Listener edits cannot interrupt a partially committed preview, and listener exceptions do not change the commit result. Unexpected live replay failures undo earlier writes. If undo fails, inspect `GeneralException` with target `preview.rollback` before further writes.

After a replay refusal, read again and build a new preview. Never repeat the model's old edit without reconsidering it. While a preview shows, the editor refuses document writes. Other runs refuse writes with `PreviewActive`. A preview refuses unsupported writes, such as tables and pictures, with `NotSupported`.

Server and collaborative runtimes refuse `preview()` with `NotSupported`. This method is DocxEditor infrastructure with no Office.js equivalent.

## Keep proxy lifetimes clear

Keep document proxies within their `runtime.run()` callback. Return plain text or structured snapshots to the model, not `Range` or `Paragraph` objects. Do not retain a proxy in a job record or reuse it after its run finishes. Explicit tracked-object adoption exists for advanced cases; fresh reads are simpler for background workers.

If model generation happens inside a run, commit against the revision that run read. If it happens outside, keep a validated snapshot and re-anchor in a new run. The example's tool adapter checks both the paragraph snapshot and document digest. On `StaleDocument`, read again and reconsider the proposal. Recheck the target before retrying.

## Use errors to recover deliberately

Use `isDocxEditorError(error)` and branch on `error.code`. `error.target` identifies the failing public member. Do not parse message strings. A failed sync does not apply its queued document edits or tracking-mode changes. Earlier successful syncs remain committed. Failed batches are discarded and are never automatically replayed.

| Code | Next action |
| --- | --- |
| `PropertyNotLoaded` | Load the named property and await sync before reading it. |
| `InvalidObjectPath` | Sync before using a newly returned proxy, or acquire a fresh proxy in a new run. `debugInfo.innerError.code` `edit.stale-target` means the document no longer holds the object; read again. |
| `StaleDocument` | Search again, reconsider the model proposal, then write. |
| `ConflictingChanges` | Separate edits that claim the same paragraph and reconsider anchors between commits. |
| `NotSupported` | The call is outside the supported subset for this host, mode, or content. Don't retry it. Read `debugInfo.innerError.code`, then check the host, tracking mode, author, and operation against the [tracking subset](#tracking-subset). |
| `NotImplemented` | The API does not implement the call for this target, such as a tracked edit beside your own pending change. Don't retry it. Read `debugInfo.innerError.code`, reconsider the target, and do not disable tracking. |
| `InvalidArgument` | Validate the argument and consult the member's JSDoc. |
| `GeneralException` | Act on `error.debugInfo.innerError.code` (see [Diagnostics](https://www.docx-editor.dev/docs/2.x/guides/diagnostics#edit-internal-invariant)). For `edit.internal-invariant`, or when `innerError` is absent, report the failure with the engine version and do not retry the write unchanged. |

### Read why the engine refused

`error.debugInfo` has the shape of Office.js `OfficeExtension.DebugInfo`: `code`, `message`, and `errorLocation`, the path of the refused call. When the engine knows a specific reason, `debugInfo.innerError` holds a stable diagnostic code and a fixed hint. Branch on `error.code`, and give `innerError.message` to the person or model that chose the edit. The hint never contains document content.

```ts
import { isDocxEditorError } from '@docx-editor.dev/editor-api';

try {
  await context.sync();
} catch (error) {
  if (!isDocxEditorError(error)) throw error;
  const reason = error.debugInfo.innerError;
  // For example: { code: 'edit.tracked-operation-unsupported', message: 'This editing API ...' }
  if (reason) feedback.push(`${reason.code}: ${reason.message}`);
}
```

For all codes, see [Diagnostics](https://www.docx-editor.dev/docs/2.x/guides/diagnostics). To record anonymous refusal events, add a telemetry module to `createServer({ modules })`. For more information, see [Server agents](https://www.docx-editor.dev/docs/2.x/telemetry/agents).

### Recover from a stale range

A range addresses text by paragraph identity and offsets. When text before its end changes, including through an earlier sync of the same run, using the range fails with `StaleDocument` and nothing is applied. When `error.expectedRevision` equals `error.actualRevision`, the range moved; when they differ, another writer changed the document. In both cases, search again and reconsider the proposal before writing. Never replay the failed write unchanged.

```ts
import { isDocxEditorError } from '@docx-editor.dev/editor-api';

// `proposals` holds { find, replace } pairs from your model.
// `stillApplies` is your own check of a proposal against the current text.
await runtime.run(async (context) => {
  context.document.changeTrackingMode = 'TrackMineOnly';
  // Read every target in one sync.
  const searches = proposals.map((proposal) => {
    const matches = context.document.body.search(proposal.find, { matchCase: true });
    matches.load('items');
    return matches;
  });
  await context.sync();

  for (const [index, proposal] of proposals.entries()) {
    const range = searches[index]!.items[0];
    if (!range) continue;
    range.insertText(proposal.replace, 'Replace');
    try {
      // One reviewable suggestion per sync, so peers see each one as it lands.
      await context.sync();
    } catch (error) {
      if (!isDocxEditorError(error) || error.code !== 'StaleDocument') throw error;
      // Equal revisions: the range moved, often through an earlier sync of this run.
      // Different revisions: another writer changed the document.
      // Either way, search again and reconsider before you write.
      const fresh = context.document.body.search(proposal.find, { matchCase: true });
      fresh.load('items');
      await context.sync();
      const current = fresh.items[0];
      if (!current || !stillApplies(proposal)) continue;
      current.insertText(proposal.replace, 'Replace');
      await context.sync();
    }
  }
});
```

## Tracking subset

| Intent | Office.js-compatible API |
| --- | --- |
| Track this agent's text edits | `context.document.changeTrackingMode = 'TrackMineOnly'` |
| Insert before or after a range | `range.insertText(text, 'Before')` or `'After'` |
| Replace a range | `range.insertText(text, 'Replace')` |
| Delete range content | `range.delete()` or `range.clear()` |
| Propose removing a paragraph | `paragraph.delete()` |
| Propose a field | `range.insertField('After', 'Ref', '_Ref123456 \\h')` |
| Write a proposed field's result | Sync, then `field.result.insertText('Figure 3', 'Replace')` |
| Propose an equation | `range.insertOoxml(flatOpcWithOneEquation, 'After')` |
| Read the current mode | `document.load('changeTrackingMode')`, then sync and read the property |
| Make an intentional permanent edit | Explicitly set `changeTrackingMode = 'Off'` |

`Off` is the initial runtime mode. `TrackMineOnly` needs a configured author and persists for that runtime. It does not change peers' editing modes or save a document-wide policy. Browser tracked writes require the review module. The tracking property does not change the editor UI mode. `TrackAll` fails with `NotSupported`.

| Tracked edit | Supported behavior |
| --- | --- |
| Range text | Insert, replace, or delete text; deletions can span adjacent sibling paragraphs, and replacements across paragraphs work outside collaboration |
| Paragraph deletion | `paragraph.delete()` records the text and the paragraph mark as deletions; accept removes the paragraph |
| Font and paragraphs | Track font, paragraph-format, and paragraph-style edits as property revisions |
| Paragraph insertion | Track inserted text and paragraph marks |
| Paragraph split | `insertText()` with `\n` tracks the text and each new paragraph mark; reject joins the paragraphs again |
| Lists | Track creation, membership, and level changes; configure newly proposed definitions |
| Tables | Track complete insertion, cell values, row additions, and partial row deletions |
| Content controls | Wrap nonempty ordinary text in `PlainText`, `RichText`, or `DatePicker` controls outside collaboration |
| Fields | Insert an inert field as one complex field in one tracked insertion, and write the cached result of your own pending field into it; reject removes the whole field |
| Equations | `insertOoxml()` with one inline `m:oMath` in a Flat OPC package writes one tracked insertion; reject removes the whole equation |

Tracked range edits refuse table and wrapper boundaries. In collaboration, a tracked replacement must remain within one paragraph. One refusal refuses the whole sync.

A tracked paragraph deletion fails with `NotSupported` for these paragraphs:

- The last paragraph of a story, table cell, or content control.
- A paragraph directly before a table or a block content control.
- A paragraph whose mark ends a section.
- A paragraph with an inline content control.
- A paragraph that holds a complex field boundary whose matching boundary is in another paragraph.
- A paragraph that nests inline content more than 64 levels deep.

A tracked paragraph deletion fails with `NotImplemented` in these cases:

- The paragraph has your own pending change, or another author's pending paragraph mark, formatting, move, or structural change.
- The start of the next paragraph has a pending change.
- A later sync deletes beside your own pending deletion. Delete adjacent paragraphs in one sync instead.
- A tracked deletion or replacement starts a paragraph whose previous paragraph mark you already proposed deleting.

Text that another participant types into struck text joins the proposed deletion. Reject restores it, and accept removes it with no separate revision.

Tracked edits can go inside or beside another author's pending text insertion or deletion. A deletion of their inserted text is recorded inside their insertion. New text lands after any deleted text, and new text inside their insertion splits it into two halves. The returned range names the new text where it lands, and each author's change stays a separate decision. For more information, see [Edit another author's pending text](#edit-another-authors-pending-text). Continuation can extend the runtime author's text and paragraph proposals.

Simple fields with nested fields or other result containers refuse tracked deletion and replacement. Direct result runs remain supported. A tracked deletion or replacement that covers an equation strikes the whole equation: accepting removes it, and rejecting restores it.

An author can configure a complete proposed table while it has no foreign revisions. Existing table properties and columns require permanent edits. Tracked table and cell value replacement refuse in collaboration. Row deletion suggestions must leave a row without a pending deletion. Pending row or cell structure revisions refuse tracked row deletion with `NotImplemented`.

Accept keeps a proposed content control. Reject restores the original formatted text. The author can set the pending control's `tag` and `title`. Empty ranges, existing review markup, and other control structure changes refuse.

Established list definitions and page setup refuse tracked writes. Comments and revision decisions remain available. Never silently fall back to `Off` when an edit cannot be tracked.

When a person adopts an agent's suggestions, attribute them to that person with `revisions.setAuthor(author, revisions)` or `revisions.setAuthor(author, { authors })`. This is a DocxEditor addition; Office.js has no author write. The changes stay pending. Never reject and reinsert suggestions to change their author.

Standard `insertText('', 'Replace')` means deletion, and an empty insertion is a no-op. Agent tools should require nonempty insertion/replacement text and expose deletion as an explicit model decision. The shipped worker does this. The [compatibility manifest](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/compat/manifest.json) records measured members and behavioral differences.

### Propose a paragraph split

`insertText()` on a body, paragraph, or range treats `\n`, `\r`, and `\r\n` as paragraph breaks. The text after a break starts a new paragraph with the properties of the paragraph that you wrote into. With `TrackMineOnly`, the inserted text and each new paragraph mark are tracked insertions.

To split between two sentences, replace only the gap between them with `'\n'`:

```ts
await runtime.run(async (context) => {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const body = context.document.body;
  const first = body.search('the goods.').getFirst();
  const second = body.search('The buyer').getFirst();
  const gap = first.getRange('End').expandTo(second.getRange('Start'));
  gap.insertText('\n', 'Replace');
  await context.sync();
});
```

The proposal strikes the one space and adds one paragraph mark. Accept gives two paragraphs with no trailing space. Reject joins the paragraphs again. Don't replace a sentence with the same words and a break: that proposes deleting and inserting those words.

The returned range runs from the first inserted character to the end of the last inserted segment. Text that lands inside an inline content control refuses with `NotSupported` and `edit.indivisible-content`. A write with a break can't share a sync with another edit in the same paragraph. For the batching rules and a refusal table, see [Propose several structural edits in one run](https://www.docx-editor.dev/docs/2.x/editor-api/revisions#propose-several-structural-edits-in-one-run).

### Edit another author's pending text

A counterparty's pending insertion is ordinary text to a tracked edit. Replace it, delete part of it, or write inside it. Your changes record under the runtime author, and each author's change stays a separate decision. New text inside their insertion splits it, so their insertion becomes two revisions, one on each side of your text. To accept or reject all of their insertion, decide both revisions, or pass both to `revisions.resolve(action, [first, second])`. The same edits work in a collaboration session; a participant's concurrent accept or reject of the counterparty's change applies to all of that change and to nothing else. In the following example, the agent replaces a counterparty's proposed term, then rejects only its own revisions:

```ts
// Create runtime with author: 'Avery Chen' before this example.
await runtime.run(async (context) => {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const proposed = context.document.body
    .search('thirty (30) days of receipt', { matchCase: true })
    .getFirst();
  await context.sync();
  proposed.insertText('forty-five (45) days of receipt', 'Replace');
  await context.sync();

  // Load the revisions again after the edit.
  const revisions = context.document.body.revisions;
  revisions.load('items/author');
  await context.sync();

  // Reject only this agent's changes. The counterparty's insertion stays pending.
  for (const revision of revisions.items) {
    if (revision.author === 'Avery Chen') revision.reject();
  }
  await context.sync();
});
```

These tracked edits fail with `NotImplemented`. Read `error.debugInfo.innerError.code` for the rule:

| `innerError.code` | Edit |
| --- | --- |
| `edit.tracked-deleted-text-only` | A deletion or replacement that covers only deleted text and no paragraph mark |
| `edit.tracked-foreign-revision-unsupported` | An edit that touches another author's paragraph mark, formatting, move, or structural change, or new text inside a link or content control within their insertion |
| `edit.tracked-own-pending-change` | An edit that covers or borders your own pending change |

The range that a tracked `insertText()` returns names your own pending insertion. With tracking on, replacing or deleting that range fails with `edit.tracked-own-pending-change`, because the edit would cover your own pending text. Write the final text in one call, or reject your revision and write again.

### Rewrite a paragraph word by word

To propose a model's rewrite of a paragraph, use `prepareRewrite` from `@docx-editor.dev/editor-api/agent`. It reads the paragraph into text for your model. `draft.apply()` then applies the steps in this section for you, keeps fields, equations, note references, and locked controls whole, and rejects only its own changes if a write fails. You own the prompt and the model call:

```ts
import { prepareRewrite } from '@docx-editor.dev/editor-api/agent';

await runtime.run(async (context) => {
  const paragraph = context.document.body.paragraphs.getFirst();
  const draft = await prepareRewrite(context, paragraph);
  const prompt = ['Make this clause shorter.', draft.legend, draft.text].join('\n\n');
  await draft.apply(await callModel(prompt));
});
```

`draft.text` holds the paragraph with numbered placeholders, and `draft.legend` states the placeholder rules. To check model text without writing, call `draft.check(modelText)`. For several paragraphs, prepare them all, call the model for every draft at once, and then apply the drafts one after another. For its guarantees and error codes, see [Propose an AI rewrite as tracked changes](https://www.docx-editor.dev/docs/2.x/recipes/propose-rewrite). The rest of this section shows the calls it makes.

Split a paragraph into word ranges with `paragraph.getTextRanges([' '])`. Each range keeps its trailing space, so a deleted word takes its space with it, and a replacement for a range ends with a space too. Address a run of words with `first.expandTo(last)`. After tracked edits, `paragraph.text` reads the deleted and the inserted words together. `getReviewedText('Current')` reads the text as if you accepted every change, and `'Original'` reads it as if you rejected every change.

Each word range is a snapshot. An edit before a range in its paragraph makes the range fail with `StaleDocument`, and an edit after it keeps it valid. Read the ranges once, before you edit. Pass the range texts to the model and plan the edits by range index, because a paragraph can repeat a word. Then apply the edits from the last index to the first, one sync per edit:

```ts
await runtime.run(async (context) => {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const paragraph = context.document.body.paragraphs.getFirst();
  const words = paragraph.getTextRanges([' ']);
  words.load('items/text');
  await context.sync();

  // Pass plain text to the model; keep the ranges in this run.
  // ['The ', 'fee ', 'is ', 'due ', 'per ', 'unit ', 'and ', 'the ', 'buyer ', ...]
  const tokens = words.items.map((range) => range.text);

  // Edits by index, applied from the last index to the first.
  words.items[7]!.delete();
  await context.sync();
  words.items[4]!.insertText('net ', 'After');
  await context.sync();
  words.items[0]!.expandTo(words.items[1]!).insertText('Each charge ', 'Replace');
  await context.sync();

  const proposed = paragraph.getReviewedText('Current');
  await context.sync();
  console.log(tokens.length, proposed.value);
});
```

A field, an equation, a picture, or a note reference reads as one unit that never splits and joins the word it touches. A field reads as its result, which can contain spaces, such as `Section 4.2`. An equation, a picture, and a note reference read as U+FFFC. A tab ends a range only when you list `'\t'` as a mark. `trimSpacing` removes spaces, tabs, and column breaks from the edges of each range; use it to read words, not to plan deletions. `Range.getRange('Start')` and `'End'` answer an insertion point; `'After'` fails with `NotSupported`. Ranges in different stories make `expandTo()` fail with `InvalidArgument`.

A tracked deletion or replacement that covers an equation strikes the whole equation. Accept removes it, and reject restores it.

The words of an inline content control join the ranges around it. `paragraph.contentControls` and `range.contentControls` list the controls that the paragraph or range overlaps, including a control that holds the whole range. Before you plan edits, load them with `cannotEdit`, `tag`, and `text`, for each word range in one sync, and keep each locked control as one unit. A replacement or deletion of part of a content-locked control fails, and `error.debugInfo.innerError.code` is `edit.protected-content`. The outer code is `GeneralException` with `TrackMineOnly` and `InvalidArgument` without it, so branch on the inner code. With tracking on, a deletion or replacement that covers the whole control proposes removing the control as one deletion.

Map each difference between the old and the new words to one call. The last range of a paragraph has no space after it:

| Difference | Call |
| --- | --- |
| Replace one or more words | `first.expandTo(last).insertText(text, 'Replace')` |
| Delete one or more words | `first.expandTo(last).delete()` |
| Insert before the first word | `words[0].insertText(text, 'Before')` |
| Insert after a word | `word.insertText(text, 'After')` |
| Insert after the last word | `last.insertText(' ' + text, 'After')`, because the last word has no space after it |

Ranges follow the runtime's `revisionTextView`. Text that the view hides, such as a pending insertion in the `original` view, holds no ending mark, and a range starts and ends at characters that the view shows. Hidden text between two shown characters of one range stays inside the range, so an edit through that range also changes the hidden text.

Do not split the paragraph again after tracked edits to plan more edits. A range over pending revisions can join deleted and inserted text, such as `two2` after you replace `two` with `2`. An edit that touches your own pending change fails with `NotImplemented`, and `error.debugInfo.innerError.code` is `edit.tracked-own-pending-change`. Read the proposed text with `getReviewedText('Current')`, then edit a range outside your pending change. To change your proposal itself, reject it and propose again.

Catch a refused word-range edit and read its rule from `debugInfo`:

```ts
import { DocxEditor, isDocxEditorError } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes, { author: 'Review agent' });
await runtime.run(async (context) => {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const words = context.document.body.paragraphs.getFirst().getTextRanges([' ']);
  words.load('items');
  await context.sync();
  try {
    words.items[0]!.insertText('Each ', 'Replace');
    await context.sync();
  } catch (error) {
    if (!isDocxEditorError(error)) throw error;
    // For example, 'edit.protected-content' inside a content-locked control.
    console.log(error.code, error.debugInfo.innerError?.code);
  }
});
```

## Review changes in a range

Use `range.revisions` to reach the tracked changes inside a search result, a comment range, or any other range. The collection lists the changes the range overlaps in its own story, including a nested change or another author's change beside it. A partly covered change is listed whole, and a replacement lists its deletion and insertion separately. Load the members and decide on each one:

```ts
await runtime.run(async (context) => {
  const matches = context.document.body.search('within 30 days');
  matches.load('items');
  await context.sync();

  const revisions = matches.items.map((match) => match.revisions);
  for (const collection of revisions) collection.load('items');
  await context.sync();

  for (const collection of revisions) {
    for (const revision of collection.items) revision.load('author');
  }
  await context.sync();

  for (const collection of revisions) {
    for (const revision of collection.items) {
      if (revision.author === 'Agent') revision.accept();
    }
  }
  await context.sync();
});
```

`acceptAll()` and `rejectAll()` on a range collection resolve every change the range overlaps, whole, including history that `items` omits. They fail with `NotImplemented` when one of those changes is read-only. When the range overlaps only part of a group of nested changes, only the overlapped changes resolve; the others stay pending. Two decisions in one sync that reach one change resolve it once; contrary decisions fail with `ConflictingChanges`. A change inside text that a decision in the same sync removes, such as a rejected insertion or an accepted deletion, goes with that text, so any decision on it in that sync is skipped. This also applies to `accept()` and `reject()` on single revisions. `resolve()` and `setAuthor()` refuse with `NotSupported` on a range collection. Use the story's `body.revisions` for them.

A browser review panel identifies cards by `key`. Pass the key to the DocxEditor function `getReviewItemRevisions(context, key)` to decide the card's own change, or the two halves of a paired replacement. `getReviewItemRange(context, key)` returns the range that a card covers; use `getReviewItemRangeOrNullObject(context, key)` when another reviewer can resolve the change first. Do not match cards to revisions by text.

## Set paragraph direction

Office.js has no paragraph direction member. Use the DocxEditor addition `Paragraph.readingOrder` to write right-to-left paragraphs, such as Arabic or Hebrew text. Queue the direction writes for several paragraphs in one sync, then read them back in the next sync:

```ts
await runtime.run(async (context) => {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load({ select: 'items', top: 2 });
  await context.sync();

  const targets = paragraphs.items;
  for (const paragraph of targets) paragraph.readingOrder = 'RightToLeft';
  await context.sync();

  for (const paragraph of targets) paragraph.load('readingOrder');
  await context.sync();
  return targets.map((paragraph) => paragraph.readingOrder);
});
```

A read returns the direction that the paragraph reads in, after its style. Writes accept only `LeftToRight` and `RightToLeft`; other values fail with `InvalidArgument`. A write of the direction that the paragraph already has changes nothing, so you can write back what you read. The write keeps `alignment` as authored: in a right-to-left paragraph, `Left` names the leading edge at the right margin. With `TrackMineOnly`, the write records a paragraph property revision.

## Go to a bookmark

Go to a bookmark with the standard calls: `getBookmarkRangeOrNullObject(name)`, then `range.select()`. Check `isNullObject` after a sync instead of catching `ItemNotFound`. Selection needs a browser host (`runtime.capabilities.selection`). It opens the header, footer or note that holds the bookmark. A read-only editor refuses a selection outside the main text with `NotSupported`.

```ts
await runtime.run(async (context) => {
  const range = context.document.getBookmarkRangeOrNullObject('Intro');
  await context.sync();
  if (range.isNullObject) return;
  range.select();
  await context.sync();
});
```

## Insert table rows

`TableRow.insertRows('Before', count, values)` and `'After'` support ordinary source rows beside unrelated merged headers. Merged source rows and crossing vertical merges refuse. Keep each row insertion as the only write in its sync. Sync before editing returned rows. For more information, see [Tables and cells](https://docx-editor.dev/docs/2.x/editor-api/tables).

## Merge and split cells

`Table.mergeCells(topRow, firstCell, bottomRow, lastCell)` merges a rectangle and returns the merged cell. Edits to that cell can share the sync. `TableCell.split(rowCount, columnCount)` splits one cell. A ragged rectangle refuses with `InvalidArgument` and `innerError.code` `edit.table-merge-not-rectangle`. A split the cell cannot take refuses with `InvalidArgument` and `edit.table-split-unsupported`. Both refuse with `NotSupported` in a tracking mode. Do not turn tracking off to make them succeed.

```ts
import { DocxEditor, isDocxEditorError } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes);
await runtime.run(async (context) => {
  const table = context.document.body.tables.getFirst();
  const header = table.mergeCells(0, 0, 0, 2);
  header.value = 'Quarterly results';
  try {
    await context.sync();
  } catch (error) {
    if (!isDocxEditorError(error)) throw error;
    // A merged cell crosses the rectangle: read the table again and pick its real corners.
    const reason = error.debugInfo.innerError;
    if (reason?.code !== 'edit.table-merge-not-rectangle') throw error;
    feedback.push(reason.message);
  }
});
```

## Pictures and fields

Insert a manual line break with `range.insertBreak('Line', 'After')` or `\v` in inserted text. Call `await context.sync()` after queuing the write. Manual line breaks support `TrackMineOnly` and text edits in the same sync. Single-line content controls refuse manual line breaks. Reads report manual line breaks as `\v`, column breaks as U+000E, and paragraph separators as `\r`. Text writes refuse U+000E. `insertText()` on a body, paragraph, or range writes `\n`, `\r`, and `\r\n` as paragraph breaks. Other paragraph separators refuse. Do not flatten these characters before sending read text back to the document.

Insert PNG or JPEG images with `range.insertInlinePictureFromBase64(data, 'After')`. Sync before setting properties on the returned picture. Width and height use points. New pictures lock the aspect ratio. Set `lockAspectRatio = false` before setting independent dimensions. Set `altTextDescription` to describe the image. Deletion preserves shared media relationships.

Insert an inert field with `range.insertField(location, type, text)`. The runtime inserts `Page`, `NumPages`, `Ref`, `PageRef`, `NoteRef`, `Seq`, `StyleRef`, `Date`, `Time`, and `TOC`. `text` holds the arguments, such as a bookmark name and switches: `range.insertField('After', 'Ref', '_Ref123456 \\h')`. With `Empty`, `text` holds the whole instruction. The runtime never evaluates an instruction, and a new field has an empty cached result.

Untracked `Page`, `NumPages`, and `TOC` fields are simple fields. Other fields, and every tracked field, are complex fields. Their runs take the formatting of the text before the insertion point. New `Ref`, `PageRef`, `NoteRef`, `Seq`, `StyleRef`, `Date`, and `Time` fields carry `w:dirty="true"`, so an application that evaluates fields recomputes them on open.

Write the cached result with `field.result.insertText(text, 'Replace')` after a sync, and read it with `field.load('result')`. The result range supports only `text` and that `insertText()` call. Its other members refuse with `NotImplemented` and `edit.field-result-unsupported`. With `TrackMineOnly`, the write works only on your own pending field and joins its insertion. If the write fails, `field.delete()` takes your own pending field back outright.

Field types that fetch, embed, link, run, or prompt, such as `DDE`, `IncludeText`, `IncludePicture`, `Link`, and `MacroButton`, fail with `InvalidArgument` and `edit.field-unsupported`. With `TrackMineOnly`, the field is one complex field inside one tracked insertion. Accept keeps it, and reject removes all of it. Tracked TOC creation refuses. For the refusal tables, see [Fields and pagination](https://www.docx-editor.dev/docs/2.x/editor-api/fields).

Insert one equation with `range.insertOoxml(ooxml, location)`. `ooxml` is a Flat OPC package (`pkg:package`) whose document part holds one paragraph with exactly one inline `m:oMath` and optional plain runs. The equation reads as U+FFFC. With `TrackMineOnly`, it is one tracked insertion, and reject removes it whole. Every other OOXML shape refuses and inserts nothing: other parts, relationships, images, fields, paragraph properties, display equations, and unknown elements fail with `NotSupported` and `edit.ooxml-unsupported`. Malformed XML, DTDs, and entities fail with `InvalidArgument` and `edit.invalid-argument`. For the accepted shape and every refusal, see [Insert an equation](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges#insert-an-equation).

Use `range.insertField('Before', 'TOC', '\\o "1-3" \\h')` to insert an inert TOC instruction. This call saves no calculated entries. TOC evaluation and code writes refuse.

Insert a page field with `range.insertField('After', 'Page')` or `'NumPages'`. Sync before using the returned field. `field.code = 'NUMPAGES'` changes its instruction; `field.updateResult()` computes and stores its result. These calls use separate syncs. Field updates can share a sync with other field updates. They cannot share a sync with layout-changing writes.

Headless field calculation requires an explicit `pagination.measurer` when creating the server runtime. Use measurements from the document's fonts. Browser runtimes use the editor's measured layout. Without pagination, `updateResult()` fails with `NotSupported`. Other field instructions remain inert. The authoring subset refuses unsupported field codes and page-field switches. A field inside a pending tracked insertion refuses `updateResult()` and code writes until a reviewer accepts it.

Character formatting also supports underline, strikethrough, exact Word-palette highlighting, subscript, and superscript. `font.underline = 'None'` removes an underline. Setting one script mode to `true` clears the other mode. The highlight setter keeps Office's pinned `string` type, although Microsoft documents runtime `null` for clearing. The runtime accepts this clearing value. The runtime rejects unsupported highlight colors.

The repository's tests run these workflows on both hosts and through save and reopen, including primary footer creation and a saved `NUMPAGES` result.

## Set document metadata

Use `context.document.properties` for core metadata. The supported string properties are `author`, `title`, `subject`, `keywords`, `comments`, and `category`. Batch independent assignments, then call `context.sync()`. Load explicit property names before reading them. Metadata writes require tracking mode `Off`.

Do not substitute revision author settings for document author metadata. Other document information and custom properties remain unchanged.

Collaborative writes require an existing core-properties part. If the input omits this part, set properties before joining collaboration. Concurrent creation of this package part cannot merge safely.

Load `properties.lastAuthor` to read the last saved author. This property has no setter. To remove all standard property parts, call `document.removeDocumentInformation('DocumentProperties')`, then `context.sync()`. Run this command alone. It removes core, extended, and custom properties, including the last author. It preserves document text, comments, revisions, and media. It does not anonymize their content. Other removal modes, tracked removal, and removal during collaboration refuse with `NotSupported`.
