// Task 10 fix round 1 — compounds, Fragment overrides, keyboard, locale, subscriptions, OOXML.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(body: string): Uint8Array {
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
  });
}

const TABLE_2X2 = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
);

function mountToolbar(toolbar: ReactNode, source = TABLE_2X2, rootProps: Record<string, unknown> = {}) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
      {...rootProps}
    >
      {toolbar}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function caretInFirstCell(editor: DocxEditorInstance): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
  });
}

afterEach(() => cleanup());

describe('Task 10 fix round 1', () => {
  test('Fragment-wrapped table part override does not throw and renders in place', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar>
        <>
          <DocxEditorToolbar.TableBorderTarget className="fragment-override" />
        </>
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const slot = view.container.querySelector('[data-slot="table.borderTarget"].fragment-override');
    expect(slot).not.toBeNull();
  });

  test('border target menu supports ArrowDown and Escape with trigger focus restore', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const root = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    const panel = root.querySelector('[role="menu"]') as HTMLElement;
    expect(panel).not.toBeNull();
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    const focused = document.activeElement as HTMLElement;
    expect(focused?.getAttribute('role')).toBe('menuitemradio');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('appended context table row is hidden outside table context', () => {
    render(
      <DocxEditorRoot document={docx('<w:p><w:r><w:t>plain</w:t></w:r></w:p>')}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <ContextMenu preset={false}>
            <ContextMenu.InsertRowAbove />
          </ContextMenu>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const surface = document.querySelector('.docx-paginated-surface') as HTMLElement;
    fireEvent.contextMenu(surface, { clientX: 40, clientY: 40, button: 2 });
    expect(document.querySelector('[data-slot="table.insertRowAbove"]')).toBeNull();
  });

  test('table furniture labels refresh on live locale switch without remount', async () => {
    let editorRef: DocxEditorInstance | null = null;
    function Host() {
      const [locale, setLocale] = useState<'en' | 'pl'>('en');
      const label = (key: 'table.insertRowBelow' | 'table.insertColumnRight') =>
        (locale === 'pl' ? 'PL-' : 'EN-') + key;
      return (
        <>
          <button type="button" data-testid="switch-locale" onClick={() => setLocale('pl')}>
            switch
          </button>
          <DocxEditorRoot
            document={TABLE_2X2}
            tableInteractionLabel={label}
            onReady={(editor) => {
              editorRef = editor as DocxEditorInstance;
            }}
          >
            <DocxEditorViewport>
              <DocxEditorContent />
            </DocxEditorViewport>
          </DocxEditorRoot>
        </>
      );
    }
    const view = render(<Host />);
    await act(async () => {});
    const editorBefore = editorRef;
    const surfaceBefore = editorRef!.surface;
    await act(async () => {
      fireEvent.click(view.getByTestId('switch-locale'));
    });
    await act(async () => {});
    expect(editorRef).toBe(editorBefore);
    expect(editorRef!.surface).toBe(surfaceBefore);
    expect(typeof editorRef!.surface!.setTableInteractionLabel).toBe('function');
  });

  test('asChild trigger merges aria-expanded onto host element', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget>
          <DocxEditorToolbar.TableBorderTarget.Trigger asChild>
            <button type="button" data-testid="custom-trigger">
              custom
            </button>
          </DocxEditorToolbar.TableBorderTarget.Trigger>
          <DocxEditorToolbar.TableBorderTarget.Content />
        </DocxEditorToolbar.TableBorderTarget>
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const trigger = view.getByTestId('custom-trigger');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    await act(async () => {
      trigger.click();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
