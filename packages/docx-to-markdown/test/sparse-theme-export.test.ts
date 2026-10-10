import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '../src/index.ts';

describe('documents whose theme lacks optional font schemes', () => {
  // The demo document's theme has no East Asian, complex-script, or supplemental faces.
  // The style cascade once hashed those `undefined` faces into its cache token, and the
  // comparator behind the hash refused them, so headless export failed outright.
  test('export instead of failing in the style cascade cache key', async () => {
    const bytes = await readFile(new URL('../../../e2e/fixtures/demo.docx', import.meta.url));
    const result = await exportMarkdown(bytes);
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.markdown.length).toBeGreaterThan(0);
  });
});
