# Renderer run grouping

## Outcome

Reduce visible text DOM from one absolutely positioned element per word/style
slice to approximately one element per authored style run per visual line, while
keeping the greenfield store, layout, interaction frame, hit testing, and
selection authority unchanged.

Use the retired editor as an implementation and E2E reference. Port proven
algorithms and behavior, not its package boundaries, hooks, ProseMirror
ownership, or DOM-derived geometry.

## What the retired implementation proves

The retired renderer separates three granularities:

1. **Measurement:** cross-run word, whitespace, tab, image, and break tokens
   determine wrapping.
2. **Pagination:** measured visual lines determine page fragmentation.
3. **Paint:** authored runs are clipped to each line and emitted as styled run
   elements. Words are not DOM elements, and spaces remain real run text.

It also demonstrates page-shell virtualization, semantic page fingerprints,
incremental repaint, animation-frame layout coalescing, stable scroll
restoration, and a dual visible/editing projection.

The current renderer emits one text item per non-whitespace word token, splits
again at style boundaries, maps each slice to one glyph run, and paints each run
as an absolute element. Whitespace exists only as caret-edge and ownership
geometry. This inflates DOM and makes native text selection harder.

## Required work

### 1. Freeze a baseline

On the comprehensive Word fixture and a reproducible large styled-text fixture,
record:

- pages, wrapping, and visible text;
- layout text items, glyph runs, text elements, and total DOM nodes;
- initial paint, selection-only update, one-character edit, scroll, and retained
  memory measurements;
- React commit counts and whether selection-only frames recreate page content;
- fixture hash, runtime/browser, hardware, warm/cold state, and repetitions.

Do not invent latency thresholds. Retain raw results and compare equivalent runs.

### 2. Separate wrap tokens from paint runs

Adapt the retired measured-line and line-clipped-run pattern:

- word tokens continue to determine wrapping;
- paint slices are reconstructed from authored or resolved run boundaries clipped
  to each visual line;
- spaces and tabs remain real semantic text in the paint projection;
- each line/style slice carries final engine geometry and stable semantic range;
- caret edges and shaped clusters remain the interaction authority.

The target is one text element per line/style run, not one per word. Do not merge
across different style, block/story identity, line/fragment identity, bidi
direction, clipping, transform, z-order, synthetic/repeated content, or opaque
shaping boundaries.

#### Whitespace interaction policy

The retired editor's whitespace behavior is the interaction oracle: whitespace is
real text inside a line-clipped run, atomic/image targets resolve before text,
and a point within that text resolves to the corresponding character offset. The
greenfield implementation MUST preserve that behavior without making browser
DOM Range geometry authoritative.

Once whitespace is painted inside a grouped text item:

- its semantic range MUST include the whitespace;
- shaped clusters and caret edges MUST cover its exact grapheme range and
  geometry;
- normal text hit testing MUST resolve those clusters;
- atomic and floating objects MUST resolve before underlying text;
- `lineWhitespace` ownership MUST remain only as a fail-closed fallback where no
  painted text cluster represents the whitespace.

Do not introduce a global whitespace priority or unbounded `zOrder` constant.
Painted whitespace MUST NOT have both a normal text-cluster authority and a
competing ownership-region authority. A separate resolution tier is permitted
only if adversarial tests prove cluster resolution insufficient, and it MUST
preserve visual stacking so an overlapping image or higher paint layer still
wins.

### 3. Keep paint and interaction contracts distinct

Grouping MAY introduce a framework-neutral paint projection, but MUST NOT weaken
the interaction frame. Preserve:

- semantic UTF-16 and grapheme ranges;
- complete shaped-cluster and caret-edge geometry;
- line/fragment identities and affinities;
- whitespace hit regions;
- read-only ownership and partial-editability boundaries;
- synthetic-item exclusion;
- stale-frame, clip, transform, bidi, and unsupported-shaping refusal.

Tests and helpers MUST address stable semantic identity rather than assume raw
item or run indices survive grouping.

### 4. Stop overlay updates rebuilding static page content

Split adapter rendering into:

- static page content keyed by layout revision and a bounded page fingerprint;
- caret, selection, and composition overlays keyed by interaction frame.

A selection-only frame MUST preserve unchanged page-content DOM identity. React
and Vue MUST consume the same grouping and fingerprint policy.

### 5. Evaluate retired virtualization separately

After grouping and static-page memoization pass, evaluate the retired lightweight
page-shell and intersection-observer design. Record whether to adapt it to
current page windows and interaction frames. Do not copy thresholds or buffers
without evidence. Unmounting page paint MUST NOT erase semantic selection,
accessibility order, or navigation state.

### 6. Complete basic text-formatting support

Run grouping MUST NOT be completed against a reduced bold/italic-only style
model. The engine SHALL parse, represent, measure, group, paint, expose for
mutation, preserve through unrelated edits, serialize, save, and reopen all
basic character formatting exercised by the comprehensive Word fixture:

- bold, italic, and combined formatting;
- underline variants and underline color;
- single and double strikethrough;
- superscript, subscript, and authored baseline position;
- font family and font size;
- text color, highlight, character shading, and paragraph shading;
- all caps and small caps;
- letter spacing, horizontal scaling, and kerning;
- text outline, shadow, emboss, imprint, and emphasis marks;
- Unicode punctuation, symbols, non-breaking characters, and authored
  whitespace.

Formatting combinations MUST remain attached to the correct semantic ranges
when a run crosses a word, line, or page boundary. Adjacent runs MUST NOT lose,
inherit, or merge formatting accidentally. Grouping MAY combine paint elements
only when every paint-affecting property is equivalent.

The engine mutation surface MUST apply and remove each supported property
without exposing ProseMirror types. Toolbar coverage is a separate concern:
disabled controls MAY remain disabled, but the engine capability and tests MUST
exist. Unsupported or invalid values MUST produce typed diagnostics rather than
being silently dropped or normalized to an unrelated style.

### 7. Make the edit pipeline incrementally ProseMirror-like

Run grouping MUST be paired with an incremental edit pipeline; reducing DOM
nodes while rebuilding and republishing complete derived interaction state on
every keystroke does not satisfy this goal.

The frozen post-grouping profile changes the priority. On the 24-page large
styled-text fixture, five insertions measured a 541.8 ms median downstream of
the store transaction: store apply 0.3 ms, `layoutBody` 30.9 ms,
`toDisplayPages` 237.2 ms, and `publishLayout` 296.6 ms. The bridge/publication
path therefore accounts for about 95% of observed work. The frame contains only
1,377 display items but approximately 105,658 shaped clusters, 106,535
navigation edges, 106,907 caret stops, and 11,391 ownership regions.

These stage medians were measured independently and need not add exactly to the
end-to-end median. Subsequent evidence MUST document timing boundaries and MUST
NOT sum overlapping freeze measurements. The conclusion to optimize first is
still binding: per-grapheme derived-state rebuild and clone/freeze publication,
not the store, layout, React commit, or retained DOM.

ProseMirror SHALL continue to own input interpretation, commands, composition,
selection, transaction steps, `StepMap`, and local editor history. It MUST NOT
become the canonical document or layout input. `StepMap` MAY identify changed
ranges at the binding boundary, but those ranges MUST be converted into stable
model block/story identities before entering the engine.

The production edit path SHALL be:

`PM transaction → binding DocOps → structurally shared store commit → precise
ModelChange dirty identities → incremental derived state → dirty paragraph
shape/layout → pagination from first dirty block until cached output converges →
changed-page publication → retained adapter DOM`.

Implement and prove:

- store commits preserve unchanged model object identity and do not clone or
  freeze the complete package;
- `ModelChange` reports exact dirty block, story, style, numbering, theme, font,
  and resource dependencies needed by downstream invalidation;
- display items, shaped clusters, ownership regions, navigation geometry, caret
  stops, resolved styles, shaping, measurement, line layout, and semantic-index
  chunks are cached per stable block/line/page identity plus complete input and
  environment fingerprints;
- `toDisplayPages` consumes `ModelChange` invalidation and recomposes changed
  chunks instead of rebuilding all document geometry;
- cluster, navigation-edge, and caret-stop consumers share one immutable
  per-line boundary/geometry representation, or an equivalently compact
  representation, instead of cloning three object graphs for every grapheme;
- frame publication shallowly assembles already immutable chunks and freezes
  only newly created subtrees; it MUST NOT clone then recursively freeze every
  unchanged page, item, run, cluster, stop, edge, and ownership region;
- a paragraph edit invalidates only dependent paragraphs and restarts
  pagination at the first affected block;
- pagination stops when page boundaries and dependency fingerprints converge
  with cached pages;
- unchanged blocks, lines, pages, display items, cluster/edge chunks,
  semantic-index chunks, and DOM nodes retain identity;
- display publication expresses changed page additions, replacements, and
  removals rather than rebuilding the complete page array;
- one user action produces one store commit and one bounded/coalesced layout
  publication;
- full-document load MAY construct all geometry once, but edits MUST reuse
  unaffected chunks; detailed geometry for distant pages SHOULD be materialized
  on demand when this does not break accessibility or navigation;
- ProseMirror input and selection update immediately while expensive derived
  work runs bounded, with the previous complete interaction frame remaining
  authoritative until the replacement frame publishes atomically.

Before optimization, instrument separate timings and work counts for PM
transaction, binding mapping, store application, dependency invalidation, style
resolution, shaping, paragraph layout, pagination, display conversion, semantic
indexing, frame freezing/publication, and adapter commit. Do not attribute time
to a stage without measurements.

## Forbidden ports

Do not port:

- ProseMirror as canonical document or layout input;
- ProseMirror document conversion as the production model pipeline;
- DOM Range or painted DOM as canonical hit-test or caret geometry;
- direct adapter dispatch or ProseMirror position ownership;
- retired flow, pagination, or painter package boundaries;
- framework state/hooks as layout orchestration;
- hidden-editor layout behavior that can disturb the current input host.

The document store remains canonical, the binding owns ProseMirror mapping, and
the display list plus interaction frame remain engine-owned.

## Correctness gates

Before completion, prove:

- identical wrapping, page count, visible text, and authored styling;
- spaces, repeated spaces, tabs, leading/trailing whitespace, empty paragraphs,
  and line breaks remain represented;
- mixed formatting, ligatures, combining marks, emoji, CJK, RTL/bidi, and run
  splits preserve semantic positions and caret stops;
- every basic character-formatting property above passes
  load → model → layout → paint and edit → save → reopen tests;
- mixed-format ranges preserve exact text, spaces, run boundaries, and
  combinations across wrapping and pagination;
- selection across spaces and run boundaries remains gap-free;
- single/double/triple click on painted whitespace resolves its exact semantic
  range through text clusters, while overlapping atomic content wins;
- pointer hit testing, double/triple click, drag selection, keyboard navigation,
  IME, clipboard, undo/redo, partial read-only boundaries, save, and reopen pass;
- repeated headers and synthetic content remain non-selectable where declared;
- clip and transform conflicts continue to fail closed;
- React and Vue paint equivalent output;
- text elements scale with visual line/style runs rather than word count;
- selection-only changes do not recreate unchanged page-content DOM;
- a one-character edit on the large fixture does not traverse, reshape, lay out,
  index, freeze, publish, or reconcile every unaffected block and page;
- instrumentation records exact dirty/reused block, line, page, display-item,
  cluster/edge, semantic-index, and DOM counts for each benchmarked edit;
- unchanged model and projection objects retain identity, and pagination stops
  at demonstrated convergence rather than document end;
- `toDisplayPages` and `publishLayout` work scale with changed chunks rather
  than the approximately 320,000 full-document derived objects;
- on the same machine/browser/harness and fixture, the five-sample median
  downstream edit time improves by at least 4× from the recorded 541.8 ms
  baseline, with bridge and publication timings reported separately;
- synchronous input/store work remains bounded independently of total document
  size, with expensive layout never blocking ProseMirror input handling;
- strict OpenSpec, typecheck, adapter authority/CSS, accessibility, and paired
  interaction gates remain green.

## Feature-support analysis

Do not implement every Word feature in this task. Produce a task-ready migration
map from retired behavior to current capability seams for:

1. fields and PAGE/NUMPAGES substitution;
2. comments and tracked-change run metadata;
3. inline images, paste/drop, selection, and resize;
4. table cell content, shared grid geometry, row pagination, and cell selection;
5. headers/footers as separate stories;
6. SDT identity overlays and typed widgets;
7. TOC stale detection, regeneration, and post-pagination page-number resolution.

For each lane identify the relevant retired components and algorithms, current
destination contracts, required model/operation/binding/layout/display/
interaction/serializer work, hostile-input checks, fixtures, and a real-browser
edit → save → reopen gate. Rank dependencies and identify lanes that can safely
run in parallel without sharing hot files.

## Completion

The task is complete only when grouping and static-page reuse are implemented
and measured, all correctness gates pass, and the feature migration map is
specific enough for separate agents to implement independent vertical slices.
An archaeology report without implementation, a lower node count without
selection/save proof, or copying retired authority does not satisfy the goal.
