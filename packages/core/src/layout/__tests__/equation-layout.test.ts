import { describe, expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type PageGeometry, type StyleSpanRecord } from '../semantic-records.ts';
import { createEquationLayouter, type EquationGeometry } from '../equation-layout.ts';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

function layout(body: string, geometry?: PageGeometry) {
  return layoutSemanticDocument(load(body), 1, {
    measurer,
    ...(geometry ? { geometry } : {}),
  });
}

function equationSpan(body: string): StyleSpanRecord {
  const span = linesOf(layout(body))
    .flatMap((line) => line.spans)
    .find((candidate) => candidate.equation);
  if (!span) throw new Error('missing equation span');
  return span;
}

function assertFiniteGeometry(node: EquationGeometry): void {
  for (const value of [node.box.x, node.box.y, node.box.width, node.box.height, node.baseline]) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
  switch (node.kind) {
    case 'row':
      node.items.forEach(assertFiniteGeometry);
      break;
    case 'fraction':
      assertFiniteGeometry(node.numerator);
      assertFiniteGeometry(node.denominator);
      break;
    case 'radical':
      assertFiniteGeometry(node.sign);
      assertFiniteGeometry(node.radicand);
      if (node.degree) assertFiniteGeometry(node.degree);
      break;
    case 'script':
      assertFiniteGeometry(node.base);
      if (node.subscript) assertFiniteGeometry(node.subscript);
      if (node.superscript) assertFiniteGeometry(node.superscript);
      break;
    case 'nary':
      assertFiniteGeometry(node.operator);
      assertFiniteGeometry(node.body);
      if (node.lowerLimit) assertFiniteGeometry(node.lowerLimit);
      if (node.upperLimit) assertFiniteGeometry(node.upperLimit);
      break;
    default:
      break;
  }
}

const complexEquation =
  '<m:oMath>' +
  '<m:f><m:num><m:r><m:t>a+b</m:t></m:r></m:num>' +
  '<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>' +
  '<m:rad><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad>' +
  '<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>' +
  '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>' +
  '<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>' +
  '<m:sub><m:r><m:t>n</m:t></m:r></m:sub><m:sup/>' +
  '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>' +
  '</m:oMath>';

describe('atomic equation paragraph layout', () => {
  test('publishes one model span with source metadata and deterministic geometry', () => {
    const body = `<w:p><w:r><w:t>A</w:t></w:r>${complexEquation}` + '<w:r><w:t>Z</w:t></w:r></w:p>';
    const first = layout(body);
    const second = layout(body);
    const [line] = linesOf(first);
    const equation = line!.spans.find((span) => span.equation)!;

    expect(line!.spans.map((span) => span.text)).toEqual(['A', '\uFFFC', 'Z']);
    expect(equation.range).toMatchObject({ start: 1, end: 2 });
    expect(equation.projected).toBe(true);
    expect(equation.style.fontFamily).toBe('Cambria Math');
    expect(equation.equation?.sourceNodeId).toBe('/word/document.xml#0.0.0.1');
    // Layout publishes no eager caret edges; a caret inside the atom measures on demand.
    expect(equation.caretEdges).toBeUndefined();
    expect(equation.equation?.geometry).toEqual(
      linesOf(second)[0]!.spans.find((span) => span.equation)!.equation!.geometry
    );
    assertFiniteGeometry(equation.equation!.geometry);
  });

  test('composes fraction, radical, script, and n-ary records without DOM metrics', () => {
    const geometry = equationSpan(`<w:p>${complexEquation}</w:p>`).equation!.geometry;
    expect(geometry.kind).toBe('row');
    if (geometry.kind !== 'row') return;
    expect(geometry.items.map((child) => child.kind)).toEqual([
      'fraction',
      'radical',
      'script',
      'nary',
    ]);
    const fraction = geometry.items[0]!;
    expect(fraction.kind).toBe('fraction');
    if (fraction.kind === 'fraction') {
      expect(fraction.bar.width).toBeGreaterThan(0);
      expect(fraction.denominator.box.y).toBeGreaterThan(fraction.bar.y);
    }
  });

  test('keeps nested n-ary child tops non-negative', () => {
    const nested =
      '<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:e>' +
      '<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>' +
      '<m:sup><m:f><m:num><m:r><m:t>n</m:t></m:r></m:num>' +
      '<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:sup>' +
      '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>' +
      '</m:e></m:nary></m:oMath>';
    const geometry = equationSpan(`<w:p>${nested}</w:p>`).equation!.geometry;

    expect(geometry.kind).toBe('nary');
    if (geometry.kind !== 'nary') return;
    expect(geometry.body.box.y).toBeGreaterThanOrEqual(0);
    assertFiniteGeometry(geometry);
  });

  test('keeps the equation atom whole when it wraps', () => {
    const result = layout(`<w:p><w:r><w:t>prefix </w:t></w:r>${complexEquation}</w:p>`, {
      width: 100,
      height: 500,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const equations = linesOf(result)
      .flatMap((line) => line.spans)
      .filter((span) => span.equation);
    expect(equations).toHaveLength(1);
    expect(equations[0]!.range.end - equations[0]!.range.start).toBe(1);
  });

  test('publishes bounded fallback text geometry for unsupported OMML', () => {
    const span = equationSpan(
      '<w:p><m:oMath><m:bar><m:e><m:r><m:t>safe fallback</m:t></m:r>' +
        '</m:e></m:bar></m:oMath></w:p>'
    );
    expect(span.equation).toMatchObject({
      fallbackText: 'safe fallback',
      geometry: { kind: 'fallback', text: 'safe fallback' },
    });
  });

  test('shows a deleted equation in original and markup views and retains its range', () => {
    const part = load(
      '<w:p><w:del w:id="7" w:author="Reviewer">' +
        '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>' +
        '</w:del></w:p>'
    );
    const paragraph = part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
    if (!paragraph) throw new Error('missing paragraph');
    const project = (mode: 'all-markup' | 'proposed' | 'original') => {
      const deletedRanges: { start: number; end: number }[] = [];
      const pieces = piecesOfParagraph(
        paragraph,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        mode,
        deletedRanges
      );
      return { pieces, deletedRanges };
    };

    const allMarkup = project('all-markup');
    const proposed = project('proposed');
    const original = project('original');
    expect(allMarkup.pieces.map((piece) => piece.text)).toEqual(['\uFFFC']);
    expect(allMarkup.pieces[0]?.equation).toBeDefined();
    expect(proposed.pieces).toEqual([]);
    expect(original.pieces.map((piece) => piece.text)).toEqual(['\uFFFC']);
    expect(original.pieces[0]?.equation).toBeDefined();
    expect(allMarkup.deletedRanges).toEqual([{ start: 0, end: 1 }]);
    expect(proposed.deletedRanges).toEqual([{ start: 0, end: 1 }]);
    expect(original.deletedRanges).toEqual([{ start: 0, end: 1 }]);
  });

  test('keeps source OMML unchanged and reproduces geometry after reopen', () => {
    const part = load(`<w:p>${complexEquation}</w:p>`);
    const before = canonicalOoxmlFingerprint(part);
    const first = layoutSemanticDocument(part, 1, { measurer });
    expect(canonicalOoxmlFingerprint(part)).toBe(before);

    const reopened = readOoxmlPart(serializeOoxmlPart(part), {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    const second = layoutSemanticDocument(reopened.part, 2, { measurer });
    const firstEquation = linesOf(first)[0]!.spans.find((span) => span.equation)!.equation;
    const secondEquation = linesOf(second)[0]!.spans.find((span) => span.equation)!.equation;
    expect(secondEquation?.geometry).toEqual(firstEquation?.geometry);
    expect(secondEquation?.sourceNodeId).toBe(firstEquation?.sourceNodeId);
  });

  test('reuses geometry across paragraph breaks and invalidates changed styles', () => {
    const part = load(`<w:p>${complexEquation}</w:p>`);
    const paragraph = part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
    if (!paragraph) throw new Error('missing paragraph');
    const piece = piecesOfParagraph(paragraph).find((candidate) => candidate.equation);
    if (!piece?.equation) throw new Error('missing equation piece');
    const fixed = createFixedMeasurer(6, 14);
    let measureCalls = 0;
    const counting = {
      measure: (...args: Parameters<typeof fixed.measure>) => {
        measureCalls += 1;
        return fixed.measure(...args);
      },
      lineMetrics: (...args: Parameters<typeof fixed.lineMetrics>) => fixed.lineMetrics(...args),
    };

    const first = createEquationLayouter(counting, 'font-epoch:1')(piece.equation, piece.style);
    const callsAfterFirst = measureCalls;
    const second = createEquationLayouter(counting, 'font-epoch:1')(piece.equation, piece.style);
    expect(second).toBe(first);
    expect(measureCalls).toBe(callsAfterFirst);

    const larger = createEquationLayouter(counting, 'font-epoch:1')(
      piece.equation,
      Object.freeze({ ...piece.style, fontSizePt: piece.style.fontSizePt + 2 })
    );
    expect(larger).not.toBe(first);
    expect(measureCalls).toBeGreaterThan(callsAfterFirst);

    const callsAfterStyleChange = measureCalls;
    const nextProducer = createEquationLayouter(counting, 'font-epoch:2')(
      piece.equation,
      piece.style
    );
    expect(nextProducer).not.toBe(first);
    expect(measureCalls).toBeGreaterThan(callsAfterStyleChange);
  });
});
