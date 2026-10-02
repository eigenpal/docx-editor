# Writer agent example

Edit an open DOCX through typed agent tools backed by the public `editor-api` document model.
The example requires the EigenPal Pro License.

## Run the example

From the repository root, prepare the environment:

```bash
bun install
cp examples/write-agent/.env.example examples/write-agent/.env.local
```

Set `OPENAI_API_KEY` in the environment file, then run the example:

```bash
bun run dev:write-agent
```

Open `http://localhost:3004`. Optional environment variables include `OPENAI_MODEL` and `ALLOWED_ORIGINS`.
The API key stays on the server. The browser executes document tools against its open editor.
The example uses the Responses API. Choose a model that supports tool calls and low reasoning effort.

## Data sent to the model

Inspection sends requested document text and properties to OpenAI as tool results.
The example does not redact personal information. Model requests use `store: false`.

## Choose the editing mode

Select **Direct edits** for supported document mutations. Select **Suggestions** to create native revisions through supported edits.
The application sets `Document.changeTrackingMode`. The model cannot disable tracking after a refusal.
Review tools can create comments and resolve requested revisions in either mode.

The runtime reads the original text view. Pending deletions remain visible, and pending insertions stay hidden.
Existing revisions remain until you accept or reject them. Inspect revisions to verify proposed insertions.

| Area | Suggestions support |
| --- | --- |
| Text and paragraphs | Text edits and paragraph insertion. Ranges across paragraphs refuse in collaboration. |
| Formatting | Font, paragraph format, and paragraph style changes. |
| Lists | Membership changes and configuration of new proposed list definitions. Established definition changes require direct edits. |
| Tables | Complete table insertion, value replacement, row additions, and partial row deletion. Value replacement refuses in collaboration. |
| Proposed tables | The author can configure a complete proposed table without foreign revisions. |
| Existing tables | Property and column changes require direct edits. |
| Content controls | Wrap eligible nonempty text in plain-text, rich-text, or date-picker controls outside collaboration. |
| Page layout and metadata | Require direct edits. |

Tracked control creation requires ordinary text without existing review markup.
Accept keeps the control. Reject restores the original formatted text.
The author can set the pending control's tag and title. Other control structure changes refuse.

## Inspect, then edit

`inspect_document` reads a selected area in a supported story.
It returns up to 40 objects, relevant properties, and `nextOffset`.
Collection enumeration still loads membership for the complete collection.
`read_document` returns paged paragraphs. Empty paragraphs remain addressable.

`inspect_document_batch` accepts up to six independent inspections.
Its combined limits are 120 top-level items and 120,000 UTF-8 bytes.
An external edit or inspection failure rejects the complete batch.
Each inspector keeps its public API sync boundaries.

Paragraph targets use an inspected paragraph ID and an optional exact phrase.
Phrase matches must be unique within the paragraph. Object targets use inspected indexes.
Inspect objects again after mutations change their indexes.

Imported paragraphs can lack stored IDs. Inspection supplies temporary targets in supported stories, tables, and lists.
Edits expire affected temporary targets. Inspect the changed story again before another edit.

Progressive edits use public paragraph IDs to preserve targets when possible. Ambiguous targets require inspection.
Paragraph IDs and object indexes do not identify objects across separate file sessions.

The adapter checks captured document bytes and target text before edits.
Before each write batch, it checks the browser revision or server bytes.
An external edit returns `StaleDocument`. Read again and reconsider the remaining edits.
Later target loads cannot replace the inspection baseline.

## Tool coverage

`discover_capabilities` reports the tool mapping, host capabilities, selected mode, and operation limits.
It does not change tracking. It reports plain-text, rich-text, and date-picker creation in both modes, with their respective limits.

`app/agent/coverage.ts` maps the repository's 81-member editing profile to tools.
A test checks every profile member's mapping.
This measures tool exposure. It does not establish complete Office.js compatibility or support for every document.

| Area | Tools |
| --- | --- |
| Inspection | `read_document`, `inspect_document`, `inspect_document_batch`, `discover_capabilities` |
| Text | `create_document`, `write_story`, `edit_text` |
| Formatting | `format_document` |
| Lists | `edit_list`, `configure_list`, `format_lists` |
| Tables | `insert_table`, `edit_table` |
| Content controls | `insert_content_controls`, `edit_control` |
| Review | `edit_review` |
| Layout | `edit_layout`, `insert_break`, `write_header_footer` |
| Pictures and fields | `edit_picture`, `edit_field` |
| Metadata | `read_properties`, `edit_properties`, `remove_document_properties` |

Every mutation uses public Office.js-shaped methods or property assignments.
The adapter does not execute generated JavaScript, browser commands, or internal automation operations.
Tool schemas belong to this application. They do not extend the public document model.

## Create and format drafts

Use `create_document` only for a requested draft or complete rewrite.
Drafts accept paragraph, list, and table blocks. Paragraph and list blocks accept explicit `format` property changes.

Paragraph `runs` support mixed inline fonts. Run text must concatenate to the paragraph text.
Each run starts with the paragraph font. Table headers accept font formatting.
Lists use real list definitions and can contain one item.

Set paragraph styles through `block.style`. Draft lists use `Normal`.
`block.format` cannot override styles. Omitted properties remain unchanged.
Use `format_document` for supported custom styles on existing content.

Text insertion does not interpret Markdown or HTML.
Set `highlightColor` to `null` to clear highlighting through the public font property.

For inserted paragraphs, `edit_text` accepts `format` changes on the returned paragraph proxy.
Repeated insertions preserve request order. Each paragraph commits before the next paragraph uses it as an anchor.
Unchanged text replacements refuse. Use `format_document` to change formatting.

Draft font sizes must round to 1–1999 half-points.
After rounding to twips, spacing must be nonnegative and line spacing must be positive.
Paragraph measurements must remain within ±31,680 twips.
Text and font names must contain valid XML characters.
These checks reject known invalid inputs before replacement. They do not make progressive drafts atomic.

Before each draft batch, the writer checks requested styles on a disposable server runtime.
It opens captured bytes and uses public paragraph style writes.
Missing styles refuse before that batch changes the active document.
The check adds one document open, one setup sync, and one sync per distinct style.

## Watch edits during generation

The editor applies completed draft blocks while the model generates later blocks.
Text edits and content-control inserts also apply one completed array item at a time.
Each part uses the same public API as a complete call.
The application validates complete JSON items. It never inserts unfinished JSON or HTML.
Other tools wait for complete input.

Streaming accepts up to 1,048,576 JSON characters per call.
It accepts up to 40 text edits or 200 draft blocks or controls.
For streamed text and control edits, `story` must precede the array in the generated JSON.
Otherwise, the application waits for complete input. One write batch targets one story.

The first draft block replaces the body. Later blocks append in document order.
Suggestions require an eligible paragraph-only body. Existing tables, wrappers, and revisions can refuse replacement.
Each block applies its properties before the next block.

Final tool validation checks the applied prefix without repeating completed parts.
Earlier parts remain if a later part fails.

The browser captures once per call and checks public revision events before each write.
It does not save the complete document again after each call.
An external edit stops later parts with `StaleDocument`.

Select **Stop** to stop generation and pending batches.
An atomic batch already executing can complete. Later batches stop before writing.
Completed edits remain available for review or undo.

## Edit content controls

A structured document tag (SDT) is a content control.
The agent uses `Range.insertContentControl()` to wrap existing field text.
Use an exact `search` phrase to preserve labels outside the control.
Each control uses a separate sync. The adapter resolves subsequent ranges again.

It sets `ContentControl.tag` and `ContentControl.title` after creation.
Inspect existing controls before adding wrappers.

Creation supports plain-text, rich-text, and date-picker controls within each mode's limits.
Dropdown, combo box, checkbox, and repeating-section creation remain unsupported.
Tools refuse unsupported types without substituting plain text.

`edit_control` exposes supported text, metadata, lock, and deletion members.
Typed control-value extensions remain outside this example's Office.js-shaped editing scope.
Text insertion supports text-like controls. Date-picker values use the editor's calendar.
Date-picker text insertion refuses with `NotSupported`.

## Edit notes, tables, and metadata

Inspect `footnotes` or `endnotes` from the main body.
Pass the returned `story` to reading and editing tools.
The example uses `Body.footnotes` and `Body.endnotes`. It edits existing notes; note creation remains unsupported.
Discover unknown note stories before including them in an inspection batch.

Table inspection includes paragraph targets for up to 200 cells across the result.
It also reports picture counts. Picture inspection reports existing table dimensions.
Inspect structure before changing image layout. Separate paragraphs can share one table row.

Use `edit_table` with `insertRows` before or after an inspected row.
The tool uses `TableRow.insertRows`. It preserves unrelated merged headers and supports native row suggestions.
Merged source rows and crossing vertical merges refuse.

Use `read_properties` for selected metadata fields, including read-only `lastAuthor`.
Use `edit_properties` for `author`, `title`, `subject`, `keywords`, `comments`, and `category`.
These tools use `Document.properties`. Collaborative metadata edits require an existing core-properties part.

For explicit metadata removal, use `remove_document_properties` in direct mode.
It calls `Document.removeDocumentInformation('DocumentProperties')`.
It removes document metadata. It preserves body text, comments, and revisions.
It does not remove all personal information. Suggestions refuse metadata writes and removal.

## Handle partial edits and errors

Calls execute sequentially for each runtime. Repeated tool-call IDs return their original result without another edit.
Independent font and paragraph writes share one sync.
Structural edits and returned proxy configuration use separate sync boundaries when required.

Results include `success`, JSON output, and `completedSteps`.
Errors include a stable `code`, a `recovery` instruction, and the public member `target` when available.
Completed steps remain if a later step fails. Complete drafts and multi-stage tools are not atomic.
The adapter does not replay failed writes automatically.

Use `recovery.action` to choose the next step:

| Action | Next step |
| --- | --- |
| `inspect` | Read affected stories and revisions. Reconsider remaining edits. |
| `revise_arguments` | Correct arguments without changing the requested scope. |
| `report_limit` | Report the limit. Continue supported edits in the selected mode. |
| `stop` | Stop generation. Keep completed edits. |

Check `completedSteps` before continuing. Inspect existing content before creating tables or controls after a partial failure.
Verify properties before reporting success. In Suggestions, inspect revisions to find proposed insertions.

Edit existing objects in place. If reconstruction needs an unsupported operation, preserve the source and report the limit.
Separate calls can partially complete. Do not delete content as a prerequisite for uncertain reconstruction.
Whole-table deletion remains available for explicit deletion requests.

Protected content, XML-bound controls, merged tables, and pending revisions can refuse edits.
Image insertion requires supplied PNG or JPEG bytes.
Field calculation requires host pagination. A server without a measurer refuses calculation.
In direct mode, the field tool inserts inert TOC instructions without calculating entries.
Section columns and new style definitions remain unavailable.

Linked headers and footers can share content across sections. The public API cannot separate linked stories.

## Hosts and collaboration

The UI uses a browser runtime. Shared handlers also run against a server runtime in integration tests.
Browser saving supplies snapshot comparisons. Server tests use the runtime's `save()` method.
Host setup and transport remain separate from document operations.
The standalone writer does not attach a collaboration session.

Tests attach two editors to real collaboration sessions.
They cover tracked text, formatting, paragraph insertion, list membership, concurrent list creation, and content-control creation.
They also cover saved row suggestions with concurrent cell edits, undo, redo, stale targets, and reconnect.
These tests do not establish support for every mapped operation.

For a room-connected worker, see the [server agent review example](../server-agent-review/README.md).
For complete returned files, see [Document refresh API](../../docs/site/content/guides/document-refresh.mdx).
Refresh diagnostics identify unmatched locations. Processor descriptions support structural change lists.

Each accepted file resets selection and undo history. Refresh refuses collaborative sessions.
Structural refresh summaries do not provide Accept and Reject actions. Use native revisions for saved review decisions.

## Verify

From the repository root:

```bash
bun test ./examples/write-agent/app/agent/tools.test.ts \
  ./examples/write-agent/app/agent/run-tool.test.ts \
  ./examples/write-agent/app/agent/editing.test.ts \
  ./examples/write-agent/app/agent/review-happy-paths.test.ts \
  ./examples/write-agent/app/agent/stream-edits.test.ts \
  ./examples/write-agent/app/agent/collaboration.test.ts \
  ./examples/write-agent/app/agent/collaboration-list.test.ts \
  ./packages/pro/src/collaboration/__tests__/document-rich-api.test.ts \
  ./packages/editor-api/src/runtime/__tests__/runtime-table-revisions.test.ts
bun run --filter docx-editor-example-write-agent typecheck
bun run --filter '@docx-editor.dev/editor-api' compat:report
```


The deterministic tests require no model API key.
They check document results, refusal behavior, and saved DOCX content.
For document-model limits, see [Office.js patterns for server agents](../../packages/editor-api/OFFICE_JS_GUIDE.md).
