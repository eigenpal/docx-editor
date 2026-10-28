/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument, linesOf, createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { ownedGapAfter } from '../src/owned-gap.ts';

function line() {
  const opened = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>one two three four five six seven eight</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="3000" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  return linesOf(
    layoutSemanticDocument(opened.part, 1, { measurer: createFixedMeasurer(6, 14) })
  )[0]!;
}

test('single underlines cover published justification without moving text', () => {
  const record = line();
  const span = record.spans[0]!,
    next = record.spans[1]!;
  const before = JSON.stringify(record);
  const gap = next.box.x - span.box.x - span.box.width;
  expect(gap).toBeGreaterThan(0.25);
  expect(ownedGapAfter({ line: record, span })).toBeCloseTo(gap, 6);
  expect(JSON.stringify(record)).toBe(before);
});

test('a zero-width space after the space still joins the underline', () => {
  const record = line();
  const span = record.spans[0]!,
    next = record.spans[1]!;
  const gap = next.box.x - span.box.x - span.box.width;
  const spaced = { ...span, text: `${span.text}\u200b` };
  expect(ownedGapAfter({ line: { ...record, spans: [spaced, next] }, span: spaced })).toBeCloseTo(
    gap,
    6
  );
});

test('a span owns no gap past a float advance, a link change, or a scaled box', () => {
  const record = line(),
    span = record.spans[0]!,
    next = record.spans[1]!;
  for (const [left, right] of [
    [span, { ...next, wrapAdvanceBefore: 12 }],
    [
      span,
      { ...next, link: { id: 'other', kind: 'external' as const, href: 'https://example.com' } },
    ],
    [{ ...span, style: { ...span.style, horizontalScalePercent: 50 } }, next],
  ] as const)
    expect(ownedGapAfter({ line: { ...record, spans: [left, right] }, span: left })).toBe(0);
});

test('a span owns its gap whatever the next span looks like', () => {
  const record = line(),
    span = record.spans[0]!,
    next = record.spans[1]!;
  const gap = next.box.x - span.box.x - span.box.width;
  for (const replacement of [
    { ...next, style: { ...next.style, underline: { variant: 'single', color: 'FF0000' } } },
    { ...next, style: { ...next.style, underline: null } },
    { ...next, style: { ...next.style, baselineShiftPt: 3 } },
  ] as const)
    expect(ownedGapAfter({ line: { ...record, spans: [span, replacement] }, span })).toBeCloseTo(
      gap,
      6
    );
});

test('exported PDF joins justified underline rectangles at the next text origin', async () => {
  const { exportPdf } = await import('../src/index.ts');
  const { docx } = await import('./fixture.ts');
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const source = docx(
    '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>one two three four five six seven eight nine ten</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="3000" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
  );
  const result = await exportPdf(source, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, obj]) =>
      obj instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(obj).decode())]
        : []
    )
    .filter((s) => s.includes(' Tm '))
    .join('\n');
  const rects = [...commands.matchAll(/rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)].map(
    (m) => m.slice(1).map(Number)
  );
  expect(rects.length).toBeGreaterThan(2);
  const [first, second] = rects;
  expect(first![1]).toBeCloseTo(second![1]!, 5);
  expect(first![0]! + first![2]!).toBeCloseTo(second![0]!, 5);
});

test('an underlined tab draws its underline across the tab', async () => {
  const { exportPdf } = await import('../src/index.ts');
  const { docx } = await import('./fixture.ts');
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const underlinedTabs = (count: number) =>
    '<w:p><w:r><w:t>Name:</w:t></w:r>' +
    '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:tab/></w:r>'.repeat(count) +
    '</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/></w:sectPr>';
  const rectsOf = async (count: number) => {
    const result = await exportPdf(docx(underlinedTabs(count)), { useSystemFonts: false });
    const pdf = await PDFDocument.load(result.bytes);
    const commands = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, obj]) =>
        obj instanceof PDFRawStream
          ? [new TextDecoder().decode(decodePDFRawStream(obj).decode())]
          : []
      )
      .join('\n');
    return [...commands.matchAll(/rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)].map((m) =>
      m.slice(1).map(Number)
    );
  };
  const rects = await rectsOf(3);
  // Three tabs from the default 36pt grid: the first runs from after "Name:" to 36pt.
  expect(rects).toHaveLength(3);
  expect(rects[1]![2]).toBeCloseTo(36, 0);
  expect(rects[2]![2]).toBeCloseTo(36, 0);
});

test('a distributed underlined word draws one continuous underline across its letters', async () => {
  const { exportPdf } = await import('../src/index.ts');
  const { docx } = await import('./fixture.ts');
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  // No settings part: a legacy package, which spreads a distributed word per character.
  const source = docx(
    '<w:p><w:pPr><w:jc w:val="distribute"/></w:pPr><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Text</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="3000" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
  );
  const result = await exportPdf(source, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, obj]) =>
      obj instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(obj).decode())]
        : []
    )
    .filter((s) => s.includes(' Tm '))
    .join('\n');
  const rects = [...commands.matchAll(/rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)].map(
    (m) => m.slice(1).map(Number)
  );
  expect(rects).toHaveLength(4);
  for (let index = 1; index < rects.length; index++) {
    expect(rects[index]![1]).toBeCloseTo(rects[0]![1]!, 5);
    expect(rects[index - 1]![0]! + rects[index - 1]![2]!).toBeCloseTo(rects[index]![0]!, 5);
  }
  // The rule runs from the left margin across the 100pt measure (2000 twips).
  const last = rects.at(-1)!;
  expect(last[0]! + last[2]! - rects[0]![0]!).toBeGreaterThan(95);
});

/** Content-stream commands of every page of an exported PDF. */
async function pageCommands(bytes: Uint8Array): Promise<string> {
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, obj]) =>
      obj instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(obj).decode())]
        : []
    )
    .filter((stream) => stream.includes(' Tm '))
    .join('\n');
}

/** Filled rectangles and stroked lines, grouped by colour and height: one group per mark. */
function markSeries(commands: string): number[][][] {
  const groups = new Map<string, number[][]>();
  const add = (key: string, from: number, to: number) => {
    const list = groups.get(key) ?? [];
    list.push([from, to]);
    groups.set(key, list);
  };
  for (const m of commands.matchAll(
    /([\d.]+ [\d.]+ [\d.]+) rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g
  ))
    add(`fill ${m[1]} ${Number(m[3]).toFixed(2)}`, Number(m[2]), Number(m[2]) + Number(m[4]));
  for (const m of commands.matchAll(
    /([\d.]+ [\d.]+ [\d.]+) RG [^m]*?([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S/g
  ))
    add(`stroke ${m[1]} ${Number(m[3]).toFixed(2)}`, Number(m[2]), Number(m[4]));
  return [...groups.values()].map((list) => list.sort((a, b) => a[0]! - b[0]!));
}

for (const [name, mark, series] of [
  ['a single underline', '<w:u w:val="single"/>', 1],
  ['a double underline', '<w:u w:val="double"/>', 2],
  ['a dotted underline', '<w:u w:val="dotted"/>', 1],
  ['a dashed underline', '<w:u w:val="dash"/>', 1],
  ['a strike', '<w:strike/>', 1],
  ['a double strike', '<w:dstrike/>', 2],
  ['a highlight', '<w:highlight w:val="yellow"/>', 1],
  ['character shading', '<w:shd w:val="clear" w:color="auto" w:fill="FFCC00"/>', 1],
] as const) {
  test(`${name} runs on across the letters of a distributed word`, async () => {
    const { exportPdf } = await import('../src/index.ts');
    const { docx } = await import('./fixture.ts');
    // No settings part: a legacy package, which spreads a distributed word per character.
    const source = docx(
      `<w:p><w:pPr><w:jc w:val="distribute"/></w:pPr><w:r><w:rPr>${mark}</w:rPr><w:t>Text</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="3000" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
    );
    const result = await exportPdf(source, { useSystemFonts: false });
    expect(result.diagnostics).toEqual([]);
    const marks = markSeries(await pageCommands(result.bytes)).filter((list) => list.length === 4);
    expect(marks).toHaveLength(series);
    for (const list of marks) {
      // Each letter's piece ends where the next letter's begins, across the 100pt measure.
      for (let index = 1; index < list.length; index++)
        expect(list[index - 1]![1]).toBeCloseTo(list[index]![0]!, 1);
      expect(list.at(-1)![1] - list[0]![0]!).toBeGreaterThan(95);
    }
  });
}

for (const kind of ['ins', 'del'] as const) {
  test(`a tracked ${kind === 'ins' ? 'insertion' : 'deletion'} mark runs on across a distributed word`, async () => {
    const { exportPdf } = await import('../src/index.ts');
    const { docx } = await import('./fixture.ts');
    const text = kind === 'ins' ? '<w:t>Text</w:t>' : '<w:delText>Text</w:delText>';
    const source = docx(
      `<w:p><w:pPr><w:jc w:val="distribute"/></w:pPr><w:${kind} w:id="1" w:author="Reviewer"><w:r>${text}</w:r></w:${kind}></w:p><w:sectPr><w:pgSz w:w="3000" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
    );
    const result = await exportPdf(source, { displayMode: 'all-markup', useSystemFonts: false });
    expect(result.diagnostics).toEqual([]);
    const marks = markSeries(await pageCommands(result.bytes)).filter((list) => list.length === 4);
    expect(marks.length).toBeGreaterThan(0);
    for (const list of marks) {
      for (let index = 1; index < list.length; index++)
        expect(list[index - 1]![1]).toBeCloseTo(list[index]![0]!, 1);
    }
  });
}
