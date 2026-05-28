---
'@eigenpal/docx-editor-react': minor
'@eigenpal/docx-editor-vue': minor
'@eigenpal/docx-editor-core': minor
---

Font-load failures (Google Fonts, `loadFontFromUrl`, `loadFontFromBuffer`) now route through the React `onError` prop and the Vue `error` event instead of writing directly to the console. Wire either to pipe these into Sentry, Datadog, or your own error tracker. When no subscriber is attached (headless / SSR / pre-mount), the loader falls back to `console.warn` so errors are not silently dropped.

Adds `onFontError(callback)` to `@eigenpal/docx-editor-core/utils` for non-adapter hosts.
