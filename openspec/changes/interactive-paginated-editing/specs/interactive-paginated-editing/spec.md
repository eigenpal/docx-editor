## ADDED Requirements

### Requirement: One normal interactive paginated surface
The normal React and Vue editor SHALL present one engine-painted paginated
document surface on which supported content is directly editable. A visible
ProseMirror pane beside a paginated preview SHALL be diagnostic-only and SHALL
NOT satisfy interactive paginated editing conformance.

#### Scenario: User edits on a rendered page
- **WHEN** a user clicks a rendered text position and types through a public adapter
- **THEN** the visible caret SHALL move to that semantic position, the canonical store SHALL receive the resulting semantic operation, and the same paginated surface SHALL publish the committed text

#### Scenario: Normal editor starts
- **WHEN** either public adapter creates an editor without a diagnostic option
- **THEN** it SHALL render the paginated interaction surface and SHALL NOT render a separate visible ProseMirror editing pane

### Requirement: Canonical and geometry authority separation
The authored model SHALL remain the only canonical document state, ProseMirror
SHALL remain an editing projection behind `EditorBinding`, and engine layout
SHALL remain the only authority for visible page, line, glyph, object, caret,
selection, and hit-test geometry. Adapters and output backends MUST NOT derive
document geometry from browser layout or hidden ProseMirror DOM.

#### Scenario: Browser geometry differs from engine geometry
- **WHEN** browser CSS or hidden ProseMirror layout would place content differently from the engine display list
- **THEN** visible paint, hit testing, caret placement, selection overlays, PDF, and print SHALL use engine geometry

#### Scenario: Adapter processes a pointer event
- **WHEN** an adapter receives a pointer coordinate over the document
- **THEN** it SHALL forward host-space input through the public editor contract and SHALL NOT inspect ProseMirror positions or infer a document offset from DOM text

### Requirement: Coherent interaction frame
The editor SHALL publish visible display data, page geometry, semantic position
indexes, current selection, caret geometry, and selection geometry as one
revision-tagged interaction frame. Every geometry result SHALL identify the
frame and model/layout revisions from which it was derived. The editor MUST NOT
expose a mixture of display and interaction geometry from incompatible
revisions.

#### Scenario: Model edit triggers asynchronous layout
- **WHEN** a model edit commits and replacement layout is not yet complete
- **THEN** the last complete interaction frame SHALL remain coherent and visible until a complete replacement frame is atomically published

#### Scenario: Selection moves without model change
- **WHEN** the selection changes over an unchanged layout revision
- **THEN** the editor MAY publish a new interaction frame reusing that layout revision, but its selection and overlay geometry SHALL be internally consistent

#### Scenario: Adapter reads display and caret
- **WHEN** an adapter paints pages and a caret
- **THEN** it SHALL be able to prove that both values belong to the same interaction frame

### Requirement: Model-derived semantic position index
Layout SHALL emit a model-derived semantic position index for every editable or
selectable scope. Positions SHALL retain story/scope identity, stable semantic
identity, text/grapheme offset or atomic target, and affinity without depending
on incidental display-item order. Empty paragraphs, trailing positions,
whitespace, tabs, bidi runs, ligatures, structural boundaries, and fragmented
content SHALL have explicit position semantics.

#### Scenario: Empty paragraph is clicked
- **WHEN** the user clicks inside the layout area owned by an empty editable paragraph
- **THEN** hit testing SHALL return its valid semantic caret position and caret geometry

#### Scenario: Ligature or bidi run is clicked
- **WHEN** a pointer lands within a shaped cluster or bidi run
- **THEN** the target SHALL resolve to a valid grapheme boundary and affinity using the engine cluster map rather than a glyph-count approximation

#### Scenario: Display items are reordered for paint
- **WHEN** z-order or display-item batching changes without a semantic document change
- **THEN** equivalent coordinates SHALL continue to resolve through stable semantic identities rather than accumulated text-item lengths

### Requirement: Transform-aware hit testing and hit ownership
Hit testing SHALL convert client coordinates through scroll, zoom, page,
writing-mode, clipping, and item-transform data; test eligible items in visual
z-order; and return a typed semantic interaction target. Each target SHALL
declare hit ownership and an interaction role such as editable text,
selectable/read-only text, atomic object, control, annotation, or background.
Non-invertible transforms and pointer-transparent decoration MUST NOT produce
invented text targets.

#### Scenario: Overlapping transformed objects are clicked
- **WHEN** multiple transformed display items overlap at a client coordinate
- **THEN** the topmost unclipped hit-owning item SHALL receive the hit according to engine z-order and inverse transforms

#### Scenario: Page gap is clicked
- **WHEN** a user clicks outside any capability-owned hit region in a page margin or inter-page gap
- **THEN** the editor SHALL return no target and SHALL NOT move the selection

#### Scenario: Read-only object is clicked
- **WHEN** a visible object declares selectable atomic ownership but no editing capability
- **THEN** the editor SHALL create the declared object selection or activation target and SHALL NOT create an editable text caret inside it

### Requirement: Engine-derived caret and selection geometry
The editor SHALL derive collapsed-caret geometry and visible selection
rectangles from the current interaction frame. It SHALL support text, node,
table-cell, control, story, and annotation selection shapes as their
capabilities land. Overlay geometry SHALL include page identity, clipping,
writing direction, and transforms and SHALL NOT become independent selection
state.

#### Scenario: Selection spans lines and pages
- **WHEN** a semantic text selection spans multiple lines or pages
- **THEN** the editor SHALL return ordered, clipped visible rectangles for mounted pages while retaining the complete semantic range

#### Scenario: Caret is at a trailing or empty position
- **WHEN** the current selection is collapsed after the last grapheme or in an empty paragraph
- **THEN** the editor SHALL provide a deterministic caret rectangle with the correct writing direction

#### Scenario: Layout changes around an anchored selection
- **WHEN** remote or local edits repaginate content around an edit-surviving selection
- **THEN** the semantic anchor SHALL resolve against the new model and the next interaction frame SHALL repaint the caret or range at its new engine geometry

### Requirement: Pointer selection semantics
The shared interaction controller SHALL implement single-click caret placement,
shift-click extension, pointer-drag range selection with capture and
autoscroll, Unicode-aware double-click word selection, and capability-owned
triple-click block selection. React and Vue SHALL delegate these semantics to
the shared controller.

#### Scenario: User drags across a page boundary
- **WHEN** a pointer drag leaves one page and enters the next while selection capture is active
- **THEN** the semantic range SHALL extend continuously across the boundary and visible overlays SHALL update without adapter-specific position logic

#### Scenario: User drags beyond the viewport
- **WHEN** selection drag remains near a scroll edge
- **THEN** bounded autoscroll SHALL request destination pages, preserve capture, and extend the semantic selection as those pages become interactive

#### Scenario: User double-clicks Unicode text
- **WHEN** a user double-clicks within text containing non-ASCII scripts or combining characters
- **THEN** the selected range SHALL follow the engine's declared Unicode word-boundary policy without splitting a grapheme cluster

### Requirement: Engine-aware keyboard navigation
Horizontal navigation SHALL honor logical text order, grapheme boundaries,
affinity, and bidi behavior. Vertical, line-edge, and page navigation SHALL use
engine line/page geometry and a retained visual advance where applicable,
rather than hidden DOM line boxes. Navigation SHALL respect editable scope and
read-only boundaries.

#### Scenario: User presses vertical arrow through wrapped lines
- **WHEN** a collapsed selection moves vertically through lines with different shaping or indentation
- **THEN** the next semantic caret SHALL be chosen from engine line geometry using the retained visual advance

#### Scenario: User navigates across pages
- **WHEN** a keyboard command moves the caret to an unmounted page
- **THEN** the editor SHALL request the required page window, preserve focus, and complete navigation only against a coherent interaction frame

#### Scenario: Navigation reaches read-only content
- **WHEN** keyboard movement reaches a capability-declared read-only boundary
- **THEN** it SHALL select or skip that content according to its declared interaction role and SHALL NOT create an invalid editable position

### Requirement: Native input, focus, clipboard, and composition routing
The editor SHALL route focus, keyboard, `beforeinput`, clipboard, drag/drop,
and composition events through an attached ProseMirror input host and
`EditorBinding`. The host MUST NOT be `display:none` or detached while active,
MUST NOT create duplicate visible or assistive document content, and SHALL
remain an implementation detail outside public adapter contracts.

#### Scenario: Rendered text receives focus
- **WHEN** a user clicks an editable rendered position
- **THEN** the editor SHALL synchronize the ProseMirror selection, focus the native input host, and preserve the visible engine caret at the same semantic position

#### Scenario: User pastes content
- **WHEN** a paste event is accepted at the visible caret
- **THEN** existing bounded clipboard parsing and semantic transaction validation SHALL run before canonical mutation and visible repaint

#### Scenario: Editor loses focus
- **WHEN** focus moves outside the editor without an owned popup retaining interaction
- **THEN** focus state and caret presentation SHALL update without discarding the semantic selection

### Requirement: IME and grapheme-safe composition
Composition SHALL remain one uninterrupted native edit session across page
painting and layout scheduling. The input host SHALL remain positioned or
otherwise configured so supported browser/platform input UI is associated with
the visible caret. Composition MUST NOT duplicate, drop, prematurely commit, or
split text and MUST preserve surrogate pairs and grapheme clusters.

#### Scenario: IME composition updates repeatedly
- **WHEN** composition start, multiple updates, and composition end occur at a rendered caret
- **THEN** the canonical model SHALL receive exactly the committed result, the visible surface SHALL show no duplicate text, and undo grouping SHALL follow the binding composition contract

#### Scenario: Layout is invalidated during composition
- **WHEN** local or remote changes require layout while composition is active
- **THEN** the editor SHALL preserve the composition anchor or cancel with a typed safe outcome and SHALL NOT silently commit at a different semantic position

#### Scenario: Composition crosses a capability boundary
- **WHEN** a composition would edit outside the current capability-owned editable region
- **THEN** it SHALL be rejected or safely truncated according to the declared binding policy before unsupported canonical mutation

### Requirement: Bounded asynchronous layout and paint
The synchronous input path SHALL be limited to native-event processing,
ProseMirror transaction handling, semantic validation/staging/publication,
selection capture, and derived-work scheduling. Full pagination, nonessential
shaping, paint, and downstream page work MUST NOT run synchronously on every
keystroke. Derived work SHALL be cancellable, prioritize the active viewport,
and converge under the owning layout specification.

#### Scenario: User types during expensive downstream pagination
- **WHEN** an accepted edit invalidates many later pages
- **THEN** the active viewport SHALL be prioritized, stale derived work SHALL be cancellable, and canonical input SHALL not wait for complete downstream pagination

#### Scenario: A newer revision supersedes layout work
- **WHEN** layout for an older model revision is still running after a newer revision commits
- **THEN** obsolete work SHALL not publish over the newer revision and cancellation SHALL not roll back either committed edit

### Requirement: Viewport page virtualization
The editor SHALL support viewport-scoped page mounting with bounded overscan and
exact geometry placeholders for unmounted pages. The active caret/composition
page, pointer-captured destination, focused interaction, and required visible
selection pages SHALL remain or become mounted. Virtualization SHALL NOT alter
semantic state, pagination, hit-test results, save output, or adapter parity.

#### Scenario: User scrolls through a large document
- **WHEN** the viewport moves through a 300–500-page representative document
- **THEN** mounted pages and DOM nodes SHALL remain bounded by the ratified window/overscan policy while scroll extent and page positions remain correct

#### Scenario: Selection includes unmounted pages
- **WHEN** a semantic selection extends beyond the mounted page window
- **THEN** the complete range SHALL remain selected and overlays SHALL appear correctly when its pages mount

#### Scenario: Earlier page heights change
- **WHEN** relayout changes page geometry before the viewport
- **THEN** scroll anchoring SHALL preserve the configured page identity and content-space offset unless the anchor no longer resolves

### Requirement: Stale-frame and derived-work failure safety
Pointer and geometry requests SHALL be bound to an interaction frame. If a
target cannot be safely rebased to current canonical state, the editor SHALL
return a typed stale, pending, read-only, or invalid-target result without
mutating state. Layout or paint failure SHALL retain the last coherent frame,
emit a bounded diagnostic, and never corrupt canonical content.

#### Scenario: User clicks while a newer model revision is pending
- **WHEN** a click targets the last published frame after its semantic target was deleted
- **THEN** the editor SHALL reject or retry the interaction against a new frame and SHALL NOT place the caret by stale numeric offset

#### Scenario: Visible-page layout fails
- **WHEN** scheduled layout fails for a new revision
- **THEN** the last coherent frame SHALL remain visible, the failure SHALL be observable through a typed diagnostic, and the committed model SHALL remain intact

### Requirement: Capability-declared editability and safe fallback
Every feature SHALL declare rendering, hit ownership, selection, generic
fallback editing, typed editing, save/reopen, and paired-adapter support
independently. Generic fallback editing SHALL be enabled only after the
capability proves exact ownership, accepted step/operation mapping, reverse
reconciliation, boundary rejection, preservation of unowned content,
interaction geometry, and deterministic save/reopen. Unsupported intent MUST
be rejected before canonical publication.

#### Scenario: Feature has rendering but no interaction proof
- **WHEN** a document contains a rendered feature without declared editing support
- **THEN** it SHALL remain visible and read-only/selectable according to policy and SHALL NOT expose a generic editable caret

#### Scenario: Feature qualifies for fallback editing
- **WHEN** a capability's fallback proof passes for its owned text region
- **THEN** the surface MAY expose generic text editing only within that region and SHALL preserve every unowned sibling, child, attribute, relationship, and preservation capsule on save/reopen

#### Scenario: Fallback edit crosses an owned boundary
- **WHEN** a ProseMirror step or native intent would cross from an owned fallback region into unsupported content
- **THEN** the binding SHALL reject it before store mutation and restore a valid projection/selection without using serialization failure as rollback

### Requirement: Incremental feature interaction lanes
The system SHALL deliver paragraphs, tables, images, controls, hyperlinks,
headers/footers, annotations, and later OOXML features one interaction
capability lane at a time. A feature's landed status SHALL identify which
commands, selections, handles, stories, fallbacks, and round-trip cases are
supported rather than implying full Word behavior.

#### Scenario: Table interaction lands before image editing
- **WHEN** table cell selection and typed table operations pass their interaction and round-trip gates while image editing has not
- **THEN** tables MAY be declared interactive for the proven matrix and images SHALL retain their independently declared read-only or selectable behavior

#### Scenario: Atomic image selection lands
- **WHEN** image hit ownership, node selection, keyboard navigation, delete/replace semantics, geometry, and save/reopen pass
- **THEN** the image capability MAY advertise only those proven interactions without implying unsupported resize, crop, wrap, anchor, or effect behavior

### Requirement: Paired public-adapter conformance
React and Vue SHALL expose identical document interaction behavior through the
PM-free public editor contract. One engine-neutral `EditorDriver` suite SHALL
exercise public package entries and SHALL NOT access `EditorView`, ProseMirror
positions, private engine modules, or example-only controls.

#### Scenario: Identical fixture runs in both adapters
- **WHEN** the conformance driver performs the same coordinate click, typed edit, selection, formatting command, undo/redo, save, and reopen sequence in React and Vue
- **THEN** both SHALL produce equivalent semantic selections, authored-state hashes, interaction geometry within declared tolerance, and saved package results

#### Scenario: Adapter CSS differs
- **WHEN** host application or framework CSS differs around the editor
- **THEN** document geometry and interaction targets SHALL remain engine-defined and equivalent

### Requirement: Single coherent accessibility projection
The editor SHALL expose one coherent semantic document and focus model to
assistive technology. Hidden ProseMirror content and painted/accessibility DOM
MUST NOT appear as duplicate documents. Accessibility focus and actions SHALL
map to the same semantic positions, selections, and commands as pointer and
keyboard interaction.

#### Scenario: Assistive technology traverses rendered paragraphs
- **WHEN** accessibility traversal enters the editor
- **THEN** it SHALL encounter document content once, in semantic reading order, with current selection and editability exposed consistently

#### Scenario: Virtualized page is not mounted
- **WHEN** accessibility focus requests content outside the mounted page window
- **THEN** the editor SHALL materialize the required semantic/page window or provide an equivalent bounded semantic projection without losing focus identity

### Requirement: Interaction and WYSIWYG claims are separate
The support manifest SHALL distinguish rendered, interactive-read-only,
fallback-editable, typed-editable, interactive-paginated, and feature-WYSIWYG
states. `interactive-paginated` SHALL require direct page interaction and
save/reopen through both public adapters. `feature-WYSIWYG` SHALL additionally
require authored-state, style, shaping, pagination, display,
semantic/accessibility, interaction, DOCX round-trip, and relevant output
comparators for the declared feature matrix.

#### Scenario: Paginated repaint works without direct interaction
- **WHEN** canonical edits repaint a separate paginated preview but pointer, caret, selection, and IME do not operate on that preview
- **THEN** the feature SHALL be reported as paginated preview repaint only and SHALL NOT be reported as interactive-paginated or WYSIWYG

#### Scenario: One feature passes full evidence
- **WHEN** a declared feature matrix passes every feature-WYSIWYG comparator
- **THEN** only that matrix MAY be reported as feature-WYSIWYG and no whole-product claim SHALL be inferred

### Requirement: Large-document editing-window decision gate
The initial implementation SHALL use a complete hidden ProseMirror projection.
The engine SHALL measure projection size, mounted ProseMirror DOM, retained
memory, input latency, reconciliation work, page-window work, and frame latency
on the representative 300–500-page corpus. A bounded mounted ProseMirror window
MAY replace it only if budgets require the change and equivalent interaction,
composition, history, anchor, clipboard, and conformance behavior is proven.

#### Scenario: Complete projection meets ratified budgets
- **WHEN** the representative corpus passes all ratified limits with the complete hidden projection
- **THEN** the implementation SHALL retain the simpler complete projection unless new measured evidence justifies change

#### Scenario: Complete projection exceeds a ratified budget
- **WHEN** a reproducible benchmark exceeds a ratified limit attributable to mounted ProseMirror state or DOM
- **THEN** a bounded-window implementation MAY proceed but SHALL NOT ship until it passes the same public interaction and round-trip suite

### Requirement: Diagnostic split mode is not completion evidence
The normal editor SHALL exclude the split edit/preview composition. An optional
split composition MAY remain for engine diagnostics while this capability is
implemented; it SHALL be explicitly enabled and SHALL NOT count toward any
interaction, parity, accessibility, performance, or WYSIWYG acceptance gate.

#### Scenario: Developer opens diagnostic mode
- **WHEN** an explicit diagnostic option enables a visible ProseMirror projection beside engine output
- **THEN** the UI SHALL identify it as diagnostic and conformance SHALL continue to run against the one-surface public adapter
