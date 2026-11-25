// The room a character border takes on its line (`w:bdr`, ECMA-376 Part 1, 17.3.2.4).
//
// The pen advances by the border's space plus its line width on each side of a bordered
// passage, on every line the passage reaches: text beside a border moves by that room, and the
// border stays in the line.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { runBorderStrokesForLine } from '../run-border-strokes.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { runBorderGapBetween, runBorderPad } from '../run-border-advance.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** A 3pt single border: `w:sz` is in eighths of a point. */
const border = (attributes = 'w:sz="24" w:space="0" w:color="C00000"') =>
  `<w:bdr w:val="single" ${attributes}/>`;
const run = (text: string, props = '') =>
  `<w:r><w:rPr><w:sz w:val="22"/>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** The lines of one paragraph in a 200pt measure; every character advances 6pt. */
function lines(body: string, paragraphProps = '', drawings = false) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${paragraphProps}</w:pPr>${body}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const part = read.part;
  const atoms = drawings ? indexInlineDrawingProjectionsInPart(part) : new Map();
  const inlineDrawingLayout: InlineDrawingLayoutContext = {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atoms.get(atomId) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () =>
      Object.freeze({
        kind: 'unrenderable' as const,
        partName: null,
        mime: 'unknown' as const,
        reason: 'unsupported-format' as const,
      }),
  };
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    geometry: { width: 200, height: 400, margin: { left: 0, right: 0, top: 0, bottom: 0 } },
    ...(drawings ? { inlineDrawingLayout } : {}),
  });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
}

const xOf = (line: ReturnType<typeof lines>[number], text: string) =>
  line.spans.find((span) => span.text.includes(text))!.box.x;
const sides = (line: ReturnType<typeof lines>[number], side: string) =>
  runBorderStrokesForLine(line)
    .filter((stroke) => stroke.side === side)
    .map((stroke) => stroke.box);

describe('the room of a character border', () => {
  test('a border advances the pen by its width on each side of its passage', () => {
    const [line] = lines(run('Aa ') + run('Bb', border()) + run(' Cc'));
    // 'Aa ' ends at 18; the border opens for 3pt, 'Bb' is 12pt wide, the border closes for 3pt.
    expect(xOf(line!, 'Bb')).toBe(21);
    // The space of ' Cc' follows the closing side at 36.
    expect(xOf(line!, 'Cc')).toBe(42);
    const [left] = sides(line!, 'left');
    const [right] = sides(line!, 'right');
    expect(left).toMatchObject({ x: 18, width: 3 });
    expect(right).toMatchObject({ x: 33, width: 3 });
  });

  test('the border space takes room with the line width', () => {
    const [line] = lines(run('Aa ') + run('Bb', border('w:sz="24" w:space="6"')) + run(' Cc'));
    expect(xOf(line!, 'Bb')).toBe(18 + 9);
    expect(xOf(line!, 'Cc')).toBe(18 + 9 + 12 + 9 + 6);
  });

  test('a border at the start of a line stays inside the line', () => {
    const [line] = lines(run('Bb', border()) + run(' Cc'));
    expect(xOf(line!, 'Bb')).toBe(3);
    expect(sides(line!, 'left')[0]!.x).toBe(0);
  });

  test('adjacent runs with one border share one passage; a formatting change does not split it', () => {
    const [line] = lines(run('Bb ', border()) + run('Dd', border() + '<w:b/>') + run(' Cc'));
    expect(xOf(line!, 'Bb')).toBe(3);
    expect(xOf(line!, 'Dd')).toBe(3 + 18);
    expect(xOf(line!, 'Cc')).toBe(3 + 30 + 3 + 6);
    expect(runBorderStrokesForLine(line!)).toHaveLength(4);
  });

  test('adjacent runs with different borders each take their own room', () => {
    const blue = border('w:sz="24" w:space="0" w:color="0000C0"');
    const [line] = lines(run('Bb', border()) + run('Dd', blue) + run(' Cc'));
    expect(xOf(line!, 'Bb')).toBe(3);
    // One border closes and the next opens between the two runs.
    expect(xOf(line!, 'Dd')).toBe(3 + 12 + 3 + 3);
    expect(xOf(line!, 'Cc')).toBe(21 + 12 + 3 + 6);
    expect(runBorderStrokesForLine(line!)).toHaveLength(8);
  });

  test('unbordered text between two bordered runs separates their passages', () => {
    const [line] = lines(run('Bb', border()) + run(' ') + run('Dd', border()) + run(' Cc'));
    expect(xOf(line!, 'Dd')).toBe(3 + 12 + 3 + 6 + 3);
    expect(xOf(line!, 'Cc')).toBe(27 + 12 + 3 + 6);
  });

  test('a right-aligned border ends at the measure, with its closing side inside', () => {
    const [line] = lines(run('Aa ') + run('Bb', border()), '<w:jc w:val="right"/>');
    const [right] = sides(line!, 'right');
    expect(right!.x + right!.width).toBeCloseTo(200, 6);
    expect(xOf(line!, 'Bb')).toBeCloseTo(200 - 3 - 12, 6);
  });

  test('a centred line centres its text with its border', () => {
    const [line] = lines(run('Bb', border()) + run(' Cc'), '<w:jc w:val="center"/>');
    // The line is 3 + 12 + 3 + 18 wide.
    expect(xOf(line!, 'Bb')).toBeCloseTo((200 - 36) / 2 + 3, 6);
  });

  test('a passage that wraps closes its border on each line, inside the measure', () => {
    // 40 characters of bordered text wrap in the 200pt measure.
    const wrapped = lines(run('aaaa bbbb cccc dddd eeee ffff gggg hhhh', border()));
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) {
      const [left] = sides(line, 'left');
      const [right] = sides(line, 'right');
      expect(left!.x).toBeGreaterThanOrEqual(0);
      expect(right!.x + right!.width).toBeLessThanOrEqual(200 + 1e-6);
      // The first character of every line starts after the opening side.
      expect(line.spans[0]!.box.x).toBe(3);
    }
    // The space at the wrap hangs outside the border: it closes after the last character.
    const first = wrapped[0]!;
    const visible = first.spans
      .map((span) => span.text)
      .join('')
      .trimEnd();
    expect(sides(first, 'right')[0]!.x).toBeCloseTo(3 + visible.length * 6, 6);
  });

  test('a justified line keeps the border it ends in inside the measure', () => {
    const justified = lines(
      run('aaaa bbbb cccc dddd eeee ffff gggg hhhh', border()),
      '<w:jc w:val="both"/>'
    );
    const [right] = sides(justified[0]!, 'right');
    expect(right!.x + right!.width).toBeCloseTo(200, 3);
  });

  test('a bordered word that fits only without its border moves to the next line', () => {
    // 'aaaa' leaves 176pt; 29 characters are 174pt and fit as text, but not with 6pt of border.
    const word = 'b'.repeat(29);
    expect(lines(run('aaaa') + run(word)).length).toBe(1);
    const bordered = lines(run('aaaa ') + run(word, border()));
    expect(bordered.length).toBe(2);
    expect(bordered[1]!.spans[0]!.box.x).toBe(3);
  });

  test('a paragraph without a border keeps its advances', () => {
    const [line] = lines(run('Aa ') + run('Bb') + run(' Cc'));
    expect(xOf(line!, 'Bb')).toBe(18);
    expect(xOf(line!, 'Cc')).toBe(36);
  });

  test('`none` and `nil` borders take no room', () => {
    for (const val of ['none', 'nil']) {
      const [line] = lines(
        run('Aa ') + run('Bb', `<w:bdr w:val="${val}" w:sz="24"/>`) + run(' Cc')
      );
      expect(xOf(line!, 'Cc')).toBe(36);
    }
  });
});

describe('a bordered line that wraps', () => {
  const words = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
  const oneRun = run(words, border());
  // Each word and each space in a run of its own, as an edited document can store the text.
  const splitRuns = words
    .split(/(?<= )|(?= )/)
    .map((text) => run(text, border()))
    .join('');
  const outline = (line: ReturnType<typeof lines>[number]) => {
    const [left] = sides(line, 'left');
    const [right] = sides(line, 'right');
    return [left!.x, right!.x + right!.width];
  };

  for (const [name, body] of [
    ['one run', oneRun],
    ['a run for each word and space', splitRuns],
  ] as const) {
    test(`${name}: the space at the wrap hangs outside the border`, () => {
      const [first, second] = lines(body);
      // Six words of 24pt and five spaces of 6pt, with 3pt of border on each side.
      expect(outline(first!)).toEqual([0, 180]);
      expect(sides(first!, 'right')).toHaveLength(1);
      expect(outline(second!)).toEqual([0, 120]);
    });
    test(`${name}: a right-aligned line ends its border at the measure`, () => {
      const [first, second] = lines(body, '<w:jc w:val="right"/>');
      expect(outline(first!)).toEqual([20, 200]);
      expect(outline(second!)).toEqual([80, 200]);
    });
    test(`${name}: a centred line centres its border`, () => {
      const [first, second] = lines(body, '<w:jc w:val="center"/>');
      expect(outline(first!)).toEqual([10, 190]);
      expect(outline(second!)).toEqual([40, 160]);
    });
    test(`${name}: a justified line ends its border at the measure`, () => {
      const [first, second] = lines(body, '<w:jc w:val="both"/>');
      expect(outline(first!)).toEqual([0, 200]);
      // The last line of a justified paragraph is not stretched.
      expect(outline(second!)).toEqual([0, 120]);
    });
  }

  test('the hanging space keeps its advance for the caret', () => {
    const [first] = lines(oneRun);
    const last = first!.spans.at(-1)!;
    expect(last.text).toBe('ffff ');
    expect(last.box.width).toBe(30);
    expect(last.borderEndTrimPt).toBe(6);
  });

  test('a manual break closes the border before it, inside the measure', () => {
    const [first, second] = lines(
      run('Aa', border()) + `<w:r><w:rPr>${border()}</w:rPr><w:br/></w:r>` + run('Bb', border()),
      '<w:jc w:val="right"/>'
    );
    expect(outline(first!)).toEqual([182, 200]);
    expect(outline(second!)).toEqual([182, 200]);
  });
});

describe('a border beside an inline object', () => {
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  /** An inline shape of 20pt by 10pt. */
  const shape =
    `<w:r><w:drawing><wp:inline xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0">` +
    '<wp:extent cx="254000" cy="127000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:docPr id="1" name="S"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="${A}">` +
    `<a:graphicData uri="${WPS}"><wps:wsp xmlns:wps="${WPS}"><wps:cNvSpPr/><wps:spPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="254000" cy="127000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

  test('the border closes before the object and opens again after it', () => {
    const [line] = lines(run('Aa', border()) + shape + run('Bb', border()), '', true);
    // Each passage has its own outline.
    expect(sides(line!, 'right')).toHaveLength(2);
    const [first] = sides(line!, 'right');
    // The object starts after the closing side of the first passage: 3 + 12 + 3.
    expect(first!.x + first!.width).toBe(18);
    expect(line!.drawings![0]!.x).toBe(18);
    // The second passage opens after the object, which is 20pt wide.
    expect(xOf(line!, 'Bb')).toBe(18 + 20 + 3);
  });

  test('an object that ends the line leaves one closing side before it', () => {
    const [line] = lines(run('Aa', border()) + shape, '<w:jc w:val="right"/>', true);
    const [right] = sides(line!, 'right');
    // 38pt in all: the outline of 18pt and the object of 20pt, which ends at the measure.
    expect(right!.x + right!.width).toBe(180);
    expect(line!.drawings![0]!.x).toBe(180);
  });

  test('text without a border keeps its place beside the object', () => {
    const [line] = lines(run('Aa') + shape + run('Bb'), '', true);
    expect(line!.drawings![0]!.x).toBe(12);
    expect(xOf(line!, 'Bb')).toBe(32);
  });
});

/** The outer left and right of each outline on a line. */
const outlines = (line: ReturnType<typeof lines>[number]) => {
  const strokes = runBorderStrokesForLine(line);
  const lefts = strokes.filter((stroke) => stroke.side === 'left').map((stroke) => stroke.box.x);
  const rights = strokes
    .filter((stroke) => stroke.side === 'right')
    .map((stroke) => stroke.box.x + stroke.box.width);
  return lefts.map((left, index) => [left, rights[index]!]);
};

describe('text the paragraph does not show', () => {
  test('a border goes on across hidden text of its own run formatting', () => {
    const [line] = lines(
      run('Aa', border()) + run('xx', `${border()}<w:vanish/>`) + run('Bb', border()) + run(' Cc')
    );
    expect(xOf(line!, 'Aa')).toBe(3);
    expect(xOf(line!, 'Bb')).toBe(15);
    expect(line!.spans.map((span) => [span.text, span.box.x])).toContainEqual([' ', 30]);
    expect(outlines(line!)).toEqual([[0, 30]]);
  });
  test('a border goes on across hidden text without a border', () => {
    const [line] = lines(
      run('Aa', border()) + run('xx', '<w:vanish/>') + run('Bb', border()) + run(' Cc')
    );
    expect(xOf(line!, 'Bb')).toBe(15);
    expect(outlines(line!)).toEqual([[0, 30]]);
  });
});

describe('right-to-left text', () => {
  const rtl = '<w:rtl/>';
  const boxOf = (line: ReturnType<typeof lines>[number], text: string) =>
    line.spans.find((span) => span.text.includes(text))!.box;
  test('right-to-left text in a left-to-right paragraph has room for its border', () => {
    const [line] = lines(run('Aa ') + run('אב', rtl + border()) + run(' Bb'));
    const boxed = boxOf(line!, 'אב');
    expect(boxed.x).toBe(21);
    const after = line!.spans.filter((span) => span.box.x > boxed.x).map((span) => span.box.x);
    expect(Math.min(...after)).toBeCloseTo(boxed.x + boxed.width + 3, 6);
    expect(outlines(line!)).toEqual([[18, boxed.x + boxed.width + 3]]);
  });
  test('a right-to-left paragraph gives the border its room from the right', () => {
    const [line] = lines(
      run('אב ', rtl) + run('גד', rtl + border()) + run(' הו', rtl),
      '<w:bidi/>'
    );
    const [first, boxed] = [boxOf(line!, 'אב'), boxOf(line!, 'גד')];
    expect(first.x + first.width).toBeCloseTo(200, 6);
    const [left, right] = [boxed.x - 3, boxed.x + boxed.width + 3];
    expect(outlines(line!)[0]![0]).toBeCloseTo(left, 6);
    expect(outlines(line!)[0]![1]).toBeCloseTo(right, 6);
    // The text on each side of the border starts where the border ends.
    const ends = line!.spans.map((span) => span.box.x + span.box.width);
    expect(Math.max(...ends.filter((end) => end < boxed.x))).toBeCloseTo(left, 6);
    const starts = line!.spans.map((span) => span.box.x);
    expect(Math.min(...starts.filter((start) => start > boxed.x))).toBeCloseTo(right, 6);
  });
  test('a bordered passage that wraps in a right-to-left paragraph stays in the measure', () => {
    const words = Array.from({ length: 24 }, () => 'אבגד').join(' ');
    const wrapped = lines(run(words, rtl + border()), '<w:bidi/>');
    expect(wrapped.length).toBeGreaterThan(2);
    for (const line of wrapped) {
      const [[left, right]] = outlines(line) as [[number, number]];
      // The right side closes at the right margin; the left side stays in the measure, and
      // the spaces at the wrap hang past it.
      expect(right).toBeCloseTo(200, 6);
      expect(left).toBeGreaterThanOrEqual(0);
      const text = line.spans.filter((span) => span.text.trim() !== '');
      expect(Math.min(...text.map((span) => span.box.x))).toBeCloseTo(left + 3, 6);
    }
  });
  test('a right-to-left paragraph keeps the height of its border', () => {
    const [plain] = lines(run('Aa Bb'), '<w:bidi/>');
    const [boxed] = lines(run('Aa Bb', border()), '<w:bidi/>');
    expect(boxed!.box.height).toBe(plain!.box.height + 6);
  });
});

describe('runBorderGapBetween', () => {
  const edge = { localName: 'bdr', attributes: { val: 'single', sz: '24', space: '2' } };
  const bordered = resolveRunStyle([edge]);
  const plain = resolveRunStyle([]);
  const span = (style: typeof plain, text: string, start: number) => ({
    style,
    text,
    range: { paragraphId: 'p', start, end: start + text.length },
  });

  test('one side is the space plus the line width', () => {
    expect(runBorderPad(bordered.border!)).toBe(5);
  });
  test('a passage opens at a line start and after unbordered text', () => {
    expect(runBorderGapBetween(undefined, span(bordered, 'a', 0))).toBe(5);
    expect(runBorderGapBetween(span(plain, 'a', 0), span(bordered, 'b', 1))).toBe(5);
  });
  test('a passage closes before unbordered text', () => {
    expect(runBorderGapBetween(span(bordered, 'a', 0), span(plain, 'b', 1))).toBe(5);
  });
  test('adjacent text with the same border shares the passage', () => {
    expect(runBorderGapBetween(span(bordered, 'a', 0), span(bordered, 'b', 1))).toBe(0);
  });
  test('text that is not adjacent in the model starts a new passage', () => {
    expect(runBorderGapBetween(span(bordered, 'a', 0), span(bordered, 'b', 5))).toBe(10);
  });
  test('hidden text and a break alone open no border', () => {
    const hidden = resolveRunStyle([edge, { localName: 'vanish', attributes: {} }]);
    expect(runBorderGapBetween(undefined, span(hidden, 'a', 0))).toBe(0);
    expect(runBorderGapBetween(undefined, span(bordered, '\n', 0))).toBe(0);
  });
});
