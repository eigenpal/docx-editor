// Delete and Backspace leave a control's prompt whole, as Word does. The prompt is one unit: the
// first keystroke replaces it, and a press never takes its characters. A press that reaches only
// the prompt selects it, and a press over a range takes only the text around it. Suggesting mode
// keeps the same rule, so no prompt character is struck. A scripted deletion is not a keystroke:
// the store applies it as asked.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { createDocxEditor } from '../docx-editor.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

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
/** "before", then a block control whose prompt fills the second paragraph. */
const BLOCK =
  `<w:p>${run('before')}</w:p>` +
  '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:richText/></w:sdtPr>' +
  `<w:sdtContent><w:p>${run(PROMPT)}</w:p></w:sdtContent></w:sdt>`;

const mounted: (() => void)[] = [];
afterEach(() => mounted.splice(0).forEach((cleanup) => cleanup()));

function mount(body: string, author?: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(body),
    ...(author === undefined ? {} : { author }),
  });
  mounted.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

function select(surface: PaginatedSurface, start: number, end = start, paragraph = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

/** The selection as `[paragraph index, from, to]`, whichever way it points. */
function selected(surface: PaginatedSurface): [number, number, number] {
  const { anchor, head } = surface.state().selection;
  const paragraph = surface.session.paragraphIds().indexOf(head.paragraphId);
  return [paragraph, Math.min(anchor.offset, head.offset), Math.max(anchor.offset, head.offset)];
}

async function savedXml(editor: ReturnType<typeof mount>): Promise<string> {
  const part = unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!;
  return new TextDecoder().decode(part);
}

const presses: readonly [string, number, (surface: PaginatedSurface) => void][] = [
  ['Delete at the start of the prompt', 2, (surface) => surface.deleteForward()],
  ['Backspace at the end of the prompt', 27, (surface) => surface.deleteBackward()],
  ['Backspace inside the prompt', 8, (surface) => surface.deleteBackward()],
  ['Delete inside the prompt', 8, (surface) => surface.deleteForward()],
  ['Ctrl+Backspace at the end of the prompt', 27, (surface) => surface.deleteWordBackward()],
  ['Ctrl+Delete at the start of the prompt', 2, (surface) => surface.deleteWordForward()],
];

for (const [name, offset, press] of presses) {
  test(`${name} selects the whole prompt and changes nothing`, () => {
    const surface = mount(INLINE).surface!;
    select(surface, offset);
    press(surface);
    expect(selected(surface)).toEqual([0, 2, 27]);
    press(surface);
    expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
    expect(surface.layout().contentControls![0]!.placeholder).toBe(true);
    expect(surface.state().revision).toBe(0);
  });
}

test('Delete and Backspace with the prompt selected leave it whole', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 2, 27);
  surface.deleteForward();
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
  expect(selected(surface)).toEqual([0, 2, 27]);
  expect(surface.state().revision).toBe(0);
});

test('a range from before the prompt into it takes only the text before it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  surface.deleteForward();
  expect(surface.session.bodyText()).toBe(`${PROMPT} B`);
  expect(surface.layout().contentControls![0]!.placeholder).toBe(true);
  surface.undo();
  expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
});

test('a range from inside the prompt past it takes only the text after it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 10, 29);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(`A ${PROMPT}`);
  expect(selected(surface)).toEqual([0, 27, 27]);
});

test('a range over the whole prompt takes only the text around it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 29);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(PROMPT);
  expect(surface.layout().contentControls![0]!.placeholder).toBe(true);
});

test('a range across paragraphs keeps the prompt it ends in whole', () => {
  const surface = mount(`<w:p>${run('X')}</w:p>${INLINE}`).surface!;
  const [first, second] = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: first!, offset: 0 },
    head: { paragraphId: second!, offset: 10 },
  });
  surface.deleteForward();
  expect(surface.session.bodyText()).toBe(`${PROMPT} B`);
  expect(surface.layout().contentControls![0]!.placeholder).toBe(true);
});

test('Backspace in a block prompt selects the whole prompt', () => {
  const surface = mount(BLOCK).surface!;
  select(surface, PROMPT.length, PROMPT.length, 1);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(`before\n${PROMPT}`);
  expect(selected(surface)).toEqual([1, 0, PROMPT.length]);
});

test('in suggesting mode a press strikes no prompt character', async () => {
  const editor = mount(INLINE, 'Ada');
  const surface = editor.surface!;
  surface.setEditingMode('suggest');
  select(surface, 27);
  surface.deleteBackward();
  surface.deleteBackward();
  expect(selected(surface)).toEqual([0, 2, 27]);
  surface.deleteForward();
  expect(await savedXml(editor)).not.toContain('w:del ');

  select(surface, 0, 10);
  surface.deleteForward();
  const xml = await savedXml(editor);
  expect(xml.match(/<w:delText[^>]*>[^<]*<\/w:delText>/g)).toEqual([
    '<w:delText xml:space="preserve">A </w:delText>',
  ]);
  expect(xml).toContain(`<w:t>${PROMPT}</w:t>`);
  expect(xml).toContain('<w:showingPlcHdr/>');
});

test('a scripted deletion inside a prompt is applied, not dropped', () => {
  const editor = mount(INLINE);
  const host = createBrowserAutomationHost(editor);
  const [document] = host.execute({ operations: [{ op: 'getDocument' }] }).results;
  if (document?.status !== 'ok' || document.value.kind !== 'handle') throw new Error('document');
  const [body] = host.execute({
    operations: [{ op: 'getBody', document: document.value.handle }],
  }).results;
  if (body?.status !== 'ok' || body.value.kind !== 'handle') throw new Error('body');
  const [found] = host.execute({
    operations: [{ op: 'search', scope: { body: body.value.handle }, text: 'here ' }],
  }).results;
  if (found?.status !== 'ok' || found.value.kind !== 'spans') throw new Error('search');
  const response = host.execute({
    operations: [{ op: 'replaceSpan', span: found.value.spans[0]!, text: '' }],
  });
  expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
  expect(editor.surface!.session.bodyText()).toBe('A Click to enter text. B');
});

test('Backspace before the prompt still deletes the text before it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 2);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(`A${PROMPT} B`);
});

test('the first keystroke after a kept prompt still replaces it whole', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 8);
  surface.deleteBackward();
  surface.type('Z');
  expect(surface.session.bodyText()).toBe('A Z B');
});
