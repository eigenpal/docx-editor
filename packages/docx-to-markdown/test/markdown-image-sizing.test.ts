import { expect, test } from 'bun:test';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import {
  exportMarkdown,
  exportMarkdownFrom,
  openDocumentForExport,
  toMarkdownJSON,
  createMarkdownZip,
} from '../src/index.ts';
import { strFromU8, unzipSync } from 'fflate';
import { imageDocx, picture } from './media-fixture.ts';

const fast = { measurer: createFixedMeasurer() };
const sizedPicture = (id: number, anchor: boolean, width: number, height: number, alt = 'Image') =>
  picture(id, anchor, alt).replace(
    '<wp:extent cx="127000" cy="127000"/>',
    `<wp:extent cx="${width * 9525}" cy="${height * 9525}"/>`
  );

test('one asset retains distinct occurrence sizes and emits those sizes in each projection', async () => {
  const bytes = imageDocx(
    `<w:p><w:r><w:t>Inline:</w:t>${sizedPicture(1, false, 24, 12)}<w:t>next</w:t>${sizedPicture(2, true, 300, 80)}</w:r></w:p>`
  );
  const result = await exportMarkdown(bytes, { ...fast, images: { syntax: 'html' } });
  expect(result.media).toHaveLength(1);
  const asset = result.media[0]!;
  expect([asset.pixelWidth, asset.pixelHeight]).toEqual([1, 1]);
  expect(asset.occurrences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'inline', displayWidthPx: 24, displayHeightPx: 12 }),
      expect.objectContaining({ kind: 'anchored', displayWidthPx: 300, displayHeightPx: 80 }),
    ])
  );
  for (const markdown of [result.markdown, result.pages[0]!.markdown]) {
    expect(markdown).toContain(
      `Inline:<img src="${asset.path}" alt="Image" width="24" height="12">next`
    );
    expect(markdown).toContain('width="300" height="80"');
    expect(markdown.match(/<img /g)).toHaveLength(2);
  }
  expect(toMarkdownJSON(result).media[0]!.occurrences).toEqual(asset.occurrences);
  const entries = unzipSync(await createMarkdownZip(result));
  expect(strFromU8(entries['document.md']!)).toBe(result.markdown);
  const ordinary = await exportMarkdown(bytes, { ...fast, images: true });
  expect(ordinary.markdown).toContain('![Image](');
  expect(ordinary.markdown).not.toContain('<img');
  expect(ordinary.media[0]!.occurrences).toEqual(asset.occurrences);
});

test('session export preserves fractional geometry while HTML uses whole CSS pixels', async () => {
  const opened = await openDocumentForExport(
    imageDocx(`<w:p><w:r>${sizedPicture(1, false, 24.4, 12.6)}</w:r></w:p>`),
    fast
  );
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const result = await exportMarkdownFrom(opened.session, { images: { syntax: 'html' } });
    expect(result.media[0]!.occurrences[0]!.displayWidthPx).toBeCloseTo(24.4);
    expect(result.media[0]!.occurrences[0]!.displayHeightPx).toBeCloseTo(12.6);
    expect(result.markdown).toContain('width="24" height="13"');
  } finally {
    opened.session.dispose();
  }
});

test('HTML image attributes cannot inject tags, handlers, or GFM table cells', async () => {
  const alt = 'A &quot; onerror=&quot;bad() | &lt;script&gt; &amp;copy; &#10; B';
  const url = 'https://cdn.example.test/a"<b>|&copy;.png';
  const paragraph = `<w:p><w:r><w:t>Before</w:t>${sizedPicture(1, false, 24, 12, alt)}<w:t>After</w:t></w:r></w:p>`;
  for (const table of [false, true]) {
    const body = table
      ? `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`
      : paragraph;
    const result = await exportMarkdown(imageDocx(body), {
      ...fast,
      images: { syntax: 'html', resolveUrl: () => url },
    });
    for (const markdown of [result.markdown, result.pages[0]!.markdown]) {
      const html = micromark(markdown, {
        allowDangerousHtml: true,
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
      });
      const document = new DOMParser().parseFromString(html, 'text/html');
      const img = document.querySelector('img')!;
      expect(document.querySelectorAll('img')).toHaveLength(1);
      expect(img.getAttribute('src')).toBe(url);
      expect(img.getAttribute('alt')).toContain('A " onerror="bad() | <script> &copy;');
      expect(img.hasAttribute('onerror')).toBe(false);
      expect(document.querySelector('script')).toBeNull();
      if (table) expect(document.querySelectorAll('td, th')).toHaveLength(1);
    }
  }
});

test('invalid image syntax fails before opening a document or resolving URLs', async () => {
  let called = false;
  await expect(
    exportMarkdown(new Uint8Array(), {
      ...fast,
      images: {
        // @ts-expect-error Check untyped JavaScript callers.
        syntax: 'invalid',
        resolveUrl: () => {
          called = true;
          return '/image.png';
        },
      },
    })
  ).rejects.toThrow('images.syntax');
  expect(called).toBe(false);
});

test('zero and subpixel extents stay in metadata and round to zero in HTML', async () => {
  const result = await exportMarkdown(
    imageDocx(
      `<w:p><w:r>${sizedPicture(1, false, 0, 10, '')}${sizedPicture(2, false, 0.4, 10)}</w:r></w:p>`
    ),
    { ...fast, images: { syntax: 'html' } }
  );
  expect(result.media[0]!.occurrences[0]!.displayWidthPx).toBe(0);
  expect(result.media[0]!.occurrences[1]!.displayWidthPx).toBeCloseTo(0.4);
  expect(result.markdown.match(/width="0" height="10"/g)).toHaveLength(2);
  expect(result.markdown).toContain('alt=""');
});
