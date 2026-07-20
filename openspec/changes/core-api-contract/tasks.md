## 1. Contract package

- [x] 1.1 Scaffold `packages/core` as `"private": true` with a six-entry `exports` map
- [x] 1.2 Declare shared types in `src/types.ts`: document model, `DocAnchor`, `DocLocation`, `ContainerRef`, `ExecResult`, `PageLayout`
- [x] 1.3 Declare the document entry in `src/index.ts`: `parseDocx`, `serializeDocx`, `toJSON`/`fromJSON`, `applyEdits`, `queryDoc`, `DocEdits`, `DocQueries`, runtime schema exports
- [x] 1.4 Declare the editor entry in `src/editor.ts`: `createEditor`, `Editor`, `EditorHost`, `EditorScope`, `EditorCommands`, `EditorQueries`, `EditorSnapshot`, `EditorEvents`
- [x] 1.5 Declare the geometry entry in `src/geometry.ts`, marked `@experimental` and semver-exempt, omitting all cache-invalidation functions
- [x] 1.6 Declare the plugin and MCP entries in `src/plugin.ts` and `src/mcp.ts`
- [x] 1.7 Add `src/types-barrel.ts` as the type-only re-export for `core/types`
- [x] 1.8 Add `tsconfig.json` and confirm the package typechecks in isolation
- [x] 1.9 Write `packages/core/README.md` recording why each decision was made
- [ ] 1.10 Add a release-workflow assertion that the contract package is never published, so `private: true` is not the only guard

## 2. Retire the parallel docs tree

- [x] 2.1 Move the API review synthesis into `openspec/changes/core-api-contract/`
- [ ] 2.2 Delete `docs/superpowers/`, checking each of the 8 files for content worth preserving in `openspec/` first
- [ ] 2.3 Remove references to `docs/superpowers` from `CLAUDE.md` and any tooling that reads that path

## 3. Verify the contract holds

- [ ] 3.1 Add a lint or CI check that fails on any consumer import of a core subpath outside the declared six entries
- [ ] 3.2 Write type-level tests asserting each entry's surface compiles as documented
- [ ] 3.3 Confirm the six entries resolve with no `tsconfig` `paths` mapping and no bundler alias for core

## 4. Close the gaps this change documents but does not fix

- [ ] 4.1 Publish an implementation satisfying the stable entries, so `bun run typecheck` can pass in this repo
- [ ] 4.2 Export the subpaths adapters import today but core does not declare, or migrate the call sites off them
- [ ] 4.3 Ship `tailwind-preset.cjs` and `styles/editor.css` from core: neither is in `exports` nor in `files`
- [ ] 4.4 Keep the seven externally consumed legacy entries resolvable as deprecated aliases for one major

## 5. Adapter migration (after engine unification)

- [ ] 5.1 Finish engine unification (#696) where it is still atomic and the e2e suite runs
- [ ] 5.2 Migrate `packages/agents` first: it already consumes one entry, so it is the smallest proof
- [ ] 5.3 Migrate `packages/react` and `packages/vue` entry by entry, `core/geometry` last
- [ ] 5.4 Shrink `core/geometry` as engine work absorbs its members, and record the removal milestone for each
- [ ] 5.5 Decide whether the ~16 toolbar and widget symbols move beside the adapters, removing them from the contract
