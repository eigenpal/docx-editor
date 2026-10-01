# Writer agent example

Edit an open DOCX through typed agent tools backed by the public `editor-api` document model. The example requires the EigenPal Pro License.

## Run the example

From the repository root:

```bash
bun install
cp examples/write-agent/.env.example examples/write-agent/.env.local
```

Set `OPENAI_API_KEY` in the environment file, then run:

```bash
bun run dev:write-agent
```

Open `http://localhost:3004`. Optional environment variables include `OPENAI_MODEL` and `ALLOWED_ORIGINS`. The API key stays on the server. The browser executes document tools against its open editor.

The default model is `gpt-6.1-sol` with low reasoning effort. The example uses the Responses API for tool calls. Configure `OPENAI_MODEL` with a model that supports Responses tool calls and low reasoning effort.

## Data sent to the model

Document inspection sends the requested text and properties to OpenAI as tool results. The example does not redact personal information. The model request disables response storage with `store: false`.

## Choose the editing mode

Select **Direct edits** for text, formatting, structure, or content controls. Select **Suggestions** for tracked text, paragraph insertion, font, paragraph-format, paragraph-style, list-membership, and supported text/date-control edits. The application sets `Document.changeTrackingMode`; the model cannot change that setting to bypass a refusal. Review tools can create comments and resolve requested revisions in either mode.

The runtime reads the original text view: pending deletions remain visible, and pending insertions stay hidden. Existing revisions remain until you accept or reject them. Complete table insertion, table value replacement, row additions, and partial row deletions support native revisions. An author can configure a complete proposed table while it has no foreign revisions. Existing table properties and columns require direct edits. Tracked table value replacement and ranges across paragraphs refuse in collaboration. Page layout requires direct edits. TrackMineOnly can wrap nonempty ordinary text in PlainText, RichText, or DatePicker controls outside collaboration. Accept keeps the control; Reject restores the original formatted text. The author can set the pending control’s tag and title. Empty ranges, existing review markup, and other control structure changes refuse. List creation and membership changes produce paragraph-property revisions. Definition changes support new proposed lists; changes to established list definitions refuse.

## Watch edits during generation

The editor applies completed draft blocks while the model generates later blocks. Text edits and content-control inserts also apply one completed array item at a time. Each part uses the same public document API methods as a complete tool call. The application validates each complete JSON item; it does not insert unfinished JSON or HTML. Other tools wait for their complete input. Streaming accepts up to 1,048,576 JSON characters per call and 40 text edits or 200 other parts.

The first draft block replaces the body. Suggestions use native text and paragraph-mark revisions for an eligible paragraph-only body. Table or wrapper boundaries and existing proposals can refuse before replacement. Later blocks append in document order. Each block applies its font, paragraph, list, or table properties before the next block. The final tool result checks the applied prefix and does not replay completed parts. Updates stay visible if a later part fails. Appended parts return only their own paragraph targets. The browser captures once per call and checks public revision events before each write. It does not serialize the document again after each call. An external document edit stops subsequent parts with `StaleDocument`.

Select **Stop** to stop generation and pending edit batches. An atomic batch already executing can complete. Later batches in that part stop before they change the document. Completed edits stay in the document and remain available for review or undo.

## Inspect, then edit

`inspect_document` reads one area in the body, a header, or a footer. It returns up to 40 objects, their relevant properties, and `nextOffset`. Collection enumeration still loads membership for the entire collection. `read_document` provides the same paged paragraph result for the main body. Empty paragraphs remain visible and addressable.

Paragraph targets use an inspected paragraph ID and an optional exact phrase. Phrase matches must be unique within the paragraph. Object targets use indexes from inspection. Re-inspect objects after a mutation. The adapter compares saved document bytes before execution. It checks paragraph text before resolving ranges. Before each write batch, it checks the browser document revision or the server document bytes. Later target loads cannot absorb an external edit into the inspection baseline. A changed document returns `StaleDocument`; the model must read again and reconsider the edit. Paragraph IDs and object indexes do not identify objects across separate file sessions.

Imported paragraphs can lack stored IDs. Inspection returns temporary targets for those paragraphs, including header, footer, table, and list paragraphs. Edits expire affected temporary targets. Inspect the changed story again before the next edit. The adapter resolves targets through public document collections.

## Tool coverage

`discover_capabilities` returns the tool mapping, host capabilities, and operation limits. `app/agent/coverage.ts` maps the repository's 81-member editing profile to tools and the application mode. A test checks that every profile member has a mapping. This mapping measures exposure, not complete Office.js compatibility or runtime success for every document.

| Area                     | Tools                                                        |
| ------------------------ | ------------------------------------------------------------ |
| Inspection               | `read_document`, `inspect_document`, `discover_capabilities` |
| Text                     | `create_document`, `write_story`, `edit_text`                |
| Formatting               | `format_document`                                            |
| Lists                    | `edit_list`, `configure_list`, `format_lists`                |
| Tables                   | `insert_table`, `edit_table`                                 |
| Content controls         | `insert_content_controls`, `edit_control`                    |
| Review                   | `edit_review`                                                |
| Layout                   | `edit_layout`, `insert_break`, `write_header_footer`         |
| Pictures and page fields | `edit_picture`, `edit_field`                                 |

Every document mutation uses public Office.js-shaped methods or property assignments. The adapter does not execute generated JavaScript, browser commands, or internal automation operations. Tool schemas belong to this application; they do not extend the public document model.

Document creation accepts paragraph, list, and table blocks. Paragraph and list blocks accept `format` arrays for explicit font and paragraph properties. Draft creation applies these properties without duplicate paragraphs. Drafts use consistent heading sizes, paragraph spacing, and real list definitions. Table headers accept font formatting. Paragraph `runs` support mixed inline fonts without ambiguous searches. Run text must concatenate to the paragraph text. Each run starts with the paragraph font. The model adds structure when the request needs it. Lists can contain one item, and bullets do not require a numbered list. Table inspection includes paragraph IDs and text for up to 200 cells across the result. Inspect paragraphs for additional targets. Property updates use explicit `changes` arrays. Omitted properties remain unchanged. The model calls one tool at a time. A new draft starts with `create_document`; capability discovery is optional for unfamiliar or host-dependent operations. It inspects object collections again after mutations invalidate their indexes. Both editing modes use the same tools. The application sends the selected mode with every model request. Text replacements with unchanged text refuse; use `format_document` for formatting. For a new paragraph, `edit_text` accepts `format` changes on the returned paragraph proxy. Font changes use font properties. Text insertion does not interpret Markdown or HTML. Set `highlightColor` to `null` to clear highlighting. This uses the documented runtime behavior of the public font property.

## Content controls

SDT means structured document tag, an actual content control. The agent preserves field labels and wraps existing field text with `Range.insertContentControl()`. Use an exact `search` phrase to keep a label outside the control. The tool inserts each control in a separate sync and resolves subsequent ranges again. It sets `ContentControl.tag` and `ContentControl.title` after creation. Inspect existing controls before adding another wrapper.

Direct edits support plain-text, rich-text, and date-picker creation. Capability discovery reports creation types for the selected mode. Suggestions report no supported creation types. Discovery does not change tracking. Dropdown, combo box, checkbox, and repeating-section creation remain unsupported by the public creation API. The tools refuse unsupported types and do not substitute plain text. `edit_control` exposes the supported Office.js-shaped text, metadata, lock, and deletion members. Typed control-value extensions are outside this example's Office.js-shaped editing scope.

## Commit and error behavior

Calls execute sequentially for each runtime. Repeated tool-call IDs return their original result without another edit. Independent font and paragraph writes share one sync. Structural edits use separate sync boundaries where the public API requires them. Creation and configuration of returned proxies also use separate syncs.

Results include `success`, JSON output, and `completedSteps`. Errors include a stable `code`, a `recovery` instruction, and the public member `target` when available. Completed steps remain committed if a later step fails. The adapter does not claim that a complete draft or multi-stage tool is atomic. It does not replay failed writes automatically.

Use `recovery.action` to choose the next step:

| Action | Next step |
| --- | --- |
| `inspect` | Read the affected story and revisions. Reconsider remaining edits. |
| `revise_arguments` | Correct the arguments without changing the requested scope. |
| `report_limit` | Report the unsupported operation. Continue other supported edits in the selected mode. |
| `stop` | Stop generation. Keep earlier completed edits. |

Do not infer rollback from an error. Check `completedSteps` before continuing. After a partial operation, inspect existing content before creating tables or controls again. Verify the edited properties before reporting success. In Suggestions, inspect revisions because original-view text can hide proposed insertions.

Protected content, XML-bound controls, merged tables, and pending revisions can refuse edits. Image insertion requires supplied PNG or JPEG bytes. Field calculation requires host pagination; a server without a measurer refuses calculation. Section columns, new style definitions, and unsupported field instructions remain unavailable.

## Hosts and collaboration

The UI uses a browser runtime. Shared handlers also run against a server runtime in integration tests. Browser editor saving supplies the snapshot comparison; server tests use the runtime's `save()` method. Host setup and transport remain separate from document operations.

The collaboration test attaches two editors to real document collaboration sessions. It checks concurrent formatting and tracked text, synchronization, save/reopen, undo, redo, stale targets, and reconnect. It does not establish collaboration support for every mapped operation.

For a server worker attached to a room, see the [server agent review example](../server-agent-review/README.md). For agents that return whole files, see the [Document refresh API](../../docs/site/content/guides/document-refresh.mdx). Full-file refresh is a separate transport choice; this example edits the open document directly.

## API feedback

Use these boundaries when you build an agent integration:

- Keep document edits in the Office.js-shaped model. Formatting uses properties; text insertion does not interpret Markdown.
- Discover supported operations before editing. A signature match does not establish support for every host, document, or tracking mode.
- Keep streaming and transport in the application. Apply complete, validated operations at explicit sync boundaries.
- Preserve successful edits after partial failures. Re-read stale targets and reconsider the next edit.
- Use native revisions for saved suggestions. Existing table column changes and established SDT wrapper changes require direct edits.
- Use refresh for complete files. Its diagnostics identify unmatched anchors, and processor descriptions support structural review lists.
- Keep refresh side effects visible. Each accepted file resets selection and undo history, and refresh refuses collaborative sessions.

Structural refresh summaries do not supply Accept and Reject actions. Extend native revision support before exposing those actions for unsupported edits.

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

The deterministic tests require no model API key. They check actual document results, refusal behavior, and saved DOCX content. For document-model limits, see [Office.js patterns for server agents](../../packages/editor-api/OFFICE_JS_GUIDE.md).

Collaboration verification covers tracked text, formatting, paragraph insertion, list membership, and content-control creation. Tests also cover concurrent new lists after a document rewrite, undo, redo, and saved row suggestions with concurrent cell edits. The standalone writer does not attach a collaboration session.

Complete table insertion, table value replacement, row additions, and partial row deletions support native revisions. An author can configure a complete proposed table while it has no foreign revisions. Existing table properties and columns require direct edits. Tracked table value replacement and ranges across paragraphs refuse in collaboration. Suggestions can wrap nonempty ordinary text in plain-text, rich-text, and date-picker controls outside collaboration. Existing review markup and changes to established wrappers refuse. Changes to SDT metadata have no generic `sdtPrChange` element in the pinned OOXML schema. Direct edits create real plain-text, rich-text, and date-picker controls. Text insertion supports text-like controls. Date-picker values use the editor's calendar; text insertion refuses with `NotSupported`.

Repeated paragraph insertions preserve request order, including mixed batches and streamed edits. Each paragraph commits before the next paragraph uses it as an anchor. Streaming uses public paragraph IDs to retain imported targets after structural edits. Ambiguous targets require inspection.

The field tool can insert inert TOC instructions. It does not calculate TOC entries or claim a populated table of contents.

### Notes and document structure

Inspect `footnotes` or `endnotes` from the main body, then pass the returned `story` to reading and editing tools. The example uses `Body.footnotes` and `Body.endnotes`. It supports existing-note edits; note creation remains unsupported.

Picture inspection reports existing table dimensions. Table inspection reports cell paragraph targets and picture counts. Separate paragraphs can already share one table row. Inspect that structure before changing image layout.

Edit existing objects in place. If reconstruction needs an unsupported operation, preserve the source and report the limit. Linked headers and footers can share content across sections. The public API cannot separate those linked stories. The example does not disable tracking after a refusal.

The reconstruction instruction is agent guidance, not a transaction boundary. Separate tool calls can partially complete. Whole-table deletion remains available for explicit deletion requests. Do not use deletion as a prerequisite for an uncertain reconstruction.

### Metadata and row insertion

Use `read_properties` to load selected metadata fields. Use `edit_properties` to batch changes to `author`, `title`, `subject`, `keywords`, `comments`, and `category`. These tools use `Document.properties`. They do not remove custom properties or other document information. Suggestions refuse metadata writes. Collaborative metadata edits require an existing core-properties part.

Use `edit_table` with `insertRows` to insert before or after an inspected row. The tool uses `TableRow.insertRows`. It preserves unrelated merged headers and supports native row suggestions. Merged source rows and crossing vertical merges refuse.

### Batch inspections and metadata removal

Use `inspect_document_batch` for up to six independent inspections of document areas or known stories. The combined limit is 120 top-level items and 120,000 UTF-8 bytes of result data. An external edit or inspection failure rejects the complete batch. The tool reduces model calls; each inspector retains its public API sync boundaries. Discover unknown note stories before including them in a batch.

`read_properties` supports readonly `lastAuthor`. For explicit metadata removal, use `remove_document_properties` in direct mode. It calls `Document.removeDocumentInformation('DocumentProperties')`. This removes document metadata, not body text, comments, revisions, or all personal information. Suggestions refuse this operation.

Draft blocks select paragraph styles through `block.style`. Draft lists use `Normal`; `block.format` cannot override styles. Draft font sizes must round to 1–1999 half-points. After rounding to twips, spacing must be nonnegative and line spacing positive. All paragraph measurements must remain within ±31,680 twips. Draft text and font names must contain valid XML characters. These checks reject known invalid inputs before replacement. They do not make progressive drafts atomic. Use `format_document` for supported custom styles on existing content.

Before each draft batch, the writer checks requested styles on a disposable server runtime opened from captured bytes. The check uses public paragraph style writes and disposes the runtime. Missing styles refuse before the active document changes. This adds one document open, one setup sync, and one sync per distinct requested style. Earlier streamed blocks remain saved if a later block fails.
