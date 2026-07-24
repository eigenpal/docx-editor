## 1. Freeze package authorities

- [ ] 1.1 Update the production package architecture to distinguish the private implementation DAG from the public product graph and record every package's runtime, license, and publication role.
- [ ] 1.2 Update the contributor contract and both dependent OpenSpec changes to reference this topology without duplicating or contradicting its requirements.
- [ ] 1.3 Add a machine-readable public product graph containing package names, allowed product dependencies, peer ranges, export ownership, license class, and publication readiness.
- [ ] 1.4 Extend package-graph tests to prove private `engine-*` boundaries and public product boundaries independently.
- [ ] 1.5 Add forbidden-public-type checks for ProseMirror, private stores, private registries, source aliases, and cross-package `src` imports.

## 2. Build packed install conformance

- [ ] 2.1 Add a reusable fixture that packs selected workspace products, installs them in a clean temporary project, typechecks a consumer, and runs a minimal runtime scenario.
- [ ] 2.2 Add a minimal headless-core fixture with DOM, ProseMirror, Yjs, transport, PDF, React, Vue, server, agents, and enterprise packages absent.
- [ ] 2.3 Add basic React and Vue fixtures that install only the framework adapter directly and verify compatible core/editor runtime dependencies resolve.
- [ ] 2.4 Add a headless-server fixture proving semantic edit and DOCX save work without browser binding, Yjs, PDF, or enterprise.
- [ ] 2.5 Make packed export maps, type declarations, styles, side effects, peer diagnostics, and undeclared runtime imports release-blocking.

## 3. Stabilize the production browser composition

- [ ] 3.1 Complete the private `engine-editor` composition so load, editability, command/query, canonical commit, rejection, layout, display, save, error, and disposal behavior no longer depends on example orchestration.
- [ ] 3.2 Replace adapter-local geometry derivation with one `engine-layout` positioned IR and one common `engine-output/dom` paint path.
- [ ] 3.3 Split `engine-output` entry graphs so DOM/common output does not import or initialize the PDF backend.
- [ ] 3.4 Publish one stable PM-free `EditorDriver` over the production editor and migrate identical React/Vue browser scenarios to package entries.
- [ ] 3.5 Retain the example-only editing path until production React and Vue pass all shared scenarios, then remove its composition and driver globals.
- [ ] 3.6 Verify public editor declarations and runtime exports contain no ProseMirror types or view access.

## 4. Define stable extension and fallback contracts

- [ ] 4.1 Finalize core extension contracts for parse, canonical model, preservation ownership, semantic operations, serialization, validation, and edit policy.
- [ ] 4.2 Finalize PM-free editor extension contracts for projection roles, transaction intent, reverse reconciliation evidence, selection, layout, display, and read-only diagnostics.
- [ ] 4.3 Require every optional capability to declare `verbatim`, `readOnlyProjected`, or `reject` fallback behavior when its implementation is absent.
- [ ] 4.4 Add document-open tests proving extension sets are instance-scoped, imports have no global registration side effect, and adding a parse/model extension requires reopen.
- [ ] 4.5 Add boundary-edit tests proving unsupported or absent capability content cannot be flattened, deleted, externally fetched, executed, or saved lossily.
- [ ] 4.6 Add version compatibility diagnostics for extensions compiled against incompatible core/editor contracts.

## 5. Migrate the public core and editor products

- [ ] 5.1 Freeze the final `@docx-editor.dev/core` and `@docx-editor.dev/editor` export maps, entry ownership, package side effects, and dependency manifests.
- [ ] 5.2 Move contract-only declarations to generated or implementation-owned public declarations and remove throwing runtime stubs.
- [ ] 5.3 Publish the semantic implementation under `@docx-editor.dev/core` while preserving its headless dependency-absence guarantees.
- [ ] 5.4 Publish the production browser composition under `@docx-editor.dev/editor` with explicit compatible core dependency ranges.
- [ ] 5.5 Migrate React and Vue together from private engine/contract imports to public core/editor imports and prove API plus browser parity.
- [ ] 5.6 Migrate Nuxt to Vue plus public editor contracts and remove its direct ProseMirror dependencies and stale source-only subpaths.
- [ ] 5.7 Add truthful compatibility aliases for retired core entries that retain equivalent semantics and document hard breaks for entries that cannot.
- [ ] 5.8 Retire `@docx-editor.dev/core-contract` only after packed core/editor/adapters and compatibility consumers pass.

## 6. Complete optional free products

- [ ] 6.1 Define the free `@docx-editor.dev/server` export map for document addressing, controlled semantic editing, protocol dispatch, and DOCX save without collaboration or PDF.
- [ ] 6.2 Remove browser-binding and undeclared synchronization/PDF dependencies from the packed server graph and add absence tests.
- [ ] 6.3 Version the server protocol and generate a client artifact without importing the semantic core implementation.
- [ ] 6.4 Publish `@docx-editor.dev/client` only after packed remote-consumer type and runtime conformance passes.
- [ ] 6.5 Migrate agents from retired headless imports to public core/server command and query contracts and re-enable its typecheck.

## 7. Create the enterprise distribution shell

- [ ] 7.1 Create one private-to-public enterprise build with no eager root barrel and explicit comments, revisions, collaboration, PDF, and framework-UI export entries.
- [ ] 7.2 Add enterprise initialization and entitlement interfaces outside free core/editor code, with stable unavailable, unlicensed, and incompatible diagnostics.
- [ ] 7.3 Add `enterprise/comments` and `enterprise/revisions` extension shells that register no global state and declare safe absence fallbacks.
- [ ] 7.4 Add paired comments/revisions React and Vue subpath shells whose public types depend only on framework and public product contracts.
- [ ] 7.5 Add `enterprise/collaboration` and `enterprise/collaboration/server` shells over the private synchronization boundary without publishing `engine-sync`.
- [ ] 7.6 Add `enterprise/pdf` over the shared positioned display IR while keeping free DOCX save/export unchanged.
- [ ] 7.7 Make Yjs, the PDF implementation, React, and Vue capability-local optional peers or isolated build dependencies with subpath-specific diagnostics.
- [ ] 7.8 Add isolated-import tests proving each enterprise subpath works without unrelated enterprise peers or module evaluation.
- [ ] 7.9 Add instance-isolation tests for two editors with different enterprise extensions and entitlements.

## 8. Prove free and enterprise behavior

- [ ] 8.1 Add free-core and free-editor fixtures containing comments, revisions, and collaboration metadata and prove no-op/unrelated DOCX save preserves unaffected package bytes.
- [ ] 8.2 Add structured read-only diagnostics for absent enterprise capability, story, QName/context, and blocked mutation lane.
- [ ] 8.3 Add a free PDF request test that returns the stable unavailable-or-unlicensed result while DOCX save remains successful.
- [ ] 8.4 Add enterprise PDF conformance proving it consumes shared display geometry and does not import browser binding state.
- [ ] 8.5 Add collaboration absence tests proving core, editor, and server run with Yjs uninstalled.
- [ ] 8.6 Add the full enterprise install matrix: each capability alone, comments plus revisions, collaboration client/server, PDF, paired UI, and all capabilities together.
- [ ] 8.7 Add incompatible-version and missing-optional-peer tests against packed enterprise artifacts.

## 9. Release and migration completion

- [ ] 9.1 Update changeset fixed groups and independent compatibility ranges for core/editor/adapters/i18n, server/client/agents, and enterprise.
- [ ] 9.2 Regenerate API Extractor snapshots, consumer JSON, export parity data, and public package documentation.
- [ ] 9.3 Remove direct private engine dependencies from examples and make examples consume public adapters, core, editor, server, agents, or enterprise entries only.
- [ ] 9.4 Run package graph, unit, type, packed install, adapter parity, browser, security, deterministic output, optional-absence, and enterprise matrix checks.
- [ ] 9.5 Remove temporary contract aliases, duplicate painters, source aliases, and migration-only package paths only after their explicit conformance gates pass.
- [ ] 9.6 Record final packed artifact hashes, dependency graphs, API surfaces, license boundaries, and rollback versions as release evidence.
