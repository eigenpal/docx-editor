// TEMPORARY review probe. Delete after running.
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

function trigger(view: ReturnType<typeof render>, labelKey: string): HTMLButtonElement {
  const match = [...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger')] //
    .find((button) => button.textContent === labelKey);
  if (!match) throw new Error(`no trigger labelled ${labelKey}`);
  return match;
}

function openPanels(view: ReturnType<typeof render>): number {
  return view.container.querySelectorAll('.docx-menubar__menu').length;
}

afterEach(() => {
  cleanup();
});

describe('probe', () => {
  test('hover-switch then click on the SAME trigger', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    act(() => {
      fireEvent.click(trigger(view, 'toolbar.file'));
    });
    expect(openPanels(view)).toBe(1);
    // Pointer travels to the Insert trigger, then clicks it.
    act(() => {
      fireEvent.mouseEnter(trigger(view, 'toolbar.insert'));
    });
    expect(view.container.querySelector('[data-slot="image.insert"]')).not.toBeNull();
    act(() => {
      fireEvent.click(trigger(view, 'toolbar.insert'));
    });
    console.log('panels after clicking hovered trigger:', openPanels(view));
    expect(openPanels(view)).toBe(1);
  });

  test('submenu: click on parent after hover closes it and it stays closed', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    act(() => {
      fireEvent.click(trigger(view, 'toolbar.insert'));
    });
    const parent = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__submenu')].find(
      (element) => element.textContent?.includes('toolbar.break')
    )!;
    act(() => {
      fireEvent.mouseEnter(parent);
    });
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).not.toBeNull();
    const button = parent.querySelector('button')!;
    act(() => {
      fireEvent.click(button);
    });
    console.log(
      'submenu open after clicking hovered parent:',
      view.container.querySelector('[data-slot="insert.pageBreak"]') !== null
    );
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).not.toBeNull();
  });

  test('submenu stays open after focus with no pointer', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    act(() => {
      fireEvent.click(trigger(view, 'toolbar.insert'));
    });
    const parent = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__submenu')].find(
      (element) => element.textContent?.includes('toolbar.break')
    )!;
    const button = parent.querySelector('button')!;
    act(() => {
      fireEvent.focus(button);
    });
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).not.toBeNull();
    act(() => {
      fireEvent.blur(button);
    });
    console.log(
      'submenu open after blur:',
      view.container.querySelector('[data-slot="insert.pageBreak"]') !== null
    );
  });

  test('save row with no document loaded', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    const { view } = mountMenu(<DocxEditorMenu />, undefined);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      fireEvent.click(trigger(view, 'toolbar.file'));
    });
    const save = view.container.querySelector<HTMLButtonElement>('[data-slot="file.save"]')!;
    console.log('save row disabled with no document:', save.disabled);
    act(() => {
      fireEvent.click(save);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    console.log('unhandled rejections:', rejections.length, rejections[0]);
    process.off('unhandledRejection', onRejection);
  });

  test('ctrl+s fires for every mounted menu, even while typing in an input', async () => {
    let a = 0;
    let b = 0;
    const first = mountMenu(<DocxEditorMenu onSave={() => (a += 1)} />);
    const second = mountMenu(<DocxEditorMenu onSave={() => (b += 1)} />);
    await act(async () => {
      await Promise.resolve();
    });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      fireEvent.keyDown(input, { key: 's', ctrlKey: true, bubbles: true });
    });
    console.log('saves fired from a keystroke in an unrelated input:', a, b);
    void first;
    void second;
  });
});
