// Content-control command dispatch — `setContentControlValue` and `removeContentControl`
// through the Editor facade into store tree ops.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pMixed = (content: string) => `<w:p>${content}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const sdt = (sdtPr: string, content: string) =>
  `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const inlineSdt = (sdtPr: string, content: string) => sdt(sdtPr, content);

function mount(body: string) {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function caretAt(
  surface: NonNullable<ReturnType<typeof createDocxEditor>['surface']>,
  offset: number,
  paragraphIndex = 0
) {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

describe('setContentControlValue command', () => {
  test('replaces plain-text control content at the caret', () => {
    const body = sdt(`<w:text/>`, p('Enter name'));
    const editor = mount(body);
    caretAt(editor.surface!, 3);

    const result = editor.exec({ type: 'setContentControlValue', value: 'Ada Lovelace' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Ada Lovelace');
    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
  });

  test('targets an inline control through caret resolution', () => {
    const body = pMixed(
      run('ab') + inlineSdt(`<w:alias w:val="Mid"/><w:text/>`, run('OLD')) + run('cd')
    );
    const editor = mount(body);
    caretAt(editor.surface!, 4);

    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ alias: 'Mid' });

    const result = editor.exec({ type: 'setContentControlValue', value: 'NEW' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('abNEWcd');
  });

  test('refuses a locked control with code locked, and can() agrees', () => {
    const body = sdt(`<w:lock w:val="contentLocked"/><w:text/>`, p('locked'));
    const editor = mount(body);
    caretAt(editor.surface!, 2);

    const command = { type: 'setContentControlValue' as const, value: 'nope' };
    const can = editor.can(command);
    const result = editor.exec(command);
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(result).toEqual(can);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('locked');
  });

  test('refuses a bound control with code bound, and can() agrees', () => {
    const body = pMixed(
      sdt(`<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/><w:text/>`, run('bound'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 2);

    const command = { type: 'setContentControlValue' as const, value: 'free' };
    const can = editor.can(command);
    const result = editor.exec(command);
    expect(can).toEqual({
      ok: false,
      code: 'bound',
      reason: 'the content control is bound to external data',
    });
    expect(result).toEqual(can);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('bound');
  });

  test('can() refuses an unlisted dropdown value the same way exec() does', () => {
    const body = sdt(
      `<w:dropDownList w:lastValue="1">` +
        `<w:listItem w:displayText="Draft" w:value="1"/>` +
        `<w:listItem w:displayText="Final" w:value="2"/></w:dropDownList>`,
      p('Draft')
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    const invalid = { type: 'setContentControlValue' as const, value: '3' };
    const canInvalid = editor.can(invalid);
    expect(canInvalid).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: 'the value is not valid for this control',
    });
    expect(editor.exec(invalid)).toEqual(canInvalid);

    const valid = { type: 'setContentControlValue' as const, value: '2' };
    expect(editor.can(valid)).toEqual({ ok: true });
    expect(editor.exec(valid)).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Final');
  });

  test('can() refuses a non-boolean checkbox value with typeMismatch', () => {
    const body = sdt(`<w14:checkbox><w14:checked w14:val="0"/></w14:checkbox>`, p('☐'));
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    const command = { type: 'setContentControlValue' as const, value: 'maybe' };
    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'typeMismatch',
      reason: 'the value does not match the control type',
    });
    expect(editor.exec(command)).toMatchObject(can);
  });

  test('can() refuses setValue under an inherited content lock', () => {
    const body = sdt(
      `<w:lock w:val="contentLocked"/><w:alias w:val="outer"/>`,
      sdt(`<w:alias w:val="inner"/><w:text/>`, p('nested'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({
      alias: 'inner',
      locked: true,
    });

    const command = { type: 'setContentControlValue' as const, value: 'nope' };
    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(editor.exec(command)).toEqual(can);
  });

  test('switching to viewing refuses setValue through can() and exec()', () => {
    // The gate read `config.mode`, which is fixed for the life of the editor — so this
    // branch, which sits ABOVE the viewing gate, answered the question the host asked at
    // open time rather than the one the reader is asking now.
    const editor = mount(sdt(`<w:alias w:val="field"/><w:text/>`, p('before')));
    caretAt(editor.surface!, 0);
    const command = { type: 'setContentControlValue' as const, value: 'after' };
    expect(editor.can(command)).toEqual({ ok: true });

    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    const revision = editor.surface!.session.packageRevision();
    const refusal = editor.can(command);
    expect(refusal.ok).toBe(false);
    expect(editor.exec(command)).toEqual(refusal);
    expect(editor.surface!.session.packageRevision()).toBe(revision);

    // Reversible, like every other viewing refusal.
    editor.exec({ type: 'setEditingMode', mode: 'editing' });
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command).ok).toBe(true);
  });
});

describe('removeContentControl command', () => {
  test('unwraps a block control while preserving text', () => {
    const body = sdt(`<w:alias w:val="Title"/>`, p('Hello'));
    const editor = mount(body);
    caretAt(editor.surface!, 2);

    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
    expect(editor.can({ type: 'removeContentControl' })).toEqual({ ok: true });

    const result = editor.exec({ type: 'removeContentControl' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
    expect(editor.query({ type: 'contentControlAt' })).toBeNull();
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Hello');
  });

  test('unwraps an inline control targeted at the caret', () => {
    const body = pMixed(run('x') + inlineSdt(`<w:alias w:val="Inner"/>`, run('y')) + run('z'));
    const editor = mount(body);
    caretAt(editor.surface!, 1);

    const result = editor.exec({ type: 'removeContentControl' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('xyz');
    expect(editor.query({ type: 'contentControlAt' })).toBeNull();
  });

  test('refuses removal when the wrapper is locked, and can() agrees', () => {
    const body = pMixed(sdt(`<w:lock w:val="sdtContentLocked"/>`, run('keep')));
    const editor = mount(body);
    caretAt(editor.surface!, 2);

    const can = editor.can({ type: 'removeContentControl' });
    const result = editor.exec({ type: 'removeContentControl' });
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(result).toEqual(can);
    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
  });

  test('can() refuses removal under an inherited sdtLocked ancestor', () => {
    const body = sdt(
      `<w:lock w:val="sdtLocked"/><w:alias w:val="outer"/>`,
      sdt(`<w:alias w:val="inner"/>`, p('nested'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    // Content edit remains allowed; only wrapper removal is refused by the union.
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({
      alias: 'inner',
    });
    expect(editor.query({ type: 'contentControlAt' })?.locked).toBeUndefined();
    expect(editor.can({ type: 'setContentControlValue', value: 'ok' })).toEqual({ ok: true });

    const can = editor.can({ type: 'removeContentControl' });
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(editor.exec({ type: 'removeContentControl' })).toEqual(can);
  });
});
