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
      // NOT the line box: each run keeps its own box so a mixed-size line highlights
      // stepped rather than as one slab. Lines still tile because layout's line height is
      // the font's own ascent + descent + line gap, which is what `normal` resolves to.
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

describe('each run is its own box, so a mixed-size line highlights stepped', () => {
  test('spans are inline-block, aligned on the baseline', () => {
    // The browser draws a selection band to the box it finds. A plain inline shares the
    // line box with everything else on the line, so a line mixing 8pt and 36pt highlighted
    // as one slab as tall as the largest run. An inline-block gives every run a box of its
    // own size — the band steps with the text, which is how Word draws it — and character
    // granularity is unaffected, so a word can still be selected part-way through.
    const span = paint('<w:p><w:r><w:t>hello</w:t></w:r></w:p>').querySelector<HTMLElement>(
      '.docx-line span'
    )!;
    expect(span.style.display).toBe('inline-block');
    expect(span.style.verticalAlign).toBe('baseline');
  });

  test('runs of different sizes keep different font sizes on one line', () => {
    const container = paint(
      '<w:p><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>8pt</w:t></w:r>' +
        '<w:r><w:rPr><w:sz w:val="72"/></w:rPr><w:t>36pt</w:t></w:r></w:p>'
    );
    const spans = [...container.querySelectorAll<HTMLElement>('.docx-line span')];
    expect(spans).toHaveLength(2);
    expect(spans[0]!.style.fontSize).toBe('8px'); // 16 half-points at scale 1
    expect(spans[1]!.style.fontSize).toBe('36px');
    // One line, not two: layout put them together and the painter must not re-flow them.
    expect(container.querySelectorAll('.docx-line')).toHaveLength(1);
  });
});

describe('only the pages worth building are built (task 9.4)', () => {
  const long = `<w:p><w:r><w:t>${'word '.repeat(3000)}</w:t></w:r></w:p>`;

  test('a page left out keeps its size and place but holds no content', () => {
    // Height and page count are unchanged, so scrolling to a page reveals it instead of
    // reflowing everything underneath it.
    const container = document.createElement('div');
    const layout = layoutOf(long);
    expect(layout.pages.length).toBeGreaterThan(2);
    paintSemanticLayout(container, layout, { scale: 1, materialize: new Set([0]) });

    const pages = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    expect(pages).toHaveLength(layout.pages.length);
    expect(pages[0]!.dataset.materialized).toBe('true');
    expect(pages[1]!.dataset.materialized).toBe('false');
    expect(pages[1]!.style.height).toBe(pages[0]!.style.height);
    expect(pages[1]!.querySelectorAll('.docx-line')).toHaveLength(0);
    expect(pages[0]!.querySelectorAll('.docx-line').length).toBeGreaterThan(0);
  });

  test('omitting the option builds everything, so the default cannot silently drop content', () => {
    const container = document.createElement('div');
    const layout = layoutOf(long);
    paintSemanticLayout(container, layout, { scale: 1 });
    for (const page of container.querySelectorAll<HTMLElement>('.docx-page')) {
      expect(page.dataset.materialized).toBe('true');
    }
  });
});

describe('a highlighted run is marked so dark mode can spare it', () => {
  test('the highlight name is stamped on the run', () => {
    // Dark mode lightness-inverts the page content, and that turns yellow into a dark olive
    // bar — Word keeps a highlight its authored colour, so the run has to be identifiable
    // for the stylesheet to counter-invert it.
    const span = paint(
      '<w:p><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>hi</w:t></w:r></w:p>'
    ).querySelector<HTMLElement>('.docx-line span')!;
    expect(span.dataset.highlight).toBe('yellow');
    expect(span.style.backgroundColor).not.toBe('');
  });

  test('an unhighlighted run carries no marker, so the rule cannot over-reach', () => {
    const span = paint('<w:p><w:r><w:t>plain</w:t></w:r></w:p>').querySelector<HTMLElement>(
      '.docx-line span'
    )!;
    expect(span.dataset.highlight).toBeUndefined();
  });

  test('an unknown highlight name is neither painted nor marked', () => {
    const span = paint(
      '<w:p><w:r><w:rPr><w:highlight w:val="constructor"/></w:rPr><w:t>hi</w:t></w:r></w:p>'
    ).querySelector<HTMLElement>('.docx-line span')!;
    expect(span.dataset.highlight).toBeUndefined();
    expect(span.style.backgroundColor).toBe('');
  });
});
