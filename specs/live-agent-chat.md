# Spec: Live Agent Chat with Document Tools

## Problem

Today `DocxReviewer` operates on a **static `Document` model** — you parse a DOCX, the agent reads/comments/proposes, you serialize back to DOCX. There's no connection to the live editor. The `bridge.ts` placeholder exists but is unimplemented.

The goal: a **chat panel next to the document** where an AI agent can read the document content, add comments, suggest changes, and highlight text — all happening live in the editor UI, not just in a serialized file.

## User Experience

```
┌────────────────────────────────────────┬─────────────────────────┐
│                                        │                         │
│           DOCX Editor                  │      Agent Chat         │
│                                        │                         │
│  ┌──────────────────────────────┐      │  User: Review section 3 │
│  │ Section 3: Payment Terms    │      │  for legal issues       │
│  │                              │      │                         │
│  │ The buyer shall pay $50k ←──────────── Agent: I found 2       │
│  │ [💬 Agent: Liability cap...] │      │  issues in section 3:   │
│  │                              │      │                         │
│  │ within 30 days of ←─────────────────── 1. Liability cap at    │
│  │ [💬 Agent: No late fee...]   │      │  $50k seems low for     │
│  │                              │      │  this deal size         │
│  └──────────────────────────────┘      │                         │
│                                        │  2. No late payment     │
│  ┌─ Comments Sidebar ──────────┐      │  clause specified       │
│  │ 💬 Agent: Liability cap     │      │                         │
│  │    at $50k is low...        │      │  I've added comments    │
│  │                              │      │  to both paragraphs.   │
│  │ 💬 Agent: No late fee       │      │                         │
│  │    clause specified...      │      │  [Apply suggested fix]  │
│  └──────────────────────────────┘      │                         │
│                                        │  User: Fix the first    │
│                                        │  one, change to $500k   │
│                                        │                         │
│                                        │  Agent: Done. Created   │
│                                        │  a tracked change:      │
│                                        │  $50k → $500k           │
└────────────────────────────────────────┴─────────────────────────┘
```

The agent's comments and tracked changes appear **instantly** in the editor — same as if a human collaborator added them. The existing `CommentsSidebar` renders them. The user can accept/reject tracked changes through the normal UI.

## Architecture

### Three layers

```
┌──────────────────────────────────────────────────────────────┐
│  1. CHAT UI  (React component)                               │
│     - Message list, input box, tool call display             │
│     - Lives in packages/react                                │
│     - Pure presentation — no AI logic                        │
└────────────┬─────────────────────────────────────────────────┘
             │ calls
┌────────────▼─────────────────────────────────────────────────┐
│  2. AGENT TOOLS  (tool definitions + handlers)               │
│     - Tool schemas the AI can call                           │
│     - Handlers that call into EditorBridge                   │
│     - Lives in packages/agent-use                            │
└────────────┬─────────────────────────────────────────────────┘
             │ calls
┌────────────▼─────────────────────────────────────────────────┐
│  3. EDITOR BRIDGE  (client-side adapter)                     │
│     - Connects agent tools → live editor state               │
│     - Reads from ProseMirror doc + Document model            │
│     - Writes comments/changes into editor state              │
│     - Lives in packages/agent-use/bridge + packages/react    │
└──────────────────────────────────────────────────────────────┘
```

### Key constraint: AI-provider agnostic

The spec defines **tool schemas and a bridge API**. It does NOT include any AI SDK, API calls, or model-specific logic. The consumer (app developer) brings their own AI provider and wires tool calls through the bridge.

This means the chat component receives messages and tool results as props — it doesn't make API calls itself.

---

## Layer 3: Editor Bridge (`packages/agent-use/src/bridge.ts`)

The bridge connects agent tool handlers to the live editor. It wraps a `DocxEditorRef` and exposes the same operations as `DocxReviewer`, but operating on the **live editor state** instead of a static Document.

### Interface

```ts
// packages/agent-use/src/bridge.ts

import type { DocxEditorRef } from '@eigenpal/docx-js-editor';

export interface EditorBridge {
  // ── READ ──────────────────────────────────────────────────
  /** Get document content as indexed text lines (same format as DocxReviewer.getContentAsText) */
  getContentAsText(options?: GetContentOptions): string;

  /** Get structured content blocks */
  getContent(options?: GetContentOptions): ContentBlock[];

  /** Get existing comments */
  getComments(): ReviewComment[];

  /** Get existing tracked changes */
  getChanges(): ReviewChange[];

  /** Get text around the user's current cursor/selection */
  getSelectionContext(): SelectionContext | null;

  // ── COMMENT ───────────────────────────────────────────────
  /** Add a comment anchored to a paragraph (optionally to specific text within it) */
  addComment(options: AddCommentOptions): number;

  /** Reply to an existing comment */
  replyTo(commentId: number, options: ReplyOptions): number;

  /** Resolve a comment */
  resolveComment(commentId: number): void;

  // ── SUGGEST CHANGES ───────────────────────────────────────
  /** Replace text, creating a tracked change visible in the editor */
  replace(options: ProposeReplacementOptions): void;

  /** Insert text as a tracked change */
  proposeInsertion(options: ProposeInsertionOptions): void;

  /** Delete text as a tracked change */
  proposeDeletion(options: ProposeDeletionOptions): void;

  // ── HIGHLIGHT ─────────────────────────────────────────────
  /** Temporarily highlight a paragraph or text range (visual only, not persisted) */
  highlight(paragraphIndex: number, options?: HighlightOptions): HighlightHandle;

  // ── NAVIGATE ──────────────────────────────────────────────
  /** Scroll to and optionally select a paragraph */
  scrollTo(paragraphIndex: number): void;
}

export interface SelectionContext {
  /** Currently selected text (empty string if cursor only) */
  selectedText: string;
  /** Paragraph index of the selection start */
  paragraphIndex: number;
  /** Full text of the paragraph containing the selection */
  paragraphText: string;
  /** Formatting at the selection */
  formatting: TextFormatting;
}

export interface HighlightOptions {
  /** Color of the highlight. Default: 'yellow' */
  color?: string;
  /** Optional: highlight only this text within the paragraph */
  search?: string;
  /** Auto-remove after N milliseconds. Default: no auto-remove */
  duration?: number;
}

export interface HighlightHandle {
  /** Remove the highlight */
  remove(): void;
}

/** Create a bridge from a DocxEditor ref */
export function createEditorBridge(editorRef: DocxEditorRef, author?: string): EditorBridge;
```

### Implementation strategy

The bridge reads from the editor's internal state:

- **Read operations**: Extract content from the ProseMirror document (same logic as `DocxReviewer` but reading from `editorRef.getDocument()` or the live PM state)
- **Comment operations**: Call `editorRef`'s existing comment APIs (already wired in `DocxEditor.tsx` — `setComments`, `addComment` handlers exist)
- **Change operations**: Dispatch ProseMirror transactions that create tracked changes (insertion/deletion marks with author metadata)
- **Highlight**: Add a temporary decoration to the ProseMirror view (a `Decoration.inline` or `Decoration.node` — removed when the handle's `remove()` is called)
- **Navigate**: Use `editorRef.scrollToIndex(paragraphIndex)` or dispatch a selection + scrollIntoView

### What needs to be added to DocxEditorRef

The existing `DocxEditorRef` needs a few new methods:

```ts
interface DocxEditorRef {
  // ... existing methods ...

  /** Get the current Document model (already exists as getDocument()) */
  getDocument(): Document;

  /** Add a comment programmatically (needs to be exposed) */
  addComment(options: {
    paragraphIndex: number;
    text: string;
    author: string;
    search?: string;
  }): number;

  /** Reply to a comment */
  replyToComment(commentId: number, text: string, author: string): number;

  /** Resolve a comment */
  resolveComment(commentId: number): void;

  /** Create a tracked change (replacement) */
  proposeReplacement(options: {
    paragraphIndex: number;
    search: string;
    replaceWith: string;
    author: string;
  }): void;

  /** Add a temporary highlight decoration */
  addHighlight(
    paragraphIndex: number,
    options?: { search?: string; color?: string }
  ): { remove(): void };

  /** Scroll to a paragraph index */
  scrollToIndex(paragraphIndex: number): void;
}
```

---

## Layer 2: Agent Tool Definitions (`packages/agent-use/src/tools/`)

Tools are defined as **JSON schemas** (compatible with Anthropic, OpenAI, and Vercel AI SDK tool formats). Each tool has a schema + a handler function that calls into the `EditorBridge`.

### Tool catalog

| Tool Name             | Description                                            | Parameters                                       |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `read_document`       | Read document content as indexed text                  | `{ fromIndex?, toIndex? }`                       |
| `read_selection`      | Get text/context at the user's current cursor position | `{}`                                             |
| `read_comments`       | List all comments in the document                      | `{ author? }`                                    |
| `read_changes`        | List all tracked changes                               | `{ author?, type? }`                             |
| `add_comment`         | Add a comment on a paragraph                           | `{ paragraphIndex, text, search? }`              |
| `reply_to_comment`    | Reply to an existing comment                           | `{ commentId, text }`                            |
| `resolve_comment`     | Mark a comment as resolved                             | `{ commentId }`                                  |
| `suggest_replacement` | Replace text (creates tracked change)                  | `{ paragraphIndex, search, replaceWith }`        |
| `suggest_insertion`   | Insert text (creates tracked change)                   | `{ paragraphIndex, text, position?, search? }`   |
| `suggest_deletion`    | Delete text (creates tracked change)                   | `{ paragraphIndex, search }`                     |
| `highlight_text`      | Temporarily highlight text to draw user attention      | `{ paragraphIndex, search?, color?, duration? }` |
| `scroll_to`           | Scroll document to a paragraph                         | `{ paragraphIndex }`                             |

### Tool definition format

```ts
// packages/agent-use/src/tools/types.ts

export interface AgentToolDefinition<TInput = unknown> {
  /** Tool name (used in tool_use blocks) */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: Record<string, unknown>;
  /** Handler — receives parsed input + bridge, returns result for the LLM */
  handler: (input: TInput, bridge: EditorBridge) => AgentToolResult;
}

export interface AgentToolResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Data to return to the LLM (will be JSON.stringified) */
  data?: unknown;
  /** Error message if failed */
  error?: string;
}
```

### Example tool definition

```ts
// packages/agent-use/src/tools/readDocument.ts

export const readDocumentTool: AgentToolDefinition<{ fromIndex?: number; toIndex?: number }> = {
  name: 'read_document',
  description:
    'Read the document content. Returns indexed text lines like "[0] First paragraph", ' +
    '"[1] Second paragraph". Use fromIndex/toIndex to read a specific range. ' +
    'Always read the document before commenting or suggesting changes.',
  inputSchema: {
    type: 'object',
    properties: {
      fromIndex: {
        type: 'number',
        description: 'Start reading from this paragraph index (inclusive). Default: 0',
      },
      toIndex: {
        type: 'number',
        description: 'Stop reading at this paragraph index (inclusive). Default: end of document',
      },
    },
  },
  handler: (input, bridge) => {
    const text = bridge.getContentAsText({
      fromIndex: input.fromIndex,
      toIndex: input.toIndex,
    });
    return { success: true, data: text };
  },
};
```

### Registry + helpers

```ts
// packages/agent-use/src/tools/index.ts

/** All built-in tools */
export const agentTools: AgentToolDefinition[];

/** Get tool schemas in Anthropic format */
export function getAnthropicTools(): AnthropicToolSchema[];

/** Get tool schemas in OpenAI format */
export function getOpenAITools(): OpenAIToolSchema[];

/** Execute a tool call against an EditorBridge */
export function executeToolCall(
  toolName: string,
  input: unknown,
  bridge: EditorBridge
): AgentToolResult;
```

---

## Layer 1: Chat UI (`packages/react/src/components/AgentChat/`)

### Components

```
AgentChat/
├── AgentChatPanel.tsx      — Main panel (message list + input)
├── ChatMessage.tsx         — Single message bubble
├── ChatToolCall.tsx        — Inline tool call display (collapsible)
├── ChatInput.tsx           — Text input + send button
├── types.ts                — Chat message types
└── useAgentChat.ts         — Hook that wires tools to the bridge
```

### Props — Provider-agnostic

```ts
// AgentChatPanel.tsx

export interface AgentChatPanelProps {
  /** Messages to display */
  messages: ChatMessage[];

  /** Whether the agent is currently generating */
  isLoading?: boolean;

  /** Called when the user sends a message. The consumer handles AI calls. */
  onSendMessage: (text: string) => void;

  /** Called when a tool call needs execution. Returns the result. */
  onToolCall?: (toolName: string, input: unknown) => Promise<AgentToolResult>;

  /** Optional: pre-built bridge for automatic tool execution */
  bridge?: EditorBridge;

  /** Agent display name. Default: 'Agent' */
  agentName?: string;

  /** Width of the panel. Default: 360px */
  width?: number;

  /** Whether the panel is open */
  isOpen: boolean;

  /** Called when the user closes the panel */
  onClose: () => void;
}
```

### Message types

```ts
// types.ts

export type ChatMessage = UserMessage | AgentMessage | ToolCallMessage | ToolResultMessage;

export interface UserMessage {
  role: 'user';
  id: string;
  content: string;
  timestamp: number;
}

export interface AgentMessage {
  role: 'agent';
  id: string;
  content: string;
  timestamp: number;
}

export interface ToolCallMessage {
  role: 'tool_call';
  id: string;
  toolName: string;
  input: unknown;
  timestamp: number;
}

export interface ToolResultMessage {
  role: 'tool_result';
  id: string;
  toolCallId: string;
  result: AgentToolResult;
  timestamp: number;
}
```

### `useAgentChat` hook

Convenience hook that wires everything together:

```ts
export function useAgentChat(options: {
  editorRef: React.RefObject<DocxEditorRef>;
  author?: string;
}): {
  /** The bridge instance (stable ref) */
  bridge: EditorBridge;

  /** Execute a tool call through the bridge */
  executeToolCall: (toolName: string, input: unknown) => AgentToolResult;

  /** Get tool schemas for your AI provider */
  getToolSchemas: () => AgentToolDefinition[];

  /** System prompt snippet describing the document context */
  getSystemContext: () => string;
};
```

### Chat UI behavior

- **Tool calls**: When the agent response includes tool calls, they appear as collapsible cards in the chat. The card shows the tool name, a human-readable summary of what it did, and the result (collapsed by default).
- **Comments**: When `add_comment` is called, a comment appears instantly in the `CommentsSidebar`. The chat shows "Added comment on paragraph 5" with a clickable link that scrolls to the paragraph.
- **Changes**: When `suggest_replacement` is called, a tracked change appears in the editor. The chat shows a mini-diff ("$50k → $500k").
- **Highlights**: When `highlight_text` is called, the paragraph briefly glows in the editor to draw attention.

---

## Integration Example (Consumer Code)

```tsx
// Example: App using the editor + chat with Anthropic SDK

import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-js-editor';
import { AgentChatPanel, useAgentChat } from '@eigenpal/docx-js-editor/ui';
import Anthropic from '@anthropic-ai/sdk';

function App() {
  const editorRef = useRef<DocxEditorRef>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  const { bridge, executeToolCall, getToolSchemas, getSystemContext } = useAgentChat({
    editorRef,
    author: 'Claude',
  });

  const handleSendMessage = async (text: string) => {
    // Add user message
    setMessages((prev) => [
      ...prev,
      { role: 'user', id: nanoid(), content: text, timestamp: Date.now() },
    ]);
    setIsLoading(true);

    // Call your AI provider
    const client = new Anthropic();
    let response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      system: `You are a document review assistant. ${getSystemContext()}`,
      messages: messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      tools: getToolSchemas(), // ← tools from the bridge
    });

    // Handle tool calls in a loop
    while (response.stop_reason === 'tool_use') {
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = executeToolCall(block.name, block.input);
          setMessages((prev) => [
            ...prev,
            {
              role: 'tool_call',
              id: block.id,
              toolName: block.name,
              input: block.input,
              timestamp: Date.now(),
            },
            {
              role: 'tool_result',
              id: nanoid(),
              toolCallId: block.id,
              result,
              timestamp: Date.now(),
            },
          ]);
        }
      }
      // Continue the conversation with tool results
      response = await client.messages.create({
        /* ... */
      });
    }

    // Add final agent message
    const textBlock = response.content.find((b) => b.type === 'text');
    if (textBlock) {
      setMessages((prev) => [
        ...prev,
        { role: 'agent', id: nanoid(), content: textBlock.text, timestamp: Date.now() },
      ]);
    }
    setIsLoading(false);
  };

  return (
    <div style={{ display: 'flex' }}>
      <DocxEditor ref={editorRef} documentBuffer={buffer} style={{ flex: 1 }} />
      <AgentChatPanel
        messages={messages}
        isLoading={isLoading}
        onSendMessage={handleSendMessage}
        bridge={bridge}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
```

---

## Implementation Plan

### Phase 1: Editor Bridge (packages/agent-use + packages/react)

**Goal**: Make `createEditorBridge()` work against a live `DocxEditorRef`.

1. **Expose missing methods on `DocxEditorRef`** (packages/react)
   - `addComment()`, `replyToComment()`, `resolveComment()` — wire existing comment state handlers to the ref
   - `proposeReplacement()` — dispatch PM transaction with tracked change marks
   - `addHighlight()` — add/remove ProseMirror `Decoration`
   - `scrollToIndex()` — scroll to paragraph by index

2. **Implement `createEditorBridge()`** (packages/agent-use/bridge.ts)
   - Read ops: call `editorRef.getDocument()` → pass body to existing `DocxReviewer` content/discovery functions
   - Write ops: call the new `DocxEditorRef` methods above
   - Selection: read from ProseMirror selection state

### Phase 2: Tool Definitions (packages/agent-use)

**Goal**: Define all 12 tools with schemas and handlers.

3. **Create `src/tools/` directory** with one file per tool + index
4. **Add format helpers** — `getAnthropicTools()`, `getOpenAITools()`
5. **Add `executeToolCall()` dispatcher**
6. **Tests** — unit test each tool handler against a mock bridge

### Phase 3: Chat UI (packages/react)

**Goal**: Ship the `AgentChatPanel` component and `useAgentChat` hook.

7. **`useAgentChat` hook** — creates bridge from ref, exposes tool execution
8. **`AgentChatPanel`** — message list, input, tool call cards
9. **`ChatMessage` / `ChatToolCall`** — rendering components
10. **Styling** — scoped within `.ep-root`, consistent with editor design

### Phase 4: Polish

11. **System prompt builder** — `getSystemContext()` generates a prompt snippet with document summary, available tools, and instructions
12. **Streaming support** — `AgentChatPanel` accepts streaming text via a `streamingContent` prop
13. **Documentation** — README with integration examples for Anthropic, OpenAI, Vercel AI SDK

---

## Scope Boundaries

### In scope

- EditorBridge API connecting agent tools to live editor
- Tool definitions (schemas + handlers) — 12 tools
- Chat UI components (presentation only)
- `useAgentChat` hook
- Format helpers for Anthropic/OpenAI tool schemas

### Out of scope

- AI provider integration (consumer brings their own)
- Authentication / API key management
- Chat message persistence
- Multi-user / real-time collaboration
- Custom tool registration (v2)
- Voice input
- File attachment in chat

---

## Open Questions

1. **Should the bridge also support headless mode?** Today `DocxReviewer` is headless-only. The bridge is editor-only. Should there be a unified interface that works in both modes? (Probably yes — `DocxReviewer` could implement `EditorBridge` for headless use, making tools portable.)

2. **Tool granularity**: Is `read_document` sufficient or do we need `read_paragraph(index)` for large documents? (Probably add `fromIndex`/`toIndex` params, which we already have.)

3. **Streaming tool calls**: Some AI providers stream tool calls incrementally. Should the chat UI render tool calls as they stream in, or wait for completion? (Start with wait-for-completion, add streaming later.)

4. **Highlight persistence**: Should highlights survive document edits or be purely ephemeral? (Ephemeral — they're for drawing attention, not annotation.)
