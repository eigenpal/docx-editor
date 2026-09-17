// `exec(command, { historyGroup })`: one gesture, one undo step.
//
// A live colour picker or a spacing slider applies every intermediate value through `exec`
// so the selection updates under the pointer, and each of those calls was its own undo
// entry: one drag needed as many Undo presses as it had frames. A history group names the
// gesture, so consecutive grouped commands extend one entry — the original state and the
// final state survive, the frames in between do not — while anything else (an ungrouped
// edit, a different group, undo or redo) closes the group.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const run = (text: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const color = (hex: string) => `<w:rPr><w:color w:val="${hex}"/></w:rPr>`;
/** A selection whose runs already disagree about colour, so undo has something to restore exactly. */
const MIXED = `<w:p>${run('alpha', color('FF0000'))}${run(' beta', color('0000FF'))}</w:p>`;

function withEditor(body: string, test: (editor: DocxEditorInstance) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  try {
    test(editor);
  } finally {
    editor.destroy();
    container.remove();
  }
}

/** Every run's `w:color`, in document order, `null` for a run that authors none. */
function colors(editor: DocxEditorInstance): (string | null)[] {
  const found: (string | null)[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'run') {
      const rPr = node.children.find((child) => child.kind === 'runProperties');
      const entry =
        rPr && rPr.kind !== 'textValue'
          ? rPr.children.find((child) => child.kind !== 'textValue' && child.localName === 'color')
          : undefined;
      found.push(
        entry && entry.kind !== 'textValue'
          ? (entry.attributes.find((attribute) => attribute.localName === 'val')?.value ?? null)
          : null
      );
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(editor.surface!.session.part().root);
  return found;
}

/** Every paragraph's `w:spacing w:after`, `null` when the paragraph authors none. */
function spacingAfter(editor: DocxEditorInstance): (string | null)[] {
  const found: (string | null)[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const pPr = node.children.find((child) => child.kind === 'paragraphProperties');
      const spacing =
        pPr && pPr.kind !== 'textValue'
          ? pPr.children.find(
              (child) => child.kind !== 'textValue' && child.localName === 'spacing'
            )
          : undefined;
      found.push(
        spacing && spacing.kind !== 'textValue'
          ? (spacing.attributes.find((attribute) => attribute.localName === 'after')?.value ?? null)
          : null
      );
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(editor.surface!.session.part().root);
  return found;
}

function selectAll(editor: DocxEditorInstance): void {
  const ids = editor.surface!.session.paragraphIds();
  const last = ids[ids.length - 1]!;
  const text = editor.surface!.session.bodyText().split('\n');
  editor.surface!.setSelection({
    anchor: { paragraphId: ids[0]!, offset: 0 },
    head: { paragraphId: last, offset: text[text.length - 1]!.length },
  });
}

const setColor = (editor: DocxEditorInstance, value: string, historyGroup?: symbol) =>
  editor.exec(
    { type: 'setMarkAttr', mark: 'color', attr: 'val', value },
    historyGroup ? { historyGroup } : undefined
  );

const FRAMES = ['00FF00', '00AA00', '007700', '0070C0'];

describe('exec history groups', () => {
  test('ungrouped commands keep one undo entry each (the behaviour the option opts out of)', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      for (const value of FRAMES)
        expect(setColor(editor, value)).toEqual({ ok: true, changed: true });
      expect(colors(editor)).toEqual(['0070C0', '0070C0']);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      // Undo visits the frame before, not the state before the gesture.
      expect(colors(editor)).toEqual(['007700', '007700']);
    });
  });

  test('grouped commands are one undo step that restores the original mixed formatting', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      const gesture = Symbol('color-drag');
      for (const value of FRAMES) {
        expect(setColor(editor, value, gesture)).toEqual({ ok: true, changed: true });
      }
      expect(colors(editor)).toEqual(['0070C0', '0070C0']);
      expect(editor.snapshot().canUndo).toBe(true);

      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['FF0000', '0000FF']);
      // One step took the whole gesture back; there is nothing older to undo.
      expect(editor.snapshot().canUndo).toBe(false);

      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['0070C0', '0070C0']);
      expect(editor.snapshot().canRedo).toBe(false);
    });
  });

  test('every grouped frame renders immediately', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      const gesture = Symbol('color-drag');
      const seen: string[] = [];
      for (const value of FRAMES) {
        setColor(editor, value, gesture);
        const shown = editor.snapshot().formatting.color;
        seen.push(shown?.kind === 'hex' ? shown.value.toUpperCase().replace('#', '') : '');
      }
      expect(seen).toEqual(FRAMES);
    });
  });

  test('a repeated value adds no entry and does not close the group', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      const gesture = Symbol('color-drag');
      setColor(editor, '00FF00', gesture);
      expect(setColor(editor, '00FF00', gesture).ok).toBe(true);
      setColor(editor, '0070C0', gesture);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['FF0000', '0000FF']);
      expect(editor.snapshot().canUndo).toBe(false);
    });
  });

  test('a new gesture is a new entry', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      setColor(editor, '00FF00', Symbol('first drag'));
      setColor(editor, '0070C0', Symbol('second drag'));
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['00FF00', '00FF00']);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['FF0000', '0000FF']);
    });
  });

  test('an ungrouped edit between two grouped frames closes the group', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      const gesture = Symbol('color-drag');
      setColor(editor, '00FF00', gesture);
      expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({
        ok: true,
        changed: true,
      });
      setColor(editor, '0070C0', gesture);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['00FF00', '00FF00']);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['FF0000', '0000FF']);
    });
  });

  test('undo closes the group: a later frame with the same token starts a new entry', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      const gesture = Symbol('color-drag');
      setColor(editor, '00FF00', gesture);
      setColor(editor, '007700', gesture);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['FF0000', '0000FF']);
      setColor(editor, '0070C0', gesture);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['FF0000', '0000FF']);
      expect(editor.snapshot().canUndo).toBe(false);
    });
  });

  test('redo closes the group too', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      const gesture = Symbol('color-drag');
      setColor(editor, '00FF00', gesture);
      editor.exec({ type: 'undo' });
      editor.exec({ type: 'redo' });
      expect(colors(editor)).toEqual(['00FF00', '00FF00']);
      setColor(editor, '0070C0', gesture);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['00FF00', '00FF00']);
    });
  });

  test('a paragraph slider groups the same way', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      const gesture = Symbol('spacing-drag');
      for (const afterPt of [6, 8, 10, 12]) {
        expect(
          editor.exec({ type: 'setParagraphSpacing', afterPt }, { historyGroup: gesture })
        ).toEqual({ ok: true, changed: true });
      }
      expect(spacingAfter(editor)).toEqual(['240']);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(spacingAfter(editor)).toEqual([null]);
      expect(editor.snapshot().canUndo).toBe(false);
    });
  });

  test('typing that lands during a grouped command is not swept into the group', () => {
    withEditor(MIXED, (editor) => {
      const ids = editor.surface!.session.paragraphIds();
      editor.surface!.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 0 },
      });
      const gesture = Symbol('color-drag');
      selectAll(editor);
      setColor(editor, '00FF00', gesture);
      // Buffered typing flushes as its own transaction at the head of the next command, so
      // it lands INSIDE the grouped call — and must still be its own undo step.
      editor.surface!.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 0 },
      });
      editor.surface!.enqueueType('X');
      selectAll(editor);
      setColor(editor, '0070C0', gesture);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['00FF00', '00FF00']);
      expect(editor.surface!.session.bodyText()).toBe('Xalpha beta');
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.surface!.session.bodyText()).toBe('alpha beta');
      expect(colors(editor)).toEqual(['00FF00', '00FF00']);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(editor)).toEqual(['FF0000', '0000FF']);
    });
  });

  test('can() accepts the option and reports nothing about it', () => {
    withEditor(MIXED, (editor) => {
      selectAll(editor);
      expect(
        editor.can(
          { type: 'setMarkAttr', mark: 'color', attr: 'val', value: '00FF00' },
          { historyGroup: Symbol('probe') }
        )
      ).toEqual({ ok: true });
    });
  });
});
