// The `fieldResults` prop reaches the editor from `DocxEditorRoot` and the `DocxEditor` sugar.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, type Component } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { flush } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('ab ')}` +
      '<w:fldSimple w:instr=" MERGEFIELD Name "><w:r><w:t>Name</w:t></w:r></w:fldSimple>' +
      `${run(' cd')}</w:p></w:body></w:document>`
  ),
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function mount(component: Component, props: Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.append(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        component,
        {
          document: SOURCE,
          ...props,
          onReady: (editor: unknown) => ready.push(editor as DocxEditorInstance),
        },
        component === DocxEditorRoot
          ? {
              default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
            }
          : undefined
      ),
  });
  app.mount(container);
  await flush();
  return { editor: ready.at(-1)!, unmount: () => app.unmount() };
}

/** Type at offset 5, inside the result in the editable mode, and read the paragraph back. */
function typeInsideResult(editor: DocxEditorInstance): string | null {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const point = { paragraphId, offset: 5 };
  surface.setSelection({ anchor: point, head: point });
  surface.type('X');
  return paragraphTextOf(surface.session.part(), paragraphId, { fieldResults: 'editable' });
}

describe('fieldResults prop', () => {
  for (const [host, component] of [
    ['root', DocxEditorRoot],
    ['sugar', DocxEditor],
  ] as const) {
    for (const mode of ['editable', undefined] as const) {
      test(`${host} with ${mode ?? 'the default'}`, async () => {
        const mounted = await mount(component, mode ? { fieldResults: mode } : {});
        try {
          expect(typeInsideResult(mounted.editor)).toBe(
            mode === 'editable' ? 'ab NaXme cd' : 'ab Name Xcd'
          );
        } finally {
          mounted.unmount();
        }
      });
    }
  }
});
