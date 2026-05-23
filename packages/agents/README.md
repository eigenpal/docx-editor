<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@eigenpal/docx-editor-agents"><img src="https://img.shields.io/npm/v/@eigenpal/docx-editor-agents.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@eigenpal/docx-editor-agents"><img src="https://img.shields.io/npm/dm/@eigenpal/docx-editor-agents.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @eigenpal/docx-editor-agents

Word-like API for AI agents to review DOCX documents. Read, comment, suggest tracked changes, accept/reject. Headless, server-friendly, browser-friendly. The library you build your AI document features on top of.

## Quick Start

```bash
npm install @eigenpal/docx-editor-agents
```

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { DocxReviewer } from '@eigenpal/docx-editor-agents';

const buffer = await readFile('contract.docx');
const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');

reviewer.addComment(5, 'This cap seems too low.');
reviewer.replace(5, '$50k', '$500k');

await writeFile('contract.reviewed.docx', new Uint8Array(await reviewer.toBuffer()));
```

That's the static-review path: drop into a CI bot, queue worker, or Lambda. No editor needed. ~50 KB.

## Packages

| Package                                                                                      | Description                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@eigenpal/docx-editor-react`](https://www.npmjs.com/package/@eigenpal/docx-editor-react)   | <img src="https://cdn.simpleicons.org/react/61DAFB" width="20" align="middle" /> &nbsp; React adapter. Toolbar, paged editor, plugins.     |
| [`@eigenpal/docx-editor-vue`](https://www.npmjs.com/package/@eigenpal/docx-editor-vue)       | <img src="https://cdn.simpleicons.org/vuedotjs/4FC08D" width="20" align="middle" /> &nbsp; Vue 3 adapter. Toolbar, paged editor, plugins.  |
| [`@eigenpal/docx-editor-core`](https://www.npmjs.com/package/@eigenpal/docx-editor-core)     | Framework-agnostic core: OOXML parser, serializer, layout engine, ProseMirror schema. Depend on this if you fork the React or Vue adapter. |
| [`@eigenpal/docx-editor-i18n`](https://www.npmjs.com/package/@eigenpal/docx-editor-i18n)     | Shared locale strings and types consumed by both adapters.                                                                                 |
| [`@eigenpal/docx-editor-agents`](https://www.npmjs.com/package/@eigenpal/docx-editor-agents) | Agent SDK and chat UI: framework-agnostic bridge, MCP server, AI SDK adapters, plus React UI.                                              |

> **Forking the adapter?** Keep your fork thin. Depend on `@eigenpal/docx-editor-core` directly so parser, serializer, and rendering fixes land in your build automatically, without backporting each upstream change by hand.

## Live editor bridge

Wire AI tools into a running `<DocxEditor>` so `add_comment`, `suggest_change`, `find_text` etc. show up live in the user's editor.

```ts
// React
import { useAgentChat } from '@eigenpal/docx-editor-agents/react';
const { executeToolCall, toolSchemas } = useAgentChat({ editorRef, author: 'Assistant' });

// Vue
import { useAgentBridge } from '@eigenpal/docx-editor-agents/vue';
const { executeToolCall, toolSchemas } = useAgentBridge({ editorRef, author: 'Assistant' });
```

Both share the same `EditorRefLike` contract from `/bridge`, the same tool catalog, and the same `AgentMessage[]` chat shape. For other frameworks, build the bridge directly via `createEditorBridge` from `@eigenpal/docx-editor-agents/bridge`.

## MCP server

Transport-agnostic core. Wrap it with your own auth, storage, and transport (HTTP-SSE, WebSocket, queue worker, anything).

```ts
import { McpServer, createReviewerBridge, DocxReviewer } from '@eigenpal/docx-editor-agents';

app.post('/api/mcp', requireAuth, async (req, res) => {
  const buffer = await loadDocxForUser(req.user, req.params.docId);
  const reviewer = await DocxReviewer.fromBuffer(buffer, req.user.name);
  const server = new McpServer(createReviewerBridge(reviewer), {
    name: 'acme-review',
    version: '1.0.0',
  });

  res.json(server.handle(JSON.parse(req.body))); // sync, transport-free, never throws

  await saveDocxForUser(req.user, req.params.docId, await reviewer.toBuffer());
});
```

Ten built-in agent tools (`read_document`, `find_text`, `add_comment`, `suggest_change`, `read_comments`, `read_changes`, `reply_comment`, `resolve_comment`, `read_selection`, `scroll`) are exposed automatically via MCP `tools/list` and `tools/call`. MCP spec version: `2025-06-18`.

> A local stdio MCP bin is one-document-per-config (Claude Desktop loads its list at startup), which doesn't fit a multi-doc product. Host the server yourself with your own auth and storage.

## Subpaths

| Subpath                                      | Use when                                                       |
| -------------------------------------------- | -------------------------------------------------------------- |
| `@eigenpal/docx-editor-agents`               | Server-side review, library glue                               |
| `@eigenpal/docx-editor-agents/bridge`        | Wiring AI tools into a running editor adapter                  |
| `@eigenpal/docx-editor-agents/server`        | Backend routes needing agent tooling without the MCP transport |
| `@eigenpal/docx-editor-agents/mcp`           | Building an MCP server (any transport)                         |
| `@eigenpal/docx-editor-agents/ai-sdk/server` | Server-side streaming chat with the Vercel `ai` package        |
| `@eigenpal/docx-editor-agents/react`         | React apps wiring `<DocxEditor>` to an agent                   |
| `@eigenpal/docx-editor-agents/ai-sdk/react`  | React chat UI over the bridge                                  |
| `@eigenpal/docx-editor-agents/vue`           | Vue apps wiring `<DocxEditor>` to an agent                     |
| `@eigenpal/docx-editor-agents/ai-sdk/vue`    | Vue chat UI over the bridge                                    |

Each subpath tree-shakes independently. Vue and AI SDK peers are optional via `peerDependenciesMeta`.

## Word API parity

The bridge mirrors the Office.js Word API pattern: locate a stable handle (`paraId`) first, then mutate. The contract is type-enforced at compile time:

```ts
import type { WordCompatBridge } from '@eigenpal/docx-editor-agents';
```

`EditorBridge` is statically required to satisfy `WordCompatBridge`. Drop a method that maps to a Word API call and typecheck breaks.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
