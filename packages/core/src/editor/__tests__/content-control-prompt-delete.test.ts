// A control that shows its prompt keeps the whole prompt when you press Delete or Backspace
// inside it, as Word keeps it. The prompt is one unit: the first keystroke replaces it, and
// a deletion in it leaves it as it was, with the placeholder state still true.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';
import { readOoxmlPackage } from '../../store/index.ts';
import { applyTreeOp } from '../../store/store/tree-op-apply.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const PROMPT = 'Click here to enter text.';
/** "A " + prompt (offsets 2–27) + " B". */
const INLINE =
  '<w:p>' +
  run('A ') +
  '<w:sdt><w:sdtPr><w:tag w:val="value"/><w:showingPlcHdr/><w:text/></w:sdtPr>' +
  `<w:sdtContent>${run(PROMPT)}</w:sdtContent></w:sdt>` +
  run(' B') +
  '</w:p>';

const mounted: (() => void)[] = [];
afterEach(() => mounted.splice(0).forEach((cleanup) => cleanup()));

function mount(body: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  mounted.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

function caret(surface: PaginatedSurface, offset: number): void {
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

const cases: readonly [string, number, (surface: PaginatedSurface) => void][] = [
  ['Delete at the start of the prompt', 2, (surface) => surface.deleteForward()],
  ['Backspace at the end of the prompt', 27, (surface) => surface.deleteBackward()],
  ['Backspace inside the prompt', 8, (surface) => surface.deleteBackward()],
  ['Delete inside the prompt', 8, (surface) => surface.deleteForward()],
];

for (const [name, offset, press] of cases) {
  test(`${name} keeps the whole prompt`, () => {
    const surface = mount(INLINE).surface!;
    caret(surface, offset);
    press(surface);
    press(surface);
    expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
    expect(surface.layout().contentControls![0]!.placeholder).toBe(true);
  });
}

test('a deleteText op inside a prompt leaves the part as it was', () => {
  const loaded = readOoxmlPackage(docx(INLINE));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const paragraph = part.root.children
    .flatMap((node) => (node.kind === 'textValue' ? [] : node.children))
    .find((node) => node.kind === 'paragraph')!;
  const result = applyTreeOp(part, {
    op: 'deleteText',
    paragraphId: paragraph.id,
    start: 4,
    end: 9,
  });
  if (!result.ok) throw new Error(result.reason);
  expect(result.part).toBe(part);
});

test('Backspace before the prompt still deletes the text before it', () => {
  const surface = mount(INLINE).surface!;
  caret(surface, 2);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(`A${PROMPT} B`);
});

test('the first keystroke after a kept prompt still replaces it whole', () => {
  const surface = mount(INLINE).surface!;
  caret(surface, 8);
  surface.deleteBackward();
  surface.type('Z');
  expect(surface.session.bodyText()).toBe('A Z B');
});

test('a deletion that covers the whole prompt still removes it', () => {
  const surface = mount(INLINE).surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 29 },
  });
  surface.deleteBackward();
  expect(surface.session.bodyText()).not.toContain('here to enter');
});
