// Per-block body editability (partial-body-editability, task M6P.1).
//
// `diagnoseBodyPatchability` answers one body-wide boolean and returns at the FIRST
// blocking block, so a single table anywhere makes an entire document immutable. On the
// comprehensive Word element fixture that meant 0 editable paragraphs out of 258.
//
// That is stricter than the lower layers require: preservation already indexes per-block
// source ranges, re-emits unchanged ranges verbatim, and patches a changed paragraph only
// after its slice passes the lossless-capture guard.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parseDocx } from '../src/package/index.ts';
import { assessBodyEditability, diagnoseBodyPatchability } from '../src/package/index.ts';
import { createEmptyModel } from '../src/index.ts';

const FIXTURE = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');

function comprehensiveModel() {
  const parsed = parseDocx(new Uint8Array(readFileSync(FIXTURE)), { preserveAll: true });
  if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.reason}`);
  return parsed.model;
}

describe('per-block body editability', () => {
  test('the comprehensive fixture is PARTIALLY editable, not wholly read-only', () => {
    const assessment = assessBodyEditability(comprehensiveModel());
    expect(assessment.mode).toBe('partial');
    // The number that matters: safe paragraphs stay editable beside immutable structures.
    expect(assessment.patchableBlockIds.size).toBeGreaterThan(100);
    expect(assessment.regions.length).toBeGreaterThan(0);
  });

  test('tables, SDTs, and unmodeled paragraphs are each reported as their own region', () => {
    const assessment = assessBodyEditability(comprehensiveModel());
    const codes = new Set(assessment.regions.map((r) => r.code));
    // One diagnostic PER read-only block, not one for the document.
    expect(codes.has('non-editable-kind')).toBe(true);
    expect(codes.has('unmodeled-content')).toBe(true);
    for (const region of assessment.regions) {
      expect(region.story.length).toBeGreaterThan(0);
      expect(region.missingLane.length).toBeGreaterThan(0);
      // A region naming a specific block must identify it, or a host cannot show the
      // user which part of their document is locked.
      if (region.code === 'non-editable-kind' || region.code === 'unmodeled-content') {
        expect(region.blockId, region.message).toBeDefined();
        expect(region.blockKind, region.message).toBeDefined();
      }
    }
  });

  test('a partially editable body forbids structural mutation', () => {
    // A changed body-block count invokes whole-region regeneration, which is
    // unavailable when any original block is not fully captured.
    const assessment = assessBodyEditability(comprehensiveModel());
    expect(assessment.structuralMutationAllowed).toBe(false);
  });

  test('no patchable id is also reported as a read-only region', () => {
    const assessment = assessBodyEditability(comprehensiveModel());
    const readOnlyIds = new Set(assessment.regions.map((r) => r.blockId).filter(Boolean) as string[]);
    for (const id of assessment.patchableBlockIds) {
      expect(readOnlyIds.has(id), `block ${id} is both patchable and read-only`).toBe(false);
    }
  });

  test('the body-wide predicate is unchanged — it still reports false here', () => {
    // `diagnoseBodyPatchability` is now a projection of `mode === 'full'`. Every existing
    // caller must keep its previous answer; only partial-aware consumers see more.
    expect(diagnoseBodyPatchability(comprehensiveModel()).editable).toBe(false);
  });

  test('a model with no preservation snapshot is mode none, not partial', () => {
    // Fails closed. Note that a FLAT `parseDocx` (no `preserveAll`) still carries a
    // preservation snapshot, so it is not the no-preservation case — a freshly created
    // model is. Asserting on the flat parse would have passed for the wrong reason.
    const assessment = assessBodyEditability(createEmptyModel());
    expect(assessment.mode).toBe('none');
    expect(assessment.patchableBlockIds.size).toBe(0);
    expect(assessment.structuralMutationAllowed).toBe(false);
    expect(assessment.regions[0]?.code).toBe('no-preservation');
  });
});
