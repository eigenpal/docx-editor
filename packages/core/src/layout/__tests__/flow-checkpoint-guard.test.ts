// The flow-checkpoint guard map stays true (companion to flow-checkpoint-guards.ts).
//
// The map's `satisfies` clause catches a `FlowCheckpoint` field that was never classified.
// These tests catch the two failures the compiler cannot see:
//  - a checkpoint BUILT with a field the interface never declared (runtime walk), and
//  - the convergence comparison in semantic-layout.ts silently dropping a `'compared'`
//    field, or quietly starting to compare a `'restore-only'` one (source scan).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type PageGeometry,
} from '../index.ts';
import {
  FLOW_CHECKPOINT_GUARDS,
  unguardedCheckpointFields,
  type FlowCheckpointGuard,
} from '../flow-checkpoint-guards.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 120,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const DOCUMENT = Array.from({ length: 24 }, (_, index) =>
  paragraph(`paragraph ${index} ${'word '.repeat(6)}`)
).join('');

describe('every checkpoint field is classified', () => {
  test('a real multi-page pass records checkpoints with no unguarded field', () => {
    const session = createLayoutSession();
    layoutSemanticDocument(load(DOCUMENT), 1, { measurer, geometry: GEOMETRY, session });
    expect(session.checkpoints.length).toBeGreaterThan(0);
    for (const checkpoint of session.checkpoints) {
      expect(unguardedCheckpointFields(checkpoint)).toEqual([]);
    }
  });
});

describe('the convergence comparison agrees with the map', () => {
  // The comparison lives in semantic-layout.ts as a hand-written `mark && ...` condition.
  // Slice the region from where the previous checkpoint is fetched to where the shift
  // verdict is taken; every field's fate is decided inside it.
  const source = readFileSync(
    fileURLToPath(new URL('../semantic-layout.ts', import.meta.url)),
    'utf8'
  );
  const start = source.indexOf('const mark = session.checkpoints[');
  // The CALL, not the name: a comment inside the region mentions the function too.
  const end = source.indexOf('convergenceTailShiftAllowed({', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const region = source.slice(start, end);

  const fields = Object.entries(FLOW_CHECKPOINT_GUARDS) as [string, FlowCheckpointGuard][];

  for (const [field, guard] of fields) {
    if (guard === 'restore-only') {
      test(`'${field}' is restore-only and the convergence region never reads it`, () => {
        // If convergence starts comparing it, the map (and its documented argument for
        // never comparing it) is stale — reclassify it, do not just silence this.
        expect(region.includes(`mark.${field}`)).toBe(false);
      });
    } else {
      test(`'${field}' (${guard}) is read by the convergence region`, () => {
        // A 'compared' field that vanished from the condition converges a mismatched
        // flow: the exact silent failure deferredAnchoredDrawings shipped once.
        expect(region.includes(`mark.${field}`)).toBe(true);
      });
    }
  }
});
