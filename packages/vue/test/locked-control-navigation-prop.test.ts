// The `lockedControlNavigation` prop reaches the editor from `DocxEditorRoot` and the
// `DocxEditor` sugar. The editor reads it once, at creation.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, shallowRef, type Component } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance, LockedControlNavigation } from '@docx-editor.dev/core/editor';
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
/** "aa" [2,7) "TOKEN" "zz": the content-locked control covers offsets 2..7. */
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('aa')}` +
      '<w:sdt><w:sdtPr><w:alias w:val="T"/><w:lock w:val="sdtContentLocked"/><w:text/></w:sdtPr>' +
      `<w:sdtContent>${run('TOKEN')}</w:sdtContent></w:sdt>` +
      `${run('zz')}</w:p></w:body></w:document>`
  ),
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function mount(component: Component, initial: LockedControlNavigation | undefined) {
  const container = document.createElement('div');
  document.body.append(container);
  const ready: DocxEditorInstance[] = [];
  const navigation = shallowRef<LockedControlNavigation | undefined>(initial);
  const app = createApp({
    render: () =>
      h(
        component,
        {
          document: SOURCE,
          ...(navigation.value !== undefined ? { lockedControlNavigation: navigation.value } : {}),
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
  return {
    ready,
    editor: ready.at(-1)!,
    async set(value: LockedControlNavigation | undefined) {
      navigation.value = value;
      await flush();
    },
    unmount: () => app.unmount(),
  };
}

/** Place the caret at offset 2, on the control's left edge, press ArrowRight, read the head. */
function stepRightFromLeftEdge(editor: DocxEditorInstance): number {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const point = { paragraphId, offset: 2 };
  surface.setSelection({ anchor: point, head: point });
  surface.navigate('right');
  return surface.state().selection.head.offset;
}

describe('lockedControlNavigation prop', () => {
  for (const [host, component] of [
    ['root', DocxEditorRoot],
    ['sugar', DocxEditor],
  ] as const) {
    for (const navigation of ['atomic', undefined] as const) {
      test(`${host} with ${navigation ?? 'the default'}`, async () => {
        const mounted = await mount(component, navigation);
        try {
          expect(stepRightFromLeftEdge(mounted.editor)).toBe(navigation === 'atomic' ? 7 : 3);
        } finally {
          mounted.unmount();
        }
      });
    }
  }

  // The warning prints once per module, so the silent cases run before the warning case.
  test('a changed prop is ignored and warns once, only for a real change', async () => {
    const messages: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      messages.push(String(args[0]));
    };
    const count = () =>
      messages.filter((message) => message.includes('lockedControlNavigation changed')).length;
    const mounted = await mount(DocxEditorRoot, undefined);
    try {
      const first = mounted.editor;
      for (const navigation of [undefined, 'characters', 'characters', undefined] as const) {
        await mounted.set(navigation);
      }
      expect(count()).toBe(0);

      await mounted.set('atomic');
      await mounted.set('characters');
      await mounted.set('atomic');
      expect(count()).toBe(1);
      expect(mounted.ready.at(-1)).toBe(first);
      expect(stepRightFromLeftEdge(first)).toBe(3);
    } finally {
      console.warn = original;
      mounted.unmount();
    }
  });
});
