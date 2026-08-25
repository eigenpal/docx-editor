import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  validateOoxmlPart,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { BackendKind } from './contract.ts';
import {
  collectKind,
  countNewReferences,
  formatFixture,
  nodeText,
  tableFixture,
  twoParagraphFixture,
} from './fixtures.ts';
import { allocationEvidence } from './gates.ts';
import {
  addRunMark,
  deleteParagraph,
  insertTableRow,
  insertText,
  joinParagraphs,
  setParagraphAttribute,
  splitParagraph,
} from './ops.ts';
import { concurrent, createPair, destroyPair, syncOne, type Pair } from './replicas.ts';

const BACKENDS: readonly BackendKind[] = ['xml', 'registry'];
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function bodyText(part: OoxmlPart): string[] {
  return collectKind(part, 'paragraph').map((paragraph) => nodeText(paragraph));
}

function expectConverged(pair: Pair): void {
  const left = pair.left.materializer.current();
  const right = pair.right.materializer.current();
  expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
  expect(validateOoxmlPart(left).ok).toBe(true);
  expect(validateOoxmlPart(right).ok).toBe(true);
}

describe('representation spike concurrent edits', () => {
  for (const kind of BACKENDS) {
    describe(kind, () => {
      test('same-offset text, different-paragraph text, attribute, and run format converge', () => {
        const pair = createPair(kind, twoParagraphFixture());
        try {
          const leftPart = pair.left.materializer.current();
          const rightPart = pair.right.materializer.current();
          const result = concurrent(
            pair,
            (replica) => insertText(replica, leftPart, 'Alpha', 5, '['),
            (replica) => insertText(replica, rightPart, 'Alpha', 5, ']')
          );
          expectConverged(pair);
          expect(bodyText(pair.left.materializer.current())[0]).toMatch(/Alpha[\[\]]+/);
          expect(result.sizes.updateBytes).toBeGreaterThan(0);
          expect(result.sizes.snapshotBytes).toBeGreaterThan(result.sizes.updateBytes);
        } finally {
          destroyPair(pair);
        }

        const paras = createPair(kind, twoParagraphFixture());
        try {
          concurrent(
            paras,
            (replica) => insertText(replica, paras.left.materializer.current(), 'Alpha', 0, 'L'),
            (replica) => insertText(replica, paras.right.materializer.current(), 'Bravo', 0, 'R')
          );
          expectConverged(paras);
          expect(bodyText(paras.left.materializer.current())).toEqual(['LAlpha', 'RBravo']);
        } finally {
          destroyPair(paras);
        }

        const attrs = createPair(kind, twoParagraphFixture());
        try {
          concurrent(
            attrs,
            (replica) =>
              setParagraphAttribute(replica, attrs.left.materializer.current(), 'Alpha', {
                namespaceUri: W14,
                localName: 'textId',
                prefix: 'w14',
                value: 'AAAAAAAA',
              }),
            (replica) =>
              setParagraphAttribute(replica, attrs.right.materializer.current(), 'Bravo', {
                namespaceUri: W14,
                localName: 'textId',
                prefix: 'w14',
                value: 'BBBBBBBB',
              })
          );
          expectConverged(attrs);
        } finally {
          destroyPair(attrs);
        }

        const format = createPair(kind, formatFixture());
        try {
          concurrent(
            format,
            (replica) => addRunMark(replica, format.left.materializer.current(), 'Format', 'b'),
            (replica) => addRunMark(replica, format.right.materializer.current(), 'Format', 'i')
          );
          expectConverged(format);
          const run = collectKind(format.left.materializer.current(), 'run')[0]!;
          const rPr = run.children.find((child) => child.kind === 'runProperties');
          expect(rPr && rPr.kind !== 'textValue' ? rPr.children.length : 0).toBe(2);
        } finally {
          destroyPair(format);
        }
      });

      test('split/type, delete/type, join/type, and table-row insertion converge', () => {
        const split = createPair(kind, twoParagraphFixture());
        try {
          concurrent(
            split,
            (replica) => splitParagraph(replica, split.left.materializer.current(), 'Alpha', 2),
            (replica) => insertText(replica, split.right.materializer.current(), 'Bravo', 5, '!')
          );
          expectConverged(split);
          const texts = bodyText(split.left.materializer.current());
          expect(texts.some((value) => value.includes('Al'))).toBe(true);
          expect(texts.some((value) => value.includes('pha'))).toBe(true);
          expect(texts.some((value) => value.includes('Bravo!'))).toBe(true);
        } finally {
          destroyPair(split);
        }

        const del = createPair(kind, twoParagraphFixture());
        try {
          concurrent(
            del,
            (replica) => deleteParagraph(replica, del.left.materializer.current(), 'Bravo'),
            (replica) => insertText(replica, del.right.materializer.current(), 'Alpha', 0, 'Z')
          );
          expectConverged(del);
          expect(bodyText(del.left.materializer.current())[0]).toBe('ZAlpha');
        } finally {
          destroyPair(del);
        }

        const join = createPair(kind, twoParagraphFixture());
        try {
          concurrent(
            join,
            (replica) =>
              joinParagraphs(replica, join.left.materializer.current(), 'Alpha', 'Bravo'),
            (replica) => insertText(replica, join.right.materializer.current(), 'Alpha', 5, '*')
          );
          expectConverged(join);
          const joined = bodyText(join.left.materializer.current()).join('|');
          expect(joined.includes('Alpha') || joined.includes('Al')).toBe(true);
        } finally {
          destroyPair(join);
        }

        const table = createPair(kind, tableFixture());
        try {
          concurrent(
            table,
            (replica) => insertTableRow(replica, table.left.materializer.current()),
            (replica) => insertTableRow(replica, table.right.materializer.current())
          );
          expectConverged(table);
          expect(collectKind(table.left.materializer.current(), 'tableRow').length).toBe(3);
        } finally {
          destroyPair(table);
        }
      });

      test('remote one-character insert stays path-local versus the local replica', () => {
        const pair = createPair(kind, twoParagraphFixture());
        try {
          const beforeLeft = pair.left.materializer.current();
          const beforeRight = pair.right.materializer.current();
          insertText(pair.left, beforeLeft, 'Alpha', 5, '!');
          const afterLeft = pair.left.materializer.rebuild();
          const localAllocated = countNewReferences(beforeLeft.root, afterLeft.root);
          const sizes = syncOne(pair.left, pair.right);
          const afterRight = pair.right.materializer.current();
          const remoteAllocated = countNewReferences(beforeRight.root, afterRight.root);
          const evidence = allocationEvidence(kind, localAllocated, remoteAllocated);
          expect(canonicalOoxmlFingerprint(afterLeft)).toBe(canonicalOoxmlFingerprint(afterRight));
          expect(evidence.verdict).not.toBe('kill');
          expect(sizes.updateBytes).toBeGreaterThan(0);
          expect(sizes.snapshotBytes).toBeGreaterThan(sizes.updateBytes);
        } finally {
          destroyPair(pair);
        }
      });
    });
  }
});
