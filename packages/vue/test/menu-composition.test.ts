import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { CHROME_MENUS } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
// Bundled menu chrome shares one Vue runtime with the test harness (Bun TSX otherwise
// loads a second copy and JSX components stringify as "[object Object]").
import { DocxEditorMenu } from '../dist/index.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorMenu composition', () => {
  test('renders registry menus on the default bar', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          { document: SOURCE },
          {
            default: () => [
              h(DocxEditorMenu),
              h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
            ],
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      const bar = container.querySelector('[data-testid="docx-menubar"]');
      expect(bar).not.toBeNull();
      const menuIds = CHROME_MENUS.map((menu) => menu.id);
      for (const id of menuIds) {
        expect(bar!.querySelector(`[data-menu="${id}"]`)).not.toBeNull();
      }
    } finally {
      app.unmount();
      container.remove();
    }
  });
});
