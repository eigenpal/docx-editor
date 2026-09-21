# Agent example: Roast My Doc

This app uses a language model to read an open DOCX and add comments to selected phrases. Saving the document preserves those comments for Microsoft Word.

The agent can read and comment. Its tool catalog does not expose text edits.

## Run the example

From the repository root, install dependencies and build the workspace packages:

```bash
bun install
bun run build:packages
cp examples/agent/.env.example examples/agent/.env.local
```

Set `OPENAI_API_KEY` in `examples/agent/.env.local`. You can also set `OPENAI_MODEL` and `ALLOWED_ORIGINS`. Then start the example:

```bash
bun run dev:agent
```

Open `http://localhost:3003`.

The demo opens a sample document. Select a suggestion, or open your own `.docx` from the title bar.

## Architecture

The application owns the tool schemas, model instructions, and chat interface. The editor API provides document access. Four files connect these parts:

| File | What it owns |
| --- | --- |
| `app/agent/tools.ts` | The tool catalog. Schemas only, no `execute`. Shared by both halves. |
| `app/api/chat/route.ts` | The model call. Advertises the catalog, streams tokens back. |
| `app/agent/run-tool.ts` | Runs each call against the live document via editor-api. |
| `app/components/AgentPanel.tsx` | Wires the chat to the editor. |

### The catalog is the allowlist

Tools are declared with no `execute`, so the AI SDK forwards each call to the browser instead of running it on the server. That is what lets a tool touch the document the reader has open.

It also means the catalog decides the agent's reach. Roastmaster exposes no text-mutating tool at all, so a model that decides to rewrite your document has nothing to call. That is a stronger guarantee than a system prompt asking it not to. Retargeting the agent is mostly editing this file plus the system prompt.

### Document work goes through editor-api

`@docx-editor.dev/editor-api/browser` borrows an editor the host already created:

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';

const runtime = DocxEditor.createBrowser(editor);

await runtime.run(async (context) => {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load('items');
  await context.sync();
  for (const p of paragraphs.items) p.load(['text', 'uniqueLocalId']);
  await context.sync();
  console.log(paragraphs.items.map((p) => p.text));
});
```

The first sync retrieves the paragraph collection. The second retrieves the requested properties for each paragraph. Load `text` on the paragraph, not the collection.

Paragraphs are addressed by `uniqueLocalId`, issued by the runtime, so every paragraph has one whether or not the file carried an id for it.

### Add comments

This example selects a phrase through editor-api and adds a comment with `useReviewOf(editor).comment` from `@docx-editor.dev/pro/react`. Both packages operate on the same editor instance. These review features require the EigenPal Pro License.

The editor API also supports `Range.insertComment()`. The example retains its selection-based review integration.

The panel needs the editor instance. `EditorBridge` reads it with `useDocxEditor()` inside the editor tree and passes it to the panel. The `onReady` callback supplies the narrower `Editor` facade, which is not the input required by `createBrowser()`.

### Anchoring

The model is told to hand back a short phrase copied verbatim out of what `read_document` gave it. `add_comment` searches for that phrase, refuses if it is missing or occurs more than once in the target paragraph, and says which, so the model can retry with something longer. Without that check the marker lands on the wrong occurrence, or on the whole block.

## Troubleshoot tool results

Each of these fails silently. The chat stays on "Reading the document," and the console shows no error.

1. **A tool that throws without answering.** `onToolCall` must reach `addToolResult` on every path. Catch inside it and hand the failure to the model as a tool result.
2. **Awaiting `addToolResult`.** It schedules the continuation request, which the SDK will not start until `onToolCall` settles. Awaiting it deadlocks.
3. **A missing `sendAutomaticallyWhen`.** Delivering a tool result does not continue the run on its own. Without `lastAssistantMessageIsCompleteWithToolCalls` the model never reads its own tool output.

`stopWhen: stepCountIs(12)` on the server is the fourth: the SDK defaults to a single step, so without it the model calls one tool and stops.

## Cost

A tool result stays in the message history and is re-sent on every later turn, so handing the model a whole long document means uploading and re-billing it once per step. `read_document` caps what it returns and tells the model it was capped, so it can search for the rest instead of assuming it saw everything.

## Deploy the example

The route spends your API key for anyone who can reach it. Set `ALLOWED_ORIGINS`, and add a rate limit before it is public.

For more information, see the [editor API documentation](https://www.docx-editor.dev/docs/2.x/editor-api).
