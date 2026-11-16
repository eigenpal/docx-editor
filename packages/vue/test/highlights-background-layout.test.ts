// `useHighlights` counts its ranges again as a large document lays out in the background:
// a range in a paragraph that layout has not reached counts as unavailable until it does.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h, type App } from 'vue';
import { strToU8, zipSync } from 'fflate';
import type { HighlightResult } from '@docx-editor.dev/core/contracts/editor';
import { acceptedTextRanges } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useHighlights } from '../src/editor/useHighlights';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Many plain paragraphs, past the open-yield threshold through a filler part. */
function largeDocx(): Uint8Array {
  const lines: string[] = [];
  for (let line = 1, total = 0; total < 700 * 1024; line += 1) {
    const text = `<l>filler line ${line} carrying a little ordinary sentence text.</l>`;
    lines.push(text);
    total += text.length;
  }
  const body = Array.from(
    { length: 1200 },
    (_, index) => `<w:p><w:r><w:t>Paragraph ${index} has one teh typo.</w:t></w:r></w:p>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'customXml/item1.xml': strToU8(`<filler>${lines.join('')}</filler>`),
  });
}

const apps: { app: App; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { app, container } of apps.splice(0)) {
    app.unmount();
    container.remove();
  }
});

async function until(condition: () => boolean): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 50_000) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('useHighlights counts its ranges again as background layout adds pages', async () => {
  const heard: HighlightResult[] = [];
  let result: { value: HighlightResult } | null = null;
  const Marks = defineComponent({
    setup() {
      result = useHighlights('spelling', (editor) =>
        editor.getParagraphs().flatMap((paragraph) => {
          const at = paragraph.acceptedText.indexOf('teh');
          return at < 0 ? [] : acceptedTextRanges(paragraph, at, at + 3);
        })
      );
      return () => {
        heard.push({ applied: result!.value.applied, unavailable: result!.value.unavailable });
        return null;
      };
    },
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: largeDocx() },
        {
          default: () => [
            h(DocxEditorViewport, null, { default: () => [h(DocxEditorContent)] }),
            h(Marks),
          ],
        }
      ),
  });
  apps.push({ app, container });
  app.mount(container);
  await until(() => result !== null && result.value.applied === 1200);
  expect(result!.value).toMatchObject({ applied: 1200, unavailable: 0 });
  expect(heard.some((entry) => entry.unavailable > 0)).toBe(true);
}, 60_000);
