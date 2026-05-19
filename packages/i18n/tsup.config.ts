import { defineConfig } from 'tsup';
import { readLocaleCodes } from './locale-files.mjs';

// Each shipped locale gets its own subpath entry
// (`@eigenpal/docx-editor-i18n/<code>`) so consumer bundlers can code-split
// a single locale instead of pulling the whole locales map. `splitting: false`
// keeps each entry self-contained. The locale list comes from `locale-files.mjs`
// — same source `scripts/validate-i18n.mjs` reads, so the build and codegen
// can't drift on the BCP-47 filename rule.
const localeCodes = readLocaleCodes(import.meta.dirname);

export default defineConfig({
  entry: ['src/index.ts', ...localeCodes.map((code) => `src/${code}.ts`)],
  format: ['cjs', 'esm'],
  dts: { resolve: true },
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
});
