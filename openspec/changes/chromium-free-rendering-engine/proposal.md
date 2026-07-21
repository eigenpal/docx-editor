## Why

We are building a document rendering engine from scratch. The defining principle
is that the browser is never the layout oracle: measurement and layout are
deterministic and Chromium-free from the first line, so the same engine produces
the same result in a browser, a worker, or a server, and can emit PDF natively
without a headless browser. This is what makes server-side processing and
deterministic fixed-layout export possible; an engine that measures text through
a browser API cannot offer either.

ProseMirror is used, but only as the client-side editing and state layer. The
layout, measurement, pagination, and output stages are independent of it and of
the DOM, so the engine runs headless from a parsed document with no editor
present.

## What Changes

This change defines the architecture and contracts for that engine. It builds on
the runtime-ports and display-list foundations shared with the `modular-core-api`
change and does not restate them.

- **Deterministic text shaping.** A font-shaping subsystem reads actual font
  bytes — embedded fonts from the file plus a bundled metric-compatible fallback
  set — and computes advances, kerning, ligatures, shaping clusters, and bidi.
  Measurement is a pure function of `(text, font bytes, size)`, identical across
  browser, worker, and server. No canvas, no browser font stack.
- **ProseMirror decoupled from layout.** ProseMirror handles client-side
  editing, undo, and keyboard state. The engine consumes a plain document model
  (the parsed file model), not a live editor view or DOM, so it runs
  `parse -> measure -> paginate -> emit` headless.
- **Positioned display-list IR.** The engine's output is an immutable list of
  positioned primitives (glyph runs at resolved advances, rects, images, links,
  feature anchors). Every output target — interactive DOM, PDF, print,
  hit-testing — consumes the IR, so geometry is computed once and never
  re-derived per target.
- **Model-owned geometry.** All geometry lives in the model, including
  justification and text-fit expressed as explicit per-line advance adjustments
  (not deferred to a layout engine downstream). The IR therefore carries final
  positions; no consumer resolves geometry.
- **Native PDF emitter.** PDF is produced by walking the IR and drawing
  primitives directly — font embedding and subsetting, glyph placement from
  measured advances, hyperlinks and internal links as PDF annotations,
  rotation/flip as content-stream matrices, and clipping for table and
  merged-cell page cuts. No headless browser; runs in a Node/worker process.
- **Two-pass cross-reference resolution.** Page numbers, `PAGEREF`/table of
  contents, and footnote placement resolve in a second pass over the paginated
  result, producing correct internal-link destinations in the IR.

## Capabilities

### New Capabilities

- `deterministic-text-shaping`: the font-shaping measurement subsystem — font
  byte loading (embedded + fallback), advance/kerning/ligature/cluster/bidi
  shaping, and the deterministic, browser-free measurement contract.
- `headless-layout-pipeline`: the DOM-free, ProseMirror-decoupled execution
  model — document-model input, `measure -> paginate -> emit`, and two-pass
  cross-reference resolution — runnable in browser, worker, or server unchanged.
- `native-pdf-emitter`: PDF output over the positioned IR without a browser —
  font embedding/subsetting, glyph placement, link annotations, transforms, and
  clipping.

### Modified Capabilities

<!-- Built from scratch. The shared runtime-ports and display-list-ir
     capabilities are defined by the modular-core-api change; this change
     depends on them and defines no modifications to existing specs. -->

## Impact

- **Engine boundary**: layout reads a plain document model and emits the IR;
  ProseMirror sits alongside it as the editor, not inside it.
- **Output**: PDF is a first-class emitter over the IR; print is another IR
  consumer rather than a browser print flow.
- **Dependencies**: a font-shaping library and a low-level PDF-writing library
  are introduced, confined to the shaping subsystem and the `pdf`/`server`
  packages. The browser editor bundle carries only the shaping code needed for
  measurement.
- **Fidelity**: deterministic advances give cross-machine consistency and enable
  server-side layout. Matching a specific word processor's line breaks
  byte-for-byte is out of scope; justification and compatibility quirks are a
  separate concern.
- **Verification**: a golden-image and metrics parity harness gates the engine
  (identical pagination for identical inputs across runtimes) before any output
  target is considered done.
