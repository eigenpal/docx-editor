#!/usr/bin/env node
/**
 * Scaffold the Vue adapter tree from React sources.
 * Pure .ts files copy with import fixes; composables get a Vue stub header.
 * TSX files are listed for manual port — run before filling in defineComponent bodies.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REACT_SRC = join(ROOT, 'packages/react/src');
const VUE_SRC = join(ROOT, 'packages/vue/src');

const SKIP_PATHS = [
  'managers',
  'hooks',
  'components/Toolbar.tsx',
  'components/TitleBar.tsx',
  'components/DocxEditor/DocxEditorShell.tsx',
  'components/PaginatedDocxEditorShell.tsx',
  'components/EditorToolbar.tsx',
  'components/EditorToolbarContext.tsx',
  'editor/loading-snapshot.ts',
];

function shouldSkip(rel) {
  return SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(base, full);
    if (shouldSkip(rel)) continue;
    if (statSync(full).isDirectory()) walk(full, base, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

function transformTs(content, rel) {
  let out = content;
  out = out.replace(/from 'react'/g, "from 'vue'");
  out = out.replace(/from "react"/g, 'from "vue"');
  out = out.replace(/ReactNode/g, 'VNode');
  out = out.replace(/\.tsx'/g, ".ts'");
  out = out.replace(/\.tsx"/g, '.ts"');
  if (rel.startsWith('editor/use') || rel === 'useEditorSnapshot.ts') {
    out = `// AUTO-SCAFFOLDED — verify Vue reactivity wiring.\n${out}`;
  }
  return out;
}

mkdirSync(VUE_SRC, { recursive: true });
cpSync(join(REACT_SRC, 'styles/editor.css'), join(VUE_SRC, 'styles/editor.css'));

const files = walk(REACT_SRC, REACT_SRC);
let copied = 0;
let tsxPending = 0;
for (const rel of files) {
  const src = join(REACT_SRC, rel);
  const destRel = rel.replace(/\.tsx$/, '.ts');
  const dest = join(VUE_SRC, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  const raw = readFileSync(src, 'utf8');
  if (rel.endsWith('.tsx')) {
    tsxPending++;
    writeFileSync(
      dest,
      `// TODO: port ${rel} to defineComponent + h()\nexport {};\n`
    );
  } else {
    writeFileSync(dest, transformTs(raw, rel));
    copied++;
  }
}

console.log(`Scaffold: ${copied} .ts copied, ${tsxPending} .tsx stubbed`);
