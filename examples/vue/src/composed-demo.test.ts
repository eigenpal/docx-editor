import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

describe('composed vue demo surface', () => {
  test('exports a composed demo entry with parity markers', () => {
    const source = readFileSync(resolve(root, 'src/ComposedEditorDemo.vue'), 'utf8');
    expect(source).toContain('data-testid="composed-mount"');
    expect(source).toContain('DocxEditorRoot');
    expect(source).toContain('DocxEditorToolbar');
    expect(source).toContain('DocxEditorNavigation');
    expect(source).toContain('DocxEditorHorizontalRuler');
    expect(source).toContain('DocxEditorVerticalRuler');
    expect(source).toContain('useDocxSource');
    expect(source).not.toContain('DocxEditorReview');
  });

  test('main bootstraps the composed demo from fixture params', () => {
    const source = readFileSync(resolve(root, 'src/main.ts'), 'utf8');
    expect(source).toContain('ComposedEditorDemo');
    expect(source).toContain('sample.docx');
    expect(source).toContain('PreviewBanner');
  });
});
