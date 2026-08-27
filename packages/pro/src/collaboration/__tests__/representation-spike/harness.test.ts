/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  validateOoxmlPart,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import type { BackendKind } from './contract.ts';
import { assertIndependentIdentity } from './identity.ts';
import {
  countNewReferences,
  nodeText,
  paragraphWithText,
  textWith,
  twoParagraphFixture,
} from './fixtures.ts';
import { allocationEvidence } from './gates.ts';
import { createPair, destroyPair } from './replicas.ts';
import { insertText } from './ops.ts';

const BACKENDS: readonly BackendKind[] = ['xml', 'registry'];

function siblingParagraph(partRoot: OoxmlNode, keepText: string): OoxmlNode {
  if (partRoot.kind === 'textValue') throw new Error('root is text');
  const body = partRoot.children[0];
  if (!body || body.kind === 'textValue') throw new Error('body missing');
  const match = body.children.find(
    (child) => child.kind !== 'textValue' && nodeText(child) === keepText
  );
  if (!match) throw new Error('sibling missing');
  return match;
}

describe('representation spike harness', () => {
  for (const kind of BACKENDS) {
    describe(kind, () => {
      test('seeds two independent Y.Doc replicas without a provider', () => {
        const pair = createPair(kind, twoParagraphFixture());
        try {
          expect(pair.left.doc).not.toBe(pair.right.doc);
          expect(pair.left.doc.clientID).toBe(1);
          expect(pair.right.doc.clientID).toBe(2);
          expect(pair.left.backend.kind).toBe(kind);
          expect(pair.right.backend.kind).toBe(kind);
          expect(canonicalOoxmlFingerprint(pair.left.materializer.current())).toBe(
            canonicalOoxmlFingerprint(pair.fixture)
          );
          expect(canonicalOoxmlFingerprint(pair.right.materializer.current())).toBe(
            canonicalOoxmlFingerprint(pair.fixture)
          );
        } finally {
          destroyPair(pair);
        }
      });

      test('keeps logical ids independent from Yjs items and Word-facing ids', () => {
        const pair = createPair(kind, twoParagraphFixture());
        try {
          const part = pair.left.materializer.current();
          const paragraph = paragraphWithText(part, 'Alpha');
          const meta = pair.left.backend.identityMeta(paragraph.id);
          expect(meta).not.toBeNull();
          assertIndependentIdentity(meta!);
          expect(meta!.wordFacingIds).toContain('11111111');
          expect(paragraph.id).not.toBe('11111111');
          expect(meta!.yjsItemKey === null || meta!.yjsItemKey !== paragraph.id).toBe(true);
        } finally {
          destroyPair(pair);
        }
      });

      test('materializes a valid frozen part and reuses untouched sibling identity', () => {
        const pair = createPair(kind, twoParagraphFixture());
        try {
          const before = pair.left.materializer.current();
          expect(validateOoxmlPart(before).ok).toBe(true);
          const bravoBefore = siblingParagraph(before.root, 'Bravo');
          insertText(pair.left, before, 'Alpha', 5, '!');
          const after = pair.left.materializer.rebuild();
          expect(validateOoxmlPart(after).ok).toBe(true);
          expect(canonicalOoxmlFingerprint(after)).not.toBe(canonicalOoxmlFingerprint(before));
          const bravoAfter = siblingParagraph(after.root, 'Bravo');
          expect(bravoAfter).toBe(bravoBefore);
          expect(after.root).not.toBe(before.root);
          const dirty = pair.left.materializer.dirtyPaths();
          expect(dirty.has(textWith(before, 'Alpha').id)).toBe(true);
          expect(dirty.has(bravoBefore.id)).toBe(false);
        } finally {
          destroyPair(pair);
        }
      });

      test('records local allocation for a one-character insert', () => {
        const pair = createPair(kind, twoParagraphFixture());
        try {
          const before = pair.left.materializer.current();
          insertText(pair.left, before, 'Alpha', 5, '!');
          const after = pair.left.materializer.rebuild();
          const allocated = countNewReferences(before.root, after.root);
          const evidence = allocationEvidence(kind, allocated, allocated);
          expect(allocated).toBeGreaterThan(0);
          expect(allocated).toBeLessThan(countNodesSafe(after.root));
          expect(evidence.verdict).toBe('pass');
        } finally {
          destroyPair(pair);
        }
      });
    });
  }

  test('spike sources stay outside the production export graph', async () => {
    const index = await Bun.file(new URL('../../index.ts', import.meta.url)).text();
    expect(index).not.toContain('representation-spike');
    const session = await Bun.file(new URL('../../session.ts', import.meta.url)).text();
    expect(session).not.toContain('representation-spike');
  });
});

function countNodesSafe(node: OoxmlNode): number {
  let count = 0;
  const visit = (current: OoxmlNode): void => {
    count += 1;
    if (current.kind === 'textValue') return;
    for (const child of current.children) visit(child);
  };
  visit(node);
  return count;
}
