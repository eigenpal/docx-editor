// `can`, the toolbar and `exec` agree on paragraph formatting over a content lock or a data
// binding: alignment passes a lock, every other paragraph format is refused before the write.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createT, en, localizeDisabledReason } from '@docx-editor.dev/i18n';
import { diagnosticCodeOfRefusal } from '../diagnostic-codes.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import type { EditorCommand } from '../../contracts/editor.ts';
import { directParagraphProperties } from '../../store/store/direct-properties.ts';
import { LOCKED_FORMAT_REASON } from '../content-lock-format-refusal.ts';
import {
  BOUND_PARAGRAPH_FORMAT_REASON,
  LOCKED_PARAGRAPH_FORMAT_REASON,
} from '../paragraph-format-lock-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const block = (sdtPr: string, pPr: string) =>
  `<w:sdt><w:sdtPr><w:tag w:val="block"/>${sdtPr}</w:sdtPr><w:sdtContent>` +
  `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>locked text</w:t></w:r></w:p></w:sdtContent></w:sdt>`;
const FREE = '<w:p><w:r><w:t>free text</w:t></w:r></w:p>';
const LOCK = '<w:lock w:val="contentLocked"/>';
const INDENT = '<w:ind w:left="240"/>';

function mount(
  body: string,
  extra: { readonly author?: string } = {}
): { editor: DocxEditorInstance; id: (index: number) => string } {
  const bytes = zipSync({
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
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    ...extra,
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, id: (index) => editor.surface!.session.paragraphIds()[index]! };
}

function select(editor: DocxEditorInstance, from: string, to = from, end = 4): void {
  editor.surface!.setSelection({
    anchor: { paragraphId: from, offset: 2 },
    head: { paragraphId: to, offset: end },
  });
}

const properties = (editor: DocxEditorInstance, paragraphId: string) =>
  JSON.stringify(directParagraphProperties(editor.surface!.session.part(), paragraphId));

/** Every paragraph format that changes something other than alignment. */
const NON_ALIGNMENT: readonly EditorCommand[] = [
  { type: 'adjustIndent', direction: 'increase' },
  { type: 'toggleList', kind: 'bullet' },
  { type: 'setLineSpacing', rule: 'multiple', value: 2 },
  { type: 'setParagraphDirection', direction: 'rtl' },
  { type: 'setParagraphSpacing', beforePt: 12 },
  { type: 'setIndent', left: 720 },
  { type: 'setParagraphFormat', spaceAfterPt: 6, alignment: 'center' },
];

const ALIGNMENT: readonly EditorCommand[] = [
  { type: 'setAlignment', align: 'center' },
  { type: 'setParagraphFormat', alignment: 'right' },
];

test('a content lock refuses every paragraph format except alignment, before the write', () => {
  const { editor, id } = mount(block(LOCK, INDENT) + FREE);
  select(editor, id(0));
  const before = properties(editor, id(0));
  for (const command of NON_ALIGNMENT) {
    const refusal = { ok: false, code: 'locked', reason: LOCKED_PARAGRAPH_FORMAT_REASON };
    expect(editor.can(command)).toEqual(refusal);
    expect(editor.exec(command)).toEqual(refusal);
    expect(properties(editor, id(0))).toBe(before);
  }
  for (const command of ALIGNMENT) {
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
  }
  expect(properties(editor, id(0))).toContain('"jc"');
  editor.destroy();
});

test('the toolbar shows paragraph buttons in a lock as disabled with the reason', () => {
  const { editor, id } = mount(block(LOCK, INDENT) + FREE);
  select(editor, id(0));
  for (const slot of [
    'list.indent',
    'list.outdent',
    'list.bullet',
    'list.numbered',
    'list.lineSpacing',
    'direction.rtl',
    'direction.ltr',
  ] as const) {
    expect(toolbarCommandState(editor, slot)).toMatchObject({
      enabled: false,
      disabledReason: LOCKED_PARAGRAPH_FORMAT_REASON,
    });
  }
  for (const slot of ['alignment.left', 'alignment.center', 'paragraph.dialog'] as const) {
    expect(toolbarCommandState(editor, slot).enabled).toBe(true);
  }
  // Outside the lock, the same buttons stay available.
  select(editor, id(1));
  for (const slot of ['list.indent', 'list.bullet', 'list.lineSpacing', 'direction.rtl'] as const) {
    expect(toolbarCommandState(editor, slot).enabled).toBe(true);
  }
  editor.destroy();
});

test('a selection that reaches into a locked paragraph is refused for all of it', () => {
  const { editor, id } = mount(FREE + block(LOCK, INDENT));
  select(editor, id(0), id(1), 0);
  const free = properties(editor, id(0));
  const command: EditorCommand = { type: 'setLineSpacing', rule: 'multiple', value: 2 };
  expect(editor.can(command)).toMatchObject({ ok: false, code: 'locked' });
  expect(editor.exec(command)).toMatchObject({ ok: false, code: 'locked' });
  expect(properties(editor, id(0))).toBe(free);
  editor.destroy();
});

test('a locked inline control leaves the formatting of its paragraph available', () => {
  const pill =
    '<w:p><w:r><w:t>ab</w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="pill"/>' +
    `${LOCK}</w:sdtPr><w:sdtContent><w:r><w:t>PIL</w:t></w:r></w:sdtContent></w:sdt>` +
    '<w:r><w:t>cd</w:t></w:r></w:p>';
  const { editor, id } = mount(pill);
  select(editor, id(0), id(0), 3);
  for (const command of [...NON_ALIGNMENT, ...ALIGNMENT]) {
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
  }
  editor.destroy();
});

test('a data binding refuses paragraph formats, including alignment, with code bound', () => {
  const binding = '<w:dataBinding w:storeItemID="{1}" w:xpath="/root/value"/>';
  const { editor, id } = mount(block(binding, INDENT) + FREE);
  select(editor, id(0));
  const before = properties(editor, id(0));
  for (const command of [...NON_ALIGNMENT, ...ALIGNMENT]) {
    const refusal = { ok: false, code: 'bound', reason: BOUND_PARAGRAPH_FORMAT_REASON };
    expect(editor.can(command)).toEqual(refusal);
    expect(editor.exec(command)).toEqual(refusal);
  }
  expect(properties(editor, id(0))).toBe(before);
  editor.destroy();
});

test('both paragraph format refusals reach the user in their own language', () => {
  const t = createT(en);
  for (const reason of [LOCKED_PARAGRAPH_FORMAT_REASON, BOUND_PARAGRAPH_FORMAT_REASON]) {
    expect(localizeDisabledReason(reason, t)).not.toBe(reason);
    expect(diagnosticCodeOfRefusal(reason)).toBe('edit.protected-content');
  }
});

test('suggested alignment is refused where its revision could not be rejected in the lock', () => {
  const pending =
    '<w:ind w:left="480"/><w:pPrChange w:id="7" w:author="Ada">' +
    '<w:pPr><w:ind w:left="240"/></w:pPr></w:pPrChange>';
  const { editor, id } = mount(block(LOCK, pending) + FREE, { author: 'Reviewer' });
  editor.surface!.setEditingMode('suggest');
  select(editor, id(0));
  const refusal = { ok: false, code: 'locked', reason: LOCKED_FORMAT_REASON };
  expect(editor.can({ type: 'setAlignment', align: 'center' })).toEqual(refusal);
  expect(editor.exec({ type: 'setAlignment', align: 'center' })).toEqual(refusal);
  expect(toolbarCommandState(editor, 'alignment.center')).toMatchObject({
    enabled: false,
    disabledReason: LOCKED_FORMAT_REASON,
  });
  editor.destroy();
});
