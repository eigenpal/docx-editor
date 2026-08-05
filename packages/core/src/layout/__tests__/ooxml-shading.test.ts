// Shared OOXML shading fill resolution + paragraph/run publication.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  paragraphShading,
  paragraphShadingBox,
  resolveOoxmlShadingFill,
  resolveStrictHexFill,
} from '../ooxml-shading.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer });

describe('resolveStrictHexFill', () => {
  test('accepts exactly six hex digits and uppercases', () => {
    expect(resolveStrictHexFill('F0F4F8')).toBe('F0F4F8');
    expect(resolveStrictHexFill('ffeeaa')).toBe('FFEEAA');
  });

  test('rejects auto, nil, short hex, and hostile payloads', () => {
    expect(resolveStrictHexFill('auto')).toBeUndefined();
    expect(resolveStrictHexFill('nil')).toBeUndefined();
    expect(resolveStrictHexFill('FFF')).toBeUndefined();
    expect(resolveStrictHexFill('1234567')).toBeUndefined();
    expect(resolveStrictHexFill('url(//evil)')).toBeUndefined();
    expect(resolveStrictHexFill('expression(1)')).toBeUndefined();
    expect(resolveStrictHexFill('#F0F4F8')).toBeUndefined();
    expect(resolveStrictHexFill('red')).toBeUndefined();
    expect(resolveStrictHexFill(undefined)).toBeUndefined();
  });
});

describe('resolveOoxmlShadingFill', () => {
  test('fixture-equivalent clear fills resolve', () => {
    expect(resolveOoxmlShadingFill({ val: 'clear', fill: 'F0F4F8' })).toBe('F0F4F8');
    expect(resolveOoxmlShadingFill({ val: 'clear', fill: 'FFEEAA' })).toBe('FFEEAA');
  });

  test('rejects nil val, auto fill, and CSS/URL payloads', () => {
    expect(resolveOoxmlShadingFill({ val: 'nil', fill: 'F0F4F8' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ val: 'clear', fill: 'auto' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ val: 'clear', fill: 'url(x)' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ val: 'clear', fill: 'javascript:alert(1)' })).toBeUndefined();
  });

  test('a theme reference keeps the fill the producer resolved next to it', () => {
    // Word writes both: the reference AND the computed value. Reading `w:fill` here is
    // reading what the producer resolved, not inventing a colour from the theme.
    expect(resolveOoxmlShadingFill({ themeFill: 'accent1', fill: 'F0F4F8' })).toBe('F0F4F8');
    expect(
      resolveOoxmlShadingFill({
        val: 'clear',
        fill: 'D9E2F3',
        themeFill: 'accent1',
        themeFillTint: '33',
      })
    ).toBe('D9E2F3');
    // A reference with no usable value still resolves to nothing — no guessing.
    expect(resolveOoxmlShadingFill({ themeFill: 'accent1' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ themeFill: 'accent1', fill: 'auto' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ themeFill: 'accent1', fill: 'url(x)' })).toBeUndefined();
  });
});

describe('paragraphShading from cascaded flat props', () => {
  test('later shd wins', () => {
    expect(
      paragraphShading([
        { localName: 'shd', attributes: { val: 'clear', fill: '111111' } },
        { localName: 'shd', attributes: { val: 'clear', fill: 'F0F4F8' } },
      ])
    ).toBe('F0F4F8');
  });

  test('nil clears a prior fill', () => {
    expect(
      paragraphShading([
        { localName: 'shd', attributes: { val: 'clear', fill: 'F0F4F8' } },
        { localName: 'shd', attributes: { val: 'nil', fill: 'FFEEAA' } },
      ])
    ).toBeUndefined();
  });
});

describe('paragraphShadingBox is the line union only', () => {
  test('unions multi-line boxes and ignores empty input', () => {
    expect(
      paragraphShadingBox(
        [
          { box: { x: 10, y: 20, width: 100, height: 14 } },
          { box: { x: 10, y: 34, width: 80, height: 14 } },
        ],
        10,
        100
      )
    ).toEqual({ x: 10, y: 20, width: 100, height: 28 });
    expect(paragraphShadingBox([], 0, 100)).toBeUndefined();
  });
});

describe('layout publishes paragraph and run shading without affecting measurement', () => {
  test('fixture-equivalent pPr/rPr fills land on the fragment and span style', () => {
    const body =
      `<w:p>` +
      `<w:pPr><w:shd w:val="clear" w:fill="F0F4F8"/><w:ind w:left="720"/></w:pPr>` +
      `<w:r><w:rPr><w:shd w:val="clear" w:fill="FFEEAA"/></w:rPr><w:t>hi</w:t></w:r>` +
      `</w:p>`;
    const layout = lay(body);
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind !== 'paragraph') return;
    expect(fragment.shading).toBe('F0F4F8');
    // Indent-aware fragment width: left indent 36pt on a 468pt content box → 432pt.
    expect(fragment.box.x).toBe(36);
    expect(fragment.box.width).toBe(468 - 36);
    expect(fragment.shadingBox).toEqual({
      x: 36,
      y: fragment.lines[0]!.box.y,
      width: 432,
      height: 14,
    });
    expect(fragment.lines[0]!.spans[0]!.style.shading).toBe('FFEEAA');
    // Shading must not change measured line height (fixed measurer stays 14).
    expect(fragment.lines[0]!.box.height).toBe(14);
  });

  test('hostile paragraph fill is dropped before the fragment record', () => {
    const layout = lay(
      `<w:p><w:pPr><w:shd w:val="clear" w:fill="url(evil)"/></w:pPr>` +
        `<w:r><w:t>x</w:t></w:r></w:p>`
    );
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind !== 'paragraph') return;
    expect(fragment.shading).toBeUndefined();
    expect(fragment.shadingBox).toBeUndefined();
  });

  test('run shading resolves, including the value beside a theme reference', () => {
    expect(
      resolveRunStyle([{ localName: 'shd', attributes: { val: 'clear', fill: 'FFEEAA' } }]).shading
    ).toBe('FFEEAA');
    expect(
      resolveRunStyle([{ localName: 'shd', attributes: { themeFill: 'accent1', fill: 'FFEEAA' } }])
        .shading
    ).toBe('FFEEAA');
    expect(
      resolveRunStyle([{ localName: 'shd', attributes: { themeFill: 'accent1' } }]).shading
    ).toBeNull();
  });
});

describe('paragraph shading geometry excludes before/after spacing', () => {
  test('shaded paragraph with before/after keeps spacing on the fragment but not the band', () => {
    // Fixture-equivalent: after=120 twips (6pt). before=200 twips (10pt) on first page.
    const layout = lay(
      `<w:p>` +
        `<w:pPr><w:shd w:val="clear" w:fill="F0F4F8"/>` +
        `<w:spacing w:before="200" w:after="120"/></w:pPr>` +
        `<w:r><w:t>Paragraph-level shading. </w:t></w:r>` +
        `<w:r><w:rPr><w:shd w:val="clear" w:fill="FFEEAA"/></w:rPr>` +
        `<w:t xml:space="preserve">Character-level shading.</w:t></w:r>` +
        `</w:p>`
    );
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind !== 'paragraph') return;

    expect(fragment.spacing).toEqual({ before: 10, after: 6 });
    expect(fragment.box.height).toBe(10 + 14 + 6);
    expect(fragment.shading).toBe('F0F4F8');
    expect(fragment.shadingBox).toBeDefined();
    // Band matches the single line — Word Online parity with character shading height.
    expect(fragment.shadingBox).toEqual({
      x: fragment.box.x,
      y: fragment.lines[0]!.box.y,
      width: fragment.box.width,
      height: 14,
    });
    expect(fragment.shadingBox!.y - fragment.box.y).toBe(10);
    expect(
      fragment.box.y + fragment.box.height - (fragment.shadingBox!.y + fragment.shadingBox!.height)
    ).toBe(6);
    expect(
      fragment.lines[0]!.spans.some(
        (span) => span.style.shading === 'FFEEAA' && span.text.includes('Character-level')
      )
    ).toBe(true);
  });

  test('multi-line shaded paragraph unions line boxes without after spacing', () => {
    // Narrow page + spaced words so the breaker wraps; after still must not inflate the band.
    const layout = layoutSemanticDocument(
      load(
        `<w:p>` +
          `<w:pPr><w:shd w:val="clear" w:fill="F0F4F8"/>` +
          `<w:spacing w:after="240"/></w:pPr>` +
          `<w:r><w:t>${'word '.repeat(20).trim()}</w:t></w:r>` +
          `</w:p>`
      ),
      1,
      {
        measurer,
        geometry: {
          width: 120,
          height: 400,
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
        },
      }
    );
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind !== 'paragraph') return;
    expect(fragment.lines.length).toBeGreaterThan(1);
    const first = fragment.lines[0]!;
    const last = fragment.lines[fragment.lines.length - 1]!;
    const lineUnion = last.box.y + last.box.height - first.box.y;
    expect(fragment.shadingBox!.height).toBe(lineUnion);
    expect(fragment.shadingBox!.y).toBe(first.box.y);
    expect(fragment.box.height).toBe(lineUnion + 12); // after=240 twips → 12pt
    expect(fragment.box.height).toBeGreaterThan(fragment.shadingBox!.height);
  });

  test('empty shaded paragraph still publishes a one-line band', () => {
    const layout = lay(
      `<w:p><w:pPr><w:shd w:val="clear" w:fill="F0F4F8"/>` +
        `<w:spacing w:before="100" w:after="120"/></w:pPr></w:p>`
    );
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind !== 'paragraph') return;
    expect(fragment.lines).toHaveLength(1);
    expect(fragment.spacing.before).toBe(5);
    expect(fragment.spacing.after).toBe(6);
    expect(fragment.shadingBox).toEqual({
      x: fragment.box.x,
      y: fragment.lines[0]!.box.y,
      width: fragment.box.width,
      height: 14,
    });
    expect(fragment.box.height).toBe(5 + 14 + 6);
  });
});
