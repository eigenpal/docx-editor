# Tasks: pro-collaboration-module

## 1. Core contract and gating

- [x] 1.1 Add `CollaborationSessionFactory`, `CollaborationModuleContribution`,
      `EditorModule.collaboration`, and `EditorModuleRegistry.collaboration` in
      `packages/core/src/contracts/modules.ts`. Keep `EditorModule` a data
      object with no lifecycle hooks
- [x] 1.2 Resolve collaboration in `resolveEditorModules` with first
      registration wins and later contributions ignored, matching review.
      Extend `EMPTY_REGISTRY`
- [x] 1.3 Pin `{ file: 'contracts/modules.ts', to: 'collaboration' }` (and
      `contracts/editor.ts` if the snapshot names `CollaborationStatus`) in
      `GRANDFATHERED_TYPE_EDGES` in
      `packages/core/src/__tests__/core-lane-imports.test.ts`. Do not add
      `collaboration` to `CORE_LANES.contracts.mayImport`
- [x] 1.4 Add `PRO_COLLABORATION_REASON` next to `PRO_REVIEW_REASON` in
      `packages/core/src/editor/opening-editing-mode.ts`. Add
      `collaborationStatus: CollaborationStatus | 'inactive'` to
      `EditorSnapshot`, always `'inactive'` without a module. Add it to
      `packages/core/src/editor/docx-editor-equality.ts` as `'compared'`
- [x] 1.5 Remove `collaboration?: EditorCollaborationSession` from
      `DocxEditorConfig`, `PaginatedSurfaceOptions`,
      `packages/core/src/automation/server-host.ts`, and
      `@docx-editor.dev/editor-api`. Add `collaborationModel?: CollaborationModuleContribution`
      on `PaginatedSurfaceOptions`
- [x] 1.6 Gate `packages/core/src/editor/paginated-surface.ts` attach (around
      lines 1281–1287), remote-selection subscribe, `gateOperations`, local
      selection publish, and undo/redo handover on the resolved
      `collaborationModel` session. Skip attach when the contribution is absent
- [x] 1.7 Tests: no-module editor reports `collaborationStatus: 'inactive'`,
      does not attach, keeps local undo; first of two collaboration modules
      wins; registered session attaches and takes over undo

## 2. Source move into Pro

- [x] 2.1 Move `packages/collaboration-yjs/src/` (except adapter-free tests that
      belong with the new tree) to `packages/pro/src/collaboration/`. Add
      Yjs-free `collaboration-module.ts` exporting `collaborationModule()`
- [x] 2.2 Re-export `collaborationModule` from `packages/pro/src/index.ts` and
      from `packages/pro/src/collaboration/index.ts`. Keep the default
      collaboration entry free of `y-webrtc` and `./webrtc`
- [x] 2.3 Move `useCollaborationStatus` to `packages/pro/src/react/` and
      `packages/pro/src/vue/`. Keep Vue's named `UseCollaborationStatusReturn`.
      Export both hooks from the Pro adapter entries
- [x] 2.4 Add the Pro copyright header to every moved file. Confirm
      `packages/pro/license-check.json` still covers `./src` `.ts` / `.tsx`

## 3. Pro package shape

- [x] 3.1 Update `packages/pro/package.json`: exports and files for
      `./collaboration` and `./collaboration/webrtc`; `dependencies` exactly
      `y-protocols`; optional peerDependencies `yjs` and `y-webrtc`; description
      and keywords mention collaboration
- [x] 3.2 Add tsup entries `collaboration/index` and `collaboration/webrtc` to
      the non-Vue config in `packages/pro/tsup.config.ts`. Keep `metafile: true`.
      Externalize `yjs`, `y-protocols`, `y-protocols/awareness`, and `y-webrtc`
- [x] 3.3 Narrow `packages/pro/src/__tests__/package-dependencies.test.ts`:
      keep core/react/vue as peers only; allow only `y-protocols` in
      `dependencies`; require `yjs` and `y-webrtc` as optional peers; keep the
      HarfBuzz / identity-cache comment so the engine-peer assertion is not
      widened. Do not delete the file
- [x] 3.4 Move or rewrite `packages/collaboration-yjs/src/__tests__/` so Pro
      owns the replica tests. Point benches in `scripts/bench/` at
      `packages/pro/src/collaboration/`

## 4. Adapters and parity

- [x] 4.1 Remove `useCollaborationStatus` from `packages/react/src/index.ts` and
      `packages/vue/src/index.ts`. Delete the adapter source files after the
      move
- [x] 4.2 Remove the `collaboration` prop from
      `packages/react/src/editor/DocxEditorRoot.tsx`,
      `packages/vue/src/editor/useDocxEditorRoot.ts`, and
      `packages/vue/src/editor/DocxEditorRoot.ts`
- [x] 4.3 Add `useCollaborationStatus` and `UseCollaborationStatusReturn` to
      `pro.exports.paired` (and `memberCheckedInterfaces` as needed) in
      `scripts/parity/parity.contract.json`

## 5. Delete the standalone package and rewire tooling

- [x] 5.1 Delete `packages/collaboration-yjs/` and
      `docs/api/docx-editor-collaboration-yjs/`
- [x] 5.2 Remove `@docx-editor.dev/collaboration-yjs` from
      `scripts/lib/packages.mjs`. Add Pro API Extractor entries for
      `./collaboration` and `./collaboration/webrtc`, including any
      `forgottenExports` allowlist those barrels need
- [x] 5.3 Remove `collaboration-yjs` from `scripts/check-package-artifacts.mjs`
- [x] 5.4 Update `scripts/check-consumer-install.mjs` so the packed consumer
      imports `@docx-editor.dev/pro/collaboration` and
      `@docx-editor.dev/pro/collaboration/webrtc` instead of
      `@docx-editor.dev/collaboration-yjs`
- [x] 5.5 Update root `package.json`: drop `collaboration-yjs` from
      `workspaces` if it is listed explicitly; remove it from
      `build:packages` and `build:packages:demo`; keep `dev:collaboration`
      pointed at `examples/collaboration`
- [x] 5.6 Update path aliases in `examples/vite/vite.config.ts` (and any other
      tsconfig paths) that still resolve `@docx-editor.dev/collaboration-yjs`

## 6. Call sites, docs, and changesets

- [x] 6.1 Register `collaborationModule({ session })` in
      `examples/collaboration` (`src/main.ts`, `headless-agent.ts`) and
      `examples/vite/src/CollaborationDemo.tsx` /
      `examples/vite/src/ComposedEditorDemo.tsx`. Stop passing the
      `collaboration` prop
- [x] 6.2 Update `e2e/collaboration.fulldocument.spec.ts` so the demo still
      connects through the Pro module path
- [x] 6.3 Add a docs page under `docs/site/content/pro/` (for example
      `collaboration.mdx`). Register it in both
      `docs/site/content/meta.json` and `docs/site/content/pro/meta.json`
- [x] 6.4 Move the `collab.realtime` row in
      `docs/site/data/word-features.ts` from `tier: 'community'` to
      `tier: 'pro'`. Point `docsLink` at the new page
- [x] 6.5 Rewrite pending collaboration changesets in `.changeset/` so they
      describe the Pro module rather than `@docx-editor.dev/collaboration-yjs`.
      Do not invent a deprecation shim

## 7. Verify

- [x] 7.1 Run `bun run build:packages` **before** `bun run api:extract`.
      Extracting against a stale `dist/` silently deletes other packages' API
      entries
- [x] 7.2 Run `bun run typecheck`, `bun run lint`, `bun run test` (scoped to
      the touched packages plus e2e as needed), `bun run check:parity`,
      `bun run api:check`, `bun run i18n:validate`, and
      `openspec validate pro-collaboration-module --strict`
- [x] 7.3 Run `bun run format` on the edited files. Confirm
      `packages/pro` `license:check` is green
