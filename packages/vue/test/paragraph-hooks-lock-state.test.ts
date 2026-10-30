// oxlint-disable react-hooks/rules-of-hooks -- Vue composables run in setup.
// The ruler and paragraph dialog composables follow the caret into and out of protected content.
import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { strToU8, zipSync } from 'fflate';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useParagraphIndent } from '../src/editor/useParagraphIndent';
import { useParagraphFormat } from '../src/editor/useParagraphFormat';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const doc = (body: string) =>
  zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
const LOCKED =
  '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
  '<w:p><w:r><w:t>Locked title</w:t></w:r></w:p></w:sdtContent></w:sdt>';
const BOUND =
  '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:dataBinding w:storeItemID="{1}" w:xpath="/a"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>Bound title</w:t></w:r></w:p></w:sdtContent></w:sdt>';
const BOUND_LOCKED =
  '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="contentLocked"/>' +
  '<w:dataBinding w:storeItemID="{1}" w:xpath="/a"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>Bound title</w:t></w:r></w:p></w:sdtContent></w:sdt>';
const FREE = '<w:p><w:r><w:t>Free text</w:t></w:r></w:p>';

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => queueMicrotask(resolve));
  await new Promise((resolve) => setTimeout(resolve, 150));
}

afterEach(() => {
  document.body.innerHTML = '';
});

// Indents and alignment pass a content lock, and a data binding mirrors only the text, so the
// ruler and the dialog stay available in both, as in a binding that also locks its content.
for (const [name, first] of [
  ['a content lock', LOCKED],
  ['a data binding', BOUND],
  ['a data binding with a content lock', BOUND_LOCKED],
] as const) {
  test(`ruler and dialog state follow the caret out of and back into ${name}`, async () => {
    let state: { indent: boolean; format: boolean } = { indent: false, format: false };
    const Probe = defineComponent({
      setup() {
        const indent = useParagraphIndent();
        const format = useParagraphFormat();
        return () => {
          state = { indent: indent.isEnabled.value, format: format.isEnabled.value };
          return null;
        };
      },
    });
    let editor: DocxEditorInstance | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: doc(first + FREE),
            onReady: (ready: Editor) => {
              editor = ready as DocxEditorInstance;
            },
          },
          {
            default: () =>
              h(DocxEditorViewport, null, { default: () => [h(Probe), h(DocxEditorContent)] }),
          }
        ),
    });
    app.mount(container);
    for (let attempt = 0; attempt < 20 && !editor; attempt += 1) await flush();
    const mounted = editor! as DocxEditorInstance;
    const ids = mounted.surface!.session.paragraphIds();
    const put = async (index: number) => {
      const at = { paragraphId: ids[index]!, offset: 1 };
      mounted.surface!.setSelection({ anchor: at, head: at });
      await flush();
      return state;
    };
    expect(await put(0)).toEqual({ indent: true, format: true });
    expect(await put(1)).toEqual({ indent: true, format: true });
    expect(await put(0)).toEqual({ indent: true, format: true });
    // A real refusal: the document open for viewing takes both away, in and out of the control.
    expect(mounted.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    await flush();
    expect(await put(0)).toEqual({ indent: false, format: false });
    expect(await put(1)).toEqual({ indent: false, format: false });
    app.unmount();
  });
}
