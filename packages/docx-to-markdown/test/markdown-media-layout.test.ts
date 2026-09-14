import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { exportMarkdown } from '../src/index.ts';
import { imageDocx, picture, PNG, R, REL } from './media-fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fast = { images: true as const, measurer: createFixedMeasurer() };

test('nested tables retain inline and anchored images as rendered HTML images', async () => {
  const table = (contents: string) =>
    `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${contents}</w:tc></w:tr></w:tbl>`;
  const paragraph = (content: string) => `<w:p><w:r>${content}</w:r></w:p>`;
  const body = table(
    paragraph('<w:t>Outer</w:t>') +
      table(
        paragraph(
          `<w:t>Before</w:t>${picture(1, false, 'Inline')}${picture(2, true, 'Anchored')}<w:t>After</w:t>`
        )
      ) +
      paragraph('<w:t>End</w:t>')
  );
  const result = await exportMarkdown(imageDocx(body), fast);
  expect(result.media).toHaveLength(1);
  expect(result.media[0]!.occurrences).toHaveLength(2);
  for (const markdown of [result.markdown, result.pages[0]!.markdown]) {
    const html = micromark(markdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
      allowDangerousHtml: true,
    });
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('alt="Inline"');
    expect(html).toContain('alt="Anchored"');
  }
  expect(result.warnings).toEqual([]);
});

test('physical occurrences include repeated furniture, notes, and note separators', async () => {
  const entries = unzipSync(
    imageDocx(
      `<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/></w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>Page two</w:t></w:r></w:p><w:sectPr xmlns:r="${R}"><w:headerReference w:type="default" r:id="rHeader"/><w:footerReference w:type="default" r:id="rFooter"/></w:sectPr>`
    )
  );
  let types = strFromU8(entries['[Content_Types].xml']!);
  let relationships = strFromU8(entries['word/_rels/document.xml.rels']!);
  const stories = [
    [
      'header1.xml',
      'header',
      'rHeader',
      'hdr',
      `<w:p><w:r>${picture(1, false, 'Header')}</w:r></w:p>`,
    ],
    [
      'footer1.xml',
      'footer',
      'rFooter',
      'ftr',
      `<w:p><w:r>${picture(2, true, 'Footer')}</w:r></w:p>`,
    ],
    [
      'footnotes.xml',
      'footnotes',
      'rFootnotes',
      'footnotes',
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r>${picture(3, false, 'Separator')}</w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/>${picture(4, false, 'Footnote')}</w:r></w:p></w:footnote>`,
    ],
    [
      'endnotes.xml',
      'endnotes',
      'rEndnotes',
      'endnotes',
      `<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/>${picture(5, false, 'Endnote')}</w:r></w:p></w:endnote>`,
    ],
  ];
  for (const [part, kind, id, root, content] of stories) {
    types = types.replace(
      '</Types>',
      `<Override PartName="/word/${part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`
    );
    relationships = relationships.replace(
      '</Relationships>',
      `<Relationship Id="${id}" Type="${R}/${kind}" Target="${part}"/></Relationships>`
    );
    entries[`word/${part}`] = strToU8(`<w:${root} xmlns:w="${W}">${content}</w:${root}>`);
    entries[`word/_rels/${part}.rels`] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rImage" Type="${R}/image" Target="media/image.png"/></Relationships>`
    );
  }
  entries['[Content_Types].xml'] = strToU8(types);
  entries['word/_rels/document.xml.rels'] = strToU8(relationships);
  const result = await exportMarkdown(zipSync(entries), fast);
  expect(result.pages.length).toBeGreaterThanOrEqual(2);
  expect(result.media).toHaveLength(1);
  const occurrences = result.media[0]!.occurrences;
  expect(occurrences.filter((o) => o.story === 'header')).toHaveLength(result.pages.length);
  expect(occurrences.filter((o) => o.story === 'footer')).toHaveLength(result.pages.length);
  expect(new Set(occurrences.map((o) => o.story))).toEqual(
    new Set(['header', 'footer', 'footnote', 'endnote', 'note-separator'])
  );
  for (const page of result.pages) {
    expect(page.headerMarkdown).toContain('![Header](');
    expect(page.footerMarkdown).toContain('![Footer](');
  }
  expect(result.markdown).toContain('![Footnote](');
  expect(result.markdown).toContain('![Endnote](');
  expect(result.markdown).not.toContain('![Header](');
  expect(result.warnings.some((w) => w.code === 'image-placement-fallback')).toBe(false);
});

test('comments after an image keep exact bindings with short and long hosted URLs', async () => {
  const entries = unzipSync(
    imageDocx(
      `<w:p><w:r><w:t>Before</w:t>${picture(1, true)}</w:r><w:commentRangeStart w:id="0"/><w:r><w:t>Target 😀</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`
    )
  );
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'
    )
  );
  entries['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(entries['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/></Relationships>`
    )
  );
  entries['word/comments.xml'] = strToU8(
    `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada"><w:p><w:r><w:t>Check</w:t></w:r></w:p></w:comment></w:comments>`
  );
  for (const url of ['/a.png', `https://cdn.example.test/${'long-path/'.repeat(30)}image.png`]) {
    const result = await exportMarkdown(zipSync(entries), {
      ...fast,
      images: { resolveUrl: () => url },
    });
    const comment = result.reviewArtifacts.find((artifact) => artifact.kind === 'comment')!;
    const bindings = result.reviewBindings.filter((binding) => binding.artifactId === comment.id);
    expect(bindings).toHaveLength(2);
    for (const binding of bindings) {
      const text =
        binding.projection.kind === 'document'
          ? result.markdown
          : result.pages[binding.projection.pageIndex]![binding.projection.field];
      expect(binding.ranges.map((range) => text.slice(range.start, range.end)).join('')).toBe(
        'Target 😀'
      );
      expect(binding.ranges.every((range) => range.precision === 'exact')).toBe(true);
    }
  }
});

test('revision projection determines which image occurrences are extracted', async () => {
  const source = imageDocx(
    `<w:p><w:del w:id="1" w:author="Ada"><w:r>${picture(1, false, 'Deleted')}</w:r></w:del><w:ins w:id="2" w:author="Ada"><w:r>${picture(2, true, 'Inserted')}</w:r></w:ins></w:p>`
  );
  for (const displayMode of ['all-markup', 'proposed', 'original'] as const) {
    const result = await exportMarkdown(source, { ...fast, displayMode });
    expect(result.media[0]!.occurrences.map((o) => o.alt).sort()).toEqual(
      displayMode === 'all-markup'
        ? ['Deleted', 'Inserted']
        : displayMode === 'proposed'
          ? ['Inserted']
          : ['Deleted']
    );
    expect(result.reviewArtifacts.length).toBeGreaterThan(0);
  }
});

test('escapes image alternative text without allowing HTML or Markdown injection', async () => {
  const result = await exportMarkdown(
    imageDocx(
      `<w:p><w:r>${picture(1, false, 'x](javascript:alert(1)) &lt;script&gt;bad&lt;/script&gt; |')}</w:r></w:p>`
    ),
    fast
  );
  const html = micromark(result.markdown);
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<a ');
});

test('keeps warnings for unsupported legacy content beside an exported legacy image', async () => {
  const shape = `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="${R}" id="Picture" type="#_x0000_t75" style="width:100pt;height:50pt"><v:imagedata r:id="rImage"/></v:shape></w:pict></w:r></w:p>`;
  const extra =
    '<w:p><w:r><w:pict><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" id="Unsupported" style="width:100pt;height:50pt"/></w:pict></w:r></w:p>';
  const clean = await exportMarkdown(imageDocx(shape), fast);
  expect(clean.media).toHaveLength(1);
  expect(clean.warnings).toEqual([]);
  const mixed = await exportMarkdown(imageDocx(shape + extra), fast);
  expect(mixed.markdown).toContain('![');
  expect(mixed.warnings).toHaveLength(1);
  expect(mixed.warnings[0]).toMatchObject({
    code: 'omitted-drawing',
    partName: '/word/document.xml',
  });
});

test('supports SVG and existing raster/positioned-image corpus without placement fallbacks', async () => {
  const svg = strToU8(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>'
  );
  const result = await exportMarkdown(imageDocx(undefined, svg, 'svg', 'image/svg+xml'), fast);
  expect(result.media[0]).toMatchObject({
    mimeType: 'image/svg+xml',
    pixelWidth: 20,
    pixelHeight: 10,
  });
  expect(result.media[0]!.bytes).toEqual(svg);
  for (const name of [
    'images-formats.docx',
    'images-header.docx',
    'images-wrap-sides.docx',
    'images-transform.docx',
    'images-zorder.docx',
  ]) {
    const result = await exportMarkdown(
      await readFile(new URL(`../../../e2e/fixtures/${name}`, import.meta.url)),
      fast
    );
    expect(result.media.length).toBeGreaterThan(0);
    expect(result.warnings.filter((w) => w.code === 'image-placement-fallback')).toEqual([]);
  }
});

test('preserved-format conversion exports the validated replacement raster', async () => {
  const source = await readFile(new URL('../../../e2e/fixtures/images-tiff.docx', import.meta.url));
  const result = await exportMarkdown(source, {
    ...fast,
    convertPreservedImage: async () => ({ bytes: PNG, mime: 'image/png' }),
  });
  expect(
    result.media.some(
      (image) => image.mimeType === 'image/png' && image.bytes.length === PNG.length
    )
  ).toBe(true);
  expect(result.media.every((image) => image.mimeType !== 'image/tiff')).toBe(true);
});
