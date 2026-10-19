import { expect, test } from 'bun:test';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { ADA, paragraphId, part, xml } from './tracked-edit-fixture.ts';

const MATH_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const equation = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
const display = `<m:oMathPara>${equation}</m:oMathPara>`;

for (const [name, atom] of [
  ['an inline equation', equation],
  ['a display equation', display],
] as const) {
  test(`a tracked deletion over ${name} refuses instead of leaving it standing`, () => {
    const before = part(`<w:p ${MATH_NS}>${run('a')}${atom}${run('b')}</w:p>`);
    const id = paragraphId(before);
    const store = new TreeDocumentStore(before);
    const outcome = store.transact((tx) => {
      tx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 3, revision: ADA });
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(xml(store.part)).toBe(xml(before));
    expect(store.revision).toBe(0);
  });
}

test('a tracked deletion beside an equation still strikes its text', () => {
  const before = part(`<w:p ${MATH_NS}>${run('ab')}${equation}${run('cd')}</w:p>`);
  const id = paragraphId(before);
  const store = new TreeDocumentStore(before);
  const outcome = store.transact((tx) => {
    tx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 2, revision: ADA });
    tx.apply({ op: 'deleteText', paragraphId: id, start: 3, end: 5, revision: ADA });
  });
  expect(outcome.ok).toBe(true);
  const saved = xml(store.part);
  expect(saved).toContain('<w:delText>ab</w:delText>');
  expect(saved).toContain('<w:delText>cd</w:delText>');
  expect(saved).toContain('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
});

test('an untracked deletion over an equation still removes it', () => {
  const before = part(`<w:p ${MATH_NS}>${run('a')}${equation}${run('b')}</w:p>`);
  const id = paragraphId(before);
  const store = new TreeDocumentStore(before);
  const outcome = store.transact((tx) => {
    tx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 3 });
  });
  expect(outcome.ok).toBe(true);
  expect(xml(store.part)).not.toContain('oMath');
});
