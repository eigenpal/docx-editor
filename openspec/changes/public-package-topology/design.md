## Context

The repository currently has three distribution planes:

- the published retired `@docx-editor.dev/core`;
- the private declaration-only `@docx-editor.dev/core-contract`;
- the real private production packages under `packages/engine-*`.

The private engine graph is useful. It mechanically keeps the canonical store free
of ProseMirror, DOM, Yjs, transport, and PDF dependencies. The public graph is not
yet useful: adapters and examples cross temporary package boundaries, the contract
package contains throwing stubs, and consumers cannot install the new engine through
a stable product surface.

This change defines the final product graph before the section 7/14 namespace
migration. It also establishes one commercial distribution boundary. Comments,
tracked revisions, collaboration, and PDF export are paid capabilities grouped under
`@docx-editor.dev/enterprise`; DOCX parsing, preservation, editing, and DOCX save
remain free.

## Goals / Non-Goals

**Goals:**

- Keep the internal engine split where it enforces a real dependency or runtime
  boundary.
- Give consumers a small product-oriented npm surface with automatic compatible
  dependencies.
- Keep the free headless core independent of browser, collaboration, transport, and
  PDF implementations.
- Keep React, Vue, and Nuxt thin and semantically paired over one browser editor.
- Distribute all paid capabilities through one package while retaining isolated,
  tree-shakable entry points.
- Preserve enterprise OOXML losslessly and fail closed when the enterprise package
  is absent.
- Make package absence and optional-peer combinations executable CI contracts.

**Non-Goals:**

- Collapsing the private engine into one source package.
- Publishing ProseMirror binding, layout, output, or raw `engine-*` packages.
- Creating a package for each OOXML feature.
- Implementing comments, revisions, collaboration, or PDF behavior in this change.
- Building a `DocxDocument` bridge or changing canonical model semantics.
- Making a package rename before the production editor and paired adapter path pass.

## Decisions

### 1. Maintain separate private and public dependency graphs

The private graph remains implementation-oriented:

```text
engine-core
  ├── engine-binding
  ├── engine-sync
  ├── engine-layout
  │     └── engine-output
  ├── engine-editor      (core + binding + layout + DOM output)
  ├── engine-server      (core + sync + layout + output; no binding)
  └── engine-clients
```

The public graph is product-oriented:

```text
core
  ├── editor
  │     ├── react
  │     └── vue ── nuxt
  ├── server ── client
  ├── agents
  └── enterprise
        ├── comments
        ├── revisions
        ├── collaboration
        └── pdf
```

Directory names do not define the API. At the migration milestone,
`packages/engine-core` becomes the implementation of `@docx-editor.dev/core` and
`packages/engine-editor` becomes `@docx-editor.dev/editor`. The remaining raw engine
names stay private.

**Alternative considered:** publish each engine lane. Rejected because it exposes
internal sequencing, invites direct ProseMirror dependencies, and creates avoidable
version combinations.

**Alternative considered:** one batteries-included core. Rejected because headless
parse/edit/save would install browser, Yjs, and PDF dependencies.

### 2. Publish only packages with an install, runtime, framework, or license boundary

The intended public npm packages are:

- `@docx-editor.dev/core`;
- `@docx-editor.dev/editor`;
- `@docx-editor.dev/server`;
- `@docx-editor.dev/client`, only when generated protocol clients are ready;
- `@docx-editor.dev/react`, `vue`, and `nuxt`;
- `@docx-editor.dev/enterprise`;
- `@docx-editor.dev/agents`;
- `@docx-editor.dev/i18n`.

There is no public `sync`, `binding`, `layout`, `output`, `comments`, `revisions`, or
`pdf` package. A basic framework consumer installs only the framework adapter; its
runtime dependencies pull compatible `editor` and `core` versions.

`server` remains a distinct free product because headless RPC, controlled semantic
editing, and DOCX export have uses unrelated to collaboration. Enterprise
collaboration adds the replication hub/awareness behavior through a server
extension. Enterprise PDF adds a PDF backend; free server export remains DOCX-only.

### 3. Keep one enterprise package with isolated explicit subpaths

`@docx-editor.dev/enterprise` defines one commercial license and release boundary.
It exposes no eager root barrel that initializes every capability. Its export map
contains explicit entries:

```text
@docx-editor.dev/enterprise/comments
@docx-editor.dev/enterprise/comments/react
@docx-editor.dev/enterprise/comments/vue
@docx-editor.dev/enterprise/revisions
@docx-editor.dev/enterprise/revisions/react
@docx-editor.dev/enterprise/revisions/vue
@docx-editor.dev/enterprise/collaboration
@docx-editor.dev/enterprise/collaboration/server
@docx-editor.dev/enterprise/pdf
```

Imports return extension factories. Registration is explicit and instance-scoped;
importing a module does not mutate a process-global registry. The document's
extension set is fixed when it is opened. Enabling an enterprise parser/model lane
for an already opened opaque document requires reopening from its preserved bytes.

React and Vue feature UI remains in paired subpaths. Base adapters forward public
commands, events, and host lifecycle only and contain no enterprise-specific logic.

**Alternative considered:** separate top-level comments and revisions packages.
Rejected because all paid functionality should have one purchase, installation, and
support boundary.

### 4. Keep enterprise dependencies absent from free install graphs

Free `core` contains the generic bounded parse/preservation machinery needed to keep
unknown or unsupported package parts. It does not contain entitlement branches or
paid semantic operations.

`enterprise/collaboration` owns the public Yjs integration. `engine-sync` remains
private. `yjs` is an optional peer/runtime dependency checked when the collaboration
subpath is initialized.

`enterprise/pdf` owns public PDF export. The common display contracts and free DOM
backend remain available to the editor, but the PDF backend and its heavy dependency
are absent from free runtime graphs. The PDF library is an optional peer or isolated
subpath dependency checked when PDF export is initialized.

React and Vue are optional peers of enterprise framework subpaths. Importing
comments or revisions headlessly must not require either framework.

### 5. Enterprise contributions use stable PM-free extension contracts

Public `core` owns canonical feature, operation, preservation, and serialization
extension contracts. Public `editor` owns PM-free projection, transaction intent,
selection, layout, and display extension contracts.

Enterprise extensions may provide declarative node/mark roles, semantic operation
mappers, display handlers, and UI, but public types never expose `EditorView`,
`EditorState`, ProseMirror transactions, private stores, or private engine
registries. The private `engine-binding` remains the only ProseMirror interpreter.

An absent enterprise contribution has one declared fallback:

- `verbatim`: preserve but do not model or display semantically;
- `readOnlyProjected`: render/project with stable identity but reject mutation;
- `reject`: fail bounded open for unsafe or ambiguous content.

Package absence never permits flattening, deletion, external fetching, field
execution, or lossy DOCX save.

### 6. Use one positioned display path

`engine-layout` owns geometry and emits the positioned display IR.
`engine-output/dom` paints that IR. `engine-editor` schedules layout and paint.
React/Vue supply host elements, lifecycle, event forwarding, and chrome only.

The PDF enterprise extension consumes the same positioned IR. It does not derive
geometry independently. Adapter-local painters and the provisional geometry bridge
retire only after public adapter conformance passes.

### 7. Version products according to compatibility, not implementation lanes

`core`, `editor`, React, Vue, Nuxt, and i18n use a compatible fixed release policy.
Adapters declare supported `core`/`editor` ranges and consumers do not manually
coordinate private engine versions.

`enterprise` versions independently but declares compatible core/editor/server
peer ranges. All enterprise capability subpaths share the enterprise package
version. `server`, `client`, and agents may version independently against explicit
protocol/core ranges.

No public package exports a path into another package's `src` directory. Export-map
removal or reassignment is a breaking change.

### 8. Migrate only after the production path is independently proven

Before npm names change:

- `engine-editor` reaches behavior parity with the shared example mount;
- React and Vue package entries pass the same stable `EditorDriver` scenarios;
- one output path serves both adapters;
- consumer builds prove how private engine code becomes the published editor;
- agents and Nuxt no longer depend on stale retired/ProseMirror paths.

The retired npm core and new core cannot occupy the same workspace identity during
the transition. The migration is one reviewed milestone with compatibility aliases
where semantics can be preserved. Throwing contract stubs are removed rather than
published.

## Risks / Trade-offs

- **One enterprise package installs code for unused capabilities** → Use isolated
  export graphs, no eager root barrel, and optional peers for Yjs, PDF, React, and
  Vue. Measure packed and bundled artifacts.
- **Enterprise features need low-level PM hooks** → Expand PM-free semantic
  extension contracts; do not export ProseMirror or let enterprise UI reach the
  private view.
- **Free fallback cannot safely edit an enterprise-containing parent** → Preserve
  ownership capsules and reject the boundary-crossing edit atomically.
- **Public wrapper and private package versions diverge** → Assemble from one
  workspace revision and test packed tarballs, not source aliases.
- **Retired core migration breaks examples or agents** → Migrate consumer groups
  behind compatibility tests before switching the npm identity.
- **PDF accidentally enters free editor/server dependencies** → Test production
  package manifests and module graphs with enterprise and PDF libraries absent.
- **Adapters drift during migration** → Require paired API extraction and identical
  driver scenarios in the same change.
- **A single enterprise version couples release cadence** → Accept this as the
  chosen commercial support boundary; isolated subpaths limit runtime coupling.

## Migration Plan

1. Record the private and public graphs in architecture and OpenSpec authority.
2. Add graph tests for public imports, forbidden dependency leakage, export maps,
   and optional package absence.
3. Complete `engine-editor`, common output, and paired public-adapter conformance
   without changing npm names.
4. Define stable core/editor extension contracts and packed consumer fixtures.
5. Replace the retired/contract split with published `core` and `editor` in one
   milestone; migrate React and Vue together.
6. Migrate Nuxt, agents, examples, server, and generated clients.
7. Add the enterprise package shell and isolated capability exports; verify absence
   and entitlement behavior before implementing feature semantics.
8. Remove temporary aliases, example mounts, duplicate painters, and contract stubs
   only after public conformance passes.

Rollback before public release restores the prior workspace package manifests and
adapter imports. After public release, rollback publishes a patch restoring the
last compatible exports; published package versions are never replaced.

## Open Questions

None. Direct PDF library choice, collaboration transport, and commercial license
provider remain implementation decisions inside their capability changes and do not
alter this package topology.
