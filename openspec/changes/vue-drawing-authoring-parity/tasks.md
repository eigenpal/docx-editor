## 0. Prerequisite

- [ ] 0.1 Confirm `typed-drawings-and-images` has landed shared engine slots, `SelectedImageState`, value-typed `image.wrap`, and React authoring proof

## 1. Vue composables

- [ ] 1.1 Add `useImageAuthoring()` (or equivalent) reading `SelectedImageState` and command state without leaking core internal types
- [ ] 1.2 Wire `image.insert`, `image.properties`, `image.wrap`, and `image.altText` through existing Vue toolbar derivation

## 2. Vue authoring UI

- [ ] 2.1 Insert dialog with byte validation delegated to engine insert-image
- [ ] 2.2 Properties panel: size, crop, alt text, position (anchored only)
- [ ] 2.3 Wrap menu showing all nine choices with current value from `ToolbarCommandState.value`
- [ ] 2.4 Resize handles and anchored drag with preview-on-move, commit-on-release
- [ ] 2.5 Keyboard resize with defined step

## 3. Verification

- [ ] 3.1 Vue tests assert shared slots and disabled/value state remain type-safe; they do not claim engine behaviour
- [ ] 3.2 `bun run api:extract`, `bun run check:parity-contract`
- [ ] 3.3 `bun run i18n:validate`
- [ ] 3.4 `openspec validate vue-drawing-authoring-parity --strict`

## 4. Explicitly out of scope

- [ ] 4.1 Engine model, layout, paint, and store operations — owned by `typed-drawings-and-images`
- [ ] 4.2 VML watermarks — owned by `typed-vml-watermarks`
