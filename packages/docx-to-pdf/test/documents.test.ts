/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
async function read(bytes: Uint8Array) {
  return getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
}

test('native comment ranges and comments flag preserve text and pages', async () => {
  const input = docx(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    {
      'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="comments" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
      'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Please check café.</w:t></w:r></w:p></w:comment></w:comments>`,
    }
  );
  // Without revision marks the page keeps its size: comments add annotations only.
  const options = { displayMode: 'proposed', useSystemFonts: false } as const;
  const withComments = await exportPdf(input, options),
    without = await exportPdf(input, { ...options, comments: false });
  const a = await read(withComments.bytes),
    b = await read(without.bytes);
  try {
    const annotations = await (await a.getPage(1)).getAnnotations();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.subtype).toBe('Highlight');
    expect(annotations[0]!.contentsObj.str).toBe('Please check café.');
    expect(annotations[0]!.titleObj.str).toBe('Reviewer');
    expect(await (await b.getPage(1)).getAnnotations()).toHaveLength(0);
    const contentA = await (await a.getPage(1)).getTextContent(),
      contentB = await (await b.getPage(1)).getTextContent();
    const comparable = (items: typeof contentA.items) =>
      items.map((i) => ('str' in i ? { str: i.str, transform: i.transform, width: i.width } : i));
    expect(comparable(contentA.items)).toEqual(comparable(contentB.items));
  } finally {
    await a.destroy();
    await b.destroy();
  }
});

test('All Markup with comments shrinks the page beside a pane of comment balloons', async () => {
  const input = docx(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    {
      'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="comments" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
      'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Reviewer" w:initials="RV" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Please check.</w:t></w:r></w:p></w:comment></w:comments>`,
    }
  );
  const marked = await exportPdf(input, { useSystemFonts: false });
  const hidden = await exportPdf(input, { comments: false, useSystemFonts: false });
  const pdf = await read(marked.bytes);
  try {
    const page = await pdf.getPage(1);
    const strings = (await page.getTextContent()).items.flatMap((i) => ('str' in i ? [i.str] : []));
    expect(strings.join('')).toContain('Commented [RV1]:');
    expect(strings.join('')).toContain('Please check.');
    const [annotation] = await page.getAnnotations();
    // The annotation moves with its range: inside the shrunk page's left part.
    expect(annotation!.rect[2]).toBeLessThan(612 * 0.76);
  } finally {
    await pdf.destroy();
  }
  const plain = await read(hidden.bytes);
  try {
    const strings = (await (await plain.getPage(1)).getTextContent()).items.flatMap((i) =>
      'str' in i ? [i.str] : []
    );
    expect(strings.join('')).not.toContain('Commented [');
  } finally {
    await plain.destroy();
  }
});

test('the comment pane numbers replies under their parent and wraps long words', async () => {
  const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
  const long = 'x'.repeat(120);
  const input = docx(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:commentReference w:id="1"/></w:r></w:p>',
    {
      '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/></Types>`,
      'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="comments" Type="${R}/comments" Target="comments.xml"/><Relationship Id="ext" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/></Relationships>`,
      'word/comments.xml': `<w:comments xmlns:w="${W}" xmlns:w14="${W14}"><w:comment w:id="0" w:author="Reviewer" w:initials="RV" w:date="2026-01-01T00:00:00Z"><w:p w14:paraId="11111111"><w:r><w:t>${long}</w:t></w:r></w:p></w:comment><w:comment w:id="1" w:author="Editor" w:initials="ED" w:date="2026-01-02T00:00:00Z"><w:p w14:paraId="22222222"><w:r><w:t>Agreed.</w:t></w:r></w:p></w:comment></w:comments>`,
      'word/commentsExtended.xml': `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="11111111" w15:done="0"/><w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0"/></w15:commentsEx>`,
    }
  );
  const result = await exportPdf(input, { useSystemFonts: false });
  const pdf = await read(result.bytes);
  try {
    const page = await pdf.getPage(1);
    const items = (await page.getTextContent()).items.flatMap((i) => ('str' in i ? [i] : []));
    const text = items.map((i) => i.str).join('');
    expect(text).toContain('Commented [RV1]:');
    expect(text).toContain('Commented [ED1R1]:');
    expect(text).not.toContain('Commented [ED2]:');
    // The 120-character word breaks inside the balloon instead of running past the sheet.
    const { width } = page.getViewport({ scale: 1 });
    for (const item of items) expect(item.transform[4] + item.width).toBeLessThanOrEqual(width);
  } finally {
    await pdf.destroy();
  }
});

test('link targets move with a page shrunk beside the comment pane', async () => {
  const input = docx(
    '<w:p><w:hyperlink w:anchor="target"><w:r><w:t>Go</w:t></w:r></w:hyperlink></w:p>' +
      '<w:p><w:pPr><w:ind w:left="2880"/></w:pPr><w:bookmarkStart w:id="9" w:name="target"/><w:commentRangeStart w:id="0"/><w:r><w:t>Target</w:t></w:r><w:commentRangeEnd w:id="0"/><w:bookmarkEnd w:id="9"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    {
      'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="comments" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
      'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Reviewer" w:initials="RV"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:comment></w:comments>`,
    }
  );
  const target = async (bytes: Uint8Array) => {
    const pdf = await read(bytes);
    try {
      return (await pdf.getDestination('target')) as [unknown, unknown, number, number];
    } finally {
      await pdf.destroy();
    }
  };
  const plain = await target(
    (await exportPdf(input, { comments: false, useSystemFonts: false })).bytes
  );
  const shrunk = await target((await exportPdf(input, { useSystemFonts: false })).bytes);
  // The page shrinks against the sheet's left edge and stays centered vertically.
  expect(plain[2]).toBeGreaterThan(144);
  const scale = (shrunk[2] - 0.96) / plain[2];
  expect(scale).toBeGreaterThan(0.6);
  expect(scale).toBeLessThan(1);
  expect(shrunk[3]).toBeCloseTo((792 - scale * 792) / 2 + scale * plain[3], 3);
});

test('comment balloons that do not fit beside the page are reported, not painted', async () => {
  const count = 80;
  const refs = Array.from(
    { length: count },
    (_, i) =>
      `<w:commentRangeStart w:id="${i}"/><w:r><w:t>w${i} </w:t></w:r><w:commentRangeEnd w:id="${i}"/><w:r><w:commentReference w:id="${i}"/></w:r>`
  ).join('');
  const notes = Array.from(
    { length: count },
    (_, i) =>
      `<w:comment w:id="${i}" w:author="Reviewer" w:initials="RV"><w:p><w:r><w:t>Note ${i}</w:t></w:r></w:p></w:comment>`
  ).join('');
  const input = docx(`<w:p>${refs}</w:p>`, {
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="comments" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
    'word/comments.xml': `<w:comments xmlns:w="${W}">${notes}</w:comments>`,
  });
  const result = await exportPdf(input, { useSystemFonts: false });
  const overflow = result.diagnostics.filter((d) => d.code === 'comment-balloon-overflow');
  expect(overflow).toHaveLength(1);
  expect(overflow[0]!.severity).toBe('information');
  const pdf = await read(result.bytes);
  try {
    const page = await pdf.getPage(1);
    // Every comment keeps its annotation.
    expect(await page.getAnnotations()).toHaveLength(count);
  } finally {
    await pdf.destroy();
  }
});

test('proposed, original, and markup views never mutate the DOCX', async () => {
  const input = docx(
    '<w:p><w:del w:id="0" w:author="Author"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="1" w:author="Author"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
  );
  const before = input.slice();
  for (const [mode, expected] of [
    ['proposed', 'New'],
    ['original', 'Old'],
    ['all-markup', 'OldNew'],
  ] as const) {
    const result = await exportPdf(input, { displayMode: mode, useSystemFonts: false });
    const pdf = await read(result.bytes);
    try {
      const contents = await (await pdf.getPage(1)).getTextContent();
      expect(
        contents.items
          .map((i) => ('str' in i ? i.str : ''))
          .join('')
          .replace(/ /g, '')
      ).toBe(expected);
    } finally {
      await pdf.destroy();
    }
  }
  expect(input).toEqual(before);
});

test('table shading, compound borders and cell text export strictly', async () => {
  const table = `<w:tbl><w:tblPr><w:tblBorders>${['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="double" w:sz="12" w:color="000080"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:fill="DDEEFF"/></w:tcPr>${paragraph('Cell A')}</w:tc><w:tc>${paragraph('Cell B')}</w:tc></w:tr></w:tbl>`;
  const result = await exportPdf(docx(table), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await read(result.bytes);
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((i) => ('str' in i ? i.str : '')).join('')).toContain('Cell A');
  } finally {
    await pdf.destroy();
  }
});

test('CFF font subsets extract text', async () => {
  const result = await exportPdf(
    docx(
      paragraph(
        'Century Gothic text',
        '<w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/></w:rPr>'
      )
    ),
    { useSystemFonts: false }
  );
  expect(result.diagnostics).toEqual([]);
  const pdf = await read(result.bytes);
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((i) => ('str' in i ? i.str : '')).join('')).toBe(
      'Century Gothic text'
    );
  } finally {
    await pdf.destroy();
  }
});
