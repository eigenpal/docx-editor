import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

import type {
  ParagraphBreakPayload,
  ParagraphCacheDiagnostics,
} from '../../packages/core/src/layout/paragraph-cache-diagnostics.ts';
import type { LayoutCacheStats } from '../../packages/core/src/layout/layout-cache.ts';

// fflate is a core workspace dependency, not a root script dependency.
const { strToU8, zipSync } = createRequire(
  new URL('../../packages/core/package.json', import.meta.url)
)('fflate') as {
  strToU8(value: string): Uint8Array;
  zipSync(files: Record<string, Uint8Array>): Uint8Array;
};

interface Scenario {
  name: string;
  target: { paragraphIndex: number; paragraphId: string };
  work: { cache: LayoutCacheStats };
  cacheDiagnostics?: {
    beforeEdit: ParagraphCacheDiagnostics;
    afterEdit: ParagraphCacheDiagnostics;
    payload: ParagraphBreakPayload;
  };
}

// Exercise the actual CLI and replay with a small real DOCX, keeping this independent
// of the large performance fixtures and their hardware-sensitive timing values.
test('cache diagnostics are opt-in and preserve each measured scenario’s work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'edit-bench-diagnostics-'));
  try {
    const fixture = join(directory, 'fixture.docx');
    const paragraphs = Array.from(
      { length: 24 },
      (_, index) => `<w:p><w:r><w:t>paragraph ${index} ${'word '.repeat(20)}</w:t></w:r></w:p>`
    ).join('');
    writeFileSync(
      fixture,
      zipSync({
        '[Content_Types].xml': strToU8(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '</Types>'
        ),
        '_rels/.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            '</Relationships>'
        ),
        'word/document.xml': strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
            paragraphs +
            '<w:sectPr><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>' +
            '</w:body></w:document>'
        ),
      })
    );
    const run = (flags: string[]) => {
      const child = Bun.spawnSync({
        cmd: [
          process.execPath,
          'scripts/bench/edit-bench.ts',
          fixture,
          '--runs',
          '2',
          '--warmup',
          '1',
          '--json',
          ...flags,
        ],
        cwd: resolve(import.meta.dir, '../..'),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(child.exitCode, child.stderr.toString()).toBe(0);
      return JSON.parse(child.stdout.toString()) as { scenarios: Scenario[] };
    };
    const baseline = run([]);
    const inspected = run(['--cache-diagnostics']);
    expect(baseline.scenarios.length).toBeGreaterThan(1);
    expect(inspected.scenarios.length).toBe(baseline.scenarios.length);
    for (const [index, scenario] of baseline.scenarios.entries()) {
      expect(Object.hasOwn(scenario, 'cacheDiagnostics')).toBe(false);
      const replay = inspected.scenarios[index]!;
      expect(replay.name).toBe(scenario.name);
      expect(replay.target).toEqual(scenario.target);
      expect(replay.work).toEqual(scenario.work);
      const diagnostics = replay.cacheDiagnostics!;
      expect(diagnostics).toBeDefined();
      const { hits, misses, evictions, size } = diagnostics.afterEdit;
      expect({ hits, misses, evictions, size }).toEqual(replay.work.cache);
      expect(diagnostics.afterEdit.misses).toBeGreaterThanOrEqual(diagnostics.beforeEdit.misses);
      expect(diagnostics.payload.uniqueLines).toBeGreaterThan(0);
      expect(diagnostics.payload.uniqueSpans).toBeGreaterThan(0);
      expect(diagnostics.payload.spanTextBytes).toBeGreaterThan(0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
