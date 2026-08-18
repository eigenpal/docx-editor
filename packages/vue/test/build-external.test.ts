import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const pkgRoot = join(import.meta.dir, '..');

describe('vue package build output', () => {
  test(
    'dist imports the engine externally when built fresh',
    () => {
      const outDir = mkdtempSync(join(tmpdir(), 'docx-editor-vue-dist-'));
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
        expect(text.includes('@docx-editor.dev/core')).toBe(true);
        expect(text.includes('createLayoutShaping')).toBe(false);
        expect(text.includes('HarfBuzz')).toBe(false);
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 }
  );
});
