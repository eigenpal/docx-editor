---
'@eigenpal/docx-editor-core': patch
---

Stop shipping sourcemaps and declaration maps in published tarballs. They were dead weight: the `.js.map` files referenced source files that aren't in the tarball, and the `.d.ts.map` files pointed at `.ts` files consumers can't see either.

Concrete changes:

- `@eigenpal/docx-editor-core`: drop `sourcemap: !isProd` from both tsup builds (the build never ran with `NODE_ENV=production`, so 245 `.js.map` files / ~8.2 MB were shipping). Tarball: 2.5 MB → 0.7 MB. Unpacked: 11.0 MB → 2.7 MB.
- `@eigenpal/docx-editor-vue`: pass `compilerOptions: { declarationMap: false }` to `vite-plugin-dts` to suppress the 63 `.d.ts.map` files.
- `@eigenpal/docx-editor-agents`: same `declarationMap: false` for the Vue sub-build; also add the missing `sideEffects: ["*.css"]` so bundlers can tree-shake.

Total unpacked footprint across all published packages: 14.8 MB → 6.3 MB.
