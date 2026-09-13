# Independent report-agent consumer feedback

App: `examples/editor-api-consumers/report-agent.ts`.
Scope: public `editor-api` and public `core/layout` imports only.
The app creates its input ZIP. It never changes saved XML.
The agent interprets a typed report plan and executes document actions.
No implementation tests supplied its workflow.

## Commands

Run from the worktree root:

```sh
bun examples/editor-api-consumers/report-agent.ts
bun examples/editor-api-consumers/report-agent.ts --probe-batching
bunx tsc -p /tmp/editor-api-consumers/report/tsconfig.json
```

Bun uses workspace aliases for the public package entry points.
The temporary typecheck configuration uses public built declarations.
Both commands save artifacts. The default command now returns success.
The batching probe intentionally exercises a documented limitation.

## Findings

1. **P1: Paragraph font writes fail after simple fields. Open at initial review.**
   Create a primary footer. Insert its paragraph and sync.
   Insert PAGE, sync, append `of`, sync, insert NUMPAGES, and sync.
   Set the paragraph font name and size, plus alignment. Sync.
   Expected: both field wrappers remain, and paragraph formatting applies.
   Actual: `GeneralException`, targeted at `getFooter.insertParagraph.font`.
   The app records this failure and continues independent field calculation.
   It does not remove fields or repair XML.
   Reproduction: default command, `footer-formatting-after-fields` evidence entry.

2. **P2: Table navigation loses loaded state. Fixed and verified.**
   Original reproduction: load `table.rows.items`, then load each `row.cells.items` and sync.
   Read each `row.cells.items.length` through the getter again.
   Expected: the loaded cells remain available.
   Original actual: `PropertyNotLoaded`.
   The root agent memoized collection getters.
   The final batching probe uses repeated getters and passes this operation.
   The ordinary app retains collection proxies, which also works.

3. **P2 compatibility gap: Different list levels cannot share a sync.**
   Start a list and sync. Configure bullet levels zero and one, then sync.
   Expected from ordinary batched authoring: both level formats apply.
   Actual: `ConflictingChanges`, with a paragraph-conflict message.
   The public guide permits separate syncs for conflicting paragraph edits.
   This remains a batching limitation, not full Office.js behavior.
   The ordinary app uses separate level syncs. The probe preserves the refusal.
   The numbered level combines numbering, indents, and restart in one sync successfully.

4. **P3 documentation gap: Font-backed server pagination setup. Addressed.**
   The compatibility page now explains resource registration, font substitution, runtime configuration, and disposal.
   It links the complete runnable report agent. The overview and package README link this setup.
   The app uses `createLayoutShaping` and `createLayoutShapedMeasurer` with actual Carlito font bytes.
   It admits regular, bold, italic, and bold-italic faces as explicit Calibri resources.
   Its resolver refuses unavailable fonts instead of using approximate widths.
   Built-in bullets request Symbol/Courier New; these need additional font resources.
   The report uses Unicode custom bullets with explicit Calibri fonts.
   This gives usable measured pagination without assuming unavailable system fonts.

## Evidence

Default output: `/tmp/editor-api-consumers/report/`.
Probe output: `/tmp/editor-api-consumers/report/batching-probe/`.
Each contains `input.docx`, `report.docx`, `document.xml`, and `evidence.json`.
Default output also includes extracted header, footer, and numbering XML.
The DOCX artifacts contain the actual public runtime output.

Verified successful actions:

- Heading style, font family/size/bold, alignment, spacing, and summary emphasis.
- Custom bullet levels, nested attachment, list detachment, and decimal restart at three.
- Three-by-three table values, row/column additions and deletions, and returned row collections.
- Header row, table style, cell value, column width, shading, vertical alignment, and cell paragraph formatting.
- Valid PNG and JPEG insertion, aspect-preserving resize, independent dimensions, escaped alt text, and deletion.
- Primary header/footer creation, page size/margins, and PAGE/NUMPAGES field insertion and calculation.
- Save/reopen table and image assertions, heading XML assertions, nested list and detachment XML assertions.
- Cached PAGE and NUMPAGES results both equal one after actual font-backed layout.
- Bookmark, sentinel text, original media bytes, unrelated custom XML, and unrelated style border preservation.

The initial footer font failure was fixed during follow-up.
The parent owns local Word inspection. Both-host results appear below.
No production source or existing implementation tests changed in this review.

## Follow-up: Word inspection and both-host execution

The parent opened the original report in local Word without a repair prompt.
Word showed one page and cached fields `1/1`.
Word also exposed two app-intent problems: inherited list membership and oversized table columns.

Microsoft documents that `addColumns` copies the first or last column as its template.
It does not promise automatic fitting after this operation.
The original app changed only column zero after adding a column.
Its resulting widths totaled 612 points, while the report body measured 504 points.
The revised app sets every final width: 144, 180, and 180 points.
See [Word.Table.addColumns](<https://learn.microsoft.com/en-us/javascript/api/word/word.table?view=word-js-preview#word-word-table-addcolumns-member(1)>).

The metrics heading and caption should not belong to the preceding action list.
The runtime inherits paragraph formatting during insertion, including list membership.
The Office.js paragraph documentation does not precisely specify that inheritance rule.
Thus, this review does not claim independent Office.js behavior equivalence for inheritance.
However, `detachFromList` explicitly expresses the app's intent.
The revised app detaches the metrics heading before table creation and detaches the image caption.
This also prevents the table-adjacent paragraph from inheriting numbering.
See [Word.Paragraph.detachFromList](<https://learn.microsoft.com/en-us/javascript/api/word/word.paragraph?view=word-js-preview#word-word-paragraph-detachfromlist-member(1)>).

Combining detachment and paragraph style in one sync returned `ConflictingChanges`.
The app now separates these operations under the documented same-paragraph batching limitation.
This remains a compatibility gap; the app does not conceal a silent content error.
The final XML asserts column widths and unnumbered heading/caption paragraphs.

The font agent fixed finding 1 through the canonical run-splitting path.
The unchanged footer formatting operation now succeeds.
The server app passes all seven actions, reopening, and preservation assertions.
Its footer XML also confirms the requested font size and centered alignment.

Both hosts now execute the same implementation in `report-plan.ts`.
The browser host uses public `createDocxEditor`, `createBrowser`, `editor.save`, and `editor.load` APIs.
It loads actual font bytes and runs in headless Chromium through Playwright.
Run:

```sh
bun examples/editor-api-consumers/report-agent.ts
bun examples/editor-api-consumers/report-browser-run.ts
REPORT_VERIFY_DOCX=/tmp/editor-api-consumers/report/browser/report.docx bun examples/editor-api-consumers/report-agent.ts
```

The final command applies the full server-side reopen/preservation assertions to browser-produced bytes.
It never modifies those bytes.
Browser artifacts live in `/tmp/editor-api-consumers/report/browser/`.
They include `report.docx`, `report.png`, `evidence.json`, and `semantic-verification.log`.

Browser execution found another navigation bug: `Body.tables` loses loaded state across getter access.
Reproduction: `body.tables.load('items'); await context.sync(); body.tables.items`.
Actual: `PropertyNotLoaded`. Expected: loaded table items.
The browser runner keeps this explicit probe and records its status.
`Body.inlinePictures` passes the equivalent probe.
All seven browser actions and saved-document semantic assertions otherwise pass.
The browser output also passes the full server-side preservation assertions.

Final rerun after the root navigation fix:

- Server command exits zero. All seven actions pass.
- Browser command exits zero. All seven actions and both getter probes pass.
- Browser save/reopen table and image assertions pass.
- Full server-side XML and preservation assertions pass against browser-produced bytes.
- Chromium reports no page or console errors.
- The browser screenshot shows unnumbered metrics/caption and a table within the body width.
- Public declaration typechecking passes for the server app, shared plan, browser app, and browser runner.

The remaining known gaps are explicit batching limitations. The pagination setup documentation gap is addressed.
No required report behavior remains blocked in these measured workflows.
