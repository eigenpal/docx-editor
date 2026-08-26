/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  semanticDigest,
  serializeOoxmlPart,
  validateOoxmlPart,
  type OoxmlInvariantResult,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { BackendKind, InvariantIssueCode } from './contract.ts';
import { twoParagraphFixture } from './fixtures.ts';
import { insertText } from './ops.ts';
import {
  applyDelivery,
  concurrent,
  createPair,
  destroyPair,
  destroyReplica,
  joinReplica,
} from './replicas.ts';

const BACKENDS: readonly BackendKind[] = ['xml', 'registry'];
export const recordedIssueCodes: InvariantIssueCode[] = [];

function reopen(part: OoxmlPart): OoxmlPart {
  const xml = serializeOoxmlPart(part);
  const result = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
  if (!result.ok) throw new Error(`reopen failed: ${result.reason}`);
  return result.part;
}

/** Scratch delta check. Production `validateOoxmlPartDelta` is not a public store export. */
function validateDelta(previous: OoxmlPart, part: OoxmlPart): OoxmlInvariantResult {
  if (previous.root === part.root) return { ok: true };
  return validateOoxmlPart(part);
}

describe('representation spike conformance', () => {
  for (const kind of BACKENDS) {
    for (const order of ['left-right', 'right-left'] as const) {
      test(`${kind} ${order} validates, fingerprints, and round-trips`, () => {
        const pair = createPair(kind, twoParagraphFixture());
        try {
          const beforeLeft = pair.left.materializer.current();
          const beforeRight = pair.right.materializer.current();
          const baseline = pair.left.backend.encodeSnapshot();
          const { leftUpdate, rightUpdate } = concurrent(
            pair,
            (replica) => insertText(replica, beforeLeft, 'Alpha', 5, 'L'),
            (replica) => insertText(replica, beforeRight, 'Bravo', 5, 'R'),
            order
          );
          const left = pair.left.materializer.current();
          const right = pair.right.materializer.current();
          const leftValidation = validateOoxmlPart(left);
          const rightValidation = validateOoxmlPart(right);
          expect(leftValidation.ok).toBe(true);
          expect(rightValidation.ok).toBe(true);
          if (!leftValidation.ok) {
            for (const issue of leftValidation.issues) recordedIssueCodes.push(issue.code);
          }
          expect(validateDelta(beforeLeft, left).ok).toBe(true);
          expect(validateDelta(beforeRight, right).ok).toBe(true);
          expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
          const leftDigest = semanticDigest([left]);
          const rightDigest = semanticDigest([right]);
          expect(leftDigest).toEqual(rightDigest);
          expect(semanticDigest([reopen(left)])).toEqual(leftDigest);
          expect(semanticDigest([reopen(right)])).toEqual(rightDigest);

          const replay = joinReplica(kind, 'replay', 5, baseline);
          try {
            applyDelivery(
              replay,
              order === 'left-right' ? [leftUpdate, rightUpdate] : [rightUpdate, leftUpdate]
            );
            expect(canonicalOoxmlFingerprint(replay.materializer.current())).toBe(
              canonicalOoxmlFingerprint(left)
            );
            expect(semanticDigest([replay.materializer.current()])).toEqual(leftDigest);
          } finally {
            destroyReplica(replay);
          }
        } finally {
          destroyPair(pair);
        }
      });
    }
  }
});
