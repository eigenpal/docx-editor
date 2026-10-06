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
  const input = docx('<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:t>Added</w:t></w:r></w:ins></w:p>');
  const options = { displayMode: 'all-markup', useSystemFonts: false } as const;
  const single = await exportPdf(input, {
    ...options,
    revisionMarkup: { insertions: { mark: 'underline', color: 'blue' }, changedLines: { mark: 'none' } },
  });
  const double = await exportPdf(input, {
    ...options,
    revisionMarkup: { insertions: { mark: 'doubleUnderline', color: 'blue' }, changedLines: { mark: 'rightBorder', color: 'red' } },
  });
  const first = await commands(single.bytes);
  const second = await commands(double.bytes);
  expect(first).toContain('0 0 1 rg');
  expect(second).toContain('0 0 1 rg');
  expect(second).toContain('1 0 0 rg');
  expect((second.match(/ re f/g) ?? []).length).toBe((first.match(/ re f/g) ?? []).length + 2);
});

test('hidden deletion projection omits deleted text before PDF layout', async () => {
  const input = docx('<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:delText>Old</w:delText></w:r></w:del><w:r><w:t>Kept</w:t></w:r></w:p>');
  const hidden = await exportPdf(input, {
    displayMode: 'all-markup', useSystemFonts: false,
    revisionMarkup: { deletions: { mark: 'hidden' }, changedLines: { mark: 'none' } },
  });
  const plain = await exportPdf(docx('<w:p><w:r><w:t>Kept</w:t></w:r></w:p>'), { useSystemFonts: false });
  expect(await commands(hidden.bytes)).toBe(await commands(plain.bytes));
});

test('Simple Markup exports proposed text with changed-line bars', async () => {
  const input = docx('<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="2" w:author="Reviewer"><w:r><w:t>New</w:t></w:r></w:ins></w:p>');
  const simple = await exportPdf(input, {
    displayMode: 'simple-markup', useSystemFonts: false,
    revisionMarkup: { changedLines: { mark: 'rightBorder', color: 'blue' } },
  });
  expect(simple.displayMode).toBe('simple-markup');
  const stream = await commands(simple.bytes);
  expect(stream).toContain('0 0 1 rg');
  expect(stream).toContain('1.5');
  expect(stream).not.toContain('0.752941 0 0 rg');
  expect(stream).not.toContain('0 0.501961 0 rg');
  const clean = await exportPdf(input, {
    displayMode: 'simple-markup', useSystemFonts: false,
    revisionMarkup: { changedLines: { mark: 'none' } },
  });
  const proposed = await exportPdf(input, { displayMode: 'proposed', useSystemFonts: false });
  expect(await commands(clean.bytes)).toBe(await commands(proposed.bytes));
});

test('Simple Markup change bars retain distinct author colors', async () => {
  const input = docx('<w:p><w:ins w:id="1" w:author="First"><w:r><w:t>First</w:t></w:r></w:ins></w:p><w:p><w:ins w:id="2" w:author="Second"><w:r><w:t>Second</w:t></w:r></w:ins></w:p>');
  const result = await exportPdf(input, {
    displayMode: 'simple-markup', useSystemFonts: false,
    revisionMarkup: { changedLines: { color: 'byAuthor' } },
  });
  const stream = await commands(result.bytes);
  expect(stream).toContain('0.752941 0.223529 0.168627 rg');
  expect(stream).toContain('0.121569 0.435294 0.698039 rg');
});

test('tracked cell shading uses the configured named color', async () => {
  const input = docx('<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:cellIns w:id="1" w:author="Reviewer"/></w:tcPr><w:p><w:r><w:t>Added cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
  const result = await exportPdf(input, {
    displayMode: 'all-markup', useSystemFonts: false,
    revisionMarkup: { cells: { inserted: 'yellow' }, changedLines: { mark: 'none' } },
  });
  expect(await commands(result.bytes)).toContain('1 1 0 rg');
});

test('nested insertions keep the removed ancestor style and inner author color', async () => {
  const input = docx('<w:p><w:del w:id="1" w:author="Outer"><w:ins w:id="2" w:author="Inner"><w:r><w:t>Removed</w:t></w:r></w:ins></w:del></w:p>');
  const result = await exportPdf(input, {
    displayMode: 'all-markup', useSystemFonts: false,
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
  const input = docx('<w:p><w:ins w:id="1" w:author="Remaining"><w:r><w:t>Added</w:t></w:r></w:ins></w:p>');
  const options = {
    displayMode: 'all-markup', useSystemFonts: false,
    revisionMarkup: { changedLines: { mark: 'none' } },
    revisionAuthorSlots: { Remaining: 3 },
  } as const;
  const result = await exportPdf(input, options);
  expect(await commands(result.bytes)).toContain('0.066667 0.478431 0.396078 rg');
  await expect(exportPdf(input, { ...options, revisionAuthorSlots: { Remaining: -1 } })).rejects.toThrow('revisionAuthorSlots');
});

test('supported move and formatting markup pass strict PDF validation', async () => {
  const input = docx('<w:p><w:moveFrom w:id="1" w:author="Reviewer"><w:r><w:delText>Before</w:delText></w:r></w:moveFrom><w:moveTo w:id="2" w:author="Reviewer"><w:r><w:t>After</w:t></w:r></w:moveTo><w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="Reviewer"><w:rPr/></w:rPrChange></w:rPr><w:t>Formatted</w:t></w:r></w:p>');
  const result = await exportPdf(input, {
    displayMode: 'all-markup', useSystemFonts: false, fidelityPolicy: 'strict',
    revisionMarkup: { trackMoves: false, formatting: { mark: 'underline', color: 'blue' } },
  });
  expect(result.diagnostics).toEqual([]);
  expect(await commands(result.bytes)).toContain('0 0 1 rg');
});

test('supported cell markup passes strict PDF validation', async () => {
  const input = docx('<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:cellIns w:id="1" w:author="Reviewer"/></w:tcPr><w:p><w:r><w:t>Added cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
  const result = await exportPdf(input, {
    displayMode: 'all-markup', useSystemFonts: false, fidelityPolicy: 'strict',
    revisionMarkup: { cells: { inserted: 'yellow' } },
  });
  expect(result.diagnostics).toEqual([]);
});

for (const mark of ['underline', 'doubleUnderline', 'strikethrough', 'doubleStrikethrough'] as const) {
  test(`explicit ${mark} replaces authored wavy underline and double strike`, async () => {
    const input = (props: string) => docx(`<w:p><w:ins w:id="1" w:author="Reviewer"><w:r>${props}<w:t>Added</w:t></w:r></w:ins></w:p>`);
    const options = {
      displayMode: 'all-markup', useSystemFonts: false,
      revisionMarkup: { insertions: { mark, color: 'blue' }, changedLines: { mark: 'none' } },
    } as const;
    const authored = await exportPdf(input('<w:rPr><w:u w:val="wave" w:color="FF0000"/><w:dstrike/></w:rPr>'), options);
    const plain = await exportPdf(input(''), options);
    expect(await commands(authored.bytes)).toBe(await commands(plain.bytes));
  });
}

for (const mark of ['none', 'colorOnly', 'bold', 'italic'] as const) {
  test(`${mark} preserves authored wavy underline and double strike`, async () => {
    const props = '<w:u w:val="wave" w:color="FF0000"/><w:dstrike/>';
    const input = docx(`<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:rPr>${props}</w:rPr><w:t>Added</w:t></w:r></w:ins></w:p>`);
    const tracked = await exportPdf(input, {
      displayMode: 'all-markup', useSystemFonts: false,
      revisionMarkup: { insertions: { mark, color: 'auto' }, changedLines: { mark: 'none' } },
    });
    const face = mark === 'bold' ? '<w:b/>' : mark === 'italic' ? '<w:i/>' : '';
    const plain = await exportPdf(docx(`<w:p><w:r><w:rPr>${props}${face}</w:rPr><w:t>Added</w:t></w:r></w:p>`), { useSystemFonts: false });
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
    const options = { displayMode: 'all-markup', useSystemFonts: false, fidelityPolicy: 'best-effort' } as const;
    const shaded = await exportPdf(input, {
      ...options,
      revisionMarkup: { cells: { [cellKind]: 'yellow' }, changedLines: { mark: 'none' } },
    });
    expect(await commands(shaded.bytes)).toContain('1 1 0 rg');
    const unshaded = await exportPdf(input, {
      ...options,
      revisionMarkup: { cells: { [cellKind]: 'none' }, changedLines: { mark: 'none' } },
    });
    const plain = await exportPdf(docx(row('')), {
      ...options,
      revisionMarkup: { changedLines: { mark: 'none' } },
    });
    expect(await commands(unshaded.bytes)).toBe(await commands(plain.bytes));
  }
);
