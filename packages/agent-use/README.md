# @eigenpal/docx-editor-agents

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

Word-like API for AI agents to review DOCX documents. Read, comment, suggest tracked changes, accept/reject. Headless. Server-friendly. Browser-friendly. **The library you build your AI document features on top of.**

```bash
npm install @eigenpal/docx-editor-agents
```

## Three ways to use this package

### 1. Static review (`DocxReviewer`) — single function call against a parsed DOCX

```ts
import { DocxReviewer } from '@eigenpal/docx-editor-agents';

const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
reviewer.addComment(5, 'This cap seems too low.');
reviewer.replace(5, '$50k', '$500k');
const output = await reviewer.toBuffer();
```

Drop into a CI bot, a queue worker, a Lambda. No editor needed. ~50 KB.

### 2. Live editor bridge (`createEditorBridge`) — wire AI tools into a running `<DocxEditor>` instance

```ts
import { useAgentChat } from '@eigenpal/docx-editor-agents/bridge';

const { executeToolCall, toolSchemas } = useAgentChat({ editorRef, author: 'Assistant' });
```

The agent's `add_comment`, `suggest_change`, `find_text` etc. show up live in the user's editor. Used by Eigenpal's chat panel; published for anyone building an AI document UX.

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

## What's in the package

| Subpath                               | What                                                              | Use when                                                  |
| ------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `@eigenpal/docx-editor-agents`        | `DocxReviewer`, `createReviewerBridge`, agent tool catalog, types | Server-side review, building your own MCP server          |
| `@eigenpal/docx-editor-agents/bridge` | `useAgentChat`, `createEditorBridge`, `EditorBridge` interface    | Wiring AI tools into a live `<DocxEditor>` in the browser |
| `@eigenpal/docx-editor-agents/mcp`    | `McpServer`, JSON-RPC types, stdio adapter                        | Building an MCP server (any transport)                    |

Zero new runtime dependencies. Tree-shakes cleanly per subpath.

## License

[AGPL-3.0](./LICENSE) — free to use and modify, but you must open-source your code. For commercial licensing without AGPL obligations, contact [founders@eigenpal.com](mailto:founders@eigenpal.com).
