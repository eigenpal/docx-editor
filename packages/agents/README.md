# @eigenpal/docx-editor-agents

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Word-like API for AI agents to review DOCX documents. Read, comment, suggest tracked changes, accept/reject. Headless. Server-friendly. Browser-friendly. **The library you build your AI document features on top of.**

```bash
npm install @eigenpal/docx-editor-agents
```

## Common patterns

### 1. Static review (`DocxReviewer`) — single function call against a parsed DOCX

```ts
import { DocxReviewer } from '@eigenpal/docx-editor-agents';

const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
reviewer.addComment(5, 'This cap seems too low.');
reviewer.replace(5, '$50k', '$500k');
const output = await reviewer.toBuffer();
```

Drop into a CI bot, a queue worker, a Lambda. No editor needed. ~50 KB.

### 2. Live editor bridge — wire AI tools into a running `<DocxEditor>` instance

**React** (`useAgentChat`):

```ts
import { useAgentChat } from '@eigenpal/docx-editor-agents/react';

const { executeToolCall, toolSchemas } = useAgentChat({ editorRef, author: 'Assistant' });
```

**Vue** (`useAgentBridge`):

```ts
import { useAgentBridge } from '@eigenpal/docx-editor-agents/vue';

const { executeToolCall, toolSchemas } = useAgentBridge({ editorRef, author: 'Assistant' });
```

The agent's `add_comment`, `suggest_change`, `find_text` etc. show up live in the user's editor. Both subpaths share the same `EditorRefLike` contract from `/bridge`, the same tool catalog, and the same `AgentMessage[]` chat shape. (For other framework adapters, build the bridge directly via `createEditorBridge` from `@eigenpal/docx-editor-agents/bridge`.)

### 3. Build your own MCP server (`McpServer` + `createReviewerBridge`) — the SaaS path

This is the one most teams want. The published library exposes a transport-agnostic MCP server core. **You wrap it inside your own auth, storage, and transport layer.** Stdio, HTTP-SSE, WebSocket, queue-worker — your call.

```ts
// Your /api/mcp/sse route — Express, Hono, Next.js, whatever
import { McpServer, createReviewerBridge, DocxReviewer } from '@eigenpal/docx-editor-agents';

app.post('/api/mcp', requireAuth, async (req, res) => {
  // 1. Pull the DOCX from your storage (S3, Postgres bytea, etc.)
  const buffer = await loadDocxForUser(req.user, req.params.docId);

  // 2. Wire it through the bridge
  const reviewer = await DocxReviewer.fromBuffer(buffer, req.user.name);
  const bridge = createReviewerBridge(reviewer);
  const server = new McpServer(bridge, {
    name: 'acme-contract-review',
    version: '1.0.0',
  });

  // 3. Drive MCP messages over your transport. server.handle() is sync,
  //    transport-free, and never throws.
  const reply = server.handle(JSON.parse(req.body));
  res.json(reply);

  // 4. After the agent's done, persist the modified DOCX back to your storage.
  await saveDocxForUser(req.user, req.params.docId, await reviewer.toBuffer());
});
```

That's the whole shape. Ten built-in agent tools (`read_document`, `find_text`, `add_comment`, `suggest_change`, `read_comments`, `read_changes`, `reply_comment`, `resolve_comment`, `read_selection`, `scroll`) are exposed automatically through MCP `tools/list` and `tools/call`. MCP spec version: `2025-06-18`.

#### Why server-side, why not a local stdio bin?

A local-installed stdio MCP server only works for one document per config — Claude Desktop loads its MCP server list at startup. That's a useless shape for a contract-review product where users have many documents. The right deployment is **a hosted MCP server you operate**, with your own auth and storage. The library gives you the engine; you bring the chassis.

## Word JS API parity

The bridge mirrors the Office.js Word API pattern — locate a stable handle (`paraId`) first, then mutate. The parity contract is enforced at compile time:

```ts
import type { WordCompatBridge } from '@eigenpal/docx-editor-agents';
```

`WordCompatBridge` is a TypeScript interface that `EditorBridge` is statically required to satisfy. If we ever drop a method that maps to a Word API call, typecheck breaks.

## Subpath map

Each subpath tree-shakes independently and pulls only its peers.

| Subpath                                      | What                                                                                               | Use when                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `@eigenpal/docx-editor-agents`               | `DocxReviewer`, `createReviewerBridge`, agent tool catalog, types                                  | Server-side review, library glue                                                  |
| `@eigenpal/docx-editor-agents/bridge`        | `createEditorBridge`, `EditorBridge`, `EditorRefLike` (the integration contract)                   | Wiring AI tools into a running editor adapter                                     |
| `@eigenpal/docx-editor-agents/server`        | Tool catalog + `DocxReviewer` + `createReviewerBridge` re-exported for backend routes (no UI peer) | Server routes that need agent tooling without the MCP transport                   |
| `@eigenpal/docx-editor-agents/mcp`           | `McpServer`, JSON-RPC types, stdio adapter                                                         | Building an MCP server (any transport)                                            |
| `@eigenpal/docx-editor-agents/ai-sdk/server` | Vercel AI SDK adapter — agent tools as AI SDK tools server-side                                    | Server-side streaming chat with `ai` package                                      |
| `@eigenpal/docx-editor-agents/react`         | Hook (`useAgentChat`) + agent UI components — see [`src/react.ts`](./src/react.ts)                 | React apps wiring `<DocxEditor>` (from `@eigenpal/docx-editor-react`) to an agent |
| `@eigenpal/docx-editor-agents/ai-sdk/react`  | React-flavoured AI SDK adapter (`useChat` → `AgentMessage[]`)                                      | React chat UI over the bridge                                                     |
| `@eigenpal/docx-editor-agents/vue`           | Composable (`useAgentBridge`) + agent UI components — see [`src/vue.ts`](./src/vue.ts)             | Vue apps wiring `<DocxEditor>` (from `@eigenpal/docx-editor-vue`) to an agent     |
| `@eigenpal/docx-editor-agents/ai-sdk/vue`    | Vue-flavoured AI SDK adapter (`useChat` → `AgentMessage[]`)                                        | Vue chat UI over the bridge                                                       |

`/react` and `/vue` share the same `EditorRefLike` contract from `/bridge` and the same `AgentMessage[]` shape (`toAgentMessages` lifted to `ai-sdk/shared.ts`), so the React and Vue UIs feed off the same chat state — but the host wiring differs (different hook names + different editor component + different SFC vs JSX shells).

Zero new runtime dependencies. Vue and AI SDK peers are optional via `peerDependenciesMeta`.

## Migration from 0.x

The 1.0.0 train tightened the package boundary so the bare entry stays UI-framework-agnostic. React-only hooks moved to the `/react` subpath:

```diff
- import { useAgentChat, useDocxAgentTools } from '@eigenpal/docx-editor-agents';
+ import { useAgentChat, useDocxAgentTools } from '@eigenpal/docx-editor-agents/react';
```

`DocxReviewer`, `createReviewerBridge`, `createEditorBridge`, the agent tool catalog, and all types stay on the bare entry — they're framework-agnostic.

## License

[Apache-2.0](./LICENSE) — permissive use with an explicit patent grant. Free for commercial use; no copyleft obligations.
