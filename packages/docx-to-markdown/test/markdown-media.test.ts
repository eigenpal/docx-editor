import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, forEachSemanticDrawing } from '@docx-editor.dev/core/layout';
import { readFile } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import {
  exportMarkdown,
  exportMarkdownFrom,
  openDocumentForExport,
  MarkdownMediaError,
} from '../src/index.ts';
import { imageDocx, picture, PNG, R, REL } from './media-fixture.ts';

const fast = { measurer: createFixedMeasurer() };

describe('portable image conversion', () => {
  test('opt-in returns owned PNG bytes and an inline link at its source position', async () => {
    const bytes = imageDocx();
    const text = await exportMarkdown(bytes, fast);
    const result = await exportMarkdown(bytes, { ...fast, images: true });
    expect(text.media).toEqual([]);
    expect(text.markdown).toBe('Before After\n\nEnd');
    expect(result.media).toHaveLength(1);
    const image = result.media[0]!;
    expect(image.bytes).toEqual(PNG);
    expect(image.path).toMatch(/^media\/[a-f0-9]{64}\.png$/);
    expect(image.url).toBe(image.path);
    expect(result.markdown).toBe(`Before![Picture](${image.path})After\n\nEnd`);
    expect(image.occurrences[0]).toMatchObject({ pageNumber: 1, story: 'body', alt: 'Picture' });
    expect(result.warnings).toEqual([]);
  });

  test('anchors render at paragraph positions, including table cells', async () => {
    for (const table of [false, true]) {
      const paragraph = `<w:p><w:r><w:t>Before</w:t>${picture(1, true)}<w:t>After</w:t></w:r></w:p>`;
      const body =
        (table
          ? `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`
          : paragraph) + '<w:p><w:r><w:t>End</w:t></w:r></w:p>';
      const result = await exportMarkdown(imageDocx(body), { ...fast, images: true });
      expect(result.media).toHaveLength(1);
      expect(result.markdown).toContain(`Before![Picture](${result.media[0]!.path})After`);
      expect(result.markdown.match(/!\[/g)).toHaveLength(1);
      expect(result.pages[0]!.markdown.match(/!\[/g)).toHaveLength(1);
      expect(result.warnings).toEqual([]);
    }
  });

  test('deduplicates before the budget and resolver, preserving per-occurrence descriptions', async () => {
    const bytes = imageDocx(
      `<w:p><w:r>${picture(1, false, 'First')}${picture(2, false, 'Second')}</w:r></w:p>`
    );
    let calls = 0;
    const result = await exportMarkdown(bytes, {
      ...fast,
      images: {
        maxTotalBytes: PNG.length,
        resolveUrl(image) {
          calls++;
          image.bytes.fill(0);
          return `https://cdn.example.test/a (b).png`;
        },
      },
    });
    expect(calls).toBe(1);
    expect(result.media).toHaveLength(1);
    expect(result.media[0]!.bytes).toEqual(PNG);
    expect(result.media[0]!.occurrences.map((o) => o.alt)).toEqual(['First', 'Second']);
    expect(result.markdown).toContain('![First](https://cdn.example.test/a%20%28b%29.png)');
    expect(result.markdown).toContain('![Second](');
  });

  test('custom URLs preserve character references and cannot split Markdown table cells', async () => {
    const url = 'https://cdn.example.test/a|b&copy;.png?x=1&y=2';
    const paragraph = `<w:p><w:r>${picture()}</w:r></w:p>`;
    for (const table of [false, true]) {
      const body = table
        ? `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`
        : paragraph;
      const result = await exportMarkdown(imageDocx(body), {
        ...fast,
        images: { resolveUrl: () => url },
      });
      expect(result.media[0]!.url).toBe(url);
      for (const markdown of [result.markdown, result.pages[0]!.markdown]) {
        const html = micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
        expect(html).toContain('src="https://cdn.example.test/a%7Cb&amp;copy;.png?x=1&amp;y=2"');
        expect(html.match(/<img /g)).toHaveLength(1);
      }
    }
  });

  test('budget errors are actionable and happen before URL callbacks', async () => {
    let calls = 0;
    try {
      await exportMarkdown(imageDocx(), {
        ...fast,
        images: {
          maxTotalBytes: 1,
          resolveUrl() {
            calls++;
            return '/image.png';
          },
        },
      });
      throw new Error('expected media limit');
    } catch (error) {
      expect(error).toBeInstanceOf(MarkdownMediaError);
      expect(error).toMatchObject({ code: 'media-limit', actualBytes: PNG.length, limitBytes: 1 });
      expect((error as Error).message).toContain('images.maxTotalBytes');
    }
    expect(calls).toBe(0);
    for (const maxTotalBytes of [0, -1, Infinity, NaN, 1.5])
      await expect(
        exportMarkdown(imageDocx(), { ...fast, images: { maxTotalBytes } })
      ).rejects.toBeInstanceOf(TypeError);
  });

  test('rejects unsafe destinations and preserves callback failures', async () => {
    for (const url of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'blob:https://x/a',
      '//example.test/a',
      'file:///tmp/a',
      '/a\\b',
      '/a\nb',
      '',
    ]) {
      await expect(
        exportMarkdown(imageDocx(), { ...fast, images: { resolveUrl: () => url } })
      ).rejects.toMatchObject({ code: 'invalid-image-url' });
    }
    const cause = new Error('upload unavailable');
    await expect(
      exportMarkdown(imageDocx(), {
        ...fast,
        images: {
          resolveUrl() {
            throw cause;
          },
        },
      })
    ).rejects.toMatchObject({ code: 'url-resolution-failed', cause });
  });

  test('aborts a pending resolver promptly and observes its late rejection', async () => {
    const controller = new AbortController();
    let rejectUpload!: (cause: Error) => void;
    const result = exportMarkdown(imageDocx(), {
      ...fast,
      signal: controller.signal,
      images: {
        resolveUrl: (_image, { signal }) => {
          expect(signal).toBe(controller.signal);
          queueMicrotask(() => controller.abort());
          return new Promise((_resolve, reject) => {
            rejectUpload = reject;
          });
        },
      },
    });
    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    rejectUpload(new Error('late upload rejection'));
    await Promise.resolve();
  });

  test('caller sessions remain usable and result bytes survive disposal', async () => {
    const opened = await openDocumentForExport(imageDocx(), fast);
    if (!opened.ok) throw new Error(opened.reason);
    const result = await exportMarkdownFrom(opened.session, { images: true });
    const layout = await opened.session.layout();
    let ready = 0;
    forEachSemanticDrawing(layout, ({ drawing }) => {
      if (opened.session.validatedImageBytes(drawing)) ready++;
    });
    expect(ready).toBe(1);
    opened.session.dispose();
    expect(result.media[0]!.bytes).toEqual(PNG);
  });

  test('hidden images are absent and decorative images have empty alternative text', async () => {
    const result = await exportMarkdown(
      imageDocx(
        `<w:p><w:r>${picture(1, false, '', false)}${picture(2, false, 'Hidden', true)}${picture(3, true, 'Hidden anchor', true)}</w:r></w:p>`
      ),
      { ...fast, images: true }
    );
    expect(result.media[0]!.occurrences).toHaveLength(1);
    expect(result.markdown).toStartWith('![](');
    expect(result.markdown).not.toContain('Hidden');
  });

  test('does not fetch external images and does not export invalid bytes', async () => {
    const entries = unzipSync(imageDocx());
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rImage" Type="${R}/image" Target="https://never-fetch.invalid/image.png" TargetMode="External"/></Relationships>`
    );
    entries['word/document.xml'] = strToU8(
      strFromU8(entries['word/document.xml']!).replace('r:embed=', 'r:link=')
    );
    for (const bytes of [zipSync(entries), imageDocx(undefined, new Uint8Array([1, 2, 3]))]) {
      const result = await exportMarkdown(bytes, { ...fast, images: true });
      expect(result.media).toEqual([]);
      expect(result.warnings.some((w) => w.code === 'omitted-drawing')).toBe(true);
    }
  });

  test('converts the checked-in image fixture with default font-backed pagination', async () => {
    const result = await exportMarkdown(
      await readFile(new URL('../../../e2e/fixtures/example-with-image.docx', import.meta.url)),
      { images: true }
    );
    expect(result.media[0]!.byteLength).toBe(789);
    expect(result.markdown).toContain('![');
    expect(
      result.warnings.some(
        (w) => w.code === 'omitted-drawing' || w.code === 'image-placement-fallback'
      )
    ).toBe(false);
  });
});
