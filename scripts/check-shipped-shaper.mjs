#!/usr/bin/env node
//
// Assert the SHIPPED bundle, not the config that produced it.
//
//   bun run check:shipped-shaper     # after `bun run build:packages`
//
// Issue #282 was a property of core's OUTPUT: a bare `module` specifier reaching a
// consumer's bundler. Every guard added with the fix checks an input — the tsup config
// object, the vendor's source, the plugin's own application count. None of them reads
// `dist/`, so the one thing a consumer actually installs was the one thing nothing
// asserted. These are the four greps that would have caught the bug, and would catch a
// regression in a dependency bump, an esbuild upgrade, or a config refactor that still
// type-checks.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'packages/core/dist');
const failures = [];

if (!existsSync(dist)) {
  console.error('packages/core/dist is missing — run `bun run build:packages` first.');
  process.exit(1);
}

const files = readdirSync(dist);
const esm = files.filter((file) => file.endsWith('.js'));
const cjs = files.filter((file) => file.endsWith('.cjs'));
const read = (file) => readFileSync(path.join(dist, file), 'utf8');

// 1. The bug itself. A browser bundler cannot resolve Node's `module`, and the guard that
//    would skip it is a runtime value, so the specifier must not survive at all.
const MODULE_SPECIFIER = /(?:from\s*["']module["']|import\(\s*["']module["']\s*\))/;
for (const file of esm) {
  if (MODULE_SPECIFIER.test(read(file))) {
    failures.push(`${file} still imports Node's \`module\`; browser builds will fail (#282)`);
  }
}

// 2. The binary the inlined loader looks for, beside the bundle that looks for it.
const wasm = path.join(dist, 'harfbuzz.wasm');
if (!existsSync(wasm) || statSync(wasm).size === 0) {
  failures.push('dist/harfbuzz.wasm is missing or empty; every browser consumer 404s at runtime');
}

// 3. The escape hatch, actually wired. The build asserts the patch was APPLIED; this asserts
//    it survived treeshaking and minification into the emitted glue.
const glue = esm.filter((file) => read(file).includes('harfbuzz.wasm'));
if (glue.length === 0) {
  failures.push('no ESM chunk references harfbuzz.wasm; the runtime was not inlined');
} else if (!glue.some((file) => /\w+\(new URL\("harfbuzz\.wasm",\s*import\.meta\.url\)\.href\)/.test(read(file)))) {
  failures.push(
    'the emitted glue reads harfbuzz.wasm directly; setHarfBuzzWasmUrl is wired to nothing'
  );
}

// 4. The CJS half of the split. It CANNOT inline harfbuzzjs (top-level await), so a change
//    that accidentally inlines it there would break `require()` consumers outright.
if (!cjs.some((file) => /import\(\s*['"]harfbuzzjs['"]\s*\)/.test(read(file)))) {
  failures.push('no CJS chunk imports harfbuzzjs externally; the format split has broken');
}

if (failures.length > 0) {
  console.error('Shipped shaper checks failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`check:shipped-shaper: core's dist ships a browser-resolvable shaper`);
