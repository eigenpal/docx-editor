import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  exportMarkdown,
  type MarkdownExportResult,
  type MarkdownReviewBinding,
} from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

function reviewedDocx(body: string, comments: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    'word/comments.xml': strToU8(`<w:comments xmlns:w="${W}">${comments}</w:comments>`),
  });
}

function comment(id: number, text: string): string {
  return `<w:comment w:id="${id}" w:author="QA"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
}

function selectedText(result: MarkdownExportResult, binding: MarkdownReviewBinding): string {
  const projection =
    binding.projection.kind === 'document'
      ? result.markdown
      : result.pages[binding.projection.pageIndex]![binding.projection.field];
  return binding.ranges.map(({ start, end }) => projection.slice(start, end)).join('');
}

function textboxDrawing(content: string): string {
  return (
    `<w:drawing xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="9" name="Review box"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

test('public export keeps exact review offsets through hostile Markdown escaping', async () => {
  const sourceText = '* | [ ] \\ `';
  const expected = '\\* \\| \\[ \\] \\\\ ' + '\\`';
  const result = await exportMarkdown(
    reviewedDocx(
      `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>${sourceText}</w:t></w:r>` +
        '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
      comment(0, 'Escape selection')
    )
  );

  const artifact = result.reviewArtifacts.find(
    (candidate) => candidate.kind === 'comment' && candidate.text === 'Escape selection'
  )!;
  const bindings = result.reviewBindings.filter((binding) => binding.artifactId === artifact.id);
  expect(bindings).toHaveLength(2);
  expect(bindings.every(({ coverage }) => coverage === 'complete')).toBe(true);
  expect(
    bindings.every(({ ranges }) => ranges.every(({ precision }) => precision === 'exact'))
  ).toBe(true);
  expect(bindings.map((binding) => selectedText(result, binding))).toEqual([expected, expected]);
});

test('public export binds a repeated phrase to the reviewed occurrence', async () => {
  const phrase = 'identical phrase';
  const result = await exportMarkdown(
    reviewedDocx(
      `<w:p><w:r><w:t>${phrase} then </w:t></w:r>` +
        `<w:commentRangeStart w:id="0"/><w:r><w:t>${phrase}</w:t></w:r>` +
        '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
      comment(0, 'Second occurrence')
    )
  );

  const artifact = result.reviewArtifacts.find(
    (candidate) => candidate.kind === 'comment' && candidate.text === 'Second occurrence'
  )!;
  const documentBinding = result.reviewBindings.find(
    (binding) => binding.artifactId === artifact.id && binding.projection.kind === 'document'
  )!;
  const pageBinding = result.reviewBindings.find(
    (binding) => binding.artifactId === artifact.id && binding.projection.kind === 'page'
  )!;
  expect(result.reviewBindings.filter(({ artifactId }) => artifactId === artifact.id)).toHaveLength(
    2
  );
  expect(selectedText(result, documentBinding)).toBe(phrase);
  expect(selectedText(result, pageBinding)).toBe(phrase);
  expect(
    [documentBinding, pageBinding].every(
      ({ coverage, ranges }) =>
        coverage === 'complete' && ranges.length === 1 && ranges[0]!.precision === 'exact'
    )
  ).toBe(true);
  expect(documentBinding.ranges[0]?.start).toBe(result.markdown.lastIndexOf(phrase));
  expect(documentBinding.ranges[0]?.start).not.toBe(result.markdown.indexOf(phrase));
  if (pageBinding.projection.kind !== 'page') throw new Error('expected page binding');
  const pageMarkdown = result.pages[pageBinding.projection.pageIndex]!.markdown;
  expect(pageBinding.ranges[0]?.start).toBe(pageMarkdown.lastIndexOf(phrase));
  expect(pageBinding.ranges[0]?.start).not.toBe(pageMarkdown.indexOf(phrase));
});

test('public export binds one cross-page comment to every occupied page and the document', async () => {
  const firstText = `START ${'alpha '.repeat(90)}`;
  const lastText = `${'omega '.repeat(90)}END`;
  const result = await exportMarkdown(
    reviewedDocx(
      `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>${firstText}</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>${lastText}</w:t></w:r><w:commentRangeEnd w:id="0"/>` +
        '<w:r><w:commentReference w:id="0"/></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="2880" w:h="1440"/><w:pgMar w:top="72" w:right="72" w:bottom="72" w:left="72"/></w:sectPr>',
      comment(0, 'Cross-page selection')
    )
  );

  const artifact = result.reviewArtifacts.find(
    (candidate) => candidate.kind === 'comment' && candidate.text === 'Cross-page selection'
  )!;
  const bindings = result.reviewBindings.filter((binding) => binding.artifactId === artifact.id);
  const pageIndexes = new Set(
    bindings.flatMap((binding) =>
      binding.projection.kind === 'page' ? [binding.projection.pageIndex] : []
    )
  );
  expect(result.pages.length).toBeGreaterThan(1);
  expect(pageIndexes.size).toBeGreaterThan(1);
  expect(pageIndexes).toEqual(new Set(artifact.occurrences.map(({ pageIndex }) => pageIndex)));
  for (const occurrenceIndex of artifact.occurrences.keys()) {
    const occurrence = artifact.occurrences[occurrenceIndex]!;
    const occurrenceBindings = bindings.filter(
      (binding) => binding.occurrenceIndex === occurrenceIndex
    );
    expect(occurrenceBindings).toHaveLength(2);
    const [documentBinding] = occurrenceBindings.filter(
      ({ projection }) => projection.kind === 'document'
    );
    expect(documentBinding).toBeDefined();
    const [pageBinding] = occurrenceBindings.filter(({ projection }) => projection.kind === 'page');
    expect(pageBinding?.projection).toEqual({
      kind: 'page',
      pageIndex: occurrence.pageIndex,
      pageNumber: occurrence.physicalPageNumber,
      field: 'markdown',
    });
    expect(occurrenceBindings.every(({ coverage }) => coverage === 'complete')).toBe(true);
    expect(occurrenceBindings.every(({ ranges }) => ranges.length > 0)).toBe(true);
    expect(
      occurrenceBindings.every(({ ranges }) =>
        ranges.every(({ precision }) => precision === 'exact')
      )
    ).toBe(true);
    expect(occurrenceBindings.every((binding) => selectedText(result, binding).length > 0)).toBe(
      true
    );
    expect(selectedText(result, documentBinding!)).toBe(selectedText(result, pageBinding!));
    if (occurrenceIndex === 0) expect(selectedText(result, pageBinding!)).toContain('START');
    if (occurrenceIndex === artifact.occurrences.length - 1) {
      expect(selectedText(result, pageBinding!)).toContain('END');
    }
  }
});

test('public export keeps exact review offsets inside an escaped GFM table cell', async () => {
  const reviewedCell =
    '<w:tc><w:tcPr/><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>A|B</w:t></w:r>' +
    '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:tc>';
  const plainCell = '<w:tc><w:tcPr/><w:p><w:r><w:t>Other</w:t></w:r></w:p></w:tc>';
  const table =
    '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr>${reviewedCell}${plainCell}</w:tr></w:tbl>`;
  const result = await exportMarkdown(reviewedDocx(table, comment(0, 'Table selection')));

  const artifact = result.reviewArtifacts.find(
    (candidate) => candidate.kind === 'comment' && candidate.text === 'Table selection'
  )!;
  const bindings = result.reviewBindings.filter(({ artifactId }) => artifactId === artifact.id);
  expect(bindings).toHaveLength(2);
  expect(bindings.map(({ projection }) => projection.kind).sort()).toEqual(['document', 'page']);
  for (const binding of bindings) {
    expect(binding.coverage).toBe('complete');
    expect(binding.ranges).toEqual([
      expect.objectContaining({ precision: 'exact', unit: 'utf16-code-unit' }),
    ]);
    expect(selectedText(result, binding)).toBe('A\\|B');
  }
});

test('public export reports omitted textbox review and retains an orphaned comment', async () => {
  const textbox = textboxDrawing(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>boxed review</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>'
  );
  const result = await exportMarkdown(
    reviewedDocx(
      `<w:p><w:r>${textbox}</w:r><w:r><w:t>Visible body</w:t></w:r></w:p>`,
      comment(0, 'Textbox selection') + comment(1, 'Orphaned comment')
    )
  );

  const textboxArtifact = result.reviewArtifacts.find(
    (candidate) => candidate.kind === 'comment' && candidate.text === 'Textbox selection'
  )!;
  expect(textboxArtifact.occurrences).toHaveLength(1);
  expect(textboxArtifact.occurrences[0]).toMatchObject({ story: 'textbox', pageIndex: 0 });
  const textboxBindings = result.reviewBindings.filter(
    (binding) => binding.artifactId === textboxArtifact.id
  );
  expect(textboxBindings).toHaveLength(1);
  expect(textboxBindings[0]).toMatchObject({
    occurrenceIndex: 0,
    projection: { kind: 'page', pageIndex: 0, pageNumber: 1, field: 'markdown' },
    coverage: 'none',
    ranges: [],
    unmappedReason: 'omitted-story-content',
  });

  const orphan = result.reviewArtifacts.find(
    (candidate) => candidate.kind === 'comment' && candidate.text === 'Orphaned comment'
  )!;
  if (orphan.kind !== 'comment') throw new Error('expected orphaned comment');
  expect(orphan.orphaned).toBe(true);
  expect(orphan.occurrences).toEqual([]);
  expect(result.reviewBindings.some(({ artifactId }) => artifactId === orphan.id)).toBe(false);
});

test('public export never binds a comment to deleted text omitted by proposed view', async () => {
  const body =
    '<w:p><w:commentRangeStart w:id="0"/>' +
    '<w:del w:id="7" w:author="Ada"><w:r><w:delText>Gone*</w:delText></w:r></w:del>' +
    '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>';
  const bytes = reviewedDocx(body, comment(0, 'Deleted selection'));
  const allMarkup = await exportMarkdown(bytes, { displayMode: 'all-markup' });
  const proposed = await exportMarkdown(bytes, { displayMode: 'proposed' });

  const visibleArtifact = allMarkup.reviewArtifacts.find(
    (candidate) => candidate.kind === 'comment' && candidate.text === 'Deleted selection'
  )!;
  const visibleBindings = allMarkup.reviewBindings.filter(
    (binding) => binding.artifactId === visibleArtifact.id
  );
  expect(visibleArtifact.occurrences).toHaveLength(1);
  expect(visibleBindings).toHaveLength(2);
  expect(visibleBindings.map(({ projection }) => projection.kind).sort()).toEqual([
    'document',
    'page',
  ]);
  expect(visibleBindings.every(({ coverage }) => coverage === 'complete')).toBe(true);
  expect(
    visibleBindings.every(
      ({ ranges }) => ranges.length > 0 && ranges.every(({ precision }) => precision === 'exact')
    )
  ).toBe(true);
  expect(visibleBindings.every((binding) => selectedText(allMarkup, binding) === 'Gone\\*')).toBe(
    true
  );

  const hiddenArtifact = proposed.reviewArtifacts.find(
    (candidate) => candidate.kind === 'comment' && candidate.text === 'Deleted selection'
  )!;
  const hiddenBindings = proposed.reviewBindings.filter(
    (binding) => binding.artifactId === hiddenArtifact.id
  );
  expect(proposed.pagination.displayMode).toBe('proposed');
  expect(proposed.markdown).not.toContain('Gone');
  expect(hiddenArtifact.occurrences).toEqual([]);
  expect(hiddenBindings).toEqual([]);
});
