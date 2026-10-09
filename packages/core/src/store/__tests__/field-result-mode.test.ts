// Saved field results under the two field-result modes.
//
// `atomic` (the default) keeps every field one offset unit: raw paragraph text does not change.
// `editable` addresses the result of a field that shows its saved value (DATE, MERGEFIELD,
// HYPERLINK display text) as ordinary text, and keeps live fields (PAGE) and fields holding
// another field one unit.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../index.ts';
import { FIELD_ATOM_CHAR } from '../package/field-nodes.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { applyTreeOp, paragraphTextOf } from '../store/tree-ops.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const EDITABLE = { fieldResults: 'editable' } as const;
const REVISION = { author: 'Reviewer', date: '2026-01-01T00:00:00Z' };

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const complex = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const simple = (instruction: string, result: string) =>
  `<w:fldSimple w:instr="${instruction}"><w:r><w:t>${result}</w:t></w:r></w:fldSimple>`;

/** `ab ` + field + ` cd` in one paragraph. */
function paragraphWith(field: string): { part: OoxmlPart; id: string } {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('ab ')}${field}${run(' cd')}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  const body = read.part.root.children[0]!;
  if (body.kind === 'textValue') throw Error('no body');
  return { part: read.part, id: body.children[0]!.id };
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op, EDITABLE);
  if (!result.ok) throw Error(result.reason);
  return result.part;
}

const KINDS = [
  { label: 'complex DATE', field: complex(' DATE ', run('2020-01-02')), result: '2020-01-02' },
  {
    label: 'complex HYPERLINK',
    field: complex(' HYPERLINK "https://e/" ', run('link')),
    result: 'link',
  },
  { label: 'simple MERGEFIELD', field: simple(' MERGEFIELD Name ', 'Name'), result: 'Name' },
] as const;

describe('raw paragraph text', () => {
  test('the default keeps every field one unit', () => {
    for (const { field } of KINDS) {
      const { part, id } = paragraphWith(field);
      expect(paragraphTextOf(part, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
    }
  });

  test('the editable mode reads saved results as text, and the default does not change', () => {
    for (const { field, result } of KINDS) {
      const { part, id } = paragraphWith(field);
      expect(paragraphTextOf(part, id, EDITABLE)).toBe(`ab ${result} cd`);
      // Offsets are memoized per mode: the editable read does not leak into the default.
      expect(paragraphTextOf(part, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
    }
  });

  test('live fields and fields holding another field stay one unit', () => {
    for (const field of [
      complex(' PAGE ', run('7')),
      complex(' REF bm ', run('target')),
      complex(' QUOTE "x" ', run('a ') + complex(' QUOTE "y" ', run('b')) + run(' c')),
    ]) {
      const { part, id } = paragraphWith(field);
      expect(paragraphTextOf(part, id, EDITABLE)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
    }
  });
});

describe('editing a saved result', () => {
  for (const { label, field, result } of KINDS) {
    test(label, () => {
      const { part, id } = paragraphWith(field);
      const start = 3;
      const end = start + result.length;
      const text = (edited: OoxmlPart) => paragraphTextOf(edited, id, EDITABLE);

      // Typing inside lands in the result; at either edge it lands outside the field.
      const inside = apply(part, {
        op: 'insertText',
        paragraphId: id,
        offset: start + 2,
        text: '#',
      });
      expect(text(inside)).toBe(`ab ${result.slice(0, 2)}#${result.slice(2)} cd`);
      expect(paragraphTextOf(inside, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
      for (const offset of [start, end]) {
        const edge = apply(part, { op: 'insertText', paragraphId: id, offset, text: '#' });
        expect(paragraphTextOf(edge, id)).toBe(
          offset === start ? `ab #${FIELD_ATOM_CHAR} cd` : `ab ${FIELD_ATOM_CHAR}# cd`
        );
      }

      // Deleting inside edits the result; deleting the whole result keeps an empty field.
      const deleted = apply(part, {
        op: 'deleteText',
        paragraphId: id,
        start: start + 1,
        end: start + 2,
      });
      expect(text(deleted)).toBe(`ab ${result.slice(0, 1)}${result.slice(2)} cd`);
      const emptied = apply(part, { op: 'deleteText', paragraphId: id, start, end });
      expect(text(emptied)).toBe('ab  cd');
      expect(paragraphTextOf(emptied, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);

      // A range with one end inside the result is refused, never half applied.
      for (const [from, to] of [
        [start - 1, start + 1],
        [end - 1, end + 1],
      ] as const) {
        const refused = applyTreeOp(
          part,
          { op: 'deleteText', paragraphId: id, start: from, end: to },
          EDITABLE
        );
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.reason).toBe('field-structure');
      }

      // A range that covers the field and reaches past it removes the field.
      const removed = apply(part, {
        op: 'deleteText',
        paragraphId: id,
        start: start - 1,
        end: end + 1,
      });
      expect(paragraphTextOf(removed, id)).toBe('abcd');
      expect(serializeOoxmlPart(removed)).not.toContain('fldChar');
      expect(serializeOoxmlPart(removed)).not.toContain('fldSimple');
    });
  }
});

describe('tracked edits inside a saved result', () => {
  for (const { label, field, result } of KINDS) {
    test(label, () => {
      const { part, id } = paragraphWith(field);
      const inserted = apply(part, {
        op: 'insertText',
        paragraphId: id,
        offset: 5,
        text: '#',
        revision: REVISION,
      });
      const insertedXml = serializeOoxmlPart(inserted);
      const separate = insertedXml.indexOf('w:fldCharType="separate"');
      const insertion = insertedXml.indexOf('<w:ins ');
      const end = insertedXml.indexOf('w:fldCharType="end"');
      // The insertion sits between the separate and end markers, and the instruction stays.
      expect(separate).toBeGreaterThan(-1);
      expect(insertion).toBeGreaterThan(separate);
      expect(end).toBeGreaterThan(insertion);
      expect(paragraphTextOf(inserted, id, EDITABLE)).toBe(
        `ab ${result.slice(0, 2)}#${result.slice(2)} cd`
      );

      const struck = apply(part, {
        op: 'deleteText',
        paragraphId: id,
        start: 4,
        end: 5,
        revision: REVISION,
      });
      const struckXml = serializeOoxmlPart(struck);
      expect(struckXml).toContain(`<w:delText>${result[1]}</w:delText>`);
      expect(struckXml.indexOf('<w:del ')).toBeGreaterThan(
        struckXml.indexOf('w:fldCharType="separate"')
      );
    });
  }
});

describe('a store transaction in the editable mode', () => {
  test('edits the result, undoes, redoes, and round-trips through save', () => {
    const { part, id } = paragraphWith(complex(' MERGEFIELD Name ', run('Name')));
    const store = new TreeDocumentStore(part);
    const committed = store.transact(
      (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'XY' });
      },
      { fieldResults: 'editable' }
    );
    expect(committed.ok).toBe(true);
    expect(paragraphTextOf(store.part, id, EDITABLE)).toBe('ab NaXYme cd');
    store.undo();
    expect(paragraphTextOf(store.part, id, EDITABLE)).toBe('ab Name cd');
    store.redo();
    expect(paragraphTextOf(store.part, id, EDITABLE)).toBe('ab NaXYme cd');

    const reopened = readOoxmlPart(serializeOoxmlPart(store.part), {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!reopened.ok) throw Error(reopened.reason);
    expect(paragraphTextOf(reopened.part, id, EDITABLE)).toBe('ab NaXYme cd');
    expect(serializeOoxmlPart(reopened.part)).toContain('MERGEFIELD Name');
  });

  test('the default transaction keeps today offsets', () => {
    const { part, id } = paragraphWith(complex(' MERGEFIELD Name ', run('Name')));
    const store = new TreeDocumentStore(part);
    store.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 4, text: '#' });
    });
    expect(paragraphTextOf(store.part, id)).toBe(`ab ${FIELD_ATOM_CHAR}# cd`);
  });
});
