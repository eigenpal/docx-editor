// Paragraph `ST_Border` style mapping: layout extent + painted appearance.
//
// Kept separate from `paragraph-borders.test.ts` (placement / grouping / PR #133 orphans)
// so style regressions do not collide with that worktree.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  computeDoubleBorderMetricsPt,
  paragraphBorderExtentPt,
  paragraphBorderStrokeWidthPt,
  paragraphBorders,
} from '../index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

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

const paragraph = (text: string, pPr: string) =>
  `<w:p><w:pPr>${pPr}</w:pPr>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;

function paragraphsOf(layout: ReturnType<typeof lay>): ParagraphFragmentRecord[] {
  const fragments: ParagraphFragmentRecord[] = [];
  for (const fragment of layout.pages[0]!.fragments) {
    if (fragment.kind === 'paragraph') fragments.push(fragment);
  }
  return fragments;
}

function painted(body: string): HTMLElement {
  const container = document.createElement('div');
  paintSemanticLayout(container, lay(body), { scale: 1 });
  return container;
}

function propertiesNodeOf(part: OoxmlPart, paragraphIndex = 0) {
  return part.root.children[0]!.children[paragraphIndex]!.children.find(
    (child) => child.kind === 'paragraphProperties'
  );
}

describe('paragraph ST_Border styles — layout geometry', () => {
  test('single uses authored w:sz; double inflates thin bands like table borders', () => {
    const single = paragraphBorders(
      propertiesNodeOf(
        load(paragraph('x', '<w:pBdr><w:top w:val="single" w:sz="3" w:space="8"/></w:pBdr>'))
      )
    ).top!;
    const dbl = paragraphBorders(
      propertiesNodeOf(
        load(paragraph('x', '<w:pBdr><w:top w:val="double" w:sz="3" w:space="8"/></w:pBdr>'))
      )
    ).top!;

    expect(single.widthPt).toBe(0.375);
    expect(paragraphBorderStrokeWidthPt(single)).toBe(0.375);
    expect(paragraphBorderExtentPt(single)).toBe(8.375);

    expect(dbl.widthPt).toBe(0.375);
    expect(paragraphBorderStrokeWidthPt(dbl)).toBe(computeDoubleBorderMetricsPt(0.375).extentPt);
    expect(paragraphBorderStrokeWidthPt(dbl)).toBe(3);
    expect(paragraphBorderExtentPt(dbl)).toBe(11);
  });

  test('fixture-shaped thin double top publishes a 3pt stroke box', () => {
    // Verbatim from comprehensive-word-element-test.docx end paragraph:
    // <w:top w:val="double" w:color="1B3A5C" w:sz="3" w:space="8"/>
    const body = paragraph(
      'END',
      '<w:pBdr><w:top w:val="double" w:color="1B3A5C" w:sz="3" w:space="8"/></w:pBdr>'
    );
    const fragment = paragraphsOf(lay(body))[0]!;
    const top = fragment.borders?.find((s) => s.side === 'top');
    expect(top).toBeDefined();
    expect(top!.edge.val).toBe('double');
    expect(top!.edge.color).toBe('1B3A5C');
    expect(top!.box.height).toBe(3);
  });

  test('a thick double splits the authored band into equal thirds without inflation', () => {
    const edge = paragraphBorders(
      propertiesNodeOf(
        load(paragraph('x', '<w:pBdr><w:bottom w:val="double" w:sz="24" w:space="2"/></w:pBdr>'))
      )
    ).bottom!;
    expect(edge.widthPt).toBe(3);
    expect(paragraphBorderStrokeWidthPt(edge)).toBe(3);
    expect(computeDoubleBorderMetricsPt(3)).toEqual({
      strokePt: 1,
      gapPt: 1,
      extentPt: 3,
      insetPt: 0,
    });
  });
});

describe('paragraph ST_Border styles — paint', () => {
  test('single stays a solid fill; double paints two borders inside the published box', () => {
    const singleBody = paragraph(
      's',
      '<w:pBdr><w:top w:val="single" w:sz="8" w:space="1" w:color="C00000"/></w:pBdr>'
    );
    const doubleBody = paragraph(
      'd',
      '<w:pBdr><w:top w:val="double" w:sz="3" w:space="8" w:color="1B3A5C"/></w:pBdr>'
    );

    const singleRule = painted(singleBody).querySelector<HTMLElement>(
      '.docx-paragraph-border-top'
    )!;
    expect(singleRule.style.backgroundColor.toLowerCase()).toBe('#c00000');
    expect(singleRule.style.borderTop).toBe('');
    expect(singleRule.style.borderBottom).toBe('');

    const doubleRule = painted(doubleBody).querySelector<HTMLElement>(
      '.docx-paragraph-border-top'
    )!;
    expect(doubleRule.style.height).toBe('3px');
    expect(doubleRule.style.backgroundColor).toBe('transparent');
    expect(doubleRule.style.borderTop).toBe('1px solid #1B3A5C');
    expect(doubleRule.style.borderBottom).toBe('1px solid #1B3A5C');
    expect(doubleRule.style.boxSizing).toBe('border-box');
  });

  test('dashed and dotted rules keep directional patterns', () => {
    const dashed = painted(
      paragraph('x', '<w:pBdr><w:bottom w:val="dashed" w:sz="8" w:space="2"/></w:pBdr>')
    ).querySelector<HTMLElement>('.docx-paragraph-border-bottom')!;
    expect(dashed.style.backgroundImage).toContain('to right');

    const dotted = painted(
      paragraph('x', '<w:pBdr><w:left w:val="dotted" w:sz="8" w:space="4"/></w:pBdr>')
    ).querySelector<HTMLElement>('.docx-paragraph-border-left')!;
    expect(dotted.style.backgroundImage).toContain('to bottom');
  });

  test('dashSmallGap and dotDash alias to the dashed pattern', () => {
    for (const val of ['dashSmallGap', 'dotDash'] as const) {
      const rule = painted(
        paragraph('x', `<w:pBdr><w:bottom w:val="${val}" w:sz="8"/></w:pBdr>`)
      ).querySelector<HTMLElement>('.docx-paragraph-border-bottom')!;
      expect(rule.style.backgroundImage).toContain('to right');
    }
  });

  test('threeDEmboss approximates as ridge; art borders stay solid', () => {
    const emboss = painted(
      paragraph('x', '<w:pBdr><w:top w:val="threeDEmboss" w:sz="16" w:color="808080"/></w:pBdr>')
    ).querySelector<HTMLElement>('.docx-paragraph-border-top')!;
    expect(emboss.style.borderTop).toContain('ridge');
    expect(emboss.style.backgroundColor).toBe('transparent');

    const art = painted(
      paragraph('x', '<w:pBdr><w:top w:val="apples" w:sz="8" w:color="00AA00"/></w:pBdr>')
    ).querySelector<HTMLElement>('.docx-paragraph-border-top')!;
    expect(art.style.backgroundColor.toLowerCase()).toBe('#00aa00');
    expect(art.style.borderTop).toBe('');
  });
});
