/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

async function commands(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .filter((stream) => stream.includes(' Tm '))
    .join('\n');
}

for (const formatting of [
  '',
  '<w:rPr><w:color w:val="112233"/><w:u w:val="double"/><w:strike/></w:rPr>',
]) {
  test(`clean revision views paint like the equivalent plain text (authored formatting: ${!!formatting})`, async () => {
    const run = (text: string, deleted = false) =>
      `<w:r>${formatting}<w:${deleted ? 'delText' : 't'}>${text}</w:${deleted ? 'delText' : 't'}></w:r>`;
    const input = docx(
      `<w:p><w:del w:id="1" w:author="Reviewer">${run('Old', true)}</w:del><w:ins w:id="2" w:author="Reviewer">${run('New')}</w:ins></w:p>`
    );
    for (const [displayMode, visibleText] of [
      ['proposed', 'New'],
      ['original', 'Old'],
    ] as const) {
      const tracked = await exportPdf(input, { displayMode, useSystemFonts: false });
      const plain = await exportPdf(docx(`<w:p>${run(visibleText)}</w:p>`), {
        useSystemFonts: false,
      });
      expect(tracked.diagnostics).toEqual([]);
      expect(await commands(tracked.bytes)).toBe(await commands(plain.bytes));
    }
    const marked = await exportPdf(input, { displayMode: 'all-markup', useSystemFonts: false });
    const stream = await commands(marked.bytes);
    expect(stream).toContain('0 0.501961 0 rg');
    expect(stream).toContain('0.752941 0 0 rg');
  });
}

test('custom revision colors, double marks, and change bars reach PDF commands', async () => {
  const input = docx(
    '<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:t>Added</w:t></w:r></w:ins></w:p>'
  );
  const options = { displayMode: 'all-markup', useSystemFonts: false } as const;
  const single = await exportPdf(input, {
    ...options,
    revisionMarkup: {
      insertions: { mark: 'underline', color: 'blue' },
      changedLines: { mark: 'none' },
    },
  });
  const double = await exportPdf(input, {
    ...options,
    revisionMarkup: {
      insertions: { mark: 'doubleUnderline', color: 'blue' },
      changedLines: { mark: 'rightBorder', color: 'red' },
    },
  });
  const first = await commands(single.bytes);
  const second = await commands(double.bytes);
  expect(first).toContain('0 0 1 rg');
  expect(second).toContain('0 0 1 rg');
  expect(second).toContain('1 0 0 rg');
  expect((second.match(/ re f/g) ?? []).length).toBe((first.match(/ re f/g) ?? []).length + 2);
});

test('hidden deletion projection omits deleted text before PDF layout', async () => {
  const input = docx(
    '<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:delText>Old</w:delText></w:r></w:del><w:r><w:t>Kept</w:t></w:r></w:p>'
  );
  const hidden = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: { deletions: { mark: 'hidden' }, changedLines: { mark: 'none' } },
  });
  const plain = await exportPdf(docx('<w:p><w:r><w:t>Kept</w:t></w:r></w:p>'), {
    useSystemFonts: false,
  });
  expect(await commands(hidden.bytes)).toBe(await commands(plain.bytes));
});

test('Simple Markup exports proposed text with changed-line bars', async () => {
  const input = docx(
    '<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="2" w:author="Reviewer"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
  );
  const simple = await exportPdf(input, {
    displayMode: 'simple-markup',
    useSystemFonts: false,
    revisionMarkup: { changedLines: { mark: 'rightBorder', color: 'blue' } },
  });
  expect(simple.displayMode).toBe('simple-markup');
  const stream = await commands(simple.bytes);
  expect(stream).toContain('0 0 1 rg');
  expect(stream).toContain('1.5');
  expect(stream).not.toContain('0.752941 0 0 rg');
  expect(stream).not.toContain('0 0.501961 0 rg');
  const clean = await exportPdf(input, {
    displayMode: 'simple-markup',
    useSystemFonts: false,
    revisionMarkup: { changedLines: { mark: 'none' } },
  });
  const proposed = await exportPdf(input, { displayMode: 'proposed', useSystemFonts: false });
  expect(await commands(clean.bytes)).toBe(await commands(proposed.bytes));
});

test('Simple Markup change bars retain distinct author colors', async () => {
  const input = docx(
    '<w:p><w:ins w:id="1" w:author="First"><w:r><w:t>First</w:t></w:r></w:ins></w:p><w:p><w:ins w:id="2" w:author="Second"><w:r><w:t>Second</w:t></w:r></w:ins></w:p>'
  );
  const result = await exportPdf(input, {
    displayMode: 'simple-markup',
    useSystemFonts: false,
    revisionMarkup: { changedLines: { color: 'byAuthor' } },
  });
  const stream = await commands(result.bytes);
  expect(stream).toContain('0.752941 0.223529 0.168627 rg');
  expect(stream).toContain('0.121569 0.435294 0.698039 rg');
});

test('tracked cell shading uses the configured named color', async () => {
  const input = docx(
    '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:cellIns w:id="1" w:author="Reviewer"/></w:tcPr><w:p><w:r><w:t>Added cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  );
  const result = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: { cells: { inserted: 'yellow' }, changedLines: { mark: 'none' } },
  });
  expect(await commands(result.bytes)).toContain('1 1 0 rg');
});

test('nested insertions keep the removed ancestor style and inner author color', async () => {
  const input = docx(
    '<w:p><w:del w:id="1" w:author="Outer"><w:ins w:id="2" w:author="Inner"><w:r><w:t>Removed</w:t></w:r></w:ins></w:del></w:p>'
  );
  const result = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: {
      insertions: { mark: 'underline', color: 'red' },
      deletions: { mark: 'strikethrough', color: 'blue' },
      changedLines: { mark: 'none' },
    },
  });
  const stream = await commands(result.bytes);
  expect(stream).toContain('0 0 1 rg');
  expect(stream).not.toContain('1 0 0 rg');
});

test('captured author slots preserve session colors after another author disappears', async () => {
  const input = docx(
    '<w:p><w:ins w:id="1" w:author="Remaining"><w:r><w:t>Added</w:t></w:r></w:ins></w:p>'
  );
  const options = {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: { changedLines: { mark: 'none' } },
    revisionAuthorSlots: { Remaining: 3 },
  } as const;
  const result = await exportPdf(input, options);
  expect(await commands(result.bytes)).toContain('0.066667 0.478431 0.396078 rg');
  await expect(
    exportPdf(input, { ...options, revisionAuthorSlots: { Remaining: -1 } })
  ).rejects.toThrow('revisionAuthorSlots');
});

test('supported move and formatting markup pass strict PDF validation', async () => {
  const input = docx(
    '<w:p><w:moveFrom w:id="1" w:author="Reviewer"><w:r><w:delText>Before</w:delText></w:r></w:moveFrom><w:moveTo w:id="2" w:author="Reviewer"><w:r><w:t>After</w:t></w:r></w:moveTo><w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="Reviewer"><w:rPr/></w:rPrChange></w:rPr><w:t>Formatted</w:t></w:r></w:p>'
  );
  const result = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    fidelityPolicy: 'strict',
    revisionMarkup: { trackMoves: false, formatting: { mark: 'underline', color: 'blue' } },
  });
  expect(result.diagnostics).toEqual([]);
  expect(await commands(result.bytes)).toContain('0 0 1 rg');
});

test('supported cell markup passes strict PDF validation', async () => {
  const input = docx(
    '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:cellIns w:id="1" w:author="Reviewer"/></w:tcPr><w:p><w:r><w:t>Added cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  );
  const result = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    fidelityPolicy: 'strict',
    revisionMarkup: { cells: { inserted: 'yellow' } },
  });
  expect(result.diagnostics).toEqual([]);
});

for (const mark of [
  'underline',
  'doubleUnderline',
  'strikethrough',
  'doubleStrikethrough',
] as const) {
  test(`explicit ${mark} replaces authored wavy underline and double strike`, async () => {
    const input = (props: string) =>
      docx(
        `<w:p><w:ins w:id="1" w:author="Reviewer"><w:r>${props}<w:t>Added</w:t></w:r></w:ins></w:p>`
      );
    const options = {
      displayMode: 'all-markup',
      useSystemFonts: false,
      revisionMarkup: { insertions: { mark, color: 'blue' }, changedLines: { mark: 'none' } },
    } as const;
    const authored = await exportPdf(
      input('<w:rPr><w:u w:val="wave" w:color="FF0000"/><w:dstrike/></w:rPr>'),
      options
    );
    const plain = await exportPdf(input(''), options);
    expect(await commands(authored.bytes)).toBe(await commands(plain.bytes));
  });
}

for (const mark of ['none', 'colorOnly', 'bold', 'italic'] as const) {
  test(`${mark} preserves authored wavy underline and double strike`, async () => {
    const props = '<w:u w:val="wave" w:color="FF0000"/><w:dstrike/>';
    const input = docx(
      `<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:rPr>${props}</w:rPr><w:t>Added</w:t></w:r></w:ins></w:p>`
    );
    const tracked = await exportPdf(input, {
      displayMode: 'all-markup',
      useSystemFonts: false,
      revisionMarkup: { insertions: { mark, color: 'auto' }, changedLines: { mark: 'none' } },
    });
    const face = mark === 'bold' ? '<w:b/>' : mark === 'italic' ? '<w:i/>' : '';
    const plain = await exportPdf(
      docx(`<w:p><w:r><w:rPr>${props}${face}</w:rPr><w:t>Added</w:t></w:r></w:p>`),
      { useSystemFonts: false }
    );
    expect(await commands(tracked.bytes)).toBe(await commands(plain.bytes));
  });
}

test.each([
  ['ins', 'inserted'],
  ['del', 'deleted'],
] as const)(
  'tracked %s row cells honor configured PDF shading and none',
  async (kind, cellKind) => {
    const row = (revision: string) =>
      `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr>${revision}<w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const input = docx(row(`<w:trPr><w:${kind} w:id="9" w:author="Reviewer"/></w:trPr>`));
    const options = {
      displayMode: 'all-markup',
      useSystemFonts: false,
      fidelityPolicy: 'best-effort',
    } as const;
    const shaded = await exportPdf(input, {
      ...options,
      revisionMarkup: { cells: { [cellKind]: 'yellow' }, changedLines: { mark: 'none' } },
    });
    expect(await commands(shaded.bytes)).toContain('1 1 0 rg');
    // Text marks off, so only the cell shading can differ from a plain row.
    const unmarked = {
      insertions: { mark: 'none' },
      deletions: { mark: 'none' },
      changedLines: { mark: 'none' },
    } as const;
    const unshaded = await exportPdf(input, {
      ...options,
      revisionMarkup: { ...unmarked, cells: { [cellKind]: 'none' } },
    });
    const plain = await exportPdf(docx(row('')), {
      ...options,
      revisionMarkup: unmarked,
    });
    expect(await commands(unshaded.bytes)).toBe(await commands(plain.bytes));
  }
);

test('cell author colors use captured slots and explicit cell attribution before row attribution', async () => {
  const cell = (revision: string) =>
    `<w:tc><w:tcPr>${revision}</w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc>`;
  const input = docx(
    `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:ins w:id="9" w:author="Row author"/></w:trPr>${cell('')}${cell('<w:cellMerge w:id="10" w:author="Cell author" w:vMerge="cont"/>')}</w:tr></w:tbl>`
  );
  const result = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
    revisionMarkup: {
      cells: { inserted: 'byAuthor', merged: 'byAuthor' },
      changedLines: { mark: 'none' },
    },
    revisionAuthorSlots: { 'Row author': 3, 'Cell author': 1 },
  });
  const stream = await commands(result.bytes);
  expect(stream).toContain('0.066667 0.478431 0.396078 rg');
  expect(stream).toContain('0.121569 0.435294 0.698039 rg');
});

test('cell-only authors retain distinct PDF colors', async () => {
  const cell = (author: string, id: number) =>
    `<w:tc><w:tcPr><w:cellIns w:id="${id}" w:author="${author}"/></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc>`;
  const result = await exportPdf(
    docx(
      `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>${cell('First', 1)}${cell('Second', 2)}</w:tr></w:tbl>`
    ),
    {
      displayMode: 'all-markup',
      useSystemFonts: false,
      revisionMarkup: { cells: { inserted: 'byAuthor' }, changedLines: { mark: 'none' } },
    }
  );
  const stream = await commands(result.bytes);
  expect(stream).toContain('0.752941 0.223529 0.168627 rg');
  expect(stream).toContain('0.121569 0.435294 0.698039 rg');
});

test.each([
  ['lightPurple', '0.917647 0.862745 0.956863'],
  ['lightGreen', '0.886275 0.937255 0.85098'],
  ['gray', '0.85098 0.85098 0.85098'],
] as const)('cell shading exports the %s print color', async (shade, rgb) => {
  const input = docx(
    '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:cellIns w:id="1" w:author="Reviewer"/></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  );
  const result = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: { cells: { inserted: shade }, changedLines: { mark: 'none' } },
  });
  expect(await commands(result.bytes)).toContain(`${rgb} rg`);
});

test('revision text backgrounds override authored highlights only in all-markup', async () => {
  const input = docx(
    '<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Added</w:t></w:r></w:ins></w:p>'
  );
  for (const displayMode of ['all-markup', 'simple-markup', 'proposed'] as const) {
    const result = await exportPdf(input, {
      displayMode,
      useSystemFonts: false,
      revisionMarkup: {
        insertions: { mark: 'none', background: 'lightGreen' },
        changedLines: { mark: 'none' },
      },
    });
    const stream = await commands(result.bytes);
    expect(stream.includes('0.886275 0.937255 0.85098 rg')).toBe(displayMode === 'all-markup');
    expect(stream.includes('1 1 0 rg')).toBe(displayMode !== 'all-markup');
  }
  const disabled = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: {
      insertions: { mark: 'none', background: 'none' },
      changedLines: { mark: 'none' },
    },
  });
  expect(await commands(disabled.bytes)).toContain('1 1 0 rg');
});

test('author backgrounds use a light tint independently from text color', async () => {
  const input = docx(
    '<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:t>Added</w:t></w:r></w:ins></w:p>'
  );
  const result = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionAuthorSlots: { Reviewer: 1 },
    revisionMarkup: {
      insertions: { mark: 'none', background: 'byAuthor' },
      changedLines: { mark: 'none' },
    },
  });
  expect(await commands(result.bytes)).toContain('0.866667 0.913725 0.952941 rg');
});

test('move fallback uses insertion background in PDF', async () => {
  const input = docx(
    '<w:p><w:moveTo w:id="1" w:author="Reviewer"><w:r><w:t>Moved</w:t></w:r></w:moveTo></w:p>'
  );
  const result = await exportPdf(input, {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: {
      trackMoves: false,
      insertions: { mark: 'none', background: 'yellow' },
      movedTo: { background: 'blue' },
      changedLines: { mark: 'none' },
    },
  });
  expect(await commands(result.bytes)).toContain('1 1 0 rg');
});

const trackedRow = (revision: string, text = 'Cell') =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr>${revision}<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
const rowMark = (kind: 'ins' | 'del') =>
  `<w:trPr><w:${kind} w:id="9" w:author="Reviewer"/></w:trPr>`;
const markedSettings = {
  insertions: { mark: 'underline', color: 'blue' },
  deletions: { mark: 'strikethrough', color: 'red' },
  cells: { inserted: 'none', deleted: 'none' },
  changedLines: { mark: 'none' },
} as const;

test.each([
  ['del', '1 0 0 rg'],
  ['ins', '0 0 1 rg'],
] as const)(
  'text in a tracked %s row takes the row revision mark and color',
  async (kind, colorOperator) => {
    const options = { displayMode: 'all-markup', useSystemFonts: false } as const;
    // Strict: a tracked row is a presented revision, not an unsupported one.
    const tracked = await exportPdf(docx(trackedRow(rowMark(kind))), {
      ...options,
      revisionMarkup: markedSettings,
    });
    const plain = await exportPdf(docx(trackedRow('')), {
      ...options,
      revisionMarkup: markedSettings,
    });
    expect(await commands(tracked.bytes)).toContain(colorOperator);
    expect(await commands(plain.bytes)).not.toContain(colorOperator);
  }
);

test('a deleted row keeps a nested inserted row visibly deleted', async () => {
  const nested = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr>${rowMark('del')}<w:tc>${trackedRow(
    rowMark('ins'),
    'Inner'
  )}<w:p/></w:tc></w:tr></w:tbl>`;
  const result = await exportPdf(docx(nested), {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: markedSettings,
  });
  const stream = await commands(result.bytes);
  expect(stream).toContain('1 0 0 rg');
  expect(stream).not.toContain('0 0 1 rg');
});

test('a tracked row marks its text without configured markup settings', async () => {
  // Strict: the row is a presented revision even without configured markup settings.
  const options = { displayMode: 'all-markup', useSystemFonts: false } as const;
  const tracked = await exportPdf(docx(trackedRow(rowMark('del'))), options);
  const plain = await exportPdf(docx(trackedRow('')), options);
  expect(await commands(tracked.bytes)).not.toBe(await commands(plain.bytes));
});

test('proposed and original views do not mark rows they resolve', async () => {
  for (const displayMode of ['proposed', 'original'] as const) {
    const options = { displayMode, useSystemFonts: false, revisionMarkup: markedSettings } as const;
    const kept = await exportPdf(
      docx(trackedRow(rowMark(displayMode === 'proposed' ? 'ins' : 'del'))),
      options
    );
    const plain = await exportPdf(docx(trackedRow('')), options);
    expect(await commands(kept.bytes)).toBe(await commands(plain.bytes));
  }
});

/** Filled rectangles thinner than 3 pt: the strike and underline lines, as `[x, y, w, h]`. */
function lineRects(stream: string): number[][] {
  return [...stream.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re f/g)]
    .map((match) => match.slice(1, 5).map(Number))
    .filter(([, , , height]) => Math.abs(height!) < 3);
}

/** Baselines of every text line, from its `Tm` operator. */
function baselines(stream: string): number[] {
  return [...stream.matchAll(/[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+) Tm/g)].map(
    (match) => Number(match[2])
  );
}

test.each([
  ['del', 'above'],
  ['ins', 'below'],
] as const)('a tracked %s row draws its line %s the text baseline', async (kind, side) => {
  const options = {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: markedSettings,
  } as const;
  const tracked = await commands((await exportPdf(docx(trackedRow(rowMark(kind))), options)).bytes);
  const plain = await commands((await exportPdf(docx(trackedRow('')), options)).bytes);
  const known = new Set(lineRects(plain).map((rect) => rect.join(' ')));
  const added = lineRects(tracked).filter((rect) => !known.has(rect.join(' ')));
  // One line under or through the one line of text.
  expect(added).toHaveLength(1);
  const [, y, width] = added[0]!;
  expect(width!).toBeGreaterThan(0);
  const baseline = baselines(tracked)[0]!;
  if (side === 'above') expect(y!).toBeGreaterThan(baseline);
  else expect(y!).toBeLessThan(baseline);
});

test('a repeated header row stays unmarked across a page break inside a tracked row', async () => {
  const lines = Array.from(
    { length: 70 },
    (_, index) => `<w:p><w:r><w:t>Line${index}</w:t></w:r></w:p>`
  ).join('');
  const table = (revision: string) =>
    '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Head</w:t></w:r></w:p></w:tc></w:tr>' +
    `<w:tr>${revision}<w:tc>${lines}</w:tc></w:tr></w:tbl><w:p/>`;
  const options = {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: markedSettings,
  } as const;
  const trackedResult = await exportPdf(docx(table(rowMark('ins'))), options);
  const plainResult = await exportPdf(docx(table('')), options);
  const document = await PDFDocument.load(trackedResult.bytes);
  // The tracked row splits, so the header repeats on the next page.
  expect(document.getPageCount()).toBeGreaterThan(1);
  const tracked = await commands(trackedResult.bytes);
  const plain = await commands(plainResult.bytes);
  // The header paints once per page: it repeats after the break.
  expect(baselines(tracked)).toHaveLength(70 + document.getPageCount());
  // Every line of the tracked row is underlined, on both pages; the header rows are not.
  expect(lineRects(tracked).length - lineRects(plain).length).toBe(70);
});

const SHAPE_NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

/** A page-anchored 3in x 1in text box holding `content`. */
const textboxWith = (content: string) =>
  `<w:p><w:r><w:drawing ${SHAPE_NS}><wp:anchor distT="0" distB="0" distL="0" distR="0"` +
  ' simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="2743200" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
  '<wp:wrapNone/><wp:docPr id="1" name="Box"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
  `<wps:txbx><w:txbxContent>${content}<w:p/></w:txbxContent></wps:txbx>` +
  '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/></wps:wsp></a:graphicData></a:graphic>' +
  '</wp:anchor></w:drawing></w:r></w:p>';

test('text in a tracked row inside a text box takes the row revision mark', async () => {
  const options = {
    displayMode: 'all-markup',
    useSystemFonts: false,
    revisionMarkup: markedSettings,
  } as const;
  const tracked = await exportPdf(docx(textboxWith(trackedRow(rowMark('ins')))), options);
  const plain = await exportPdf(docx(textboxWith(trackedRow(''))), options);
  expect(await commands(tracked.bytes)).toContain('0 0 1 rg');
  expect(await commands(plain.bytes)).not.toContain('0 0 1 rg');
  expect(tracked.diagnostics.map((entry) => entry.code)).not.toContain('review-presentation');
});

test('cell-only authors in a text box retain distinct PDF colors', async () => {
  const cell = (author: string, id: number) =>
    `<w:tc><w:tcPr><w:cellIns w:id="${id}" w:author="${author}"/></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc>`;
  const result = await exportPdf(
    docx(
      textboxWith(
        `<w:tbl><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid><w:tr>${cell('First', 1)}${cell('Second', 2)}</w:tr></w:tbl>`
      )
    ),
    {
      displayMode: 'all-markup',
      useSystemFonts: false,
      revisionMarkup: { cells: { inserted: 'byAuthor' }, changedLines: { mark: 'none' } },
    }
  );
  const stream = await commands(result.bytes);
  expect(stream).toContain('0.752941 0.223529 0.168627 rg');
  expect(stream).toContain('0.121569 0.435294 0.698039 rg');
});
