import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repositoryRoot = join(import.meta.dir, '..', '..', '..');
const source = (...parts: string[]): string => readFileSync(join(repositoryRoot, ...parts), 'utf8');
const markdownSource = source('packages/docx-to-markdown/src/markdown.ts');
const markdownInlineSource = source('packages/docx-to-markdown/src/markdown-inline.ts');
const exportSessionSource = source('packages/core/src/export/export-session.ts');
const browserSurfaceSource = source('packages/core/src/editor/paginated-surface.ts');
const recordQueriesSource = source('packages/core/src/layout/semantic-record-queries.ts');
const markdownPolicySource = source('packages/docx-to-markdown/src/markdown-semantic-policy.ts');
const wrapperSource = source('packages/docx-to-markdown/src/index.ts');
const shapingSource = source('packages/core/src/layout/layout-shaping.ts');
const coordinatorSource = source('packages/core/src/layout/document-layout-coordinator.ts');
const multiSectionSource = source('packages/core/src/layout/multi-section-layout.ts');
const contentControlBoundarySource = source(
  'packages/core/src/layout/content-control-boundary-layout.ts'
);

test('the Markdown translator remains a semantic-record-only consumer', () => {
  const translatorSource = markdownSource + markdownInlineSource;
  expect(translatorSource).not.toMatch(/from\s+['"][^'"]*\/store/);
  expect(translatorSource).not.toMatch(
    /\b(?:readOoxml|parseOoxml|serializeOoxml|currentPackage)\b/
  );
  const externalImports = [...translatorSource.matchAll(/from\s+['"]((?!\.)[^'"]+)['"]/g)].map(
    (match) => match[1]
  );
  expect(new Set(externalImports)).toEqual(
    new Set(['@docx-editor.dev/core/layout', '@docx-editor.dev/core/export'])
  );
});

test('browser and exporter compose final layout through the same neutral coordinator', () => {
  for (const source of [browserSurfaceSource, exportSessionSource]) {
    expect(source).toContain('layoutDocumentView(');
    expect(source).toContain(
      'satisfies LayoutDocumentViewOptions & Record<keyof LayoutDocumentViewOptions, unknown>'
    );
    expect(source).not.toContain('layoutSemanticDocument(');
    expect(source).not.toContain('createDocumentNotesInput(');
  }
});

test('export resource settlement uses the canonical recursive story walk', () => {
  expect(exportSessionSource).toContain('forEachSemanticDrawing(layout');
  expect(exportSessionSource).not.toContain('forEachStoryDrawing(');
  expect(exportSessionSource).not.toContain('blocksHavePendingImages');
});

test('root stories and drawing provenance have one evolution-gated authority', () => {
  expect(recordQueriesSource).toContain('satisfies Record<keyof PageRecord, StoryFieldRole>');
  expect(recordQueriesSource).toContain('satisfies Record<PageStoryField, true>');
  expect(recordQueriesSource).toContain('export function forEachSemanticStory(');
  expect(recordQueriesSource).toContain('export function forEachSemanticDrawing(');
});

test('Markdown policy exhausts output-affecting unions as well as record fields', () => {
  expect(markdownPolicySource).toContain('Record<RevisionKind, MarkdownFieldPolicy>');
  expect(markdownPolicySource).toContain('Record<RevisionDisplayMode, MarkdownFieldPolicy>');
  expect(markdownPolicySource).toContain(
    "Record<ParagraphFragmentRecord['alignment'], MarkdownFieldPolicy>"
  );
  expect(markdownPolicySource).toContain(
    "Record<NonNullable<StyleSpanRecord['noteNav']>['direction'], MarkdownFieldPolicy>"
  );
});

test('one-shot APIs keep layout options out of record-only translation', () => {
  const oneShot = wrapperSource.slice(
    wrapperSource.indexOf('export async function exportMarkdown(')
  );
  expect(oneShot).toContain('translateMarkdownLayout(layout)');
  expect(oneShot).not.toContain('translateMarkdownLayout(layout, options)');
  expect(oneShot.indexOf('opened.session.dispose()')).toBeLessThan(
    oneShot.indexOf('translateMarkdownLayout(layout)')
  );
});

test('font configuration sampling and cache identity both exhaust every public key', () => {
  expect(shapingSource.match(/Record<keyof LayoutFontConfiguration, unknown>/g)).toHaveLength(2);
});

test('the coordinator exhausts every input at both downstream composition sinks', () => {
  expect(coordinatorSource).toContain(
    'Record<keyof LayoutDocumentViewOptions, LayoutDocumentViewSink>'
  );
  expect(coordinatorSource).toContain("Record<CoordinatorInputsFor<'notes'>, unknown>");
  expect(coordinatorSource).toContain('Record<keyof CreateDocumentNotesInputOptions, unknown>');
  expect(coordinatorSource).toContain("Record<CoordinatorInputsFor<'semantic-layout'>, unknown>");
  expect(browserSurfaceSource).toContain('Record<keyof SurfaceFurnitureOptions, unknown>');
  expect(exportSessionSource).toContain(
    'Record<keyof CreateDocumentFurnitureSourceOptions, unknown>'
  );
});

test('layout transforms preserve evolving top-level metadata or classify constructor ownership', () => {
  expect(contentControlBoundarySource).toMatch(/return \{\s*\.\.\.source,\s*revision:/);
  expect(multiSectionSource).toContain('Record<keyof SemanticLayout, MultiSectionLayoutFieldRole>');
  expect(multiSectionSource).toContain('{ ...freshlyFinalized, pages: merged }');
});
