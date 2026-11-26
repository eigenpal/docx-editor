// The `fieldDate` prop reaches the editor from `DocxEditor.Root` and the `DocxEditor` sugar. The
// editor reads it once: a new `Date` with the same time does not warn, a changed time is ignored
// and warns once.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { resetFieldDateWarningForTests } from '../src/editor/field-date-warning.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Thursday 5 March 2026, 14:07 local time. */
const MOMENT = new Date(2026, 2, 5, 14, 7);

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
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('Dated ')}` +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> DATE \\@ "d MMMM yyyy" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      run('1 January 2020') +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:p></w:body></w:document>'
  ),
});

afterEach(cleanup);

/** The text of the first page as laid out. */
function shown(editor: DocxEditorInstance): string {
  return editor
    .surface!.layout()
    .pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? (fragment as { lines: readonly { spans: readonly { text: string }[] }[] }).lines.flatMap(
            (line) => line.spans.map((span) => span.text)
          )
        : []
    )
    .join('');
}

function tree(host: 'root' | 'sugar', fieldDate: Date | undefined, onReady: (e: unknown) => void) {
  const props = fieldDate ? { fieldDate } : {};
  return host === 'root' ? (
    <DocxEditorRoot document={SOURCE} onReady={onReady} {...props}>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  ) : (
    <DocxEditor document={SOURCE} onReady={onReady} {...props} />
  );
}

describe('fieldDate prop', () => {
  for (const host of ['root', 'sugar'] as const) {
    for (const fieldDate of [MOMENT, undefined] as const) {
      test(`${host} ${fieldDate ? 'with' : 'without'} a date`, async () => {
        let instance: DocxEditorInstance | null = null;
        await act(async () => {
          render(
            tree(host, fieldDate, (editor) => {
              instance = editor as DocxEditorInstance;
            })
          );
        });
        expect(shown(instance!)).toBe(fieldDate ? 'Dated 5 March 2026' : 'Dated 1 January 2020');
      });
    }
  }

  test('a new Date with the same time does not warn; a changed time is ignored and warns once', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    const dateWarnings = () => warnings.filter((message) => message.includes('fieldDate changed'));
    resetFieldDateWarningForTests();
    try {
      let instance: DocxEditorInstance | null = null;
      const onReady = (editor: unknown) => {
        instance = editor as DocxEditorInstance;
      };
      let view: ReturnType<typeof render> | null = null;
      await act(async () => {
        view = render(tree('root', MOMENT, onReady));
      });
      const first = instance!;
      await act(async () => {
        view!.rerender(tree('root', new Date(MOMENT.getTime()), onReady));
      });
      expect(dateWarnings()).toHaveLength(0);

      await act(async () => {
        view!.rerender(tree('root', new Date(2030, 0, 1), onReady));
      });
      expect(dateWarnings()).toHaveLength(1);

      // Removing the date is a change too.
      await act(async () => {
        view!.rerender(tree('root', MOMENT, onReady));
      });
      resetFieldDateWarningForTests();
      await act(async () => {
        view!.rerender(tree('root', undefined, onReady));
      });
      expect(dateWarnings()).toHaveLength(2);
      expect(instance).toBe(first);
      expect(shown(first)).toBe('Dated 5 March 2026');
    } finally {
      console.warn = original;
    }
  });
});
