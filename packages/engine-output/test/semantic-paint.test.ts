// Painting semantic layout records (task 7.5).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/engine-core';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/engine-layout';
import { paintSemanticLayout } from '../src/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function layoutOf(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 7, { measurer: createFixedMeasurer(6, 14) });
}

function paint(body: string): HTMLElement {
  const container = document.createElement('div');
  paintSemanticLayout(container, layoutOf(body), { scale: 1 });
  return container;
}

describe('the painter is a non-authoritative consumer', () => {
  test('it paints a page, a fragment, a line and a span', () => {
    const container = paint('<w:p><w:r><w:t>hello</w:t></w:r></w:p>');
    expect(container.querySelectorAll('.docx-page')).toHaveLength(1);
    expect(container.querySelectorAll('.docx-paragraph-fragment')).toHaveLength(1);
    expect(container.querySelectorAll('.docx-line')).toHaveLength(1);
    expect(container.querySelector('.docx-line span')?.textContent).toBe('hello');
  });

  test('it stamps the revision it painted, so a stale paint is detectable', () => {
    expect(paint('<w:p><w:r><w:t>x</w:t></w:r></w:p>').dataset.revision).toBe('7');
  });

  test('LINE positions come from the records, not from the browser', () => {
    // Where the boundary sits: layout decides what is on a line and where the line goes;
    // the browser places glyphs within it. So a line carries published coordinates and its
    // spans carry none — positioning each word independently is what broke the selection
    // highlight into one block per word and left `vertical-align` with nothing to align to.
    const container = paint('<w:p><w:r><w:t>abc</w:t></w:r><w:r><w:t>de</w:t></w:r></w:p>');
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    expect(line.style.position).toBe('absolute');
    expect(line.style.left).toBe('0px');
    expect(line.style.top).toBe('0px');
    // A line never re-wraps: layout already decided where it ends.
    expect(line.style.whiteSpace).toBe('pre');
    const spans = [...container.querySelectorAll<HTMLElement>('.docx-line span')];
    expect(spans).toHaveLength(2);
    for (const span of spans) expect(span.style.left).toBe('');
  });

  test('a line is as tall as the record says, so lines cannot drift apart', () => {
    const container = paint(`<w:p><w:r><w:t>${'word '.repeat(60)}</w:t></w:r></w:p>`);
    const lines = [...container.querySelectorAll<HTMLElement>('.docx-line')];
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.style.height).toBe('14px'); // the fixed measurer's line height at scale 1
      // Deliberately NOT the line height: that would set every inline box on the line, and
      // the selection highlight follows the inline box, so a small run would be highlighted
      // as tall as the largest one on the line.
      expect(line.style.lineHeight).toBe('normal');
    }
    // Consecutive lines sit exactly one line height apart.
    expect(Number.parseFloat(lines[1]!.style.top)).toBe(
      Number.parseFloat(lines[0]!.style.top) + 14
    );
  });

  test('every span carries its model range, so the DOM maps back without a lookup', () => {
    const span = paint('<w:p><w:r><w:t>hello</w:t></w:r></w:p>').querySelector<HTMLElement>(
      '.docx-line span'
    )!;
    expect(span.dataset.paragraphId).toBe('/word/document.xml#0.0.0');
    expect(span.dataset.start).toBe('0');
    expect(span.dataset.end).toBe('5');
  });

  test('resolved run style is applied from the record', () => {
    const span = paint(
      '<w:p><w:r><w:rPr><w:b/><w:i/><w:sz w:val="44"/><w:color w:val="C00000"/>' +
        '<w:u w:val="double"/></w:rPr><w:t>styled</w:t></w:r></w:p>'
    ).querySelector<HTMLElement>('.docx-line span')!;
    expect(span.style.fontWeight).toBe('bold');
    expect(span.style.fontStyle).toBe('italic');
    expect(span.style.fontSize).toBe('22px'); // 44 half-points at scale 1
    expect(span.style.textDecorationStyle).toBe('double');
  });

  test('text is set with textContent, so markup in a document is never parsed', () => {
    const container = paint('<w:p><w:r><w:t>&lt;img src=x onerror=alert(1)&gt;</w:t></w:r></w:p>');
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelector('.docx-line span')!.textContent).toContain('<img');
  });

  test('a hostile font name is refused at the sink as well as the resolver', () => {
    const span = paint(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="A&quot;;background:url(//evil)"/></w:rPr>' +
        '<w:t>x</w:t></w:r></w:p>'
    ).querySelector<HTMLElement>('.docx-line span')!;
    expect(span.style.backgroundImage).toBe('');
    expect(span.style.fontFamily === '' || span.style.fontFamily.includes('evil') === false).toBe(
      true
    );
  });

  test('painted pages are presentational, so they are not a second reading order', () => {
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutOf('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    const page = container.querySelector('.docx-page')!;
    expect(page.getAttribute('aria-hidden')).toBe('true');
    expect(page.getAttribute('role')).toBe('presentation');
  });

  test('repainting replaces the previous content rather than appending', () => {
    const container = document.createElement('div');
    const layout = layoutOf('<w:p><w:r><w:t>one</w:t></w:r></w:p>');
    paintSemanticLayout(container, layout);
    paintSemanticLayout(container, layout);
    expect(container.querySelectorAll('.docx-page')).toHaveLength(1);
  });

  test('scale multiplies published geometry without changing it', () => {
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutOf('<w:p><w:r><w:t>abc</w:t></w:r></w:p>'), { scale: 2 });
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    expect(line.style.height).toBe('28px'); // 14pt at scale 2
    const page = container.querySelector<HTMLElement>('.docx-page')!;
    expect(page.style.width).toBe('1224px'); // 612pt at scale 2
  });
});
