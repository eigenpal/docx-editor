# docx-editor (Grant Workbench fork)

A fork of [eigenpal/docx-editor](https://github.com/eigenpal/docx-editor) that contains **only Apache-2.0 code**, so everything here can be used commercially without limits.

The EigenPal Pro License packages (`@docx-editor.dev/pro`, `editor-api`, `docx-to-pdf`, `telemetry`), and the upstream examples, tests, docs and tooling that used them, have been removed. Don't add them back.

| Path | What it is | Licence |
| --- | --- | --- |
| `packages/core` | The DOCX engine: parsing, layout, editing, tracked-change markup, serialisation | Apache-2.0 |
| `packages/react` | React adapter | Apache-2.0 |
| `packages/fonts` | Bundled fonts | Apache-2.0, OFL-1.1, GUST |
| `packages/i18n` | UI strings | Apache-2.0 |
| `packages/vue`, `packages/nuxt`, `packages/docx-to-markdown`, `packages/fonts-cjk` | Other upstream Apache packages (not used by Grant Workbench) | Apache-2.0 (fonts: OFL-1.1) |
| `extensions/review` (`@gw/docx-review`) | Our review module and panel: comments and tracked changes, written only against the Apache packages | Apache-2.0 |
| `examples/free-review` | A demo of the editor with `@gw/docx-review` | Apache-2.0 |

Grant Workbench (calvinhoang/crc-p) vendors core, react, fonts, i18n and `@gw/docx-review` with `npm run vendor:eigenpal`, which refuses any package whose licence isn't Apache-2.0 or a free font licence.

```
bun install
bun run build     # i18n, core, fonts, react, @gw/docx-review
bun run test
```

Licence: [Apache-2.0](LICENSE). Copyright Eigenpal, Inc. for the upstream code; see [NOTICE](NOTICE) and [FORK-CHANGES.md](FORK-CHANGES.md) for what this fork changed.
