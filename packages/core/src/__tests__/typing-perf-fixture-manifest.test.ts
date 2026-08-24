import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('typing-perf-521pp fixture manifest', () => {
  test('matches the committed manifest fields', () => {
    const manifestPath = new URL(
      '../../../../e2e/fixtures/typing-perf-521pp.manifest.json',
      import.meta.url
    );
    const fixturePath = new URL('../../../../e2e/fixtures/typing-perf-521pp.docx', import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      fixtures: Record<string, { sha256: string; byteSize: number; expectedPageCount: number }>;
    };
    const entry = manifest.fixtures['typing-perf-521pp.docx'];
    expect(entry).toBeDefined();

    const bytes = readFileSync(fixturePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.byteLength).toBe(entry.byteSize);
    expect(digest).toBe(entry.sha256);
    expect(entry.expectedPageCount).toBe(521);
  });
});
