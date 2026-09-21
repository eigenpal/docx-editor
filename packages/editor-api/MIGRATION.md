# Migrate to the object model

`@docx-editor.dev/editor-api` replaces `@docx-editor.dev/agents`. It exposes a supported subset of Word's Office.js object model. Use it on a server or with an open browser editor.

The migration removes the reviewer, editor bridge, tool catalog, Model Context Protocol (MCP) server, and framework chat components. Removed exports have no aliases.

## Replace reviewer calls

The former reviewer addresses content by paragraph index:

```ts
const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
reviewer.replace(5, '$50k', '$500k');
const out = await reviewer.toBuffer();
```

The object model uses document proxies and explicit batches. This example permanently replaces one unique match:

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes, { author: 'AI Reviewer' });
try {
  await runtime.run(async (context) => {
    const matches = context.document.body.search('$50k', { matchCase: true });
    matches.load('items');
    await context.sync();
    if (matches.items.length !== 1) throw new Error('Choose one unique target');

    matches.items[0]!.insertText('$500k', 'Replace');
    await context.sync();
  });
  const out = await runtime.save();
} finally {
  runtime.dispose();
}
```

Account for three model differences:

- Addressing: Find objects through searches and collections instead of paragraph indexes.
- Batching: Queued writes commit together at `await context.sync()`. A failed batch applies no writes.
- Loading: Load properties before reading them. Reading an unloaded property throws `PropertyNotLoaded`.

The example syncs once to read matches and once to commit the replacement. Earlier successful batches remain committed if a later batch fails.

## Change entry points

| Former entry                       | Replacement                                            |
| ---------------------------------- | ------------------------------------------------------ |
| `@docx-editor.dev/agents`          | `@docx-editor.dev/editor-api` for server or worker use |
| `@docx-editor.dev/agents/server`   | `@docx-editor.dev/editor-api`                          |
| `@docx-editor.dev/agents/bridge`   | `@docx-editor.dev/editor-api/browser`                  |
| `@docx-editor.dev/agents/react`    | `@docx-editor.dev/editor-api/browser`                  |
| `@docx-editor.dev/agents/vue`      | `@docx-editor.dev/editor-api/browser`                  |
| `@docx-editor.dev/agents/mcp`      | Removed; define MCP tools in your application          |
| `@docx-editor.dev/agents/ai-sdk/*` | Removed; define SDK adapters in your application       |

The browser entry accepts an editor instance from core, React, or Vue. Save through the owning editor and dispose the runtime when your integration ends:

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';

const runtime = DocxEditor.createBrowser(editor, { author: 'AI Reviewer' });
```

## Read and edit content

| Former API | Replacement |
| --- | --- |
| `DocxReviewer.fromBuffer(buffer, author)` | `await DocxEditor.createServer(bytes, { author })` |
| `reviewer.toBuffer()` | `await runtime.save()` |
| `reviewer.toDocument()` | Removed; obtain proxies inside `runtime.run()` |
| `reviewer.getContent()` / `getContentAsText()` | Load `body.text`, sync, then read it; or enumerate `body.paragraphs` |
| `reviewer.replace(i, search, with)` | Search for a target, then call `range.insertText(text, 'Replace')` |
| `reviewer.applyReview(batchOps)` | Queue independent writes inside `runtime.run()`, then call `context.sync()` |
| `TextNotFoundError` and related errors | Handle `DocxEditorError.code` |

Ranges retain their original offsets. After editing a paragraph, search again before acting on another target there. See [Text and ranges](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges) for same-batch editing limits.

## Preserve suggestions as tracked changes

To replace `proposeReplacement`, `proposeInsertion`, or `proposeDeletion`, set `context.document.changeTrackingMode = 'TrackMineOnly'` before editing. Supply an `author` when creating the runtime. Without this setting, the initial `Off` mode makes permanent edits.

| Former API | Edit after enabling `TrackMineOnly` |
| --- | --- |
| `reviewer.proposeReplacement(...)` | `range.insertText(text, 'Replace')` |
| `reviewer.proposeInsertion(...)` | `range.insertText(text, 'Before')` or `range.insertText(text, 'After')` |
| `reviewer.proposeDeletion(...)` | `range.delete()` or `range.clear()` |

Tracked edits support text in one paragraph, including table-cell text. The runtime rejects structural edits, formatting edits, and targets touching pending revisions while tracking. Browser tracked writes require the Pro review module and an editable editor. `TrackAll` fails with `NotSupported`.

For a complete tracked-edit example, see [Office.js patterns for server agents](OFFICE_JS_GUIDE.md). Never disable tracking automatically to make a rejected suggestion succeed.

## Migrate comments and revision decisions

| Former API | Replacement |
| --- | --- |
| `reviewer.getComments(filter)` | Load `document.comments` or `body.getComments()` with `'items'`, then sync |
| `reviewer.replyTo(id, text)` | `comment.reply(text)` |
| `reviewer.getChanges(filter)` | Load `document.revisions` or `body.revisions` with `'items'`, then sync |
| `reviewer.acceptChange` / `rejectChange` | `revision.accept()` / `revision.reject()` |
| `reviewer.acceptAll` / `rejectAll` | `revisions.acceptAll()` / `revisions.rejectAll()` for a strict story-wide batch |
| `reviewer.addComment(...)` | `range.insertComment(text)` with the runtime's configured `author` |
| `reviewer.removeComment(id)` | `comment.delete()` for the complete thread, or `reply.delete()` for one reply |

Load the properties needed for filtering, sync, then filter `items`. Use `revisions.resolve(action, selectedRevisions)` to resolve selected changes and report skipped decisions. See [Tracked changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions) for story scope and unsupported groups.

## Replace tools, MCP, and chat components

The package removes these tool and bridge exports:

- `agentTools`, `getToolSchemas`, `executeToolCall`, and `getToolDisplayName`.
- The `read_document`, `add_comment`, `suggest_change`, `apply_formatting`, and `scroll` tools.
- `EditorBridge`, `createEditorBridge`, `createReviewerBridge`, and `WordCompatBridge`.
- `McpServer`, `runStdioServer`, MCP protocol types, and AI SDK adapters.

Define tool schemas and error handling in your application. Implement each document operation through a `runtime.run()` callback.

The package also removes these React and Vue chat exports:

- `AgentPanel`, `AgentChatLog`, `AgentComposer`, `AgentSuggestionChip`, and `AgentTimeline`.
- `AIContextMenu`, `AIResponsePreview`, `useAgentChat`, `useDocxAgentTools`, and `useAgentBridge`.
- `toAgentMessages`, `AgentMessage`, and `AgentToolCall`.

The React editor removes `agentPanel`, `agentPanelOpen`, and `onAgentPanelClose`. The shared locales remove `agentPanel.*` strings. Render chat controls in your application and connect them with `createBrowser(editor)`.

## Check compatibility

The object model implements a documented Office.js subset. It runs independently of Office and does not require a Microsoft package. Matching signatures do not guarantee identical runtime behavior.

Tables and inline pictures have supported editing subsets. Repeating-section objects and custom XML mapping APIs remain unavailable. Check [Office.js compatibility](https://www.docx-editor.dev/docs/2.x/editor-api/office-js-api) for each operation your integration needs.
