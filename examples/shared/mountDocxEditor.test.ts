import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strToU8, zipSync } from 'fflate';
import { createDeterministicLayoutShaping } from '@docx-editor.dev/core-contract/layout';
import type { BrowserFontFace, BrowserFontSet } from '@docx-editor.dev/core-contract/editor';
import { createEditableParagraphFixture } from '../../packages/engine-editor/browser/fixtures.ts';
import { mountDocxEditor } from './mountDocxEditor.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const shaping = createDeterministicLayoutShaping({
  families: ['Arial', 'Calibri', 'Times New Roman'],
});

const readOnlyBytes = () =>
  zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    'word/document.xml': strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '</w:body></w:document>'
    ),
  });

function fontRuntime() {
  const faces = new Set<BrowserFontFace>();
  const fontSet: BrowserFontSet = {
    add: (face) => faces.add(face),
    delete: (face) => faces.delete(face),
  };
  return {
    fontSet,
    createFace: (): BrowserFontFace => {
      const face = { load: async () => face };
      return face;
    },
  };
}

test('editable mount installs an explicit mapping before paginated paint', async () => {
  const container = document.createElement('div');
  const mounted = await mountDocxEditor(
    container,
    createEditableParagraphFixture(),
    shaping,
    fontRuntime()
  );

  expect(mounted.driver.editable).toBe(true);
  expect(container.querySelector('.docx-paged-pane')?.children.length).toBeGreaterThan(0);
  mounted.destroy();
});

test('read-only mount installs an explicit mapping before preview paint', async () => {
  const container = document.createElement('div');
  const mounted = await mountDocxEditor(container, readOnlyBytes(), shaping, fontRuntime());

  expect(mounted.driver.editable).toBe(false);
  expect(container.children.length).toBeGreaterThan(0);
  mounted.destroy();
});
