## ADDED Requirements

### Requirement: Public namespace is exclusively DocxEditor
The public object model SHALL be declared only as `DocxEditor.*`. Core and its
adapters MUST NOT expose a branded compatibility namespace or alias.

#### Scenario: Public declarations are inspected
- **WHEN** generated API declarations and package exports are enumerated
- **THEN** every object-model type and value MUST resolve through `DocxEditor.*` and no alternate namespace MUST exist

### Requirement: Batched request contexts and lazy proxies
`DocxEditor.run` SHALL create a revision-aware `DocxEditor.RequestContext`.
Proxy reads MUST be declared with `load` and materialized by `sync`; proxy writes
MUST queue as semantic operations and commit atomically on `sync`. Tracked
objects MUST have explicit lifetime beyond a run scope.

#### Scenario: Load and write in one context
- **WHEN** a caller loads body text, queues multiple inserts, and calls `sync`
- **THEN** one atomic store transaction MUST commit the writes and the loaded value MUST reflect the resulting revision

### Requirement: Proxies, collections, results, and insertion semantics
The base namespace SHALL provide document, body, range, paragraph, table, row,
cell, section, header, footer, image, and content-control proxies. Installed
annotation capabilities SHALL augment the same `DocxEditor.*` namespace with
comment, tracked-change, and citation proxies. The complete supported
distribution MUST provide all listed capabilities, with lazy collections and item accessors;
`DocxEditor.ClientResult<T>` values; and `DocxEditor.InsertLocation` semantics for before, after,
start, end, and replace where valid.

#### Scenario: Invalid insertion location
- **WHEN** a caller uses an insertion location unsupported by the target proxy
- **THEN** `sync` MUST return `invalidArgs` without partially mutating the document

### Requirement: One semantic path for all public surfaces
The engine MUST expose `DocxEditor.parse` and `DocxEditor.create` through the
shared lifecycle/schema/result layer, and route `DocxEditor.applyEdits`,
`DocxEditor.query`, agent/MCP commands, object-model writes, and browser editor
commands through the same command/query, target, validation, normalization, and
result registries. All writes MUST become `DocOp`s. Parse/create seed and
normalize a store and MUST NOT be misrepresented as edit operations.

#### Scenario: Equivalent commands from two surfaces
- **WHEN** an agent JSON command and an object-model method express the same replacement against the same revision
- **THEN** they MUST produce equivalent operations, authored state, revision, result, and model change

### Requirement: EditorHost and EditorBinding have separate roles
`DocxEditor.createEditor` SHALL compose semantic store, layout, binding, and an
`EditorHost`. `EditorHost` SHALL provide adapter/runtime lifecycle, current host
surface getters, scheduling, events, and available runtime ports.
`EditorBinding` alone MUST map ProseMirror state and transactions.

#### Scenario: Host surface is mounted late
- **WHEN** `DocxEditor.createEditor` runs before a host surface exists and the host getter later returns it
- **THEN** the editor MUST attach and paint without recreation, while no ProseMirror type leaks into the host contract

### Requirement: Scope identifies body and related stories
Editor commands and queries SHALL accept body, a specific header/footer or other
story, active story, and read-only aggregate scopes where applicable. A write
MUST NOT silently fall back to body when another story is active.

#### Scenario: Header is active
- **WHEN** a formatting command omits scope while a header is active
- **THEN** the command MUST target that header story

### Requirement: Feature operations are complete and lock-aware
The common command/query vocabulary SHALL support search, text and formatting,
sections, tables, headers/footers, images and relationships, content controls
and locking, comments, tracked changes with explicit authorship, citations, and
selective DOCX/PDF export. Locked or bound controls MUST reject prohibited
operations without partial change.

#### Scenario: Search and replace crosses stories
- **WHEN** a query searches an aggregate scope and a replacement targets selected results
- **THEN** each result MUST use an external target, ambiguous or stale results MUST fail explicitly, and allowed replacements MUST obey story and lock boundaries

### Requirement: Runtime schemas accompany commands and queries
Every command, query, target, result, and error exposed to automation SHALL have
a versioned JSON Schema generated from the same registry as its runtime
validator. Extensions MUST register schemas with their handlers.

#### Scenario: MCP tools are enumerated
- **WHEN** a tool host requests available commands and queries
- **THEN** it MUST receive schemas matching the in-process API without a separately maintained wrapper

### Requirement: Result and error taxonomy is explicit
Writes SHALL distinguish applied change, successful no-op, not found,
ambiguous, locked, bound, type mismatch, kind mismatch, out of bounds,
unsupported, invalid arguments, stale revision, failed precondition, resource
limit, unauthorized, conflict, aborted, property not loaded, invalid object
path, invalid anchor, and internal failure. Transport/protocol envelope failures
MUST use typed exceptions outside this result taxonomy. A bare boolean MUST NOT
represent execution outcome.

#### Scenario: Already-applied formatting
- **WHEN** a valid operation sets a property to its current authored value
- **THEN** the result MUST report success with `changed: false`

### Requirement: Public entries have declared stability
Document, editor, plugin, automation-schema, and type entries SHALL be stable and
semver governed. Experimental geometry, if temporarily exposed, MUST be
explicitly semver-exempt and have a retirement milestone. Consumers MUST resolve
declared exports without source aliases.

#### Scenario: Undeclared subpath is imported
- **WHEN** a consumer imports an unlisted package subpath
- **THEN** resolution MUST fail instead of reaching workspace source through an alias

### Requirement: Public proxy IDL is normative
The schema-first IDL MUST declare `DocxEditor.run`,
`DocxEditor.RequestContext`, `DocxEditor.ClientObject`,
`DocxEditor.ClientCollection<T>`, `DocxEditor.ClientResult<T>`,
`DocxEditor.InsertLocation`, document/body/range/paragraph/table/row/cell/
section/header/footer/image/content-control proxies, and extension-contributed
annotation proxies. Every method MUST declare arguments, return proxy/result,
loadable properties, valid insertion locations, scope, lock permission, emitted
command ID, and result/error variants. Generated TypeScript declarations MUST be
an output of this IDL, not the existing bare contract declarations.

The minimum normative IDL shape is:

```ts
declare namespace DocxEditor {
  function parse(bytes: Uint8Array, options?: ParseOptions): Promise<DocumentHandle>;
  function create(options?: CreateOptions): DocumentHandle;
  function run<T>(
    document: DocumentHandle,
    callback: (context: RequestContext) => Promise<T>,
  ): Promise<T>;
  function applyEdits(
    document: DocumentHandle,
    edits: readonly Command[],
    options?: BatchOptions,
  ): Promise<BatchResult>;
  function query<T extends Query>(
    document: DocumentHandle,
    query: T,
  ): Promise<Result<QueryResult<T>>>;
  function createEditor(options: CreateEditorOptions): Promise<Editor>;

  interface DocumentHandle {
    readonly isClosed: boolean;
    close(): Promise<void>;
    dispose(): Promise<void>;
  }
  interface RequestContext {
    readonly document: Document;
    readonly baseRevision: RevisionId;
    readonly trackedObjects: TrackedObjects;
    load(object: ClientObject, selectors: readonly string[]): void;
    sync(): Promise<SyncResult>;
    close(): Promise<void>;
  }
  interface ClientObject {
    readonly context: RequestContext;
    readonly objectPath: string;
    readonly isNullObject: boolean;
    load(selectors: string | readonly string[]): this;
  }
  interface ClientCollection<T extends ClientObject> extends ClientObject {
    readonly items: readonly T[];
    getFirst(): T;
    getItem(id: string): T;
    getItemOrNullObject(id: string): T;
  }
  interface ClientResult<T> { readonly value: T; }
  interface TrackedObjects {
    add(object: ClientObject | readonly ClientObject[]): void;
    remove(object: ClientObject | readonly ClientObject[]): void;
  }

  interface Document extends ClientObject {
    readonly body: Body;
    readonly sections: ClientCollection<Section>;
    getSelection(scope?: Scope): Range;
    search(text: string, options?: SearchOptions): ClientCollection<Range>;
    save(options?: SaveOptions): ClientResult<Uint8Array>;
    exportPdf(options?: PdfOptions): ClientResult<Uint8Array>;
  }
  interface Body extends ClientObject {
    readonly paragraphs: ClientCollection<Paragraph>;
    readonly tables: ClientCollection<Table>;
    getRange(): Range;
    insertParagraph(text: string, location: InsertLocation): Paragraph;
    insertTable(rows: number, columns: number, location: InsertLocation): Table;
  }
  interface Range extends ClientObject {
    readonly text: string;
    readonly font: Font;
    insertText(text: string, location: InsertLocation): Range;
    delete(): void;
    replace(text: string): Range;
  }
  interface Paragraph extends Range {
    readonly stableId: string;
    split(target: Target): Paragraph;
    joinNext(): Paragraph;
  }
  interface Table extends ClientObject {
    readonly rows: ClientCollection<TableRow>;
    insertRow(location: InsertLocation): TableRow;
    delete(): void;
  }
  interface TableRow extends ClientObject {
    readonly cells: ClientCollection<TableCell>;
    delete(): void;
  }
  interface TableCell extends ClientObject {
    readonly body: Body;
    merge(target: Target): TableCell;
    split(rows: number, columns: number): void;
  }
  interface Section extends ClientObject {
    readonly body: Body;
    getHeader(kind: RelatedStoryKind): Body;
    getFooter(kind: RelatedStoryKind): Body;
  }
  interface Editor {
    getCurrentPage(mode: "caret" | "viewport"): Promise<Result<PageInfo>>;
    relayout(options?: RelayoutOptions): Promise<void>;
    dispose(): void;
  }
  type InsertLocation = "before" | "after" | "start" | "end" | "replace";
}
```

#### Scenario: IDL and declarations are compared
- **WHEN** public declarations are generated
- **THEN** every durable function/type MUST be rooted at `DocxEditor.*` and each proxy method MUST map to one schema command ID

### Requirement: Proxy lifecycle and load semantics are exact
A proxy SHALL be valid only in its creating context unless tracked with
`context.trackedObjects.add`. Tracking permits reuse across syncs only while the
`RequestContext` and enclosing `DocxEditor.run` remain open. Run completion or
context close MUST invalidate every proxy; remove MUST invalidate the selected
proxy no later than the next sync.
Unloaded property access MUST throw a typed `propertyNotLoaded` API error.
`load` MUST accept generated property selectors, deduplicate requests, and reject
unknown properties before transport. Collections materialize `.items` only
after load/sync; `getItemOrNullObject` SHALL return a loaded null object whose
`isNullObject` is true, while strict accessors return `notFound`.

#### Scenario: Untracked proxy escapes run
- **WHEN** a proxy is used after its run callback without having been tracked
- **THEN** access MUST fail with `invalidObjectPath` and MUST NOT read current store state

#### Scenario: Tracked proxy reaches run completion
- **WHEN** a tracked proxy is retained after its `DocxEditor.run` callback completes
- **THEN** every later access MUST fail with `invalidObjectPath`

#### Scenario: Tracked proxy is untracked
- **WHEN** a tracked proxy is removed and the context completes its next sync
- **THEN** later use MUST fail and associated server-side object paths MUST be releasable

### Requirement: Sync load and mutation semantics are all or nothing
One `DocxEditor.RequestContext.sync()` MUST validate all loads and writes against
one base revision, evaluate all write failures positionally, commit all writes
or none, then materialize loads at an explicitly reported committed or unchanged
reconciled revision. Candidate post-write values MUST be discarded on failure.
Application, validation, conflict, authorization, and resource failures MUST
return `DocxEditor.Result`. A transport or protocol failure that prevents
receipt or validation of a result envelope MUST throw typed
`DocxEditor.TransportError` or `DocxEditor.ProtocolError`.

#### Scenario: Write fails while properties are loaded
- **WHEN** one queued write fails and the same sync requests loaded properties
- **THEN** no write commits, candidate values MUST be discarded, and loads MUST materialize from the result's explicit unchanged reconciled revision

### Requirement: Same-sync proxy dependencies use symbolic IDs
New proxies returned by queued inserts MUST use transaction-local symbolic IDs.
The context SHALL build a dependency graph, validate it topologically, stage
creation before dependent resolution, and execute in stable topological order.
Missing dependencies and cycles MUST return positional errors and abort the
whole sync; successful commit MUST replace symbolic IDs with stable IDs on the
same proxy objects.

#### Scenario: Insert then format before sync
- **WHEN** a queued paragraph insert returns a proxy and a later queued write formats that proxy before sync
- **THEN** the symbolic dependency MUST resolve in staging and both operations MUST commit atomically or both receive failing/aborted results

### Requirement: Insertion locations are method-specific
`DocxEditor.InsertLocation` MUST define `before`, `after`, `start`, `end`, and
`replace`; each IDL method MUST enumerate its accepted subset and boundary
semantics. Replace MUST preserve or mint identity according to the mapped
semantic operation, and invalid combinations MUST abort the full sync.

#### Scenario: Range replace is valid
- **WHEN** `DocxEditor.Range.insertText` uses `replace`
- **THEN** it MUST replace only the anchored range using the command's declared endpoint affinities

### Requirement: External target schema is versioned and Unicode-defined
`DocxEditor.Target` MUST be a versioned union for paragraph phrase, stable node,
container/story boundary, range endpoints, and document boundary. Variants MUST
carry document/story/container/stable IDs, affinity, optional base revision and
preconditions. Paragraph IDs MUST normalize ASCII hexadecimal letters
case-insensitively. Phrase text and authored text MUST normalize to Unicode NFC
and compare case-sensitive Unicode scalar sequences with authored whitespace
preserved. Range endpoints MUST use Unicode grapheme-boundary positions and
explicit affinity. Occurrence MUST be zero-based;
omitted occurrence requires uniqueness. No variant may use canonical block or
paragraph indices.

```ts
declare namespace DocxEditor {
  type Target =
    | { version: 1; kind: "paragraphPhrase"; documentId: string; storyId: string;
        paraId: string; phrase?: string; occurrence?: number;
        affinity?: "before" | "after"; baseRevision?: string; preconditions?: Preconditions }
    | { version: 1; kind: "node"; documentId: string; storyId: string;
        nodeId: string; affinity?: "before" | "after";
        baseRevision?: string; preconditions?: Preconditions }
    | { version: 1; kind: "boundary"; documentId: string; storyId: string;
        containerId: string; edge: "start" | "end";
        baseRevision?: string; preconditions?: Preconditions }
    | { version: 1; kind: "documentBoundary"; documentId: string;
        edge: "start" | "end"; baseRevision?: string; preconditions?: Preconditions }
    | { version: 1; kind: "range"; start: Endpoint; end: Endpoint;
        baseRevision?: string; preconditions?: Preconditions };
  type Endpoint = {
    target: Exclude<Target, { kind: "range" }>;
    grapheme: number;
    affinity: "before" | "after";
  };
  type Preconditions = {
    expectedKind?: string;
    expectedTextNfc?: string;
    expectedRevision?: string;
    expectedParentId?: string;
    mustExist?: boolean;
  };
}
```

#### Scenario: Unicode-equivalent phrases differ by policy
- **WHEN** phrase input and authored text differ only by Unicode normalization
- **THEN** resolution MUST follow the declared normalization mode identically in browser and RPC

### Requirement: Result envelope is versioned and safe
`DocxEditor.Result<T>` MUST be a versioned discriminated envelope containing
success/changed/value/revision/commit ID or stable error code, retryability,
redacted message, safe structured evidence, failing indices, and RPC status
mapping. Internal stacks, secrets, raw document text, and untrusted backend
messages MUST be redacted. Query, command, sync, MCP, and RPC results MUST use
the same envelope for application-level outcomes. Transport/protocol failures
that prevent receipt or validation of a valid envelope MUST throw typed
exceptions and MUST NOT be represented as invented results.

#### Scenario: Conflict crosses RPC
- **WHEN** compare-and-swap fails
- **THEN** the result MUST include retryable conflict code, expected/actual revision evidence, and no sensitive document content

### Requirement: Schema-first registry generates every surface
A single versioned schema/IDL source MUST generate `DocOp`, command/query IDs,
payloads, targets, results, TypeScript declarations, runtime validators, MCP
descriptors, and RPC schemas. Semantic core owns validation/dispatch; MCP and RPC
hosts own transport. Manual declaration merging MUST NOT be the source of
runtime schema truth.

#### Scenario: Extension adds a command
- **WHEN** an installed extension contributes a namespaced schema command
- **THEN** generated TypeScript augmentation, runtime validation, MCP descriptor, and RPC schema MUST share the same schema hash

### Requirement: Document and editor factories share one store
`DocxEditor.parse(bytes, options)` and `DocxEditor.create(options)` MUST return a
document/store handle. `DocxEditor.run(document, callback)` MUST open contexts on
that store. `DocxEditor.createEditor({ document, host })` MUST attach layout and
binding to the same store without copying canonical state; disposal MUST detach
projection/host resources without disposing an externally owned document.
`DocxEditor.DocumentHandle.close()` or `.dispose()` MUST invalidate all
contexts/proxies, detach internally owned editors, resolve pending persistence
by declared option, and release store resources. An editor MAY dispose a handle
only when it explicitly created and owns that handle.

#### Scenario: Headless document later receives an editor
- **WHEN** a server-created document handle is transferred to an authorized browser runtime and attached
- **THEN** the editor MUST project the same canonical store revision without reparse or duplicate state

### Requirement: Feature inventory and lock matrix are normative
The IDL MUST enumerate base commands/queries for create/open/save/export,
search, text/formatting, sections, tables, related stories, images/relationships,
controls, comments, tracked changes, citations, and navigation. A matrix MUST
define content-locked, control-locked, bound, nested, permission-restricted, and
read-only behavior for text, formatting, structural, annotation, accept/reject,
relationship, and aggregate replacement operations. Tracked-change commands
MUST require explicit author; no hidden global toggle may change untracked verbs.

The base inventory MUST include command IDs for text insert/delete/replace,
set/clear mark and paragraph property, split/join/move/replace content, section
insert/update, table/row/cell insert/delete/update/merge/split, related-story
create/link/unlink, image insert/replace/delete, relationship add/update/delete,
control insert/update/delete/lock/unlock, comment create/reply/resolve/delete,
tracked insert/delete/format/structure/accept/reject, citation
create/update/delete, and DOCX/PDF export. Query IDs MUST include document
metadata, search, text/range formatting, sections, tables, related stories,
images/relationships, controls/locks, comments, revisions, citations,
selection, page-by-caret, and page-by-viewport. Each ID MUST map in the IDL to
its exact `DocOp` family or read projection.

The normative matrix is:

- **content-locked**: read/search/navigation MAY run; text, formatting,
  structure, relationship, annotation, accept/reject, and replacement MUST
  return `locked`.
- **control-locked only**: edits inside existing content MAY run subject to
  permissions; deleting, moving, wrapping, unwrapping, replacing, or changing
  control identity/binding MUST return `locked`.
- **bound**: reads MAY run; writes declared by the binding profile MAY run;
  every other content or structure write MUST return `bound`.
- **nested controls**: the most restrictive applicable ancestor/descendant rule
  MUST win for every touched range; aggregate writes MUST validate all touched
  controls before staging.
- **permission-restricted**: only operations explicitly granted to the actor and
  range MAY run; others MUST return `unauthorized`.
- **read-only document/viewer**: all mutation categories and export unless
  separately granted MUST return `unauthorized`; reads MAY run.
- **tracked-change mode**: only explicit tracked verbs with author MAY create
  revisions; ordinary verbs MUST retain ordinary semantics.

#### Scenario: Nested lock blocks structural edit
- **WHEN** an unlocked range is inside a control whose structure is locked
- **THEN** text edits allowed by the matrix MAY proceed but structural replacement MUST return `locked` and abort the batch

### Requirement: EditorHost preserves two-phase scheduling and isolation
`EditorHost` MUST expose late-bound surface getters and `scheduleFrame` for
engine coalescing; optional `afterCommit` runs only after adapter render commit.
Omitting `afterCommit` MUST disable only post-commit work. No host method may
return a ProseMirror type or view. Relayout and caches MUST be editor-instance
scoped so two editors cannot invalidate one another.

#### Scenario: Several edits precede one frame
- **WHEN** multiple model changes arrive before the scheduled frame
- **THEN** the engine MUST coalesce layout once, wait for `afterCommit` before post-DOM geometry work, and leave another editor unaffected

### Requirement: Scope and current-page modes are explicit
Writes MUST default to active story; aggregate scope is query-only.
`DocxEditor.Editor.getCurrentPage` MUST require explicit `caret` or `viewport`
mode unless a documented stable default is selected in the IDL. The two modes
MUST have separate query semantics and results.

#### Scenario: Caret and viewport are on different pages
- **WHEN** current page is queried in both modes
- **THEN** caret mode MUST return the anchored caret page and viewport mode MUST return the declared visible-page selection

### Requirement: Export map and deprecation window are exact
The package root MUST export the `DocxEditor` namespace. Allowed non-object-model
exports are `./types`, `./schemas`, `./plugin`, `./styles.css`, `./tailwind`,
and temporary semver-exempt `./geometry`. No bare durable object-model function
or type may be exported. Replaced retired subpaths MUST forward to
`DocxEditor.*` for exactly one major release with warnings and MUST NOT declare
an alternate namespace alias.

#### Scenario: Compatibility window expires
- **WHEN** the next major after the forwarding window is released
- **THEN** retired subpaths MUST be removed after migration tests pass while `DocxEditor.*` remains unchanged
