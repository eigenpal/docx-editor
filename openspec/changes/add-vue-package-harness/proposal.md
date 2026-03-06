## Why

The Vue package (`packages/vue`) and its example (`examples/vue`) exist as scaffolds with placeholder content — `renderAsync` throws "not yet implemented" and the example shows a static "coming soon" page. There's no `dev:vue` script, so contributors can't easily spin up the Vue dev server. Adding a minimal working harness with a `bun run dev:vue` command lets Vue contributors start iterating immediately without figuring out the project structure.

## What Changes

- Add `dev:vue` script to root `package.json` to start the Vue example dev server on port 5174
- Implement a minimal `DocxEditor` Vue component in `packages/vue` that wraps `@eigenpal/docx-core` to render a DOCX file with toolbar and basic editing
- Update `examples/vue/src/App.vue` from placeholder to a working demo (file open, new, save) mirroring the React Vite example's functionality
- Wire up the Vue example to use the new component

## Capabilities

### New Capabilities

- `vue-editor-component`: Minimal Vue 3 component wrapping @eigenpal/docx-core that provides DOCX rendering and editing with toolbar support

### Modified Capabilities

_None — this is a new integration, no existing spec-level behavior changes._

## Impact

- **packages/vue/**: New component files (DocxEditor.vue or composable), updated `index.ts` exports
- **examples/vue/**: Updated App.vue with working editor demo, possibly new dependencies
- **root package.json**: New `dev:vue` script
- **Dependencies**: `vue` (already a peer dep), may need `@eigenpal/docx-core` manager APIs
- **No breaking changes**: The existing placeholder exports remain; new component is additive
