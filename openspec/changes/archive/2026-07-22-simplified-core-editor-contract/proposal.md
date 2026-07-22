## Why

Framework adapters must drive the editor through one small, stable surface, not
by reaching into an editing engine's transactions or a layout module's
internals. A contract that leaks editing-engine or layout types couples every
adapter file to implementation details, blocks swapping the engine, and makes
the two adapters drift.

The browser facade already covers editing commands, queries, and lifecycle. The
gap is geometry: selection rectangles, caret position, hit-testing, and paint.
This change closes that gap so an adapter is a renderer and an event forwarder
and nothing more.

## What Changes

- Core owns layout and emits a positioned, immutable render list
  (`DisplayPage[]` of `DisplayItem`) that an adapter paints verbatim.
- Selection, caret, hit-test, page, and scroll geometry become queries on the
  `Editor` facade, derived from current state.
- `EditorHost` is reduced to DOM handles, frame scheduling, and event
  forwarding. The adapter no longer measures or receives layout primitives; it
  receives `DisplayPage[]` via `onDisplay` / the `display` event.
- Every position carried in the render list is a document offset, so selection
  maps to geometry without the adapter ever holding an engine position.
- No editing-engine types appear anywhere in the public surface.

Scope is the contract only: type declarations plus this design. No engine
implementation and no adapter code change in this pass.

## Capabilities

### Editor facade

One object exposes load/save, `exec`/`can` commands, typed `query`, snapshot,
lifecycle, and the geometry queries. Header/footer and body are addressed by an
explicit scope.

### Positioned render IR

A page is a box plus an ordered list of items (text, image, fill, table border,
decoration). Content items carry `docFrom`/`docTo` and a view scope. Adapters
render items positionally and never compute geometry.

## Impact

Affects the `@docx-editor.dev/core` editor and geometry contract entries and,
in later changes, the React and Vue adapters that consume them. Parsing and
serialization vocabulary is unchanged. Acceptance is the contract package
typecheck and the consumer type test.
