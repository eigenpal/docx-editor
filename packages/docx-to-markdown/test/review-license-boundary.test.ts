import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '../src/index.ts';
import { docx } from './fixture.ts';

// Review extraction belongs to the Apache-2.0 converter. It must not require the
// Pro editing module or license configuration, including for revision projections.
test('exports comments through the one-shot API without Pro configuration', async () => {
  const docxBytes = new Uint8Array(
    await readFile(new URL('../../../examples/vite/public/sample.docx', import.meta.url))
  );
  const result = await exportMarkdown(docxBytes);
  expect(result.reviewArtifacts.some((artifact) => artifact.kind === 'comment')).toBe(true);
  expect(result.pages.some((page) => page.comments.length > 0)).toBe(true);
  expect(result.reviewBindings.some((binding) => binding.artifactKind === 'comment')).toBe(true);
});

test('exports tracked changes in every display mode without Pro configuration', async () => {
  const docxBytes = docx(
    '<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:delText>Old</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="Reviewer"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
  );
  for (const [displayMode, markdown] of [
    ['all-markup', '~~Old~~New'],
    ['proposed', 'New'],
    ['original', 'Old'],
  ] as const) {
    const result = await exportMarkdown(docxBytes, { displayMode });
    expect(result.markdown).toBe(markdown);
    expect(result.reviewArtifacts.some((artifact) => artifact.kind === 'tracked-change')).toBe(
      true
    );
    expect(result.pages.some((page) => page.trackedChanges.length > 0)).toBe(true);
  }
});

test('ships review conversion under Apache-2.0 without a Pro dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.license).toBe('Apache-2.0');
  for (const dependencies of [
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.devDependencies,
  ]) {
    expect(dependencies?.['@docx-editor.dev/pro']).toBeUndefined();
  }
});
