// Footnote budgets at the page bottom: the note area may use the last line's trailing
// line-spacing depth, and a held-out reference keeps only its own line off the page.
import { describe, expect, test } from 'bun:test';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import {
  expectNotesWithReferences,
  expectReferenceBoxesClear,
  labeledLine,
  layoutProbe,
  loadProbe,
  notesInput,
  pages,
  shapeOf,
  summary,
  warmSessionOver,
  type Probe,
} from './footnote-probe-harness.ts';

describe('footnote area beside the last line trailing spacing', () => {
  // US Letter, 1 in margins: 648 pt of body. Body lines are 30.55 pt double-spaced boxes
  // whose glyph band ends 15.27 pt above the box; each note line is 12.73 pt.
  test('a note fits whole when the last line leaves room below its glyph band', () => {
    // 17 note lines: the area rises above L14's box bottom but stays below its glyph band.
    const probe: Probe = { lines: 30, refs: { 1: [1] }, notes: { 1: 17 } };
    const layout = layoutProbe(probe);
    expect(layout.pages.map(summary)).toEqual(['L01..L14 | 1', 'L15..L30']);
    const page = layout.pages[0]!;
    const fragment = page.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
    const last = fragment.lines[fragment.lines.length - 1]!;
    const areaTop = page.footnotes!.box.y - page.contentBox.y;
    expect(areaTop).toBeLessThan(last.box.y + last.box.height);
    expect(areaTop).toBeGreaterThanOrEqual(
      last.box.y + last.box.height - (last.trailingSpacing ?? 0)
    );
    expectNotesWithReferences(probe, layout);
  });

  test('a first-page note never continues onto later body-only pages', () => {
    const probe: Probe = { lines: 70, refs: { 1: [1] }, notes: { 1: 10 } };
    const layout = layoutProbe(probe);
    expect(layout.pages.map(summary)).toEqual(['L01..L17 | 1', 'L18..L38', 'L39..L59', 'L60..L70']);
    expectNotesWithReferences(probe, layout);
  });

  test('a reference line whose glyph band fits but whose box does not moves with its note', () => {
    // With L15 kept, notes 1 and 2 would start 1.09 pt above L15's box bottom and
    // 14.18 pt below its glyph band. The reference line needs its whole box.
    const probe: Probe = { lines: 30, refs: { 1: [1], 15: [2] }, notes: { 1: 13, 2: 1 } };
    expect(pages(probe)).toEqual(['L01..L14 | 1', 'L15..L30 | 2']);
    expectNotesWithReferences(probe);
  });

  test('a reference line that fits by neither box nor glyph band moves with its note', () => {
    const probe: Probe = { lines: 30, refs: { 1: [1], 15: [2] }, notes: { 1: 15, 2: 1 } };
    expect(pages(probe)).toEqual(['L01..L14 | 1', 'L15..L30 | 2']);
    expectNotesWithReferences(probe);
  });

  test('a split note starts below the full box of its reference line', () => {
    // L14 ends page 1 and carries a note taller than the note column. The note splits,
    // and its head starts below L14's whole line box, not just below its glyph band.
    const probe: Probe = { lines: 30, refs: { 14: [1] }, notes: { 1: 50 } };
    const layout = layoutProbe(probe);
    expect(layout.pages.map(summary)).toEqual(['L01..L14 | 1', 'L15..L21 | 1c', 'L22..L30']);
    const page = layout.pages[0]!;
    const refLine = labeledLine(page, 14);
    expect(refLine.trailingSpacing ?? 0).toBeGreaterThan(0);
    expectReferenceBoxesClear(probe, layout);
  });

  test('a warm split note keeps the same reference clearance as a clean layout', () => {
    const probe: Probe = { lines: 30, refs: { 14: [1] }, notes: { 1: 50 } };
    const doc = warmSessionOver(probe);
    expect(shapeOf(doc.warm())).toEqual(shapeOf(doc.clean()));
    const paragraphId = doc.paragraphIds()[0]!;
    for (const text of ['x', 'yy']) {
      expect(doc.edit({ op: 'insertText', paragraphId, offset: 3, text })).toBe(true);
      const warm = doc.warm();
      expect(shapeOf(warm)).toEqual(shapeOf(doc.clean()));
      expectReferenceBoxesClear(probe, warm);
    }
  });
});

describe('footnote hold-out keeps only the reference line out', () => {
  test('reference-free lines return in front of a reference whose note cannot', () => {
    // An earlier round lays page 2 out under page 1's first-pass reserve; the reference on
    // L40 then opens page 3. Page 2 fills exactly as it does without that reference.
    const control: Probe = { lines: 70, refs: { 1: [1] }, notes: { 1: 8 } };
    const probe: Probe = { lines: 70, refs: { 1: [1], 40: [2] }, notes: { 1: 8, 2: 4 } };
    expect(pages(control).slice(0, 2)).toEqual(['L01..L17 | 1', 'L18..L38']);
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L38', 'L39..L57 | 2', 'L58..L70']);
    expectNotesWithReferences(probe);
  });

  test('the line above a held reference line returns on its own', () => {
    const probe: Probe = { lines: 70, refs: { 1: [1], 38: [2] }, notes: { 1: 8, 2: 4 } };
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L37', 'L38..L56 | 2', 'L57..L70']);
    expectNotesWithReferences(probe);
  });

  test('a keep-with-next heading returns with the two lines orphan control needs', () => {
    // L35 is a `w:keepNext` heading; L36-L45 a widow-controlled paragraph with its
    // reference on L38. The heading and L36-L37 return; L38 opens page 3.
    const probe: Probe = {
      lines: 45,
      paragraphs: [
        { lines: 34 },
        { lines: 1, keepNext: true, widowControl: true },
        { lines: 10, widowControl: true },
      ],
      refs: { 1: [1], 38: [2] },
      notes: { 1: 8, 2: 12 },
    };
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L37', 'L38..L45 | 2']);
    expectNotesWithReferences(probe);
  });

  test('a keep-with-next heading stays when only one line of its paragraph could return', () => {
    // The reference sits on the paragraph's second line, so one line could return ahead of
    // it: orphan control refuses that, and the heading stays with its paragraph. L36, the
    // preceding paragraph's last line, still returns.
    const probe: Probe = {
      lines: 47,
      paragraphs: [
        { lines: 36 },
        { lines: 1, keepNext: true, widowControl: true },
        { lines: 10, widowControl: true },
      ],
      refs: { 1: [1], 39: [2] },
      notes: { 1: 8, 2: 12 },
    };
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L36', 'L37..L47 | 2']);
    expectNotesWithReferences(probe);
  });

  test('the reference line returns when only a lower reference note cannot', () => {
    // L37's one-line note fits beside it on page 2; L38's ten-line note does not. The lower
    // reference stays on page 3 without keeping L37 there.
    const probe: Probe = {
      lines: 70,
      refs: { 1: [1], 37: [2], 38: [3] },
      notes: { 1: 8, 2: 1, 3: 10 },
    };
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L37 | 2', 'L38..L54 | 3', 'L55..L70']);
    expectNotesWithReferences(probe);
  });

  test('a widow pair returns only when both of its notes fit', () => {
    // Widow control ties L17, the penultimate line of a continued paragraph, to L18. L17's
    // note alone would fit on page 1, but the pair brings L18's note too. Releasing L17
    // on its own note let the pair return, evicted L18, and sent both back: an orbit.
    const probe: Probe = {
      lines: 18,
      paragraphs: [{ lines: 14 }, { lines: 4, widowControl: true }],
      refs: { 1: [1], 17: [2], 18: [3] },
      notes: { 1: 4, 2: 1, 3: 4 },
    };
    expect(pages(probe)).toEqual(['L01..L16 | 1', 'L17..L18 | 2 3']);
    expectNotesWithReferences(probe);
  });
});

describe('footnote hold-out across incremental layouts', () => {
  test('a warm session follows note edits to the same pages as a clean layout', () => {
    const session = createLayoutSession();
    const shapes = [
      { lines: 70, refs: { 1: [1], 40: [2] }, notes: { 1: 8, 2: 4 } },
      { lines: 70, refs: { 1: [1], 40: [2] }, notes: { 1: 10, 2: 4 } },
      { lines: 70, refs: { 1: [1], 38: [2] }, notes: { 1: 8, 2: 4 } },
      { lines: 70, refs: { 1: [1], 37: [2], 38: [3] }, notes: { 1: 8, 2: 1, 3: 10 } },
    ] satisfies Probe[];
    shapes.forEach((probe, revision) => {
      const loaded = loadProbe(probe);
      const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
      const notes = notesInput(loaded);
      const warm = layoutSemanticDocument(part, revision + 1, {
        measurer: notes.measurer,
        notes,
        session,
      });
      expect(shapeOf(warm)).toEqual(shapeOf(layoutProbe(probe)));
      expectNotesWithReferences(probe, warm);
    });
  });

  test('typing before a held reference keeps the warm layout equal to a clean one', () => {
    const probe: Probe = { lines: 70, refs: { 1: [1], 40: [2] }, notes: { 1: 8, 2: 4 } };
    const doc = warmSessionOver(probe);
    expect(shapeOf(doc.warm())).toEqual(shapeOf(doc.clean()));
    const paragraphId = doc.paragraphIds()[0]!;
    for (const text of ['x', 'yy']) {
      expect(doc.edit({ op: 'insertText', paragraphId, offset: 3, text })).toBe(true);
      const warm = doc.warm();
      expect(shapeOf(warm)).toEqual(shapeOf(doc.clean()));
      expect(warm.pages.map(summary)).toEqual([
        'L01..L17 | 1',
        'L18..L38',
        'L39..L57 | 2',
        'L58..L70',
      ]);
    }
  });
});
