// Geometry fixture catalog validation and capability-driven behavioral tests (task 3.1).

import { describe, expect, test } from 'bun:test';
import {
  GEOMETRY_FIXTURES,
  GEOMETRY_FIXTURE_VERSION,
  validateGeometryFixtureCatalog,
  unsupportedFixtureCases,
  type GeometryFixtureCase,
  type GeometryFixtureExpectedSemantic,
} from './fixtures/geometry-fixtures.ts';
import { modelFromFixtureInput, paginateLayoutOptions } from './fixtures/geometry-fixture-build.ts';
import { buildSemanticIndex } from '../../editor/semantic-index.ts';
import { toDisplayPages } from '../../editor/display-bridge.ts';
import { createDeterministicLayoutShaping, layoutBody } from '../index.ts';

const LAYOUT_BASE = {
  pageWidth: 12240,
  pageHeight: 15840,
  margin: 1440,
  shaping: createDeterministicLayoutShaping(),
};

/** Every key allowed on fixture.expected must be executed by assertExpectedSemantics. */
const EXECUTABLE_EXPECTED_KEYS = new Set<keyof GeometryFixtureExpectedSemantic>([
  'classificationOnly',
  'hasEditableCaretStops',
  'blockCount',
  'emptyBlockCount',
  'graphemeCounts',
  'trailingGraphemeOffset',
  'trailingAffinity',
  'oneClusterPerGrapheme',
  'fullUtf16Span',
  'noInternalCaretStop',
  'stableIdentityAcrossSplits',
  'whitespaceSubrangeCount',
  'paragraphOwnershipCount',
  'readOnlyBlockCount',
  'structuralOwnership',
]);

function editableCaretStops(index: ReturnType<typeof buildSemanticIndex>) {
  return index.caretStops.filter((s) => s.role === 'editableText');
}

function paragraphTextFromInput(fixture: GeometryFixtureCase): string | undefined {
  const para = fixture.input.paragraphs?.[0];
  if (!para) return fixture.input.tableCellParagraph;
  if (para.text !== undefined) return para.text;
  if (para.runs) return para.runs.join('');
  return '';
}

function assertExpectedSemantics(fixture: GeometryFixtureCase): void {
  const exp = fixture.expected;
  if (!exp) return;

  for (const key of Object.keys(exp) as (keyof GeometryFixtureExpectedSemantic)[]) {
    if (!EXECUTABLE_EXPECTED_KEYS.has(key)) {
      throw new Error(
        `geometry fixtures: ${fixture.id} expected.${key} is not executable in the fixture runner`
      );
    }
  }

  if (exp.classificationOnly) {
    expect(fixture.capability).toBe('readOnly');
    expect(fixture.reason.length).toBeGreaterThan(0);
    return;
  }

  const model = modelFromFixtureInput(fixture.input);
  const index = buildSemanticIndex(model);

  if (exp.blockCount !== undefined) expect(index.stories[0]!.blocks).toHaveLength(exp.blockCount);
  if (exp.emptyBlockCount !== undefined) {
    expect(index.stories[0]!.blocks.filter((b) => b.empty)).toHaveLength(exp.emptyBlockCount);
  }
  if (exp.graphemeCounts !== undefined) {
    expect(index.stories[0]!.blocks.map((b) => b.graphemeCount)).toEqual([...exp.graphemeCounts]);
  }
  if (exp.hasEditableCaretStops !== undefined) {
    expect(editableCaretStops(index).length > 0).toBe(exp.hasEditableCaretStops);
  }
  if (exp.paragraphOwnershipCount !== undefined) {
    expect(index.ownershipRegions.filter((r) => r.kind === 'paragraph')).toHaveLength(
      exp.paragraphOwnershipCount
    );
  }
  if (exp.whitespaceSubrangeCount !== undefined) {
    expect(
      index.ownershipRegions.filter((r) => r.kind === 'lineWhitespace' && r.utf16From !== undefined)
    ).toHaveLength(exp.whitespaceSubrangeCount);
  }
  if (exp.trailingGraphemeOffset !== undefined) {
    const block = index.stories[0]!.blocks[0]!;
    const trailing = index.caretStops.find(
      (s) =>
        s.target.kind === 'text' &&
        s.target.identity.blockId === block.identity.blockId &&
        s.target.graphemeOffset === exp.trailingGraphemeOffset
    );
    expect(trailing?.target.affinity).toBe(exp.trailingAffinity ?? 'downstream');
  }
  if (exp.noInternalCaretStop) {
    for (const block of index.stories[0]!.blocks) {
      expect(
        index.caretStops.filter(
          (s) => s.target.kind === 'text' && s.target.identity.blockId === block.identity.blockId
        )
      ).toHaveLength(block.graphemeCount + 1);
    }
  }
  if (exp.readOnlyBlockCount !== undefined) {
    expect(index.stories[0]!.blocks.filter((b) => b.readOnly)).toHaveLength(exp.readOnlyBlockCount);
  }
  if (exp.structuralOwnership) {
    expect(index.ownershipRegions.some((r) => r.kind === 'structural')).toBe(true);
  }
  if (exp.hasEditableCaretStops === false) {
    expect(editableCaretStops(index)).toHaveLength(0);
    for (const block of index.stories[0]!.blocks) {
      if (block.readOnly) {
        expect(
          index.caretStops.some(
            (s) => s.target.kind === 'text' && s.target.identity.blockId === block.identity.blockId
          )
        ).toBe(false);
      }
    }
  }

  const needsBridge =
    exp.oneClusterPerGrapheme === true ||
    exp.fullUtf16Span === true ||
    exp.stableIdentityAcrossSplits === true;
  if (needsBridge) {
    const paginate = paginateLayoutOptions(fixture.input);
    const layout = layoutBody(model, {
      ...LAYOUT_BASE,
      pageWidth: paginate?.narrowPageWidth ?? LAYOUT_BASE.pageWidth,
    });
    const { display, semanticIndex } = toDisplayPages(model, layout.pages);
    const items = display
      .flatMap((p) => p.items)
      .filter((i) => i.kind === 'text')
      .sort((a, b) =>
        a.kind === 'text' && b.kind === 'text' ? a.semantic.utf16From - b.semantic.utf16From : 0
      );

    if (exp.oneClusterPerGrapheme || exp.fullUtf16Span) {
      const sourceText = paragraphTextFromInput(fixture);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        if (item.kind !== 'text') continue;
        if (exp.oneClusterPerGrapheme) {
          expect(item.clusters).toHaveLength(item.semantic.graphemeTo - item.semantic.graphemeFrom);
          expect(item.clusters.every((c) => c.graphemeTo - c.graphemeFrom === 1)).toBe(true);
        }
        if (exp.fullUtf16Span && sourceText !== undefined && item.semantic.utf16From === 0) {
          const clusterSpan = item.clusters.reduce((n, c) => n + (c.utf16To - c.utf16From), 0);
          expect(clusterSpan).toBe(sourceText.length);
        }
      }
    }

    if (exp.stableIdentityAcrossSplits) {
      const pid = semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
      expect(items.length).toBeGreaterThan(1);
      let lastTo = 0;
      for (const item of items) {
        if (item.kind !== 'text') continue;
        expect(item.semantic.identity.blockId).toBe(pid);
        expect(item.semantic.utf16From).toBeGreaterThanOrEqual(lastTo);
        lastTo = item.semantic.utf16To;
      }
    }
  }
}

describe('geometry fixture catalog', () => {
  test('validates exhaustive versioned coverage (all classes exactly once, unique ids, required fields)', () => {
    expect(() => validateGeometryFixtureCatalog()).not.toThrow();
    expect(GEOMETRY_FIXTURES).toHaveLength(14);
    expect(GEOMETRY_FIXTURES.every((f) => f.version === GEOMETRY_FIXTURE_VERSION)).toBe(true);
  });

  test('every declared expected field key is executable by the fixture runner', () => {
    for (const fixture of GEOMETRY_FIXTURES) {
      if (!fixture.expected) continue;
      for (const key of Object.keys(
        fixture.expected
      ) as (keyof GeometryFixtureExpectedSemantic)[]) {
        expect(EXECUTABLE_EXPECTED_KEYS.has(key)).toBe(true);
      }
    }
  });

  test('unsupported fixtures declare capability and reason without expected semantics', () => {
    for (const fixture of unsupportedFixtureCases()) {
      expect(fixture.capability).toBe('unsupported');
      expect(fixture.reason.trim().length).toBeGreaterThan(0);
      expect(fixture.expected).toBeUndefined();
    }
  });

  for (const fixture of GEOMETRY_FIXTURES) {
    if (fixture.capability === 'supported' || fixture.capability === 'readOnly') {
      test(`${fixture.capability}: ${fixture.id}`, () => assertExpectedSemantics(fixture));
    }
    if (fixture.capability === 'unsupported') {
      test(`unsupported: ${fixture.id}`, () => {
        expect(fixture.reason.trim().length).toBeGreaterThan(0);
        expect(() => modelFromFixtureInput(fixture.input)).not.toThrow();
      });
    }
  }
});
