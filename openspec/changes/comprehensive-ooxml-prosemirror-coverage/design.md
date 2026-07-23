## Context

The production engine currently opens
`e2e/fixtures/comprehensive-word-element-test.docx` safely, retains all 38 package
members, models body paragraphs plus top-level tables and block SDTs, and reopens an
unedited package byte-identically. The fixture is intentionally read-only because
only a few paragraphs are fully regenerable. Layout renders body text and basic
tables but does not yet resolve the fixture's sections, columns, lists, related
stories, drawings, fields, annotations, or full formatting.

The first paired editing vertical lives in `examples/shared`: React and Vue use one
session and one ProseMirror mount, while the published adapters still call a
contract-only `createEditor` stub. The binding schema edits paragraphs with
bold/italic and projects every other top-level block as a read-only atom. Parse
dispatch has a block registry, but scan, preservation, serialization, normalization,
DocOps, ProseMirror projection, layout, and output still contain central kind
switches.

The comprehensive fixture exercises paragraphs and rich run properties, style
inheritance, numbering, nested and merged tables, seventeen SDTs, five sections
including columns and landscape pages, four header/footer pairs, footnotes,
endnotes, embedded drawings, hyperlinks, bookmarks, fields, comments, breaks, tabs,
symbols, settings, and package properties. It also contains source defects that are
part of the preservation contract: two body-level `w:pBdr` elements, duplicate style
IDs with missing base styles, malformed simple field instructions, repeated drawing
IDs, and a comment described in text as a reply without threaded-comment metadata.

The fixture uses Transitional namespace URIs while the repository XSDs use Strict
URIs. Coverage inventory therefore compares normalized namespace families plus local
name and parent context; it does not claim that direct Strict-XSD validation proves
Transitional validity.

## Goals / Non-Goals

**Goals:**

- Make feature support explicit at every pipeline stage: parse, canonical model,
  preservation, rendering, ProseMirror projection, editing, serialization, and
  reopen.
- Make new OOXML support primarily a capability module plus conformance fixtures,
  rather than edits to central switches.
- Render the comprehensive fixture through deterministic display output and expose
  supported content in ProseMirror without flattening unsupported structures.
- Add semantic editing feature-by-feature while retaining unsupported XML and
  package parts losslessly.
- Keep ProseMirror a projection and `PackageModel` the canonical authored source.
- Keep React and Vue behavior paired through one production editor composition and
  one shared driver-based test matrix.
- Generate honest coverage reports with separate denominators and fixture evidence.

**Non-Goals:**

- Modeling the full OOXML XSD directly in ProseMirror.
- Treating XSD element counts as a single product-support percentage.
- Auto-generating semantically valid documents for every XSD production.
- Making malformed fields executable, fetching external resources, or repairing
  source defects during a no-op save.
- Requiring Yjs, hosted synchronization, server RPC, or language clients.
- Declaring complete Word compatibility from this single fixture.

## Decisions

### 1. Use registered vertical feature lanes

Each feature owns one stable capability ID and contributes handlers through package-
local registries:

- **engine-core:** QName/context recognition, parse, scan, canonical record,
  identity traversal, normalization, preservation ownership, serializer, validation,
  semantic operations, and edit policy.
- **engine-binding:** ProseMirror node/mark spec, canonical projection, read-only
  fallback, transaction-step mapping, reverse reconciliation, selection and IME
  behavior.
- **engine-layout:** dependency keys, resolution, measurement, pagination, semantic
  roles, and display items.
- **engine-output:** DOM/PDF/a11y/hit-test handling for the feature's display items.
- **conformance:** fixture regions, authored comparator, layout/display oracle,
  edit/save/reopen vectors, and adapter evidence.

Core exports stable capability IDs and data contracts; downstream packages register
their own handlers without core importing binding, layout, or output.

**Alternative considered:** continue adding `switch (block.kind)` branches. Rejected
because parallel feature work would repeatedly conflict in parser, binding, and
layout files.

**Alternative considered:** put all OOXML nodes in one ProseMirror schema. Rejected
because it duplicates the canonical model, cannot retain arbitrary package state,
and makes headless/server editing depend on PM.

### 2. Separate block, inline, property, story, and package capabilities

One block-only abstraction cannot represent the fixture. The registry supports:

- block structures: paragraph, table, block SDT;
- inline structures: runs, hyperlinks, inline SDTs, drawings, fields, bookmarks,
  comment/note references, tabs, breaks, symbols, math, and tracked wrappers;
- properties/resolution: paragraph/run properties, styles, numbering, themes, table
  styles, section properties, settings, and document defaults;
- stories: body, header, footer, footnote, endnote, comments, text boxes;
- package resources: relationships, media, metadata, font table, content types.

Capabilities declare contexts in which each QName is owned. The same QName in a
different parent context can have a different policy.

### 3. Keep unsupported content lossless and explicitly non-editable

Every recognized context declares one edit policy:

- `editable`: canonical record, semantic operations, PM mapping, serializer, and
  reopen evidence exist;
- `readOnlyProjected`: visible typed PM atom/node with canonical identity, but no
  mutation mapper;
- `verbatim`: retained in an ownership-scoped preservation capsule and omitted from
  semantic editing;
- `reject`: unsafe or ambiguous input fails before publication.

An absent mapper is never interpreted as permission to flatten or delete. Editing a
supported parent containing an unowned child requires capsule reinsertion or rejects
that edit. A no-op save preserves malformed-but-safe fixture constructs byte-for-
byte.

### 4. Compose ProseMirror from binding capabilities

`engine-binding` builds one schema from registered feature fragments. Canonical
records carry stable semantic identities into PM attrs. Typed read-only nodes replace
the generic placeholder as rendering support lands; their node views consume
canonical/display state but remain `contenteditable=false`.

Supported transactions are applied to a shadow `EditorState`, translated into
minimal semantic operations, and committed once. The actual view reconciles from the
normalized `ModelChange` using affected ranges, not a whole-document diff. Local
typing does not synchronously run full layout; layout starts asynchronously from the
earliest invalidated flow position and repaints changed visible pages.

### 5. Use the comprehensive fixture as a corpus, not a specification substitute

The source DOCX hash and all package member hashes are frozen. A fixture inventory
records QName/context counts and named feature regions. Expectations distinguish:

- standards-valid semantics;
- source defects that must remain inert and preserved;
- claimed fixture features not actually encoded, such as threaded comments and
  tracked revisions;
- absent features, including a theme part, charts, diagrams, macros, and OLE.

Small focused fixtures remain the primary diagnosis unit. The comprehensive fixture
is the integration and no-regression gate.

### 6. Add a machine-readable support manifest

The generated XSD inventory contains normalized namespace family, local name, schema
type, legal parent contexts where derivable, and source schema version. A maintained
manifest overlays support claims:

```ts
interface OoxmlSupportClaim {
  capabilityId: string;
  qname: string;
  contexts: readonly string[];
  parse: SupportState;
  model: SupportState;
  preserve: SupportState;
  render: SupportState;
  pmProject: SupportState;
  edit: SupportState;
  serialize: SupportState;
  reopen: SupportState;
  evidence: readonly EvidenceId[];
}

type SupportState =
  | 'unsupported'
  | 'verbatim'
  | 'readOnly'
  | 'partial'
  | 'supported';
```

CI validates unique ownership, known QNames/contexts, stage monotonicity, required
evidence, and capability-handler presence. Reports show separate counts for XSD
inventory, encountered fixture contexts, modeled contexts, rendered contexts, and
editable contexts. Product documentation maps these granular claims to existing
user-facing feature IDs; it does not expose raw QName percentages as marketing.

### 7. Implement fixture coverage in dependency-ordered waves

**Wave A — foundations and visible text**

- capability registries and support manifest;
- preservation normalization/hash correction;
- paragraph/run properties, styles/defaults, numbering and list labels;
- whitespace, Unicode, bidi, fonts, sizes, colors, underline/strike, highlighting,
  shading, alignment, indentation, spacing, tabs, breaks, symbols and math;
- production `Editor`/`EditorHost` composition promoted from examples.

**Wave B — page flow and containers**

- sections, page sizes/margins/orientation, columns and column breaks;
- headers, footers, PAGE/NUMPAGES inert/resolved output;
- footnotes/endnotes and references;
- complete table pagination, nesting, merges, repeated headers and floating tables;
- block/inline/table-cell SDTs and control rendering.

**Wave C — relationships and anchored content**

- embedded images, inline/floating drawings, crop/size/wrap/position/alt text;
- sanitized external and internal hyperlinks;
- bookmarks and navigation;
- fields as inert authored instructions with separately resolved display results.

**Wave D — annotations and advanced editing**

- comments and range anchors without invented threading;
- tracked-change structures when focused fixtures exist;
- semantic table, SDT, image, link, section, story, field, note, comment and
  formatting operations;
- PM forward/reverse mapping, selection, clipboard, IME, undo and read-only
  boundaries for each editable capability.

Each slice must pass parse/model/preserve/render before becoming PM-editable.

### 8. Keep adapters thin and test them through one driver

The framework-agnostic session and mount lifecycle move from `examples/shared` into
the production editor composition. React and Vue supply DOM getters, scheduling,
commit notification and chrome only. Neither adapter imports PM types or implements
feature mapping.

Every feature runs headless conformance first, then one shared `EditorDriver` scenario
against both adapters. Display and DOCX comparators are authoritative; DOM selectors
and PM positions are not public assertions.

## Risks / Trade-offs

- **Capability contracts are frozen too early** → Migrate paragraph, table and SDT
  through registries behavior-neutrally, then freeze only after the comprehensive
  fixture proves block, inline, story and resource categories.
- **Support manifest becomes paperwork** → Generate handler/evidence checks and
  require claims to live beside capability registration.
- **XSD coverage is misleading** → Report separate denominators and require
  QName-plus-context claims; never publish one aggregate compatibility number.
- **Editable parent drops unknown descendants** → Require ownership capsules or
  reject the edit before canonical commit.
- **Typed PM nodes turn PM into a second model** → PM attrs contain only projection
  and stable identity data; authored package state remains in `PackageModel`.
- **Large documents regress typing latency** → Prohibit whole-document binding diffs,
  defer layout from the input critical path, virtualize display output, and benchmark
  bounded edits on 300–500-page fixtures.
- **Fixture defects are normalized away** → Classify them as inert preservation
  evidence and assert no-op byte identity.
- **React/Vue drift** → One editor composition, one shared feature scenario, and
  paired CI execution.

## Migration Plan

1. Freeze the fixture and generate its inventory without changing runtime behavior.
2. Add manifest and evidence validation in report-only mode.
3. Introduce core and downstream registries; migrate paragraph, table and SDT
   handlers without output changes.
4. Promote the shared editing session behind `Editor`/`EditorHost`; keep the existing
   query-param demo path as a temporary compatibility entry.
5. Implement Waves A–D as independently reviewable vertical slices.
6. Turn manifest gaps and missing evidence into CI failures only after each owning
   wave declares its baseline.
7. Retire example-only mounting, duplicate painters and retired PM-facing browser
   hooks after paired adapters consume the production composition.

Rollback is per capability: unregister the new handler and retain the previous
read-only/verbatim policy. Canonical formats and preservation capsules remain
versioned so rollback never requires destructive package conversion.

## Open Questions

- Whether the active editing surface should keep a full-story PM document with
  virtualized node views or use a bounded PM window over canonical/display state.
- Which shaping, bidi and line-breaking libraries pass the section-8 technology
  bake-off and cross-runtime determinism requirements.
- Whether malformed duplicate style IDs resolve first-wins or last-wins for display;
  raw XML must be retained regardless.
- Which fields beyond PAGE/NUMPAGES are resolved automatically versus remaining
  inert until explicit user action.
- Whether the two invalid body-level `w:pBdr` nodes receive a display-only fallback
  or remain preserved with no invented semantics.
