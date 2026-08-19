import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const pkgRoot = join(import.meta.dir, '..');

describe('vue package build output', () => {
  test(
    'dist imports the engine externally when built fresh',
    async () => {
      const outDir = mkdtempSync(join(pkgRoot, '.test-dist-'));
      try {
        const result = spawnSync(
          'bunx',
          ['tsup', '--config', 'tsup.config.ts', '--out-dir', outDir],
          {
            cwd: pkgRoot,
            encoding: 'utf8',
            timeout: 120_000,
          }
        );
        expect(result.status).toBe(0);
        const text = readFileSync(join(outDir, 'index.js'), 'utf8');
        const cjsText = readFileSync(join(outDir, 'index.cjs'), 'utf8');
        expect(text.includes('@docx-editor.dev/core')).toBe(true);
        expect(text.includes('createLayoutShaping')).toBe(false);
        expect(text.includes('HarfBuzz')).toBe(false);
        expect(cjsText.length).toBeGreaterThan(0);
        const esm = await import(pathToFileURL(join(outDir, 'index.js')).href);
        const require = createRequire(import.meta.url);
        const cjs = require(join(outDir, 'index.cjs'));
        expect(esm.DocxEditorRoot).toBeDefined();
        expect(cjs.DocxEditorRoot).toBeDefined();
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 }
  );
});
