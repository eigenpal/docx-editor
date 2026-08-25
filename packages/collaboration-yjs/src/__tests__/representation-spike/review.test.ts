import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  validateOoxmlPart,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import type { BackendKind } from './contract.ts';
import {
  collectKind,
  commentAnchorFixture,
  contentControlFixture,
  invalidPlacementFixture,
  nodeText,
  revisionWrapperFixture,
  unknownNodeFixture,
} from './fixtures.ts';
import { insertText } from './ops.ts';
import { concurrent, createPair, destroyPair } from './replicas.ts';

const BACKENDS: readonly BackendKind[] = ['xml', 'registry'];

function kinds(partRoot: OoxmlNode): string[] {
  const found: string[] = [];
  const walk = (node: OoxmlNode): void => {
    found.push(node.kind);
    if (node.kind !== 'textValue') for (const child of node.children) walk(child);
  };
  walk(partRoot);
  return found;
}

describe('representation spike review and generic fixtures', () => {
  for (const kind of BACKENDS) {
    test(`${kind} comment anchors converge and stay valid`, () => {
      const pair = createPair(kind, commentAnchorFixture());
      try {
        const before = pair.left.materializer.current();
        expect(kinds(before.root)).toContain('commentRangeStart');
        expect(kinds(before.root)).toContain('commentReference');
        concurrent(
          pair,
          (replica) => insertText(replica, pair.left.materializer.current(), 'Commented', 0, 'L'),
          (replica) => insertText(replica, pair.right.materializer.current(), 'Commented', 9, 'R')
        );
        const left = pair.left.materializer.current();
        expect(canonicalOoxmlFingerprint(left)).toBe(
          canonicalOoxmlFingerprint(pair.right.materializer.current())
        );
        expect(validateOoxmlPart(left).ok).toBe(true);
        expect(nodeText(collectKind(left, 'paragraph')[0]!)).toContain('Commented');
        expect(kinds(left.root)).toContain('commentRangeStart');
      } finally {
        destroyPair(pair);
      }
    });

    test(`${kind} revision wrappers converge`, () => {
      const pair = createPair(kind, revisionWrapperFixture());
      try {
        expect(kinds(pair.left.materializer.current().root)).toContain('revisionInsert');
        concurrent(
          pair,
          (replica) => insertText(replica, pair.left.materializer.current(), 'Inserted', 0, '['),
          (replica) => insertText(replica, pair.right.materializer.current(), 'Inserted', 8, ']')
        );
        const left = pair.left.materializer.current();
        expect(canonicalOoxmlFingerprint(left)).toBe(
          canonicalOoxmlFingerprint(pair.right.materializer.current())
        );
        expect(validateOoxmlPart(left).ok).toBe(true);
        expect(kinds(left.root)).toContain('revisionInsert');
      } finally {
        destroyPair(pair);
      }
    });

    test(`${kind} content controls converge`, () => {
      const pair = createPair(kind, contentControlFixture());
      try {
        expect(kinds(pair.left.materializer.current().root)).toContain('contentControl');
        concurrent(
          pair,
          (replica) => insertText(replica, pair.left.materializer.current(), 'Bound', 0, 'A'),
          (replica) => insertText(replica, pair.right.materializer.current(), 'Bound', 5, 'B')
        );
        const left = pair.left.materializer.current();
        expect(canonicalOoxmlFingerprint(left)).toBe(
          canonicalOoxmlFingerprint(pair.right.materializer.current())
        );
        expect(validateOoxmlPart(left).ok).toBe(true);
        expect(kinds(left.root)).toContain('contentControl');
      } finally {
        destroyPair(pair);
      }
    });

    test(`${kind} unknown nodes stay generic`, () => {
      const pair = createPair(kind, unknownNodeFixture());
      try {
        const before = pair.left.materializer.current();
        const unknown = collectKind(before, 'generic').find((node) => node.localName === 'marker');
        expect(unknown).toBeDefined();
        concurrent(
          pair,
          (replica) => insertText(replica, pair.left.materializer.current(), 'Known', 0, 'X'),
          (replica) => insertText(replica, pair.right.materializer.current(), 'keep', 0, 'Y')
        );
        const left = pair.left.materializer.current();
        expect(canonicalOoxmlFingerprint(left)).toBe(
          canonicalOoxmlFingerprint(pair.right.materializer.current())
        );
        expect(collectKind(left, 'generic').some((node) => node.localName === 'marker')).toBe(true);
      } finally {
        destroyPair(pair);
      }
    });

    test(`${kind} invalid placement demotes without dropping content`, () => {
      const pair = createPair(kind, invalidPlacementFixture());
      try {
        const before = pair.left.materializer.current();
        expect(validateOoxmlPart(before).ok).toBe(true);
        expect(nodeText(before.root)).toContain('Host');
        expect(nodeText(before.root)).toContain('Nested');
        concurrent(
          pair,
          (replica) => insertText(replica, pair.left.materializer.current(), 'Host', 0, '!'),
          (replica) => insertText(replica, pair.right.materializer.current(), 'Nested', 0, '?')
        );
        const left = pair.left.materializer.current();
        expect(canonicalOoxmlFingerprint(left)).toBe(
          canonicalOoxmlFingerprint(pair.right.materializer.current())
        );
        expect(validateOoxmlPart(left).ok).toBe(true);
        expect(nodeText(left.root)).toContain('!Host');
        expect(nodeText(left.root)).toContain('?Nested');
      } finally {
        destroyPair(pair);
      }
    });
  }
});
