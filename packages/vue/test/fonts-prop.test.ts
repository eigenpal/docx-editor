// `fonts` replaces fonts in place through both Vue hosts.
import './dom-setup.ts';
import { describe, expect, test } from 'bun:test';
import { createApp, h, shallowRef } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance, FontResolver } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { flush } from './helpers/mount';
import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Fonts stay in place</w:t></w:r></w:p></w:body></w:document>`
  ),
});

/** A resolver that records each request under `name` and supplies nothing. */
function resolver(name: string, calls: string[]): FontResolver {
  return async () => {
    calls.push(name);
    return undefined;
  };
}

type Host = 'root' | 'sugar';
function tree(host: Host, props: Record<string, unknown>) {
  return host === 'sugar'
    ? h(DocxEditor, props)
    : h(DocxEditorRoot, props, {
        default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
      });
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

describe('fonts prop', () => {
  for (const host of ['root', 'sugar'] as const) {
    test(`${host}: a new value replaces the fonts in the same editor`, async () => {
      const calls: string[] = [];
      const fonts = shallowRef(resolver('first', calls));
      const ready: Editor[] = [];
      const container = document.createElement('div');
      document.body.append(container);
      const app = createApp({
        render: () =>
          tree(host, {
            document: SOURCE,
            fonts: fonts.value,
            onReady: (e: Editor) => ready.push(e),
          }),
      });
      try {
        app.mount(container);
        await flush();
        await settle();
        expect(ready).toHaveLength(1);
        const editor = ready[0] as DocxEditorInstance;
        const session = editor.surface?.session;
        const second = resolver('second', calls);
        fonts.value = second;
        await flush();
        await settle();
        // No remount: one editor, one session, and the new resolver was asked.
        expect(ready).toHaveLength(1);
        expect(editor.surface?.session).toBe(session);
        expect(calls).toEqual(['first', 'second']);
      } finally {
        app.unmount();
        container.remove();
      }
    });
  }
});
