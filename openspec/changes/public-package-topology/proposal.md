## Why

The greenfield engine needs strong internal dependency boundaries, but consumers
should not have to understand or version the growing `engine-*` workspace graph.
The public distribution model must be fixed before the production `createEditor`,
React/Vue migration, and commercial review features make provisional package names
part of the supported API.

## What Changes

- Define separate private implementation and public product dependency graphs.
- Keep raw `engine-*` packages private while publishing a small set of
  install-oriented products: `core`, `editor`, optional `server`/`client`,
  framework adapters, agents, and i18n.
- Preserve a headless `@docx-editor.dev/core` with no ProseMirror, DOM, Yjs,
  transport, or PDF dependency.
- Publish the browser composition as `@docx-editor.dev/editor`; React, Vue, and
  Nuxt consume it instead of private engine packages.
- Group all paid capabilities under one `@docx-editor.dev/enterprise` package
  with isolated comments, revisions, collaboration, PDF, and framework-UI
  subpaths.
- Keep DOCX import, canonical editing, preservation, and DOCX save/export free.
  PDF export, collaboration, comments, and tracked-revision workflows require the
  enterprise capability package.
- Require unsupported or unlicensed enterprise OOXML to remain losslessly
  preserved and explicitly read-only rather than silently flattened.
- **BREAKING**: retire `@docx-editor.dev/core-contract` and direct public or
  adapter imports of `@docx-editor.dev/engine-*` at the section 7/14 migration.
- Add install-matrix, export, dependency-absence, adapter-parity, and entitlement
  conformance before publishing the new topology.

## Capabilities

### New Capabilities

- `public-package-distribution`: Public package names, dependency boundaries,
  export ownership, install personas, compatibility, and migration from the
  private engine graph.
- `enterprise-capability-distribution`: One commercial package with isolated
  comments, revisions, collaboration, PDF, and paired framework-UI capability
  entry points.

### Modified Capabilities

None. Existing document semantics remain governed by `document-engine`,
`comprehensive-ooxml-prosemirror-coverage`, and baseline feature specifications.

## Impact

- **Packages:** `packages/core`, all `packages/engine-*`, React, Vue, Nuxt,
  agents, i18n, and new public distribution/enterprise package manifests.
- **Public API:** package names, export maps, peer/runtime dependencies,
  `createEditor` ownership, plugin entry points, and compatibility aliases.
- **Build/release:** workspace build graph, API Extractor, changesets, artifact
  assembly, consumer-install tests, and optional-dependency matrices.
- **Architecture:** package graph authority, PM/Yjs/DOM/PDF/transport isolation,
  common display ownership, and feature registration boundaries.
- **Migration:** retired npm core, contract stubs, example-only composition,
  direct engine imports, stale Nuxt ProseMirror dependencies, and agents'
  retired headless imports.
