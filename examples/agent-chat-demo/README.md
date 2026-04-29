# Roast My Doc — agent + editor reference example

The canonical "plug an agent into the editor" demo. A Next.js app that:

- Mounts `<DocxEditor>` with the controllable right-hand `agentPanel` slot.
- Wires `useDocxAgentTools` (~10 lines) to an OpenAI-backed `/api/chat` route.
- Streams the agent reading your DOCX and dropping a (constructive) roast on
  every paragraph that deserves one — every comment appears live in the editor
  as the model writes it.

## Run it

```bash
export OPENAI_API_KEY=sk-...
bun install
bun run dev --filter agent-chat-demo
```

Open http://localhost:3002, drop in a DOCX, and click **Roast it**.

## What the code does

Three pieces — copy them into your own app.

**1. Server route (`app/api/chat/route.ts`)** — proxy your LLM call. Imports
tool schemas from `@eigenpal/docx-editor-agents/server` and passes them to
OpenAI:

```ts
import { getToolSchemas } from '@eigenpal/docx-editor-agents/server';
// ...
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [...systemMessages, ...messages],
  tools: getToolSchemas(),
});
```

**2. React page (`app/page.tsx`)** — the hook owns the bridge, the panel
holds your chat UI:

```tsx
const { executeToolCall, getContext } = useDocxAgentTools({
  editorRef,
  author: 'Roastmaster',
});

<DocxEditor
  ref={editorRef}
  documentBuffer={buf}
  agentPanel={{
    open: panelOpen,
    onOpenChange: setPanelOpen,
    render: () => <YourChatUI />,
  }}
/>;
```

**3. Tool execution loop** — every time the model emits `tool_calls`, run
them locally through `executeToolCall` and push the results back into the
conversation history. The toolkit keeps the editor in sync with the model in
the same tick.

## Repurposing

Want a redlining agent? A writing assistant? A medical summarizer? Three
edits:

1. **Swap the system prompt** in `app/api/chat/route.ts`.
2. **Filter tools** if the agent shouldn't have full access — e.g. for a
   read-only summarizer, omit `add_comment` / `suggest_change` /
   `apply_formatting` from `getToolSchemas()`.
3. **Re-skin the panel** in `app/page.tsx` (or drop in `useChat` from the
   AI SDK if you want streaming + abort + tool-call inspector for free).

## Why no chat framework here

We use raw `fetch` + plain React state to keep the dependency surface tiny
and make the BYO pattern obvious. AI SDK's `useChat` works one-for-one — the
toolkit ships in OpenAI function-calling format, which the AI SDK and most
LLM providers consume directly:

```tsx
import { useChat } from '@ai-sdk/react';

const chat = useChat({
  api: '/api/agent',
  onToolCall: ({ toolCall }) => executeToolCall(toolCall.toolName, toolCall.args),
  prepareRequestBody: ({ messages }) => ({ messages, context: getContext() }),
});
```

That's it. The toolkit is framework-agnostic.
