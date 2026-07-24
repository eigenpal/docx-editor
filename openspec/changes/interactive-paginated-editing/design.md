## Context

The greenfield engine already has the intended high-level separation:

- `DocumentStore`/`PackageModel` is canonical authored state;
- `EditorBinding` and ProseMirror process editing intent and project canonical
  state;
- layout produces positioned, anchored `DisplayPage[]`/`DisplayItem[]`;
- output backends paint that display data without deriving geometry;
- React and Vue supply thin `EditorHost` implementations.

The current production composition is incomplete. React and Vue mount a
ProseMirror view off-screen and paint paginated display output visibly, but the
public editor geometry methods are stubs, painted pages do not route pointer
input back to the binding, and caret/selection overlays do not exist. The
example conformance path still exposes a separate visible ProseMirror pane next
to a paginated preview. A model edit can therefore repaint pages without making
those pages the editing surface.

This change owns the missing browser interaction plane. It composes, but does
not replace:

- `document-engine` for store, binding, layout, output, performance, and
  conformance contracts;
- `comprehensive-ooxml-prosemirror-coverage` for per-feature parse/model/render/
  edit/save evidence;
- `partial-body-editability` for full/partial/none editability and read-only
  boundaries;
- `simplified-core-editor-contract` for the PM-free `Editor`/`EditorHost`
  facade;
- `public-package-topology` for final npm ownership and imports.

The term WYSIWYG is split deliberately. **Interactive paginated editing** is the
surface capability. **Feature WYSIWYG** is an evidence-backed claim earned by
each feature independently. Complete Word fidelity is not a binary prerequisite
for editing supported paragraphs, tables, images, or later feature lanes.

## Goals / Non-Goals

**Goals:**

- Make the normal React and Vue editor one interactive paginated surface.
- Keep ProseMirror responsible for editing semantics while keeping it hidden
  from the public API and non-authoritative for visible geometry.
- Make engine layout and its display/cluster/anchor data the only source for
  hit testing, caret placement, selection overlays, and page geometry.
- Publish display and interaction geometry coherently so adapters never combine
  pages from one revision with selection geometry from another.
- Support pointer, keyboard, clipboard, composition, focus, scroll,
  autoscroll, zoom, transformed content, read-only regions, and incremental
  feature interaction.
- Keep the synchronous input path bounded and make page painting,
  nonessential layout, and viewport virtualization asynchronous.
- Establish paired React/Vue and engine-neutral `EditorDriver` evidence through
  public package paths.
- Permit generic fallback editing only through a capability-declared,
  fail-closed proof of ownership and round-trip safety.
- Define a measured decision gate between a complete hidden ProseMirror
  projection and a bounded mounted editing window for large documents.

**Non-Goals:**

- Making ProseMirror DOM, CSS layout, or browser selection geometry canonical.
- Implementing page nodes or page breaks in the authored/ProseMirror document.
- Completing every OOXML feature or claiming whole-product Word fidelity.
- Moving feature parsing, semantic operations, layout, or save logic into
  adapters.
- Replacing the existing binding IME, selection, layout, partial-editability,
  or package-fidelity contracts with weaker copies.
- Requiring collaboration, PDF, or every related story before the first
  supported body-paragraph interaction milestone.
- Treating screenshot similarity alone as WYSIWYG evidence.

## Decisions

### D1: The normal editor has one visible engine-painted surface

React and Vue render the same engine-produced paginated display and overlay
layers. The ProseMirror editing view remains an internal input/projection
surface. A permanent visible ProseMirror pane beside paginated output is
diagnostic tooling, not the product editor.

The surface is layered:

```text
scroll host
  ├─ page geometry / placeholders
  ├─ positioned display-item paint
  ├─ semantic/accessibility projection
  ├─ selection, caret, composition and interaction overlays
  └─ hidden/repositioned ProseMirror input host
```

The adapter owns framework lifecycle, DOM handles, native event forwarding, and
chrome. The engine owns what events mean, which semantic position they target,
and all document geometry.

**Alternative considered:** keep the split edit/preview composition. Rejected
because it cannot prove direct interaction with rendered geometry and allows
preview repaint to be mislabeled as WYSIWYG.

### D2: ProseMirror remains hidden; paginated ProseMirror is rejected

The initial implementation keeps a complete ProseMirror projection mounted as
the editing engine. It receives focus, keyboard, clipboard, beforeinput, and
composition events. Its transactions map through `EditorBinding` into canonical
`DocOp`s; store commit precedes projection reconciliation and visible layout.

ProseMirror DOM does not determine page breaks, line boxes, pointer targets,
caret rectangles, selection rectangles, or export geometry. The interaction
plane maps semantic positions between ProseMirror and layout.

**Alternative considered:** render paginated ProseMirror/node-view DOM as the
visible document. Rejected because it creates a second layout authority,
duplicates display-item output, makes React/Vue parity dependent on browser CSS,
and cannot faithfully represent table fragmentation, notes, fields, floats,
headers/footers, PDF geometry, or read-only content absent from the editable
projection.

### D3: A bounded ProseMirror window is a measured optimization, not v1

The first milestone uses the complete hidden projection to minimize selection,
IME, clipboard, undo, and structural-edit risk. The 300–500-page corpus records
ProseMirror state size, mounted DOM nodes, retained memory, input latency, and
reconciliation work.

If ratified budgets fail, a later milestone may mount a bounded editing window
around the active scope. That window is only a view optimization:

- canonical state remains complete;
- transaction validation and semantic effects remain full-document;
- external and internal anchors remain document-wide;
- moving the window preserves selection, composition, history, and clipboard
  semantics;
- behavior must pass the same conformance suite before replacement.

### D4: One immutable interaction frame prevents revision tearing

`engine-editor` owns an immutable interaction frame containing at least:

- frame identity;
- canonical model revision;
- layout/display revision and resource/configuration epochs;
- the published page window and stable page geometry;
- semantic position/cluster index used by hit testing;
- current semantic selection and focus/composition state;
- caret and visible selection rectangles derived from that same geometry;
- completeness/pending diagnostics.

Display and interaction geometry are published atomically. Selection-only
changes may create a new interaction frame over an unchanged layout revision.
Model changes that require layout do not expose new selection geometry against
old display items.

While layout is pending, the last complete interaction frame remains visible.
Pointer input against that frame resolves to an engine anchor and is rechecked
against current canonical state. If it cannot be safely resolved, the operation
returns a typed stale-frame/invalid-target result and does not move the caret or
mutate state.

The exact public facade shape may be one snapshot or revision-tagged display and
geometry queries, but adapters must be able to prove all consumed values belong
to the same interaction frame.

### D5: Hit testing resolves display geometry to semantic interaction targets

Layout emits model-derived position data rather than deriving document offsets
from whichever glyph items happened to paint. Empty paragraphs, trailing
positions, whitespace, tabs, bidi runs, ligatures, page/column breaks, table
cells, atomic objects, and read-only blocks all have explicit caret or hit
semantics.

Hit testing:

1. converts client coordinates through scroll, zoom, page, and transform data;
2. identifies the topmost visible eligible display item in reverse z-order;
3. respects clipping, pointer transparency, and non-invertible transforms;
4. resolves through cluster/grapheme maps and affinity;
5. returns a semantic target containing scope, stable identity, position or
   object target, affinity, interaction role, and frame identity;
6. maps that target through the binding to a valid ProseMirror selection or a
   declared non-text interaction.

Page margins and gaps do not invent text positions. A capability may declare a
nearest-caret policy for its owned paragraph/line area. Read-only and atomic
objects may be selected or activated according to their interaction role but do
not become editable text.

### D6: Caret and selection overlays come only from engine geometry

The browser must not measure hidden ProseMirror DOM or painted DOM to recover
document geometry. The engine derives:

- collapsed caret rectangle and writing direction;
- visible rectangles for text, node, table-cell, control, story, and annotation
  selections;
- logical range and affinity;
- active page/scope;
- overlay clipping and transforms.

Selections spanning unmounted pages remain semantically complete. Only visible
segments are painted; page remount reconstructs the same overlay from the
semantic selection. Empty paragraphs and ligature-internal grapheme stops
produce deterministic caret boxes.

The overlay layer is pointer-transparent except for explicitly registered
handles or controls. It never becomes a second source of selection state.

### D7: Native interaction routes through the engine into ProseMirror

The interaction controller handles:

- single-click caret placement;
- shift-click extension;
- drag selection with capture and autoscroll;
- double-click Unicode word selection;
- triple-click capability-owned block selection;
- horizontal logical and vertical visual navigation;
- Home/End and page navigation using engine line/page geometry;
- atomic/node/table-cell/control selections;
- focus and blur;
- keyboard commands, beforeinput, clipboard, drag/drop, and IME;
- zoom and scroll changes.

The controller owns gesture interpretation and geometry-aware target
calculation, not editable selection state. It converts each target into a
ProseMirror selection or command through `EditorBinding`; ProseMirror remains
the owner of live selection, transaction, plugin, clipboard, and composition
state. The interaction frame is a revision-tagged projection of that state, not
a second selection model.

For commands already implemented correctly by ProseMirror, the controller
forwards native input after synchronizing the PM selection. Geometry-dependent
navigation uses engine line/cluster data to calculate the next semantic target,
then updates ProseMirror through `EditorBinding`. All resulting mutations still
commit store-first.

Adapters normalize only framework event wiring. They do not implement word
boundaries, selection mapping, layout navigation, or semantic command policy.

### D8: The hidden input host must support real focus, IME, accessibility, and mobile

The ProseMirror host is not `display:none` and is not detached. The
implementation may clip and reposition its active input/composition point near
the visible engine caret so browser IME candidate UI, virtual keyboards, and
clipboard events remain usable. It must not expose duplicate visible or
assistive content.

Before broad feature work, a focused cross-browser gate verifies:

- focus transfer from page click;
- composition start/update/end and cancellation;
- no duplicate or dropped composition text;
- candidate/input anchor follows the visible caret where the platform exposes
  testable geometry;
- dead keys, surrogate pairs, grapheme clusters, RTL composition, and blur;
- clipboard and mobile/virtual-keyboard behavior on supported platforms;
- accessibility tree contains one coherent document, not both painted and
  hidden duplicates.

If the selected hidden-host technique cannot pass this gate, implementation
must stop and revise the input-host mechanism without making ProseMirror or
browser DOM the layout authority.

### D9: Layout and paint are asynchronous; accepted input remains coherent

The synchronous input path is limited to native-event handling, ProseMirror
transaction processing, semantic validation/staging/publication, selection
capture, and scheduling. It does not synchronously paginate or repaint the full
document.

After commit:

1. `ModelChange` identifies dirty semantic identities and dependencies.
2. Layout restarts from the earliest required frontier and prioritizes the
   active/visible page window.
3. Page/display work runs through cancellable scheduled work.
4. A complete interaction frame for the affected visible window publishes
   atomically.
5. Downstream layout continues until the document convergence contract is
   satisfied.

Superseded derived work is cancelled without rolling back a published canonical
edit. The visible frame may lag canonical state briefly, but it never mixes
revisions and must meet ratified input-to-visible-update latency.

### D10: Page virtualization preserves geometry and interaction

The engine owns the requested page window and overscan policy using viewport,
caret, selection, active composition, navigation destination, and accessibility
requirements. Adapters render only the supplied/mounted page window and exact
size placeholders for unmounted pages.

The following stay mounted or become mounted before interaction completes:

- active caret/composition page;
- pages intersecting visible selection overlays;
- pointer-captured drag/autoscroll destination;
- focused atomic/control interaction;
- declared accessibility focus range.

Scroll position is anchored by page identity and content-space offset when page
heights before the viewport change. A selection crossing unmounted pages
retains its semantic range. Hit testing an unmounted page requests/awaits its
interaction frame or returns a typed pending result; it never guesses from DOM.

### D11: Incremental feature interaction is capability-proven and fail-closed

Each feature capability declares independent support levels for:

- visible rendering;
- semantic hit ownership;
- selection/navigation;
- generic fallback editing;
- typed editing/commands;
- save/reopen preservation;
- paired-adapter evidence.

Generic fallback editing is permitted only when the capability proves:

- exact owned canonical/XML region;
- accepted ProseMirror steps and semantic operation mapping;
- reverse reconciliation and selection behavior;
- rejection of boundary-crossing or unsupported edits before mutation;
- preservation of unowned children/siblings/capsules;
- deterministic save/reopen equivalence;
- interaction geometry and paired React/Vue evidence.

Otherwise the feature remains fully rendered but read-only/selectable according
to policy. Serialization failure is not a rollback strategy for optimistic
editing; unsupported intent is rejected before canonical publication.

Tables, images, controls, links, headers/footers, annotations, and other
features earn interactive and WYSIWYG claims one lane at a time.

### D12: Claims are explicit and evidence-backed

The support manifest distinguishes:

- `rendered`;
- `interactive-read-only`;
- `fallback-editable`;
- `typed-editable`;
- `interactive-paginated`;
- `feature-wysiwyg`.

`interactive-paginated` requires direct page interaction, selection/IME where
applicable, canonical mutation, repaint, and save/reopen through both public
adapters.

`feature-wysiwyg` additionally requires authored-state, resolved-style,
shaping, pagination, display, semantic/accessibility, interaction, DOCX
save/reopen, and relevant PDF/print comparators for that feature. It does not
assert unsupported Word behavior.

No aggregate "true WYSIWYG" product claim may be inferred from a single feature
or from paginated repaint alone.

### D13: Public adapter conformance replaces the example split path

One engine-neutral `EditorDriver` scenario runs against installed-style React
and Vue entries. It uses public commands, queries, pointer coordinates,
snapshots, display/interaction frame identifiers, and save/reopen results. It
does not query ProseMirror positions, private views, or framework-specific DOM.

The split-pane example may remain behind an explicit diagnostic flag until the
public path passes. It is then removed from normal demos and never acts as
completion evidence.

## Risks / Trade-offs

- **Hidden ProseMirror causes IME candidate, virtual-keyboard, or accessibility
  problems** → make input-host behavior an early cross-browser falsification
  gate; reposition/clip the active host near the engine caret; stop and revise
  before broad feature work if it fails.
- **Custom selection feels less native than visible contenteditable** → define
  complete pointer, keyboard, clipboard, word/block selection, autoscroll, and
  bidi/grapheme scenarios; compare behavior through public browser tests.
- **Full hidden projection is expensive on 300–500 pages** → instrument PM
  state/DOM/memory/input latency; retain a measured bounded-window option without
  changing semantics.
- **Asynchronous layout makes typed text appear late** → prioritize active
  viewport layout, cancel stale work, retain coherent last frame, and enforce a
  ratified input-to-visible-frame budget.
- **Stale display receives a pointer event** → bind targets to frame identity,
  resolve to stable anchors, recheck against current state, and reject rather
  than guess.
- **Model/display/selection positions drift** → build positions from canonical
  block/story identity and cluster maps, not rendered-item accumulation; test
  empty, bidi, ligature, structural, and cross-page cases.
- **Fallback editing corrupts unsupported XML** → require capability-owned
  precommit proof and save/reopen evidence; fail closed at boundaries.
- **React and Vue implement different gestures** → keep gesture semantics in
  the interaction controller and run identical driver scenarios.
- **Virtualization breaks long selections or scroll position** → preserve
  semantic ranges, exact page placeholders, and page-identity scroll anchors.
- **WYSIWYG becomes a marketing percentage** → expose per-feature evidence
  states and prohibit an aggregate claim without a separately ratified matrix.

## Migration Plan

1. Correct status language: rename the landed document-engine checkpoint to
   "paginated preview repaint" and reference this change for direct editing.
2. Freeze interaction-frame, semantic-position, hit-target, geometry, and
   `EditorDriver` fixtures, including empty/bidi/ligature/cross-page cases.
3. Replace provisional rendered-item offsets with model-derived story/block/
   grapheme position indexes and capability-owned hit roles.
4. Wire layout hit testing, caret rectangles, selection rectangles, current
   selection, and current page through the PM-free `Editor` facade.
5. Pass the hidden-input focus/IME/clipboard/accessibility falsification gate.
6. Add the shared interaction controller and one-surface page/overlay
   composition to React and Vue.
7. Migrate browser conformance from the split example to public adapters and
   retain split mode only as an explicit diagnostic.
8. Move layout/repaint off the synchronous input path; add cancellation,
   visible-window prioritization, coherent interaction-frame publication, and
   stale-frame handling.
9. Add page virtualization, overscan, scroll anchoring, drag autoscroll, and
   unmounted-selection behavior.
10. Run the 300–500-page decision benchmark. Keep the complete hidden
    ProseMirror projection if it passes; otherwise implement and requalify a
    bounded mounted window.
11. Integrate capability-proven fallback and typed interaction lane by lane,
    beginning with paragraphs, tables, and images.
12. Remove normal split-pane paths only after both public adapters pass the
    required interaction and save/reopen matrix.

Rollback is milestone-based. Until public adapters pass, the existing painted
preview and diagnostic split composition remain available. Canonical model and
DOCX formats do not change. A failed interaction milestone can disable page
input and return to read-only paint without reverting authored state or feature
parsers.

## Open Questions

- Exact browser/platform matrix for the hidden input-host IME and mobile gate
  must be fixed before task implementation begins.
- Numerical input-to-visible-frame, scroll, DOM-node, memory, and mounted-PM
  thresholds are ratified from the existing representative benchmark corpus,
  not invented in this change.
- The complete hidden projection versus bounded mounted-window decision remains
  explicitly open until measured evidence is available.
- Accessibility implementation may use positioned semantic DOM, a dedicated
  semantic projection, or another standards-compliant mechanism, but it must
  expose one coherent document and preserve the common semantic tree.
