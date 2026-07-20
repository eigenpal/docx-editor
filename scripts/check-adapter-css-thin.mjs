#!/usr/bin/env node
/**
 * Guards the single-source-of-truth invariant for editor UI styling:
 * the React and Vue adapter `src/styles/editor.css` files must ONLY import the
 * shared core stylesheet (packages/core/src/styles/editor.css) — no tokens, no
 * @tailwind directive, no UI rules forked into one adapter. The Vue copy is
 * allowed a small, explicit set of documented Vue-only rules.
 *
 * If this fails, you almost certainly added a style to an adapter editor.css.
 * Move it to packages/core/src/styles/editor.css instead.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_IMPORT = "@import '../../../core/src/styles/editor.css';";

// Both adapters' editor.css must be 100% thin (import-only) — there are no
// adapter-only CSS rules. If you think you need one, prove it can't live in
// the shared core stylesheet first.
const VUE_ALLOWED_BLOCKS = [];

/** Strip CSS/JS comments and the core @import line, then return what's left. */
function residual(css, { allowBlocks = [] } = {}) {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
  s = s.replace(/@import\s+['"][^'"]+core\/src\/styles\/editor\.css['"];?/g, '');
  for (const re of allowBlocks) s = s.replace(re, '');
  return s.trim();
}

const checks = [
  { file: 'packages/react/src/styles/editor.css', allowBlocks: [] },
  { file: 'packages/vue/src/styles/editor.css', allowBlocks: VUE_ALLOWED_BLOCKS },
];

const failures = [];
for (const { file, allowBlocks } of checks) {
  const css = readFileSync(join(repoRoot, file), 'utf8');
  if (!css.includes(CORE_IMPORT)) {
    failures.push(`${file}: must @import the shared core stylesheet ("${CORE_IMPORT}").`);
  }
  const leftover = residual(css, { allowBlocks });
  if (leftover.length > 0) {
    failures.push(
      `${file}: contains adapter-local styling that should live in the shared core stylesheet ` +
        `(packages/core/src/styles/editor.css). Offending residue:\n` +
        leftover.split('\n').map((l) => `    ${l}`).join('\n')
    );
  }
}

if (failures.length) {
  console.error('✘ adapter editor.css is not thin (single-source-of-truth violation):\n');
  console.error(failures.join('\n\n'));
  console.error('\nMove shared UI styling into packages/core/src/styles/editor.css.');
  process.exit(1);
}
console.log('✓ adapter editor.css files are thin (shared styling lives in core).');
