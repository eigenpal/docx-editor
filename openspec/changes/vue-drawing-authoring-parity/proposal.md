## Why

`typed-drawings-and-images` ships the engine-owned drawing model, layout, paint, store operations, shared chrome slots, command state, and React authoring. Vue already consumes the shared disabled and value state from `toolbarCommandState`, but it has no image insert dialog, wrap menu, properties panel, resize handles, or anchored drag affordances.

The drawings lane must not be described as paired production support until this follow-up lands. `paragraph-adapter-acceptance` gates production support on paired adapters; React-only delivery is explicit in the parent change.

## What Changes

**Vue authoring surface only**

- Implement Vue image authoring controls that mirror the React surface: insert, properties, wrap menu (all nine choices), alt text, resize handles, anchored move, and keyboard resize.
- Consume the shared engine slots (`image.insert`, `image.properties`, `image.wrap`, `image.altText`) and `SelectedImageState` from the parent change — no parallel wrap vocabulary or store writes.
- Wire value-typed `image.wrap` through the shared `ToolbarCommandState.value` path widened by the parent change.
- Add i18n keys only where Vue-specific chrome strings differ; reuse engine strings for wrap choices and refusal reasons.

## Capabilities

### New Capabilities

- `image-authoring-surface`: Vue image insert dialog, wrap menu, properties panel, handles, and keyboard affordances consuming shared engine state.

### Modified Capabilities

None. The parent change owns the engine contract; this change owns Vue UI parity only.

## Impact

- `packages/vue/src` — image authoring components and composables.
- `packages/i18n` — any Vue-only chrome strings.
- `bun run api:extract`, `bun run check:parity-contract` — Vue return interfaces must not leak core internal types.

## Acceptance boundary

- React authoring from `typed-drawings-and-images` is sufficient for engine acceptance and browser smoke evidence.
- This change is complete when Vue exposes the same user-facing image operations through the shared slots with type-safe composables and paired parity-contract coverage.
- Out of scope: engine model, layout, paint, store operations, and chrome slot definitions — all owned by `typed-drawings-and-images`.

## Owner

Vue adapter lane. Depends on `typed-drawings-and-images` landing shared engine state and React proof first.
