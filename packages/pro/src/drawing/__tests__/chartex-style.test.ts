/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The chartex look, with the rules measured against reference renderings: text takes the run
// properties at the end of a `cx:txPr` paragraph, not its default run; the chart space's
// `cx:txPr` cannot change the text size; a point's shape properties layer over its series'.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { ChartexLook, namesTextColor } from '../chartex-style.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';

function element(xml: string): OoxmlElement {
  const parsed = readOoxmlPart(xml, { name: '/test', contentType: 'application/xml' });
  if (!parsed.ok) throw new Error('bad test markup');
  return parsed.part.root;
}

/** A `cx:txPr` with a default run `def` and an end run `end` (attributes and children). */
function txPr(def: string, end: string): OoxmlElement {
  return element(
    `<cx:txPr xmlns:cx="${CX}" xmlns:a="${A}"><a:bodyPr/><a:lstStyle/>` +
      `<a:p><a:pPr><a:defRPr ${def}/></a:pPr><a:endParaRPr lang="en-US" ${end}/></a:p></cx:txPr>`
  );
}

function spPr(inner: string): OoxmlElement {
  return element(`<cx:spPr xmlns:cx="${CX}" xmlns:a="${A}">${inner}</cx:spPr>`);
}

const noParts = { style: null, colors: null };

describe('text', () => {
  test('the end run sets the text; the default run alone does not', () => {
    const look = new ChartexLook(noParts, null);
    expect(look.text('categoryAxis', txPr('sz="1200"', '')).sizePt).toBe(9);
    expect(look.text('categoryAxis', txPr('sz="600"', 'sz="1200"')).sizePt).toBe(12);
    expect(look.text('categoryAxis', txPr('', 'sz="1100"')).sizePt).toBe(11);
  });

  test('the chart space text properties cannot change the size', () => {
    expect(new ChartexLook(noParts, txPr('sz="1400"', 'sz="1400"')).text('valueAxis').sizePt).toBe(
      9
    );
    expect(new ChartexLook(noParts, txPr('sz="600"', '')).text('dataLabel').sizePt).toBe(9);
  });

  test('a colour counts as the labels own only on the end run', () => {
    const fill = '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>';
    const onEnd = element(
      `<cx:txPr xmlns:cx="${CX}" xmlns:a="${A}"><a:bodyPr/><a:p><a:pPr/>` +
        `<a:endParaRPr lang="en-US">${fill}</a:endParaRPr></a:p></cx:txPr>`
    );
    const onDefault = element(
      `<cx:txPr xmlns:cx="${CX}" xmlns:a="${A}"><a:bodyPr/><a:p><a:pPr><a:defRPr>${fill}</a:defRPr>` +
        '</a:pPr><a:endParaRPr lang="en-US"/></a:p></cx:txPr>'
    );
    expect(namesTextColor(onEnd)).toBe(true);
    expect(namesTextColor(onDefault)).toBe(false);
    expect(namesTextColor(null)).toBe(false);
  });
});

describe('points', () => {
  const look = new ChartexLook(noParts, null);
  const color = { hex: '4472C4', alpha: 1 };

  test('a point fill keeps the series outline', () => {
    const series = spPr(
      '<a:ln w="28575"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:ln>'
    );
    const point = spPr('<a:solidFill><a:srgbClr val="FFC000"/></a:solidFill>');
    const shape = look.point('dataPoint', series, point, color);
    expect(shape.fill?.hex).toBe('FFC000');
    expect(shape.line?.hex).toBe('C00000');
    expect(shape.line?.widthPt).toBeCloseTo(2.25, 6);
  });

  test('without point properties the series and then the style entry apply', () => {
    expect(look.point('dataPoint', null, null, color).fill?.hex).toBe('4472C4');
    const series = spPr('<a:solidFill><a:srgbClr val="70AD47"/></a:solidFill>');
    expect(look.point('dataPoint', series, null, color).fill?.hex).toBe('70AD47');
  });
});
