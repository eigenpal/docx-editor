## Context

The editor's save flow (`DocxEditor.handleSave()`) calls `fromProseDoc()` to convert ProseMirror state back to a `Document` model, then `repackDocx()` to fully re-serialize every XML part and repack the ZIP. This produces valid DOCX files, but the full re-serialization changes whitespace, attribute order, and paragraph formatting in ways that differ from the original XML — even for paragraphs the user never touched.

Enterprise customers use Word's Review → Compare to verify edits. The current full-repack approach produces massive spurious diffs, undermining trust.

PR #73 attempted to solve this with a separate `DirectXmlDocxEditor` component (5,200+ lines added). While the core idea is sound, the approach has problems: it duplicates the editor component, introduces complex baseline snapshot management, uses regex-based XML parsing susceptible to nested element bugs, and adds significant surface area. The review identified multiple correctness issues.

### Existing Infrastructure

- **`rezip.ts`** already has `updateMultipleFiles(originalBuffer, Map<path, content>)` — updates specific files in the ZIP without touching others
- **`paraId`** is preserved on every paragraph node through the ProseMirror layer (parsed from DOCX, stored in attrs, serialized back)
- **`serializeDocument()`** produces the full `document.xml` string from the Document model
- **Original buffer** is preserved on the Document as `doc.originalBuffer`

### Constraints

- Client-side only, no backend
- Must not break existing save behavior — selective save is an optimization, not a replacement
- Must fall back gracefully to full repack when selective patching is unsafe

## Goals / Non-Goals

**Goals:**

- Minimize spurious diffs when saving DOCX files with small edits
- Preserve original XML byte-for-byte for unchanged paragraphs
- Automatic fallback to full repack when selective save is unsafe
- Integrate into existing `DocxEditor` save flow (no separate component)
- Comprehensive test coverage for edge cases

**Non-Goals:**

- Selective save for headers/footers (full repack is fine for these — they're small)
- Selective save for styles.xml, numbering.xml, or other non-document parts
- Tracking changes at run-level granularity (paragraph-level is sufficient)
- Supporting nested `<w:p>` inside `<mc:AlternateContent>` for selective patching (fall back to full repack)
- Replacing the existing full-repack save path (it remains as fallback)

## Decisions

### Decision 1: Integrate into existing DocxEditor, not a separate component

**Choice:** Add selective save as an internal optimization in `DocxEditor.handleSave()`, not as a new `DirectXmlDocxEditor` component.

**Rationale:** PR #73 created an entirely separate editor component with its own baseline management, props, and lifecycle. This doubled the API surface and maintenance burden. The selective save is purely a serialization optimization — the editing experience is identical. It belongs in the save path, not the component layer.

**Alternative considered:** Separate component (PR #73 approach) — rejected due to complexity, duplication, and the baseline synchronization issues identified in review.

### Decision 2: XML patching via DOM parsing, not regex

**Choice:** Parse original `document.xml` with DOMParser, locate `<w:p>` elements by `w14:paraId`, replace their outerHTML with re-serialized XML, then serialize back.

**Rationale:** PR #73 used regex (`<w:p\s[^>]*paraId="xxx"[\s\S]*?</w:p>`) which fails on nested `<w:p>` elements inside `<mc:AlternateContent>` blocks (identified in review). DOM parsing correctly handles nesting and is already available in the browser.

**Alternative considered:** Regex with balanced-tag validation — fragile and complex. String splitting on paragraph boundaries — still brittle with nesting.

**Trade-off:** DOMParser may normalize some whitespace in the serialized output. We mitigate this by only serializing changed paragraphs' subtrees and splicing them into the original string at known offsets.

### Decision 3: Hybrid approach — DOM for location, string splicing for output

**Choice:** Use DOMParser to find paragraph positions and validate structure, but use string index offsets to splice new paragraph XML into the original string. This preserves the original XML byte-for-byte for unchanged regions.

**Flow:**

1. Parse original `document.xml` string with DOMParser
2. For each changed `paraId`, find the `<w:p>` element in the DOM
3. Record the string start/end offsets of that paragraph in the original XML
4. Serialize only the changed paragraph from the Document model
5. Build patched XML by concatenating: original[0..start] + newParagraphXml + original[end..]
6. Apply patches from end-to-start to avoid offset invalidation

**Alternative considered:** Full DOM serialize → loses all original formatting/whitespace. Full string regex → nested element bugs.

### Decision 4: ProseMirror plugin for change tracking

**Choice:** A simple ProseMirror plugin that watches `appendTransaction` and records `paraId` values of any paragraph nodes that were modified (content change, formatting change, or structural change within the paragraph).

**Rationale:** This is lightweight and leverages ProseMirror's transaction system. The plugin maintains a `Set<string>` of changed paraIds that gets cleared on save.

**Alternative considered:** Diffing the Document model before/after — much more expensive and requires maintaining a baseline Document clone in memory. Transaction watching is incremental and cheap.

### Decision 5: Conservative fallback triggers

**Choice:** Fall back to full repack when any of these conditions are detected:

- Paragraphs were added or deleted (paraId count changed)
- Section properties changed
- No original buffer available
- New images or hyperlinks were added (need relationship management)
- Any changed paragraph has a `paraId` that can't be found in the original XML
- The patched XML fails a basic structure validation (balanced tags)

**Rationale:** Correctness over optimization. Full repack is the proven path — selective save is a best-effort optimization. When in doubt, fall back.

### Decision 6: Serialize individual paragraphs by extracting from full serialization

**Choice:** Rather than writing a new per-paragraph serializer, serialize the full `document.xml` via the existing `serializeDocument()`, parse it, and extract the specific `<w:p>` elements for changed paragraphs by `paraId`.

**Rationale:** Reuses proven serialization logic. No risk of divergence between selective and full serialization. The full serialization is fast (< 100ms for large documents).

**Alternative considered:** Writing `serializeParagraph()` separately — risk of inconsistency with full serializer, more code to maintain.

## Risks / Trade-offs

- **[Risk] DOMParser whitespace normalization** — Even for changed paragraphs, the re-serialized XML may differ slightly from what the original serializer would produce. → Mitigation: We only replace paragraphs the user actually edited, so any formatting differences are expected and intentional.

- **[Risk] paraId collisions or missing IDs** — Some DOCX files may have duplicate or missing paraIds. → Mitigation: Detect duplicates/missing during patch planning and fall back to full repack.

- **[Risk] Namespace handling in DOMParser** — XML namespaces (`w:`, `w14:`, `mc:`, etc.) require careful handling with DOMParser. → Mitigation: Use namespace-aware parsing or fall back to string-based offset finding with proper tag matching.

- **[Risk] Performance regression for large documents** — Building the full serialized document.xml just to extract a few paragraphs is wasteful. → Mitigation: Acceptable for now; per-paragraph serialization can be added later as an optimization if profiling shows a bottleneck.

- **[Trade-off] Paragraph-level granularity** — We track changes at paragraph level, not run level. A single character change marks the whole paragraph as changed. → Acceptable trade-off: paragraph-level is sufficient to eliminate 95%+ of spurious diffs.

- **[Trade-off] No header/footer selective save** — Headers and footers are always fully re-serialized if changed. → Acceptable: they're small and rarely edited.
