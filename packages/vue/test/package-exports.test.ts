import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgRoot = join(import.meta.dir, '..');
const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
  exports: { '.': { import: string; require: string } };
};

describe('@docx-editor.dev/vue export map', () => {
  test('import and require conditions match the tsup output names', () => {
    expect(manifest.exports['.'].import).toBe('./dist/index.js');
    expect(manifest.exports['.'].require).toBe('./dist/index.cjs');
  });

  test('styles.css export resolves to a non-empty file', () => {
    const stylesPath = join(pkgRoot, 'src/styles/editor.css');
    expect(readFileSync(stylesPath, 'utf8').length).toBeGreaterThan(0);
  });
});
