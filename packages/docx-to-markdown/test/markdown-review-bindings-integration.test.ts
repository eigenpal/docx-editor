import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { openDocumentForExport } from '@docx-editor.dev/core/export';
import {
  exportMarkdownFrom,
  type MarkdownExportOptions,
  type MarkdownExportResult,
} from '../src/markdown.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(
  body: string,
  extra: {
    readonly contentTypes?: string;
    readonly documentRelationships?: string;
    readonly entries?: Readonly<Record<string, Uint8Array>>;
  } = {}
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (extra.contentTypes ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    ...(extra.documentRelationships
      ? {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}">${extra.documentRelationships}</Relationships>`
          ),
        }
      : {}),
    ...(extra.entries ?? {}),
  });
}

async function exportMarkdown(
  bytes: Uint8Array,
  options: MarkdownExportOptions = {}
): Promise<MarkdownExportResult> {
  const opened = openDocumentForExport(bytes, options);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return await exportMarkdownFrom(opened.session);
  } finally {
    opened.session.dispose();
  }
}

function selectedBindingText(
  result: MarkdownExportResult,
  binding: MarkdownExportResult['reviewBindings'][number]
): string {
  const projection =
    binding.projection.kind === 'document'
      ? result.markdown
      : result.pages[binding.projection.pageIndex]![binding.projection.field];
  return binding.ranges.map(({ start, end }) => projection.slice(start, end)).join('');
}

test('binds real Core comment occurrences through escaping and UTF-16 text', async () => {
  const source = docx(
    '<w:p><w:r><w:t>pre </w:t></w:r>' +
      '<w:commentRangeStart w:id="0"/><w:r><w:t>A &amp; 😀 *B*</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    {
      contentTypes:
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      documentRelationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      entries: {
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
            '<w:p><w:r><w:t>check</w:t></w:r></w:p></w:comment></w:comments>'
        ),
      },
    }
  );

  const result = await exportMarkdown(source);

  expect(result.markdown).toBe('pre A &amp; 😀 \\*B\\*');
  const artifact = result.reviewArtifacts.find((candidate) => candidate.kind === 'comment')!;
  expect(artifact.occurrences[0]?.source).toMatchObject({
    start: { offset: 4 },
    end: { offset: 14 },
  });
  const bindings = result.reviewBindings.filter((binding) => binding.artifactId === artifact.id);
  expect(bindings).toHaveLength(2);
  expect(bindings.map((binding) => selectedBindingText(result, binding))).toEqual([
    'A &amp; 😀 \\*B\\*',
    'A &amp; 😀 \\*B\\*',
  ]);
});

test('binds both real Core replacement roles in every revision view', async () => {
  const source = docx(
    '<w:p><w:del w:id="1" w:author="A"><w:r><w:delText>Old*</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="A"><w:r><w:t>New&amp;</w:t></w:r></w:ins></w:p>'
  );
  const cases = [
    {
      displayMode: 'all-markup',
      markdown: '<del>Old\\*</del>New&amp;',
      expected: [
        ['replaced', 'Old\\*'],
        ['replacement', 'New&amp;'],
      ],
    },
    { displayMode: 'original', markdown: 'Old\\*', expected: [['replaced', 'Old\\*']] },
    { displayMode: 'proposed', markdown: 'New&amp;', expected: [['replacement', 'New&amp;']] },
  ] as const;

  for (const { displayMode, markdown, expected } of cases) {
    const result = await exportMarkdown(source, { displayMode });
    expect(result.markdown).toBe(markdown);
    const change = result.reviewArtifacts.find(
      (artifact) => artifact.kind === 'tracked-change' && artifact.change === 'replace'
    )!;
    expect(change.occurrences.map((occurrence) => occurrence.revisionRole)).toEqual(
      expected.map(([role]) => role)
    );
    for (const [occurrenceIndex, [, selected]] of expected.entries()) {
      const bindings = result.reviewBindings.filter(
        (binding) => binding.artifactId === change.id && binding.occurrenceIndex === occurrenceIndex
      );
      expect(bindings).toHaveLength(2);
      expect(bindings.every((binding) => selectedBindingText(result, binding) === selected)).toBe(
        true
      );
    }
  }
});
