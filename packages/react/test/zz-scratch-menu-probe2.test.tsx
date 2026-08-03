// TEMPORARY review probe 2. Delete after running.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';

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

function mountMenu(
  menu: ReactNode,
  source: Uint8Array | undefined = SOURCE
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      {...(source ? { document: source } : {})}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {menu}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

afterEach(() => {
  cleanup();
});

describe('probe2', () => {
  test('generic Menu child with an explicit id is NOT recognized as an override', () => {
    const { view } = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.Menu id="file" className="mine" />
      </DocxEditorMenu>
    );
    const bar = view.getByTestId('docx-menubar');
    const ids = [...bar.children].map((child) => child.getAttribute('data-menu'));
    console.log('bar menus:', ids);
    const fileTriggers = [
      ...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger'),
    ].filter((button) => button.textContent === 'toolbar.file');
    console.log('file triggers:', fileTriggers.length);
    act(() => {
      fireEvent.click(fileTriggers[0]!);
    });
    console.log('open panels after one click:', view.container.querySelectorAll('[role="menu"]').length);
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);
  });

  test('editor.save() rejects with no document', async () => {
    const { editor } = mountMenu(<DocxEditorMenu />, undefined);
    await act(async () => {
      await Promise.resolve();
    });
    let outcome = 'resolved';
    try {
      await editor().save();
    } catch (error) {
      outcome = `rejected: ${(error as Error).message ?? String(error)}`;
    }
    console.log('save with no document:', outcome);
  });

  test('cmd+s while typing in the editor surface still preventDefaults', async () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    await act(async () => {
      await Promise.resolve();
    });
    const event = new KeyboardEvent('keydown', {
      key: 'o',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    console.log('ctrl+o preventDefaulted:', event.defaultPrevented);
    void view;
  });
});
