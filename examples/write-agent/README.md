# Writer agent example

This app interviews a user, creates a fresh DOCX, and proposes later edits as tracked changes.
It keeps `examples/agent` unchanged.

## Run the example

From the repository root, install dependencies and create the environment file:

```bash
bun install
cp examples/write-agent/.env.example examples/write-agent/.env.local
```

Set `OPENAI_API_KEY` in `examples/write-agent/.env.local`. You can also set
`OPENAI_MODEL` and `ALLOWED_ORIGINS`. Then start the example:

```bash
bun run dev:write-agent
```

Open `http://localhost:3004`.

Without `OPENAI_API_KEY`, the chat route returns HTTP 503 with a clear message.
The editor and direct tool tests still work.

## Flow

The writer starts from a short request and infers safe defaults for audience, tone, and length.
It uses placeholders for missing names, dates, amounts, jurisdictions, and private facts.
It asks one question only when a missing detail prevents a useful draft.
The `create_document` schema records the resulting six-field brief.
The agent then uses five visible tool calls:

1. Write styled paragraphs with `create_document`.
2. Format bullet and numbered lists with `format_lists`.
3. Add tagged fields with `insert_content_controls`.
4. Insert and populate a table with `insert_table`.
5. Write the header, footer, and page field with `write_header_footer`.

`create_document` calls the lower-level `replaceStoryBlocks` automation operation in one
transaction. Every generated document uses all five calls.

The browser runtime uses `revisionTextView: 'original'`. This DocxEditor runtime option matches
Word's Original review view. It does not belong to the Office.js object model.
Later turns call `read_document` through the standard `text` properties and `search()` methods.
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

- Fresh atomic body replacement through the core automation protocol.
- Title, heading, and normal paragraph styles through editor-api.
- Reader-visible document reads and search anchors through editor-api.
- Bullet and numbered lists through browser editor commands.
- Populated tables through browser editor commands and editor-api paragraph targeting.
- Header, footer, and page fields through browser editor commands.
- Plain-text content-control creation through the core automation protocol.
- Tracked insertion, deletion, and replacement through browser editor commands.

## Remaining API gaps

Editor-api cannot atomically replace all story blocks or create lists, tables, headers, footers,
page fields, or content controls.
The example uses browser commands for lists, tables, headers, footers, and page fields.
It uses the core automation protocol for content-control creation.

No current editor-api or browser editor command sets section columns.
The app reports this limitation and does not fake columns.
