// The `contentLockPolicy` prop reaches the editor from `DocxEditorRoot` and the `DocxEditor`
// sugar, and a later change is compared by value before it warns.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, shallowRef, type Component } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { ContentLockPolicy, DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { flush } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>ABC</w:t></w:r>` +
      '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:t>TOKEN</w:t></w:r></w:sdtContent></w:sdt>' +
      '<w:r><w:t>DEF</w:t></w:r></w:p></w:body></w:document>'
  ),
});

const POLICY: ContentLockPolicy = { allowFormattingInLockedContent: true };

afterEach(() => {
  document.body.innerHTML = '';
});

/** Mount `component`; `props` is read on every render, so a test can swap it reactively. */
async function mount(component: Component, props: () => Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.append(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        component,
        {
          document: SOURCE,
          ...props(),
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
  return { ready, unmount: () => app.unmount() };
}

/** Select everything, including the locked control, and toggle bold. */
function boldOverLockedControl(editor: DocxEditorInstance): boolean {
  editor.surface!.selectAll();
  const result = editor.exec({ type: 'toggleMark', mark: 'bold' });
  return result.ok && 'changed' in result && result.changed === true;
}

describe('contentLockPolicy prop', () => {
  for (const [host, component] of [
    ['root', DocxEditorRoot],
    ['sugar', DocxEditor],
  ] as const) {
    for (const policy of [POLICY, undefined] as const) {
      test(`${host} ${policy ? 'with' : 'without'} the policy`, async () => {
        const mounted = await mount(component, () => (policy ? { contentLockPolicy: policy } : {}));
        try {
          const editor = mounted.ready.at(-1)!;
          expect(boldOverLockedControl(editor)).toBe(policy !== undefined);
          expect(editor.surface!.session.bodyText()).toBe('ABCTOKENDEF');
        } finally {
          mounted.unmount();
        }
      });
    }
  }

  test('an equal new object does not warn; a changed value is ignored and warns once', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    const policyWarnings = () =>
      warnings.filter((message) => message.includes('contentLockPolicy changed'));
    const policy = shallowRef<ContentLockPolicy | undefined>({
      allowFormattingInLockedContent: true,
    });
    try {
      const mounted = await mount(DocxEditorRoot, () =>
        policy.value ? { contentLockPolicy: policy.value } : {}
      );
      try {
        const first = mounted.ready.at(-1)!;
        policy.value = { allowFormattingInLockedContent: true };
        await flush();
        expect(policyWarnings()).toHaveLength(0);

        policy.value = { allowFormattingInLockedContent: false };
        await flush();
        policy.value = undefined;
        await flush();
        expect(mounted.ready.at(-1)).toBe(first);
        expect(policyWarnings()).toHaveLength(1);
        expect(boldOverLockedControl(first)).toBe(true);
      } finally {
        mounted.unmount();
      }
    } finally {
      console.warn = original;
    }
  });
});
