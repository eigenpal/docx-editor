# Writer agent example

This app interviews a user, creates a fresh DOCX, and proposes later edits as tracked changes.
It keeps `examples/agent` unchanged.

## Run the example

1. Copy `.env.example` to `.env.local`.
2. Set `OPENAI_API_KEY`.
3. Optionally set `OPENAI_MODEL` and `ALLOWED_ORIGINS`.
4. From the repository root, run:

   ```bash
   bun dev:write-agent
   ```

5. Open `http://localhost:3004`.

Without `OPENAI_API_KEY`, the chat route returns HTTP 503 with a clear message.
The editor and direct tool tests still work.

## Flow

The writer asks for the document type, parties or audience, purpose, rules, tone, and length.
The `create_document` schema requires all six answers.
The tool calls `Body.replaceParagraphs` to replace the seeded body in one transaction.
It then applies paragraph styles and supported document structure.

Later turns call `read_document` with the explicit `vanilla` revision projection.
The three proposal tools call `proposeReplacement`, `proposeInsertion`, and `proposeDeletion`.
Insertion anchors call `range.select('End')` before the browser command.
All comments and tracked changes use the author `Writer agent`.

## Architecture

- `app/api/chat/route.ts` owns the interview prompt and AI SDK tool catalog.
- `app/agent/tools.ts` owns schemas and the interview gate.
- `app/agent/run-tool.ts` runs tools against the live browser editor.
- `app/components/WriterPanel.tsx` always returns tool results, including exact failures.
- `app/components/WriterWorkspace.tsx` composes the editor and chat panel.

The example uses workspace packages through `workspace:*`.

## Supported capabilities

- Fresh atomic body replacement through editor-api.
- Title, heading, and normal paragraph styles through editor-api.
- Explicit vanilla reads and search anchors through editor-api.
- Bullet and numbered lists through browser editor commands.
- Header, footer, and page fields through browser editor commands.
- Plain-text content-control creation through the core automation protocol.
- Tracked insertion, deletion, and replacement through browser editor commands.

## Remaining API gaps

Editor-api cannot create lists, headers, footers, page fields, or content controls.
The example uses browser commands for lists, headers, footers, and page fields.
It uses the core automation protocol for content-control creation.

No current editor-api or browser editor command sets section columns.
The app reports this limitation and does not fake columns.
