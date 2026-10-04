// A symbol (`w:sym`) is one character to the caret: one arrow press steps over it, and one
// Backspace or Delete removes it. Undo brings it back.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { paragraphTextOf } from '../../store/store/tree-op-apply.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
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
}

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(
    container,
    docx('<w:p><w:r><w:t>a</w:t><w:sym w:font="Wingdings" w:char="F0FC"/><w:t>b</w:t></w:r></w:p>'),
    { scale: 1 }
  );
  if (!opened.ok) throw new Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  const surface = opened.surface;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  return {
    surface,
    paragraphId,
    text: () => paragraphTextOf(surface.session.part(), paragraphId),
    press: (key: string) =>
      pages.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
    caret: (offset: number) =>
      surface.setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset },
      }),
  };
}

test('one arrow press steps over a symbol', () => {
  const host = mount();
  expect(host.text()).toBe('a(b');
  host.caret(1);
  host.press('ArrowRight');
  expect(host.surface.state().selection.head.offset).toBe(2);
  host.press('ArrowLeft');
  expect(host.surface.state().selection.head.offset).toBe(1);
});

test('Backspace and Delete remove the symbol, and undo restores it', () => {
  const host = mount();
  host.caret(2);
  host.surface.deleteBackward();
  expect(host.text()).toBe('ab');
  expect(host.surface.state().selection.head.offset).toBe(1);
  host.surface.undo();
  expect(host.text()).toBe('a(b');

  host.caret(1);
  host.surface.deleteForward();
  expect(host.text()).toBe('ab');
});
