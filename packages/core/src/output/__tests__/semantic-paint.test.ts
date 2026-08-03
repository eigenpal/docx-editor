// Painting semantic layout records (task 7.5).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  buildNumberingIndex,
  createFixedMeasurer,
  layoutSemanticDocument,
} from '@docx-editor.dev/core-contract/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function layoutOf(body: string, numbering?: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  let numberingIndex;
  if (numbering) {
    const num = readOoxmlPart(`<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`, {
      name: '/word/numbering.xml',
      contentType: 'app/xml',
    });
    if (!num.ok) throw new Error(num.reason);
    numberingIndex = buildNumberingIndex(num.part.root);
  }
  return layoutSemanticDocument(read.part, 7, {
    measurer: createFixedMeasurer(6, 14),
    ...(numberingIndex ? { numberingIndex } : {}),
  });
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
    const spans = [...container.querySelectorAll<HTMLElement>('.layout-run-text')];
    expect(spans).toHaveLength(2);
    for (const span of spans) expect(span.style.left).toBe('');
  });

  test('a line is as tall as the record says, so lines cannot drift apart', () => {
    const container = paint(`<w:p><w:r><w:t>${'word '.repeat(60)}</w:t></w:r></w:p>`);
    const lines = [...container.querySelectorAll<HTMLElement>('.docx-line')];
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.style.height).toBe('14px'); // the fixed measurer's line height at scale 1
      // Zero host font-size strut; published height is the authoritative line-height.
      expect(line.style.fontSize).toBe('0px');
      expect(line.style.lineHeight).toBe('14px');
      expect(line.style.overflow).toBe('visible');
    }
    // Consecutive lines sit exactly one line height apart.
    expect(Number.parseFloat(lines[1]!.style.top)).toBe(
      Number.parseFloat(lines[0]!.style.top) + 14
    );
  });

  test('every span carries its model range, so the DOM maps back without a lookup', () => {
    const span = paint('<w:p><w:r><w:t>hello</w:t></w:r></w:p>').querySelector<HTMLElement>(
      '.layout-run-text'
    )!;
    expect(span.dataset.paragraphId).toBe('/word/document.xml#0.0.0');
    expect(span.dataset.start).toBe('0');
    expect(span.dataset.end).toBe('5');
  });

  test('resolved run style is applied from the record', () => {
    const span = paint(
      '<w:p><w:r><w:rPr><w:b/><w:i/><w:sz w:val="44"/><w:color w:val="C00000"/>' +
        '<w:u w:val="double"/></w:rPr><w:t>styled</w:t></w:r></w:p>'
    ).querySelector<HTMLElement>('.layout-run-text')!;
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

  test('a tab span reserves layout box width, not the browser native tab advance', () => {
    // Regression: inline-block + textContent `\t` otherwise collapses to a narrow native
    // tab (~one character), so right/center stops never reach the painted surface even
    // when breakParagraph published the correct advance.
    const body =
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="2400"/></w:tabs></w:pPr>` +
      `<w:r><w:t>L</w:t><w:tab/><w:t>ABCD</w:t></w:r></w:p>`;
    const layout = layoutOf(body);
    const tabRecord = layout.pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines : []
    )
      .flatMap((line) => line.spans)
      .find((span) => span.text === '\t')!;
    expect(tabRecord.box.width).toBeGreaterThan(6);

    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const tabEl = [...container.querySelectorAll<HTMLElement>('.layout-run-text')].find(
      (el) => el.textContent === '\t'
    )!;
    expect(tabEl.style.width).toBe(`${tabRecord.box.width}px`);
    expect(tabEl.style.overflow).toBe('hidden');
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
      '.layout-run-text'
    )!;
    expect(span.style.display).toBe('inline-block');
    expect(span.style.verticalAlign).toBe('baseline');
  });

  test('runs of different sizes keep different font sizes on one line', () => {
    const container = paint(
      '<w:p><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>8pt</w:t></w:r>' +
        '<w:r><w:rPr><w:sz w:val="72"/></w:rPr><w:t>36pt</w:t></w:r></w:p>'
    );
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    const spans = [...container.querySelectorAll<HTMLElement>('.layout-run-text')];
    expect(spans).toHaveLength(2);
    expect(spans[0]!.style.fontSize).toBe('8px'); // 16 half-points at scale 1
    expect(spans[1]!.style.fontSize).toBe('36px');
    // Line strut is zeroed; child runs still own their sizes and baseline alignment.
    expect(line.style.fontSize).toBe('0px');
    expect(spans[0]!.style.verticalAlign).toBe('baseline');
    expect(spans[1]!.style.verticalAlign).toBe('baseline');
    // One line, not two: layout put them together and the painter must not re-flow them.
    expect(container.querySelectorAll('.docx-line')).toHaveLength(1);
  });

  test('a run owns its line-height, so its selection band is its own height', () => {
    // 11pt next to 22pt on one line. The band the browser draws follows each run's inner
    // line box, so the run must NOT inherit the line's pixel line-height — inherited, an
    // 11pt run next to a 22pt one highlighted as one uniform 28px slab.
    const container = paint(
      '<w:p><w:r><w:t>small</w:t></w:r>' +
        '<w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>big</w:t></w:r></w:p>'
    );
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    expect(line.style.height).toBe('28px'); // tallest run decides the line
    const [small, big] = [...line.querySelectorAll<HTMLElement>('.layout-run-text')];
    expect(small!.style.lineHeight).toBe('14px'); // its own published height
    // The tallest run's band is exactly the line height — the same value it used to
    // inherit — so the browser's line-box/baseline math is unchanged by the stepping.
    expect(big!.style.lineHeight).toBe('28px');
  });

  test('line spacing above single joins the stepped bands with the extra leading', () => {
    // Double spacing doubles the line box. Word still paints the leading, so every run's
    // band grows by the same extra leading — capped at the line height, which the tallest
    // run reaches exactly.
    const container = paint(
      '<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr>' +
        '<w:r><w:t>small</w:t></w:r>' +
        '<w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>big</w:t></w:r></w:p>'
    );
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    expect(line.style.height).toBe('56px'); // 28 natural × 480/240
    const [small, big] = [...line.querySelectorAll<HTMLElement>('.layout-run-text')];
    expect(small!.style.lineHeight).toBe('42px'); // 14 own + 28 leading
    expect(big!.style.lineHeight).toBe('56px'); // 28 own + 28 leading = the line height
  });

  test('a tab span gets its own band too, not the full line height', () => {
    // A tab paints with `overflow: hidden`, which makes its inline-block baseline the
    // BOTTOM edge (CSS2.1 §10.8.1) — so unlike a text run its whole band counts above the
    // baseline. Inheriting the line height made a small-style tab dominate the line box of
    // a mixed-size line and push every glyph below the published baseline; its own band
    // keeps the tab's contribution no larger than the run it belongs with.
    const container = paint(
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2400"/></w:tabs></w:pPr>' +
        '<w:r><w:t>a</w:t><w:tab/></w:r>' +
        '<w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>big</w:t></w:r></w:p>'
    );
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    expect(line.style.height).toBe('28px');
    const tab = [...line.querySelectorAll<HTMLElement>('.layout-run-text')].find(
      (el) => el.textContent === '\t'
    )!;
    expect(tab.style.lineHeight).toBe('14px'); // the tab style's own height, not the line's
  });

  test('an exact line rule below the natural height caps every band at the line', () => {
    // `exact` can shrink the box below the glyphs (Word clips). Bands must not grow past
    // the published line height, or a selection would spill over the neighbouring lines.
    const container = paint(
      '<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact"/></w:pPr>' +
        '<w:r><w:t>small</w:t></w:r>' +
        '<w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>big</w:t></w:r></w:p>'
    );
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    expect(line.style.height).toBe('10px'); // 200 twips exact
    const [small, big] = [...line.querySelectorAll<HTMLElement>('.layout-run-text')];
    expect(small!.style.lineHeight).toBe('10px'); // 14 own, capped at the line
    expect(big!.style.lineHeight).toBe('10px'); // 28 own, capped at the line
  });

  test('superscript keeps a relative offset and is not clipped by the line box', () => {
    const container = paint(
      '<w:p><w:r><w:t>x</w:t></w:r>' +
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r></w:p>'
    );
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    const spans = [...container.querySelectorAll<HTMLElement>('.layout-run-text')];
    expect(line.style.overflow).toBe('visible');
    expect(line.style.fontSize).toBe('0px');
    const superRun = spans.find((span) => span.textContent === '2')!;
    expect(superRun.style.position).toBe('relative');
    expect(Number.parseFloat(superRun.style.top)).toBeLessThan(0);
    expect(superRun.style.fontSize).toBe('8.25px'); // 11pt * 0.75 at scale 1
    expect(superRun.style.verticalAlign).toBe('baseline');
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

describe('paragraph and character shading paint from validated fills', () => {
  test('fixture-equivalent paragraph and run fills paint on fragment and glyph box', () => {
    const body =
      `<w:p><w:pPr><w:shd w:val="clear" w:fill="F0F4F8"/></w:pPr>` +
      `<w:r><w:rPr><w:shd w:val="clear" w:fill="FFEEAA"/></w:rPr><w:t>hi</w:t></w:r></w:p>`;
    const container = paint(body);
    const fragment = container.querySelector<HTMLElement>('.docx-paragraph-fragment')!;
    const band = container.querySelector<HTMLElement>('.docx-paragraph-shading')!;
    const span = container.querySelector<HTMLElement>('.docx-line span')!;
    expect(fragment.style.backgroundColor).toBe('');
    expect(band.style.backgroundColor.toLowerCase()).toBe('#f0f4f8');
    expect(span.style.backgroundColor.toLowerCase()).toBe('#ffeeaa');
  });

  test('paragraph shading band uses published line geometry, not before/after', () => {
    const body =
      `<w:p><w:pPr><w:shd w:val="clear" w:fill="F0F4F8"/>` +
      `<w:spacing w:before="200" w:after="120"/></w:pPr>` +
      `<w:r><w:t>shaded</w:t></w:r></w:p>`;
    const layout = layoutOf(body);
    const record = layout.pages[0]!.fragments[0]!;
    expect(record.kind).toBe('paragraph');
    if (record.kind !== 'paragraph') return;
    expect(record.shadingBox).toBeDefined();

    const container = paint(body);
    const fragment = container.querySelector<HTMLElement>('.docx-paragraph-fragment')!;
    const band = container.querySelector<HTMLElement>('.docx-paragraph-shading')!;
    expect(fragment.style.backgroundColor).toBe('');
    expect(band).not.toBeNull();
    expect(band.style.backgroundColor.toLowerCase()).toBe('#f0f4f8');
    // Geometry comes from the record, relative to the fragment — not from the DOM.
    expect(band.style.height).toBe(`${record.shadingBox!.height}px`);
    expect(Number.parseFloat(band.style.top)).toBe(record.shadingBox!.y - record.box.y);
    expect(Number.parseFloat(band.style.top)).toBe(10); // before=200 twips
    expect(band.style.width).toBe(`${record.shadingBox!.width}px`);
    // Outer fragment still carries spacing for flow; band does not.
    expect(fragment.style.height).toBe(`${record.box.height}px`);
    expect(record.box.height).toBe(10 + 14 + 6);
    expect(record.shadingBox!.height).toBe(14);
  });

  test('highlight overrides character shading', () => {
    const span = paint(
      '<w:p><w:r><w:rPr><w:shd w:val="clear" w:fill="FFEEAA"/>' +
        '<w:highlight w:val="yellow"/></w:rPr><w:t>hi</w:t></w:r></w:p>'
    ).querySelector<HTMLElement>('.docx-line span')!;
    expect(span.dataset.highlight).toBe('yellow');
    expect(span.style.backgroundColor.toLowerCase()).toBe('#ffff00');
  });

  test('hostile paragraph and run fills are refused at the sink', () => {
    const container = paint(
      '<w:p><w:pPr><w:shd w:val="clear" w:fill="url(evil)"/></w:pPr>' +
        '<w:r><w:rPr><w:shd w:val="clear" w:fill="javascript:alert(1)"/></w:rPr>' +
        '<w:t>x</w:t></w:r></w:p>'
    );
    const fragment = container.querySelector<HTMLElement>('.docx-paragraph-fragment')!;
    const band = container.querySelector<HTMLElement>('.docx-paragraph-shading');
    const span = container.querySelector<HTMLElement>('.docx-line span')!;
    expect(fragment.style.backgroundColor).toBe('');
    expect(band).toBeNull();
    expect(span.style.backgroundColor).toBe('');
    expect(fragment.style.backgroundImage).toBe('');
    expect(span.style.backgroundImage).toBe('');
  });

  test('line strut is zeroed so character shading can share the paragraph band top', () => {
    // Regression for the inherited 16px host font-size strut: paragraph shading uses the
    // published line box, while character shading paints on baseline-aligned runs. With a
    // non-zero line strut those run backgrounds sat 2px below the band in the browser.
    const body =
      `<w:p><w:pPr><w:shd w:val="clear" w:fill="F0F4F8"/>` +
      `<w:spacing w:after="120"/></w:pPr>` +
      `<w:r><w:t>Paragraph-level shading. </w:t></w:r>` +
      `<w:r><w:rPr><w:shd w:val="clear" w:fill="FFEEAA"/></w:rPr>` +
      `<w:t>Character-level shading.</w:t></w:r></w:p>`;
    const layout = layoutOf(body);
    const record = layout.pages[0]!.fragments[0]!;
    expect(record.kind).toBe('paragraph');
    if (record.kind !== 'paragraph') return;

    const container = paint(body);
    // Host pages commonly set 16px; paint must not inherit that onto the line strut.
    container.style.fontSize = '16px';
    const fragment = container.querySelector<HTMLElement>('.docx-paragraph-fragment')!;
    const band = container.querySelector<HTMLElement>('.docx-paragraph-shading')!;
    const line = container.querySelector<HTMLElement>('.docx-line')!;
    const charRun = [...container.querySelectorAll<HTMLElement>('.layout-run-text')].find(
      (el) => el.style.backgroundColor.toLowerCase() === '#ffeeaa'
    )!;

    expect(line.style.fontSize).toBe('0px');
    expect(line.style.lineHeight).toBe(`${record.shadingBox!.height}px`);
    expect(line.style.height).toBe(`${record.shadingBox!.height}px`);
    expect(band.style.height).toBe(line.style.height);
    expect(Number.parseFloat(band.style.top)).toBe(Number.parseFloat(line.style.top));
    expect(charRun.style.verticalAlign).toBe('baseline');
    expect(charRun.style.fontSize).not.toBe('0px');
    // Selection / model mapping stay on the outer run after nested decoration work.
    expect(charRun.dataset.start).toBeDefined();
    expect(charRun.dataset.end).toBeDefined();
    // Happy-dom rects are coarse; when both boxes report a top, they must match.
    const bandTop = band.getBoundingClientRect().top;
    const runTop = charRun.getBoundingClientRect().top;
    if (Number.isFinite(bandTop) && Number.isFinite(runTop) && (bandTop !== 0 || runTop !== 0)) {
      expect(runTop - bandTop).toBe(0);
    }
    // After spacing remains on the fragment only.
    expect(Number.parseFloat(fragment.style.height)).toBeGreaterThan(
      Number.parseFloat(band.style.height)
    );
  });
});

describe('run underline and strike decorations (fixture variants + mixed)', () => {
  const runOf = (body: string): HTMLElement =>
    paint(body).querySelector<HTMLElement>('.layout-run-text')!;

  test('single strike paints a solid line-through', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:strike/></w:rPr><w:t>strikethrough text</w:t></w:r></w:p>'
    );
    expect(run.style.textDecorationLine).toBe('line-through');
    expect(run.style.textDecorationStyle === '' || run.style.textDecorationStyle === 'solid').toBe(
      true
    );
    expect(run.style.textDecorationStyle).not.toBe('double');
    expect(run.querySelectorAll('[data-docx-deco]')).toHaveLength(0);
  });

  test('double strike paints a true double line-through', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:dstrike/></w:rPr><w:t>double strikethrough</w:t></w:r></w:p>'
    );
    expect(run.style.textDecorationLine).toBe('line-through');
    expect(run.style.textDecorationStyle).toBe('double');
  });

  test('when both strike flags are set, double strike wins', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:strike/><w:dstrike/></w:rPr><w:t>both</w:t></w:r></w:p>'
    );
    expect(run.style.textDecorationLine).toBe('line-through');
    expect(run.style.textDecorationStyle).toBe('double');
  });

  test('fixture underline variants map style and thick weight', () => {
    const cases: Array<{ val: string; style: string; heavy: boolean }> = [
      { val: 'single', style: 'solid', heavy: false },
      { val: 'thick', style: 'solid', heavy: true },
      { val: 'double', style: 'double', heavy: false },
      { val: 'wave', style: 'wavy', heavy: false },
      { val: 'dotted', style: 'dotted', heavy: false },
      { val: 'dash', style: 'dashed', heavy: false },
    ];
    for (const entry of cases) {
      const run = runOf(
        `<w:p><w:r><w:rPr><w:u w:val="${entry.val}"/></w:rPr><w:t>${entry.val}</w:t></w:r></w:p>`
      );
      expect(run.style.textDecorationLine).toBe('underline');
      expect(run.style.textDecorationStyle).toBe(entry.style);
      if (entry.heavy) {
        expect(run.style.textDecorationThickness).toContain('0.12em');
        expect(run.style.textDecorationThickness).toContain('2px');
      } else {
        expect(Boolean(run.style.textDecorationThickness)).toBe(false);
      }
    }
  });

  test('wavy underline keeps its authored colour', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:u w:val="wave" w:color="FF0000"/></w:rPr><w:t>Wavy underline</w:t></w:r></w:p>'
    );
    expect(run.style.textDecorationStyle).toBe('wavy');
    expect(run.style.textDecorationColor.toLowerCase()).toBe('#ff0000');
  });

  test('mixed underline and strike use independent nested layers', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:u w:val="wave" w:color="C00000"/><w:strike/></w:rPr>' +
        '<w:t>mixed</w:t></w:r></w:p>'
    );
    expect(run.style.textDecorationLine).toBe('');
    expect(run.dataset.start).toBe('0');
    expect(run.dataset.end).toBe('5');
    const underline = run.querySelector<HTMLElement>('[data-docx-deco="underline"]')!;
    const strike = run.querySelector<HTMLElement>('[data-docx-deco="strike"]')!;
    expect(underline).not.toBeNull();
    expect(strike).not.toBeNull();
    expect(underline.style.textDecorationLine).toBe('underline');
    expect(underline.style.textDecorationStyle).toBe('wavy');
    expect(underline.style.textDecorationColor.toLowerCase()).toBe('#c00000');
    expect(strike.style.textDecorationLine).toBe('line-through');
    expect(
      strike.style.textDecorationStyle === '' || strike.style.textDecorationStyle === 'solid'
    ).toBe(true);
    expect(strike.style.textDecorationStyle).not.toBe('wavy');
    expect(strike.style.textDecorationColor).toBe('');
    expect(run.textContent).toBe('mixed');
    // Nested deco layers are not a second model-range surface.
    expect(underline.dataset.paragraphId).toBeUndefined();
    expect(strike.dataset.start).toBeUndefined();
  });

  test('double underline plus single strike does not double the strike', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:u w:val="double"/><w:strike/></w:rPr><w:t>x</w:t></w:r></w:p>'
    );
    const underline = run.querySelector<HTMLElement>('[data-docx-deco="underline"]')!;
    const strike = run.querySelector<HTMLElement>('[data-docx-deco="strike"]')!;
    expect(underline.style.textDecorationStyle).toBe('double');
    expect(strike.style.textDecorationStyle).not.toBe('double');
  });

  test('single underline plus double strike keeps strike double', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:u w:val="single"/><w:dstrike/></w:rPr><w:t>x</w:t></w:r></w:p>'
    );
    const underline = run.querySelector<HTMLElement>('[data-docx-deco="underline"]')!;
    const strike = run.querySelector<HTMLElement>('[data-docx-deco="strike"]')!;
    expect(underline.style.textDecorationStyle).toBe('solid');
    expect(strike.style.textDecorationStyle).toBe('double');
  });

  test('thick underline plus strike keeps heavy thickness on underline only', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:u w:val="thick"/><w:strike/></w:rPr><w:t>x</w:t></w:r></w:p>'
    );
    const underline = run.querySelector<HTMLElement>('[data-docx-deco="underline"]')!;
    const strike = run.querySelector<HTMLElement>('[data-docx-deco="strike"]')!;
    expect(underline.style.textDecorationThickness).toContain('0.12em');
    // Happy-dom leaves unset thickness as undefined rather than "".
    expect(Boolean(strike.style.textDecorationThickness)).toBe(false);
  });

  test('highlight and shading stay on the outer layout-run with nested decorations', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:u w:val="single"/><w:strike/>' +
        '<w:highlight w:val="yellow"/></w:rPr><w:t>hi</w:t></w:r></w:p>'
    );
    expect(run.dataset.highlight).toBe('yellow');
    expect(run.style.backgroundColor.toLowerCase()).toBe('#ffff00');
    expect(run.querySelector('[data-docx-deco="underline"]')).not.toBeNull();
    expect(run.dataset.start).toBe('0');
    expect(run.dataset.end).toBe('2');
  });

  test('a hostile underline colour is refused at the sink', () => {
    const run = runOf(
      '<w:p><w:r><w:rPr><w:u w:val="single" w:color="javascript:alert(1)"/></w:rPr>' +
        '<w:t>x</w:t></w:r></w:p>'
    );
    expect(run.style.textDecorationLine).toBe('underline');
    expect(run.style.textDecorationColor).toBe('');
    expect(run.style.backgroundImage).toBe('');
  });
});

describe('paragraph bottom borders paint from layout geometry', () => {
  test('empty bordered paragraph paints a rule at the published box', () => {
    const body =
      '<w:p><w:pPr><w:spacing w:before="100" w:after="120"/>' +
      '<w:pBdr><w:bottom w:val="single" w:sz="16" w:space="2" w:color="FF0000"/></w:pBdr>' +
      '</w:pPr></w:p>';
    const layout = layoutOf(body);
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind !== 'paragraph') return;
    expect(fragment.bottomBorder).toBeDefined();

    const container = paint(body);
    const rule = container.querySelector<HTMLElement>('.docx-paragraph-border-bottom')!;
    expect(rule).not.toBeNull();
    expect(rule.style.backgroundColor.toLowerCase()).toBe('#ff0000');
    // Geometry comes from the record, relative to the fragment — not from the DOM.
    expect(rule.style.height).toBe(`${fragment.bottomBorder!.box.height}px`);
    expect(Number.parseFloat(rule.style.top)).toBe(fragment.bottomBorder!.box.y - fragment.box.y);
    expect(rule.style.width).toBe(`${fragment.bottomBorder!.box.width}px`);
  });

  test('a hostile border colour is refused at the sink', () => {
    const container = paint(
      '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:color="javascript:alert(1)"/>' +
        '</w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
    );
    const rule = container.querySelector<HTMLElement>('.docx-paragraph-border-bottom');
    // Invalid colour falls back to black — never a javascript: or url() value.
    expect(rule?.style.backgroundColor.toLowerCase()).toBe('#000000');
    expect(rule?.style.backgroundImage).toBe('');
  });
});

describe('list marker paint', () => {
  const NUM = `
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
        <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="1"/>
      <w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;

  test('paints an inert marker outside model text ranges', () => {
    const layout = layoutOf(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>Item</w:t></w:r></w:p>',
      NUM
    );
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const marker = container.querySelector<HTMLElement>('[data-docx-marker]');
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toBe('•');
    expect(marker!.getAttribute('contenteditable')).toBe('false');
    expect(marker!.dataset.start).toBeUndefined();
    expect(marker!.dataset.paragraphId).toBeUndefined();
    const run = container.querySelector<HTMLElement>('.layout-run-text');
    expect(run?.textContent).toBe('Item');
    expect(run?.dataset.start).toBe('0');
  });
});
