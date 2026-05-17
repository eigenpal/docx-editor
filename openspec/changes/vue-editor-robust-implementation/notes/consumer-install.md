# Fresh Consumer Install Check

Run date: 2026-05-12

## Packed Package Check

Local tarballs were created for:

- `@eigenpal/docx-editor-vue@0.0.1`
- `@eigenpal/docx-editor-core@0.0.28`
- `@eigenpal/docx-editor-agents@0.5.1`
- `@eigenpal/docx-editor-i18n@0.0.1`

The first install attempt with only the Vue tarball correctly exposed a release
packaging blocker: `workspace:*` dependency ranges were preserved in the packed
adapter and npm refused the install. The adapter package manifests now use
publishable internal ranges so released consumers will not need to install core
or i18n directly for basic editor usage.

Because the renamed internal packages are not published to npm yet, the local
pack-only check cannot fetch `@eigenpal/docx-editor-core` from the public
registry before the 1.0.0 release. The explicit local-tarball variant below
verifies the built package graph that npm will resolve after the fixed group is
published.

## Explicit Local-Tarball Variant

Verified in a fresh Vite + Vue temp app:

```bash
npm install vue @vitejs/plugin-vue vite typescript \
  /tmp/docx-local-registry-U7abbQ/eigenpal-docx-editor-core-0.0.28.tgz \
  /tmp/docx-local-registry-U7abbQ/eigenpal-docx-editor-agents-0.5.1.tgz \
  /tmp/docx-local-registry-U7abbQ/eigenpal-docx-editor-i18n-0.0.1.tgz \
  /tmp/docx-local-registry-U7abbQ/eigenpal-docx-editor-vue-0.0.1.tgz
npx vite build
```

Result: the app imported `DocxEditor`, `DocxEditorRef`, and
`@eigenpal/docx-editor-vue/styles.css`, mounted the component with
`mode="editing"`, and built successfully.
