# Agent example: Roast My Doc

An LLM reading a DOCX and leaving comments on it, live, in the editor the reader
is looking at. Every roast lands as a real Word comment anchored to the exact
words it is about, so saving the file carries them into Word.

The agent is read + comment only. It has no tool that edits text.

## Run it

```bash
bun install
bun run build:packages          # from the repo root
cp examples/agent/.env.example examples/agent/.env.local
# put your OPENAI_API_KEY in .env.local
bun run dev:agent               # http://localhost:3003
```

The demo boots with a short document of deliberately terrible prose. Click a
suggestion, or open your own `.docx` from the title bar.

## The shape

The packages ship no agent toolkit, no tool schemas and no chat UI. That is a
choice, not a gap. Which operations a model may reach, how they are described to
it, and what the chat surface looks like are all decisions about your product,
so they live in your app. What the packages give you is the layer underneath:
a real editing API against the live document.

Four files carry the whole thing.

| File                            | What it owns                                                         |
| ------------------------------- | -------------------------------------------------------------------- |
| `app/agent/tools.ts`            | The tool catalog. Schemas only, no `execute`. Shared by both halves. |
| `app/api/chat/route.ts`         | The model call. Advertises the catalog, streams tokens back.         |
| `app/agent/run-tool.ts`         | Runs each call against the live document via editor-api.             |
| `app/components/AgentPanel.tsx` | Wires the chat to the editor.                                        |

### The catalog is the allowlist

Tools are declared with no `execute`, so the AI SDK forwards each call to the
browser instead of running it on the server. That is what lets a tool touch the
document the reader has open.

It also means the catalog decides the agent's reach. Roastmaster exposes no
text-mutating tool at all, so a model that decides to rewrite your document has
nothing to call. That is a stronger guarantee than a system prompt asking it not
to. Retargeting the agent is mostly editing this file plus the system prompt.

### Document work goes through editor-api

`@docx-editor.dev/editor-api/browser` borrows an editor the host already
created:

```ts
const runtime = DocxEditor.createBrowser(editor);

await runtime.run(async (context) => {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load();
  await context.sync();
  for (const p of paragraphs.items) p.load(['text', 'uniqueLocalId']);
  await context.sync();
  // ...
});
```

Two phases, and the first is not optional. `text` is a property of a
`Paragraph`, not of the collection, so loading it off the collection throws.
`run-tool.ts` carries a comment at every place this bites.

Paragraphs are addressed by `uniqueLocalId`, issued by the runtime, so every
paragraph has one whether or not the file carried an id for it.

### Comments come from pro

editor-api can read, reply to and resolve comments, but it cannot create one. So
`add_comment` selects the phrase through editor-api and lands the comment
through `useReviewOf(editor).comment` from `@docx-editor.dev/pro/react`, which
comments on the current selection. Both halves drive the same editor, so the
selection one makes is the selection the other sees.

The panel needs the editor INSTANCE for this, and `useDocxEditor()` only answers
from inside the editor's tree. `EditorBridge` is a component that renders
nothing and exists to carry it out. `<DocxEditor onReady>` is not a substitute:
it hands over the narrower `Editor` facade, and `createBrowser` wants the
instance.

### Anchoring

The model is told to hand back a short phrase copied verbatim out of what
`read_document` gave it. `add_comment` searches for that phrase, refuses if it
is missing or occurs more than once in the target paragraph, and says which,
so the model can retry with something longer. Without that check the marker
lands on the wrong occurrence, or on the whole block.

## Three things that hang the panel

Each of these fails silently, with the chat sitting on "Reading the document"
for ever and nothing in the console.

1. **A tool that throws without answering.** `onToolCall` must reach
   `addToolResult` on every path. Catch inside it and hand the failure to the
   model as a tool result.
2. **Awaiting `addToolResult`.** It schedules the continuation request, which
   the SDK will not start until `onToolCall` settles. Awaiting it deadlocks.
3. **A missing `sendAutomaticallyWhen`.** Delivering a tool result does not
   continue the run on its own. Without
   `lastAssistantMessageIsCompleteWithToolCalls` the model never reads its own
   tool output.

`stopWhen: stepCountIs(12)` on the server is the fourth: the SDK defaults to a
single step, so without it the model calls one tool and stops.

## Cost

A tool result stays in the message history and is re-sent on every later turn,
so handing the model a whole long document means uploading and re-billing it
once per step. `read_document` caps what it returns and tells the model it was
capped, so it can search for the rest instead of assuming it saw everything.

## Deploying this

The route spends your API key for anyone who can reach it. Set
`ALLOWED_ORIGINS`, and add a rate limit before it is public.

Docs: https://www.docx-editor.dev/docs/editor-api
