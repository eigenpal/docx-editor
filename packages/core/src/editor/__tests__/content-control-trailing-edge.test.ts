// Typing at the trailing edge of an inline text control, beside an automatic
// inter-script gap.
//
// An automatic gap separates Latin letters or digits from East Asian text
// (`w:autoSpaceDE`, `w:autoSpaceDN`). The caret at the control's end sits after
// that gap, so the end of the control is not one hair to the caret's left.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { caretAt, createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { withAuthoredCjkGapMetric } from '../../layout/cjk-auto-spacing-metric-port.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(paragraph: string, protect = true): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}">${protect ? '<w:documentProtection w:edit="forms" w:enforcement="1"/>' : ''}</w:settings>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p>${paragraph}</w:p></w:body></w:document>`
    ),
  });
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const control = (text: string) =>
  '<w:sdt><w:sdtPr><w:tag w:val="value"/><w:text/></w:sdtPr>' +
  `<w:sdtContent>${run(text)}</w:sdtContent></w:sdt>`;

/** A fixed-width measurer that prices the inter-script gap at a quarter of the font size. */
const measurer = withAuthoredCjkGapMetric(
  createFixedMeasurer(6, 14),
  (style) => style.fontSizePt / 4
);

const mounted: HTMLElement[] = [];
afterEach(() => mounted.splice(0).forEach((container) => container.remove()));

function mount(paragraph: string): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  mounted.push(container);
  const result = mountPaginatedSurface(container, docx(paragraph), { scale: 1, measurer });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.surface;
}

function caretAtControlEnd(surface: PaginatedSurface): void {
  const range = surface.layout().contentControls![0]!.range!;
  const position = { paragraphId: range.paragraphId, offset: range.end };
  surface.setSelection({ anchor: position, head: position });
}

test('a gap after the control puts the caret past the control box', () => {
  const surface = mount(run('번호 ') + control('26202') + run('의 값'));
  caretAtControlEnd(surface);
  const fragment = surface.layout().contentControls![0]!.fragments[0]!;
  const caret = caretAt(surface.layout(), surface.state().selection.head, measurer)!;
  // The precondition the regression needs: the caret is outside the control's own box.
  expect(caret.x).toBeGreaterThan(fragment.box.x + fragment.box.width + 0.25);
});

test('typing at the trailing edge continues the control across an inter-script gap', () => {
  const surface = mount(run('번호 ') + control('26202') + run('의 값'));
  caretAtControlEnd(surface);
  surface.type('X');
  expect(surface.session.bodyText()).toBe('번호 26202X의 값');
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 3, end: 9 });
});

test('a Latin control followed by East Asian text keeps typing inside', () => {
  const surface = mount(control('Alpha') + run('값'));
  caretAtControlEnd(surface);
  surface.type('Z');
  expect(surface.session.bodyText()).toBe('AlphaZ값');
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 0, end: 6 });
});

function mountEditor(paragraph: string) {
  const container = document.createElement('div');
  document.body.append(container);
  mounted.push(container);
  const editor = createDocxEditor({ container, document: docx(paragraph) });
  const surface = editor.surface!;
  caretAtControlEnd(surface);
  return { editor, surface };
}

test('commands at the trailing edge are admitted and land inside the control', () => {
  for (const command of [
    { type: 'insertText', text: 'X' },
    { type: 'pasteWithoutFormatting', text: 'X' },
  ] as const) {
    const { editor, surface } = mountEditor(run('A ') + control('value') + run(' B'));
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toEqual({ ok: true, changed: true });
    expect(surface.session.bodyText()).toBe('A valueX B');
    expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 2, end: 8 });
    editor.destroy();
  }
});

test('a caret past the trailing edge stays outside the form field', () => {
  const { editor, surface } = mountEditor(run('A ') + control('value') + run(' B'));
  const range = surface.layout().contentControls![0]!.range!;
  const past = { paragraphId: range.paragraphId, offset: range.end + 1 };
  surface.setSelection({ anchor: past, head: past });
  expect(editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  expect(editor.exec({ type: 'pasteWithoutFormatting', text: 'X' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  // A form feed is a paragraph break in a paste, so admission refuses it the same way.
  const feed = { type: 'pasteWithoutFormatting', text: 'abc\fdef' } as const;
  expect(editor.can(feed)).toMatchObject({ ok: false, code: 'locked' });
  expect(surface.layout().contentControls).toHaveLength(1);
  expect(surface.session.bodyText()).toBe('A value B');
  editor.destroy();
});

test('a multi-line paste at the trailing edge never splits the control', () => {
  const { editor, surface } = mountEditor(run('A ') + control('value') + run(' B'));
  // Beside the control, a multi-line paste is outside the form field, so protection refuses it.
  const command = { type: 'pasteWithoutFormatting', text: 'abc\ndef' } as const;
  expect(editor.can(command)).toMatchObject({ ok: false, code: 'locked' });
  expect(editor.exec(command)).toMatchObject({ ok: false, code: 'locked' });
  expect(surface.session.bodyText()).toBe('A value B');
  expect(surface.layout().contentControls).toHaveLength(1);
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 2, end: 7 });
  editor.destroy();
});

test('a suggested paste at the trailing edge is a tracked insertion inside the control', async () => {
  for (const [text, inside] of [
    ['X', true],
    ['one\ntwo', false],
  ] as const) {
    const container = document.createElement('div');
    document.body.append(container);
    mounted.push(container);
    const editor = createDocxEditor({
      container,
      document: docx(run('A ') + control('value') + run(' B'), false),
    });
    const surface = editor.surface!;
    surface.setAuthor('Reviewer');
    surface.setEditingMode('suggest');
    caretAtControlEnd(surface);
    expect(editor.exec({ type: 'pasteWithoutFormatting', text }).ok).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    const sdt = xml.slice(xml.indexOf('<w:sdt>'), xml.indexOf('</w:sdt>'));
    // One line joins the control as a proposal; more lines stay beside it, in one control.
    expect(sdt.includes('<w:ins ')).toBe(inside);
    expect(xml.split('<w:sdt>')).toHaveLength(2);
    editor.destroy();
  }
});
