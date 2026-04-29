# Agents

Add an AI assistant to your DOCX editor: a Google-Docs-style side panel, a streaming chat with a collapsible tool-call timeline, and a toolkit that lets the agent read/comment/redline by stable paragraph id. Working reference: [`examples/agent-chat-demo/`](../examples/agent-chat-demo/).

The library owns the panel chrome and chat primitives. **You bring your own agent runtime** — Vercel AI SDK, LangChain, Anthropic SDK, raw OpenAI, anything. We ship optional adapters for the AI SDK because it's the most popular path; everything else is plain JSON-Schema interop.

---

## Surface

| Piece                                                         | Where                                        | Notes                                                       |
| ------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `<DocxEditor agentPanel>`                                     | `@eigenpal/docx-js-editor`                   | Right-hand panel, sparkle toolbar toggle, drag-resize       |
| `<AgentChatLog>`, `<AgentComposer>`, `<AgentTimeline>`        | `@eigenpal/docx-js-editor`                   | Opinionated chat primitives — optional                      |
| `useDocxAgentTools()`                                         | `@eigenpal/docx-editor-agents/react`         | Tool executor + selection / page context                    |
| `getToolSchemas()`, `getToolDisplayName()`, `executeToolCall` | `@eigenpal/docx-editor-agents/server`        | OpenAI function-calling format — runtime-agnostic           |
| `getAiSdkTools()`                                             | `@eigenpal/docx-editor-agents/ai-sdk/server` | **AI SDK only.** Returns `streamText({ tools })` shape      |
| `toAgentMessages()`                                           | `@eigenpal/docx-editor-agents/ai-sdk/react`  | **AI SDK only.** `useChat` `UIMessage[]` → `AgentMessage[]` |
| `DocxReviewer`                                                | `@eigenpal/docx-editor-agents` (Node)        | Headless: same toolkit, no editor                           |

The `/ai-sdk/*` subpaths import `ai`. Don't use them if you're not on AI SDK — `ai` is an optional peer dep.

---

## Quickstart — Vercel AI SDK (recommended)

### 1. Install

```bash
npm i @eigenpal/docx-js-editor @eigenpal/docx-editor-agents \
      ai @ai-sdk/react @ai-sdk/openai
```

Set `OPENAI_API_KEY`.

### 2. Server route — `app/api/chat/route.ts`

```ts
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { type AgentContextSnapshot } from '@eigenpal/docx-editor-agents/server';
import { getAiSdkTools } from '@eigenpal/docx-editor-agents/ai-sdk/server';

const tools = getAiSdkTools();

export async function POST(req: Request) {
  const { messages, context } = (await req.json()) as {
    messages: UIMessage[];
    context?: AgentContextSnapshot;
  };

  const result = streamText({
    model: openai('gpt-4o'),
    system:
      'You are a helpful document assistant.' +
      (context?.selection?.paraId ? `\n[CONTEXT] Cursor in ${context.selection.paraId}.` : ''),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(12), // let the agent loop until it writes a final reply
  });

  return result.toUIMessageStreamResponse();
}
```

`stopWhen` is required — without it AI SDK stops after one tool call and you never get the final text response.

### 3. Client — `app/page.tsx`

```tsx
'use client';
import { useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { type DocxEditorRef, AgentChatLog, AgentComposer } from '@eigenpal/docx-js-editor';
import {
  useDocxAgentTools,
  getToolDisplayName,
  type EditorRefLike,
} from '@eigenpal/docx-editor-agents/react';
import { toAgentMessages } from '@eigenpal/docx-editor-agents/ai-sdk/react';

const DocxEditor = dynamic(
  () => import('@eigenpal/docx-js-editor').then((m) => ({ default: m.DocxEditor })),
  { ssr: false }
);

export default function Page() {
  const editorRef = useRef<DocxEditorRef>(null);
  const [input, setInput] = useState('');

  const { executeToolCall, getContext } = useDocxAgentTools({
    editorRef: editorRef as React.RefObject<EditorRefLike | null>,
    author: 'Assistant',
  });

  // chat isn't defined yet inside onToolCall — route the tool result back
  // through a ref that we set after useChat returns.
  const chatRef = useRef<{ addToolResult: (args: unknown) => Promise<void> } | null>(null);
  const chat = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { messages, context: getContext() },
      }),
    }),
    // Re-send the conversation after each tool result so the model can
    // read its own output and either call another tool or write the reply.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      const r = executeToolCall(
        toolCall.toolName,
        (toolCall.input ?? {}) as Record<string, unknown>
      );
      const output = typeof r.data === 'string' ? r.data : (r.error ?? JSON.stringify(r.data));
      void chatRef.current?.addToolResult({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output,
      });
    },
  });
  chatRef.current = chat as unknown as typeof chatRef.current;

  const messages = useMemo(
    () => toAgentMessages(chat.messages, chat.status),
    [chat.messages, chat.status]
  );
  const loading = chat.status === 'streaming' || chat.status === 'submitted';

  return (
    <DocxEditor
      ref={editorRef}
      // ...your usual editor props
      agentPanel={{
        title: 'Assistant',
        render: () => (
          <>
            <AgentChatLog
              messages={messages}
              loading={loading}
              error={chat.error?.message}
              humanizeToolName={getToolDisplayName}
            />
            <AgentComposer
              value={input}
              onChange={setInput}
              onSubmit={() => {
                if (!input.trim() || loading) return;
                chat.sendMessage({ text: input });
                setInput('');
              }}
              disabled={loading}
            />
          </>
        ),
      }}
    />
  );
}
```

That's the full integration. Words stream in token-by-token; tool calls show up in the timeline (running spinner → green check); comments / tracked changes / formatting appear live in the doc as the agent emits them.

---

## Bring your own agent runtime

Don't want AI SDK? Skip the `/ai-sdk/*` imports. The core toolkit is plain OpenAI function-calling format, which Anthropic, LangChain, and most others accept directly.

### LangChain (sketch)

```ts
import { getToolSchemas, executeToolCall } from '@eigenpal/docx-editor-agents/server';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const tools = getToolSchemas().map((s) =>
  tool(async (input) => JSON.stringify(executeToolCall(s.function.name, input, bridge)), {
    name: s.function.name,
    description: s.function.description,
    schema: zodFromJsonSchema(s.function.parameters), // your converter of choice
  })
);

const model = new ChatOpenAI({ model: 'gpt-4o' }).bindTools(tools);
```

### Anthropic SDK

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getToolSchemas } from '@eigenpal/docx-editor-agents/server';

const client = new Anthropic();
const stream = client.messages.stream({
  model: 'claude-sonnet-4',
  tools: getToolSchemas().map((s) => ({
    name: s.function.name,
    description: s.function.description,
    input_schema: s.function.parameters, // Anthropic accepts this shape directly
  })),
  messages: [{ role: 'user', content: 'Review this doc.' }],
});
```

The pattern is the same: schemas in, tool calls out, run them through `executeToolCall` (server) or `useDocxAgentTools().executeToolCall` (client). Stream how you like; render into the panel however you like.

---

## Built-in tools

| Tool                               | What it does                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `read_document`                    | Doc as `[paraId] text` lines                                                  |
| `read_selection`                   | Current cursor / selection                                                    |
| `read_page`, `read_pages`          | Paged content (1-indexed)                                                     |
| `find_text`                        | Locate phrases, return paraId anchors                                         |
| `read_comments`                    | List comments + threads                                                       |
| `read_changes`                     | List tracked changes                                                          |
| `add_comment`                      | Comment, anchored by paraId (+ optional `search` for sub-paragraph anchoring) |
| `suggest_change`                   | Tracked change — user accepts or rejects                                      |
| `apply_formatting`                 | Bold / italic / underline / strike / color / highlight / size / font          |
| `set_paragraph_style`              | Heading or named style — rejects styleIds not in `styles.xml`                 |
| `reply_comment`, `resolve_comment` | Comment thread ops                                                            |
| `scroll`                           | Move the viewport to a paragraph                                              |

Everything anchors by stable `w14:paraId`. A `ParaIdAllocatorExtension` runs in the editor and assigns fresh ids to paragraphs on Enter / paste / split — concurrent typing won't desync the agent's anchors.

---

## Common patterns

### Read-only / comment-only

```tsx
useDocxAgentTools({ editorRef, include: ['read_document', 'find_text', 'add_comment'] });
useDocxAgentTools({ editorRef, exclude: ['suggest_change', 'apply_formatting'] });
```

`executeToolCall` enforces the filter — a model that hallucinates a filtered tool gets an error, not a silent bypass. Custom tools always pass.

### Custom tools

```tsx
import type { AgentToolDefinition } from '@eigenpal/docx-editor-agents/react';

const fetchClause: AgentToolDefinition<{ name: string }> = {
  name: 'fetch_clause_template',
  displayName: 'Fetching template',
  description: 'Fetch a clause from the template library by name.',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  handler: (input) => ({ success: true, data: fetchTemplateSync(input.name) }),
};

useDocxAgentTools({ editorRef, tools: { fetch_clause_template: fetchClause } });
```

A custom tool with the same name as a built-in **replaces** the built-in.

### Control the panel from outside the editor

```tsx
const [open, setOpen] = useState(false);
<DocxEditor agentPanel={{ open, onOpenChange: setOpen, showToolbarButton: false, render }} />;
```

The render prop also receives `{ close }` for closing from inside.

### Skip our chat primitives

```tsx
<DocxEditor agentPanel={{ render: ({ close }) => <MyChatUI onClose={close} /> }} />
```

The panel takes any `ReactNode`. Use `assistant-ui`, your design system, or raw HTML.

---

## Library vs consumer split

| Library                                    | Consumer                                                 |
| ------------------------------------------ | -------------------------------------------------------- |
| Panel chrome, drag-resize, open/close anim | LLM provider, model, streaming protocol                  |
| Sparkle button + header + close button     | What renders inside the panel                            |
| Tool-call timeline UI                      | Tool-call execution loop (we hand you `executeToolCall`) |
| Built-in tool schemas + display labels     | Custom tools, filtering, system prompt                   |
| Stable paraId allocation                   | Whether the panel is open                                |

Panel chrome is intentionally non-customizable so the look stays consistent across consumers. Everything inside is yours.

---

## Headless / Node

```ts
import { DocxReviewer } from '@eigenpal/docx-editor-agents';

const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
reviewer.addComment(5, 'Liability cap seems too low.');
reviewer.replace(5, '$50k', '$500k');
const out = await reviewer.toBuffer();
```

Same toolkit, no browser. Wire `getToolSchemas()` to any backend LLM and run review batches in Node / Workers / serverless.
