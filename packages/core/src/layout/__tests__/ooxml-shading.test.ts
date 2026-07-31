// Shared OOXML shading fill resolution + paragraph/run publication.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  paragraphShading,
  resolveOoxmlShadingFill,
  resolveStrictHexFill,
} from '../ooxml-shading.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

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

  test('rejects nil val, auto fill, theme fills, and CSS/URL payloads', () => {
    expect(resolveOoxmlShadingFill({ val: 'nil', fill: 'F0F4F8' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ val: 'clear', fill: 'auto' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ themeFill: 'accent1', fill: 'F0F4F8' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ val: 'clear', fill: 'url(x)' })).toBeUndefined();
    expect(resolveOoxmlShadingFill({ val: 'clear', fill: 'javascript:alert(1)' })).toBeUndefined();
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

describe('layout publishes paragraph and run shading without affecting measurement', () => {
  test('fixture-equivalent pPr/rPr fills land on the fragment and span style', () => {
    const body =
      `<w:p>` +
      `<w:pPr><w:shd w:val="clear" w:fill="F0F4F8"/><w:ind w:left="720"/></w:pPr>` +
      `<w:r><w:rPr><w:shd w:val="clear" w:fill="FFEEAA"/></w:rPr><w:t>hi</w:t></w:r>` +
      `</w:p>`;
    const layout = layoutSemanticDocument(load(body), 1, { measurer });
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind !== 'paragraph') return;
    expect(fragment.shading).toBe('F0F4F8');
    // Indent-aware fragment width: left indent 36pt on a 468pt content box → 432pt.
    expect(fragment.box.x).toBe(36);
    expect(fragment.box.width).toBe(468 - 36);
    expect(fragment.lines[0]!.spans[0]!.style.shading).toBe('FFEEAA');
    // Shading must not change measured line height (fixed measurer stays 14).
    expect(fragment.lines[0]!.box.height).toBe(14);
  });

  test('hostile paragraph fill is dropped before the fragment record', () => {
    const layout = layoutSemanticDocument(
      load(
        `<w:p><w:pPr><w:shd w:val="clear" w:fill="url(evil)"/></w:pPr>` +
          `<w:r><w:t>x</w:t></w:r></w:p>`
      ),
      1,
      { measurer }
    );
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind !== 'paragraph') return;
    expect(fragment.shading).toBeUndefined();
  });

  test('run shading resolves and ignores theme fills', () => {
    expect(
      resolveRunStyle([{ localName: 'shd', attributes: { val: 'clear', fill: 'FFEEAA' } }])
        .shading
    ).toBe('FFEEAA');
    expect(
      resolveRunStyle([
        { localName: 'shd', attributes: { themeFill: 'accent1', fill: 'FFEEAA' } },
      ]).shading
    ).toBeNull();
  });
});
