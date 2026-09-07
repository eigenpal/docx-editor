import { expect, test } from 'bun:test';
import { defineFontResolver, exportMarkdown } from '../src/index.ts';
import { docx } from './fixture.ts';
import { createPackagedFileFetch } from '@docx-editor.dev/core/export';
import { composeFontOrigins } from '@docx-editor.dev/core/editor';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';
import { FONT_ASSET_ROOT, packagedFonts } from '@docx-editor.dev/fonts';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

test('plain text with bundled fonts has no warnings', async () => {
  const result = await exportMarkdown(docx('<w:p><w:r><w:t>Text</w:t></w:r></w:p>'));
  expect(result.warnings).toEqual([]);
  expect(Object.isFrozen(result.warnings)).toBe(true);
});

test('reports legacy text boxes even when layout omits their records', async () => {
  const textbox =
    '<w:p><w:r><w:pict><v:shape id="box" type="#_x0000_t202" xmlns:v="urn:schemas-microsoft-com:vml" ' +
    'style="position:absolute;width:200pt;height:100pt"><v:textbox><w:txbxContent>' +
    '<w:p><w:r><w:t>Text box content</w:t></w:r></w:p>' +
    '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>';
  const result = await exportMarkdown(
    docx(
      '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' +
        textbox +
        textbox.replace('id="box"', 'id="box2"')
    )
  );
  expect(result.markdown.trim()).toBe('Body text');
  expect(result.warnings).toEqual([
    {
      code: 'omitted-textbox',
      message: 'Legacy text box content in /word/document.xml may be omitted from Markdown.',
      partName: '/word/document.xml',
    },
  ]);
});

test('reports failed origins and incomplete fonts in best-effort output', async () => {
  const result = await exportMarkdown(
    docx(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="MissingTestFont"/></w:rPr><w:t>Text</w:t></w:r></w:p>'
    ),
    {
      fonts: defineFontResolver(() => {
        throw new Error('Font service unavailable');
      }),
    }
  );
  expect(result.markdown).toBe('Text');
  expect(result.warnings).toContainEqual({
    code: 'font-origin-failed',
    message: 'A font source failed: Font service unavailable',
  });
  expect(
    result.warnings.some(
      (warning) => warning.code === 'incomplete-font' && warning.message.includes('MissingTestFont')
    )
  ).toBe(true);
});

test('reports unsupported legacy shapes that never produce drawing records', async () => {
  const result = await exportMarkdown(
    docx(
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        '<w:p><w:r><w:pict><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" ' +
        'id="Diagram" style="position:absolute;width:100pt;height:50pt" fillcolor="red"/>' +
        '</w:pict></w:r></w:p>'
    )
  );
  expect(result.markdown).toBe('Body');
  expect(result.warnings).toEqual([
    {
      code: 'omitted-drawing',
      partName: '/word/document.xml',
      message:
        'Legacy images or shapes in /word/document.xml are omitted from Markdown and may affect page breaks.',
    },
  ]);
});

test('ignores inactive legacy branches when the selected branch has no drawing', async () => {
  const result = await exportMarkdown(
    docx(
      '<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
        'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
        '<mc:Choice Requires="wps"><w:t>Selected text</w:t></mc:Choice>' +
        '<mc:Fallback><w:pict><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" ' +
        'id="Fallback" style="width:100pt;height:50pt"/></w:pict></mc:Fallback>' +
        '</mc:AlternateContent></w:r></w:p>'
    )
  );
  expect(result.warnings).toEqual([]);
});

test('reports both supported and unsupported legacy images without duplicate source warnings', async () => {
  for (const rotation of ['', ';rotation:15']) {
    const entries = unzipSync(
      docx(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:p><w:r><w:pict>' +
          '<v:shape xmlns:v="urn:schemas-microsoft-com:vml" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
          `id="Picture1" type="#_x0000_t75" style="width:100pt;height:50pt${rotation}">` +
          '<v:imagedata r:id="rImage"/></v:shape></w:pict></w:r></w:p>'
      )
    );
    entries['word/_rels/document.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/></Relationships>'
    );
    entries['word/media/image.png'] = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ef8AAAAASUVORK5CYII=',
        'base64'
      )
    );
    const result = await exportMarkdown(zipSync(entries));
    expect(result.markdown).toBe('Body');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('omitted-drawing');
    if (rotation) expect(result.warnings[0]?.partName).toBe('/word/document.xml');
    else expect(result.warnings[0]?.pageNumber).toBe(1);
    if (!rotation) {
      entries['word/document.xml'] = strToU8(
        strFromU8(entries['word/document.xml']!)
          .replace(
            '<w:pict>',
            '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
              'xmlns:future="urn:unsupported-shape"><mc:Choice Requires="future"><w:drawing/></mc:Choice><mc:Fallback><w:pict>'
          )
          .replace('</w:pict>', '</w:pict></mc:Fallback></mc:AlternateContent>')
      );
      const fallback = await exportMarkdown(zipSync(entries));
      expect(fallback.warnings).toHaveLength(1);
      expect(fallback.warnings[0]?.code).toBe('omitted-drawing');
      expect(fallback.warnings[0]?.partName).toBe('/word/document.xml');
    }
  }
});

test('reports bounded MC branch selection when a fallback cannot be inspected', async () => {
  const result = await exportMarkdown(
    docx(
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:p><w:r>' +
        '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:future="urn:unsupported-shape">' +
        '<mc:Choice Requires="future"><w:drawing/></mc:Choice>'.repeat(64) +
        '<mc:Fallback><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" ' +
        'id="Fallback" style="width:100pt;height:50pt"><v:textbox><w:txbxContent>' +
        '<w:p><w:r><w:t>Fallback text</w:t></w:r></w:p></w:txbxContent></v:textbox>' +
        '</v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>'
    )
  );
  expect(result.markdown).toBe('Body');
  expect(result.warnings).toContainEqual({
    code: 'content-scan-limit',
    partName: '/word/document.xml',
    message: 'Content checks stopped at the scan limit in /word/document.xml.',
  });
});

test('keeps successful packaged faces and reports a failed face to strict policy', async () => {
  const readPackaged = createPackagedFileFetch({
    trustedRoot: FONT_ASSET_ROOT,
    maxBytes: HARD_MAX_FONT_BYTES,
  });
  const partialFonts = packagedFonts({
    install: false,
    onFailure() {},
    fetcher: (async (input, init) => {
      if (String(input).endsWith('/Carlito-Bold.ttf')) return new Response(null, { status: 404 });
      return readPackaged(input, init);
    }) as typeof fetch,
  });
  const failures: unknown[] = [];
  const fragment = await composeFontOrigins(
    [partialFonts],
    {
      families: ['Calibri'],
      defaultFamily: 'Calibri',
    },
    { onOriginFailure: ({ cause }) => failures.push(cause) }
  );
  expect(fragment?.sources).toHaveLength(3);
  expect(failures).toHaveLength(1);

  const bytes = docx('<w:p><w:r><w:t>Text</w:t></w:r></w:p>');
  const result = await exportMarkdown(bytes, { fonts: partialFonts });
  expect(result.markdown).toBe('Text');
  // The normal bundled origin fills the missing face, but the earlier failure stays observable.
  expect(result.fontResolution?.families.every(({ coverage }) => coverage === 'complete')).toBe(
    true
  );
  expect(result.warnings.filter(({ code }) => code === 'font-origin-failed')).toHaveLength(1);
  await expect(
    exportMarkdown(bytes, { fonts: partialFonts, fontPolicy: 'strict' })
  ).rejects.toThrow();
});

test('a hostile resolver error cannot make warning formatting reject best-effort output', async () => {
  const cause = Object.defineProperty(new Error(), 'message', {
    get() {
      throw new Error('Do not inspect this error');
    },
  });
  const result = await exportMarkdown(docx('<w:p><w:r><w:t>Text</w:t></w:r></w:p>'), {
    fonts: defineFontResolver(() => {
      throw cause;
    }),
  });
  expect(result.markdown).toBe('Text');
  expect(result.warnings).toContainEqual({
    code: 'font-origin-failed',
    message: 'A font source failed: unknown error',
  });
});
