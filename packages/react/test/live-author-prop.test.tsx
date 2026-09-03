import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

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
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>abcd</w:t></w:r></w:p></w:body></w:document>`
  ),
});

function select(editor: DocxEditorInstance, start: number, end: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

afterEach(cleanup);

describe('DocxEditor.Root author prop', () => {
  test('applies a changed author without replacing the editor', async () => {
    let instance: DocxEditorInstance | null = null;
    const tree = (author: string) => (
      <DocxEditorRoot
        document={SOURCE}
        author={author}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const view = render(tree('Initial Author'));
    const firstInstance = instance!;

    await act(async () => {
      select(firstInstance, 0, 1);
      firstInstance.exec({ type: 'proposeReplacement', replaceWith: 'X' });
    });
    await act(async () => {
      view.rerender(tree('Updated Author'));
    });
    expect(instance).toBe(firstInstance);
    expect(firstInstance.getConfiguredAuthor()).toBe('Updated Author');

    await act(async () => {
      select(firstInstance, 1, 2);
      firstInstance.exec({ type: 'proposeReplacement', replaceWith: 'Y' });
      await firstInstance.save();
    });
    const xml = serializeOoxmlPart(firstInstance.surface!.session.part());
    expect(xml.match(/w:author="Initial Author"/g)).toHaveLength(2);
    expect(xml.match(/w:author="Updated Author"/g)).toHaveLength(2);
  });
});
