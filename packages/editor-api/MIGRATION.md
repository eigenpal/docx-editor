# Migrating to the object model

This release replaces everything `@docx-editor.dev/agents` used to export. The package used to be
four things at once — a static reviewer, an editor bridge with a flat tool catalog, an MCP server,
and a chat UI for React and Vue. The package is now named `@docx-editor.dev/editor-api` and exposes
one thing: the Office.js Word-shaped DocxEditor API, which drives a document from a server or from
an editor already open in a page.

There are no aliases and no deprecation window. Every import below moves or goes away, and the
version bump is major to say so.

## The shape of the change

```ts
// Before — a reviewer holding a parsed document, addressed by paragraph index.
const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
reviewer.replace(5, '$50k', '$500k');
const out = await reviewer.toBuffer();

// After — a runtime, objects you reached and read, one batch at a time.
const runtime = await DocxEditor.createServer(bytes, { author: 'AI Reviewer' });
try {
  await runtime.run(async (context) => {
    const matches = context.document.body.search('$50k');
    matches.load();
    await context.sync();

    for (const match of matches.items) match.insertText('$500k', 'Replace');
    await context.sync();
  });
  const out = await runtime.save();
} finally {
  runtime.dispose();
}
```

Three things changed at once, and the third is the one that bites:

1. **Addressing.** Paragraph indices are gone. You reach an object — by searching, by walking a
   collection, by asking a collection for an item — and operate on the object.
2. **Batching.** Nothing reaches the document until `await context.sync()`. Work queued between
   two syncs is one ordered transaction that applies whole or not at all.
3. **Reads are declared.** A property you did not `load()` throws rather than answering
   `undefined`. This is why the example above syncs twice: once to find out what the search found,
   once to write.

## Entry points

| Before                             | After                                                           |
| ---------------------------------- | --------------------------------------------------------------- |
| `@docx-editor.dev/agents`          | `@docx-editor.dev/editor-api` — server/worker, from DOCX bytes  |
| `@docx-editor.dev/agents/server`   | `@docx-editor.dev/editor-api`                                   |
| `@docx-editor.dev/agents/bridge`   | `@docx-editor.dev/editor-api/browser`                           |
| `@docx-editor.dev/agents/react`    | `@docx-editor.dev/editor-api/browser` — no React-specific entry |
| `@docx-editor.dev/agents/vue`      | `@docx-editor.dev/editor-api/browser` — no Vue-specific entry   |
| `@docx-editor.dev/agents/mcp`      | removed                                                         |
| `@docx-editor.dev/agents/ai-sdk/*` | removed                                                         |

The browser entry is a separate import on purpose: reaching a live editor means reaching the
painted engine, and a server holding bytes should not pay for that. It takes an editor the host
already created, from any framework:

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';

const runtime = DocxEditor.createBrowser(editor);
```

## Reading and editing

| Before                                         | After                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `DocxReviewer.fromBuffer(buffer, author)`      | `await DocxEditor.createServer(bytes, { author })`                             |
| `reviewer.toBuffer()`                          | `await runtime.save()`                                                         |
| `reviewer.toDocument()`                        | removed — the document model is not a public value                             |
| `reviewer.getContent()` / `getContentAsText()` | `body.load('text')` then `body.text`, or walk `body.paragraphs`                |
| `reviewer.replace(i, search, with)`            | `body.search(search)` → `range.insertText(with, 'Replace')`                    |
| `reviewer.proposeReplacement(...)`             | same as `replace` above                                                        |
| `reviewer.proposeInsertion(...)`               | `range.insertText(text, 'Start' \| 'End')` or `insertParagraph(text, 'After')` |
| `reviewer.proposeDeletion(...)`                | `paragraph.delete()`, or `range.insertText('', 'Replace')` for part of one     |
| `reviewer.applyReview(batchOps)`               | a `run` callback: queue the work, one `sync()` makes it one transaction        |
| `TextNotFoundError` etc.                       | one `DocxEditorError` carrying a `code` — branch on the code, not the class    |

## Comments and tracked changes

| Before                                   | After                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `reviewer.getComments(filter)`           | `document.comments` / `body.getComments()`, then `load()` and read `items`                       |
| `reviewer.replyTo(id, text)`             | `comment.reply(text)`                                                                            |
| `reviewer.getChanges(filter)`            | `document.revisions` / `body.revisions`                                                          |
| `reviewer.acceptChange` / `rejectChange` | `revision.accept()` / `revision.reject()`                                                        |
| `reviewer.acceptAll` / `rejectAll`       | `revisions.acceptAll()` / `revisions.rejectAll()`                                                |
| `reviewer.addComment(...)`               | Find or obtain a `Range`, then call `range.insertComment(text)`. The runtime's `author` is used. |
| `reviewer.removeComment(id)`             | **no equivalent yet.** Resolve it (`comment.resolved = true`) or leave it.                       |

Filters are gone as arguments: load the collection and filter `items` yourself, which is one less
vocabulary to learn and the same number of round trips.

## Tools, MCP and chat

The flat tool catalog (`agentTools`, `getToolSchemas`, `executeToolCall`, `getToolDisplayName`),
the `read_document` / `add_comment` / `suggest_change` / `apply_formatting` / `scroll` tool names,
`EditorBridge`, `createEditorBridge`, `createReviewerBridge`, `WordCompatBridge`, `McpServer`,
`runStdioServer`, the MCP protocol types, and the AI SDK adapters are **removed with no
equivalent in this package**.

That is a deliberate scope change rather than an oversight. A tool schema is a decision about a
model's interface — which operations to expose, how to describe them, what to do with a refusal —
and it belongs in the application that owns the model, not in a document library. The object model
is the layer underneath: a tool named `add_comment` in your own catalog does its work by calling
into a `run` block.

Likewise the React and Vue chat UI (`AgentPanel`, `AgentChatLog`, `AgentComposer`,
`AgentSuggestionChip`, `AgentTimeline`, `AIContextMenu`, `AIResponsePreview`, `useAgentChat`,
`useDocxAgentTools`, `useAgentBridge`, `toAgentMessages`, the `AgentMessage` / `AgentToolCall`
types) is removed, along with the `agentPanel`, `agentPanelOpen` and `onAgentPanelClose` props on
`@docx-editor.dev/react`'s editor shell and the `agentPanel.*` locale strings. Chat UI is
application chrome; render it where the rest of your chrome lives and drive the document through
`createBrowser(editor)`.

## What the compatibility claim means

The object model's shape is compatible with a documented subset of Word's JavaScript object model,
so a call site written against that vocabulary compiles here. It is not Office.js, it does not run
in an Office add-in host, and it depends on no Microsoft package — every type in the surface is
authored in this repository. The supported subset and its omissions (tables, images, repeating
sections, custom XML mapping) are listed on
[the Office.js compatibility page](https://www.docx-editor.dev/docs/latest/editor-api/office-js-api).
