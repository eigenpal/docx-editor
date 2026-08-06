// Guards the SHIPPED core stylesheet: dist/editor.css must be fully compiled
// (no raw @tailwind directive) and namespaced (utilities and editable-surface
// rules scoped under .docx-editor). See scripts/core-css-assertions.mjs for the
// contract and scripts/build-core-styles.mjs for the build that satisfies it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coreCssProblems } from './core-css-assertions.mjs';

const dist = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'core',
  'dist',
  'editor.css'
);

if (!existsSync(dist)) {
  console.error(
    'check:core-css-compiled: packages/core/dist/editor.css is missing.\n' +
      "Run `bun run --filter '@docx-editor.dev/core' build` first."
  );
  process.exit(1);
}

const problems = coreCssProblems(readFileSync(dist, 'utf8'));
if (problems.length > 0) {
  console.error('check:core-css-compiled: dist/editor.css violates the shipped-CSS contract:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('check:core-css-compiled: dist/editor.css is compiled and .docx-editor-scoped');
