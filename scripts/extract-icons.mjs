// One-off: parse packages/react/src/components/ui/Icons.tsx and emit
// packages/vue/src/components/ui/icon-paths.json — a `name → string[]`
// map of SVG `d` attributes that the Vue Icons.vue component consumes.
//
// Run with: bun scripts/extract-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'packages/react/src/components/ui/Icons.tsx');
const OUT = resolve(ROOT, 'packages/vue/src/components/ui/icon-paths.json');

const src = readFileSync(SRC, 'utf8');

// Match each `export function IconFoo(props: IconProps) { return (<SvgIcon ...>BODY</SvgIcon>...`
const fnRe = /export function (Icon\w+)\(props: IconProps\)\s*\{\s*return\s*\(\s*<SvgIcon[^>]*>([\s\S]*?)<\/SvgIcon>/g;
const fnPaths = {};
for (const m of src.matchAll(fnRe)) {
  const [, fn, body] = m;
  const paths = [];
  for (const pm of body.matchAll(/<path d="([^"]+)"\s*\/>/g)) paths.push(pm[1]);
  if (paths.length) fnPaths[fn] = paths;
}

// Build kebab-name → fn mapping from the `iconMap` literal.
const block = src.match(/const iconMap[^=]*=\s*\{([\s\S]*?)\n\};/);
const out = {};
if (block) {
  for (const m of block[1].matchAll(/^\s*([\w-]+|'[^']+')\s*:\s*(Icon\w+)/gm)) {
    let key = m[1];
    if (key.startsWith("'")) key = key.slice(1, -1);
    if (fnPaths[m[2]]) out[key] = fnPaths[m[2]];
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`extracted ${Object.keys(fnPaths).length} icons, mapped ${Object.keys(out).length} names → ${OUT}`);
