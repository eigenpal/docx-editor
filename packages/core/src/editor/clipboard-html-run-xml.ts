// Run and paragraph XML emitters for the external-HTML projection — split from
// clipboard-html-read.ts at the max-lines cap. Every file-derived value is escaped;
// enumerated properties interpolate only allowlisted tokens.

import { escapeXml, escapeXmlAttribute } from '../store/package/sinks.ts';
import { xmlSafeText } from './clipboard-html-xml.ts';
import type { HtmlParaProps, HtmlRunProps } from './clipboard-html-styles.ts';

/** `w:rPr`, children in CT_RPr sequence order. */
export function rPrXml(props: HtmlRunProps): string {
  let inner = '';
  if (props.font !== undefined) {
    const face = escapeXmlAttribute(xmlSafeText(props.font));
    inner += `<w:rFonts w:ascii="${face}" w:hAnsi="${face}"/>`;
  }
  if (props.bold) inner += '<w:b/>';
  if (props.italic) inner += '<w:i/>';
  if (props.caps) inner += '<w:caps/>';
  if (props.smallCaps) inner += '<w:smallCaps/>';
  if (props.doubleStrike) inner += '<w:dstrike/>';
  else if (props.strike) inner += '<w:strike/>';
  if (props.color !== undefined) inner += `<w:color w:val="${props.color}"/>`;
  if (props.charSpacingTwentieths !== undefined) {
    inner += `<w:spacing w:val="${props.charSpacingTwentieths}"/>`;
  }
  if (props.szHalfPoints !== undefined) inner += `<w:sz w:val="${props.szHalfPoints}"/>`;
  if (props.highlight !== undefined) {
    inner += `<w:highlight w:val="${escapeXmlAttribute(props.highlight)}"/>`;
  }
  if (props.underline) {
    inner += `<w:u w:val="${props.underlineVal ?? 'single'}"${
      props.underlineColor === undefined ? '' : ` w:color="${props.underlineColor}"`
    }/>`;
  }
  if (props.shdFill !== undefined) {
    inner += `<w:shd w:val="clear" w:color="auto" w:fill="${props.shdFill}"/>`;
  }
  if (props.vertAlign !== undefined) inner += `<w:vertAlign w:val="${props.vertAlign}"/>`;
  if (props.rtl) inner += '<w:rtl/>';
  if (props.lang !== undefined) inner += `<w:lang w:val="${escapeXmlAttribute(props.lang)}"/>`;
  return inner.length > 0 ? `<w:rPr>${inner}</w:rPr>` : '';
}

export function textRunXml(text: string, props: HtmlRunProps): string {
  return `<w:r>${rPrXml(props)}<w:t xml:space="preserve">${escapeXml(xmlSafeText(text))}</w:t></w:r>`;
}

/** `w:pPr`, children in CT_PPr sequence order. */
export function pPrXml(para: HtmlParaProps): string {
  let inner = '';
  if (para.styleId !== undefined) {
    inner += `<w:pStyle w:val="${escapeXmlAttribute(para.styleId)}"/>`;
  }
  if (para.keepNext) inner += '<w:keepNext/>';
  if (para.keepLines) inner += '<w:keepLines/>';
  if (para.pageBreakBefore) inner += '<w:pageBreakBefore/>';
  if (para.widowControl) inner += '<w:widowControl/>';
  if (para.numPr) {
    inner +=
      `<w:numPr><w:ilvl w:val="${para.numPr.ilvl}"/>` +
      `<w:numId w:val="${escapeXmlAttribute(para.numPr.numId)}"/></w:numPr>`;
  }
  if (para.borders !== undefined) {
    let borders = '';
    for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
      const border = para.borders[edge];
      if (border === undefined) continue;
      borders +=
        `<w:${edge} w:val="${border.val}" w:sz="${border.szEighthPoints}" ` +
        `w:space="0" w:color="${border.color}"/>`;
    }
    if (borders.length > 0) inner += `<w:pBdr>${borders}</w:pBdr>`;
  }
  if (para.shdFill !== undefined) {
    inner += `<w:shd w:val="clear" w:color="auto" w:fill="${para.shdFill}"/>`;
  }
  if (para.tabs !== undefined && para.tabs.length > 0) {
    inner += `<w:tabs>${para.tabs
      .map(
        (tab) =>
          `<w:tab w:val="${tab.val}" w:pos="${tab.posTwips}"` +
          (tab.leader === undefined ? '/>' : ` w:leader="${tab.leader}"/>`)
      )
      .join('')}</w:tabs>`;
  }
  if (para.bidi) inner += '<w:bidi/>';
  if (
    para.spacingBeforeTwips !== undefined ||
    para.spacingAfterTwips !== undefined ||
    para.lineTwentieths !== undefined
  ) {
    let spacing = '<w:spacing';
    if (para.spacingBeforeTwips !== undefined) {
      spacing += ` w:before="${para.spacingBeforeTwips}"`;
    }
    if (para.spacingAfterTwips !== undefined) {
      spacing += ` w:after="${para.spacingAfterTwips}"`;
    }
    if (para.lineTwentieths !== undefined) {
      spacing += ` w:line="${para.lineTwentieths}" w:lineRule="${para.lineRule ?? 'auto'}"`;
    }
    inner += `${spacing}/>`;
  }
  const first = para.firstLineTwips;
  if (para.indLeftTwips !== undefined || para.indRightTwips !== undefined || first !== undefined) {
    let ind = '<w:ind';
    if (para.indLeftTwips !== undefined) ind += ` w:left="${para.indLeftTwips}"`;
    if (para.indRightTwips !== undefined) ind += ` w:right="${para.indRightTwips}"`;
    if (first !== undefined) {
      ind += first >= 0 ? ` w:firstLine="${first}"` : ` w:hanging="${-first}"`;
    }
    inner += `${ind}/>`;
  }
  if (para.jc !== undefined) inner += `<w:jc w:val="${para.jc}"/>`;
  return inner.length > 0 ? `<w:pPr>${inner}</w:pPr>` : '';
}

export function paragraphXml(para: HtmlParaProps, runs: readonly string[]): string {
  return `<w:p>${pPrXml(para)}${runs.join('')}</w:p>`;
}

/** Heading direct formatting: bold plus these sizes in half-points (h1=32pt … h6=14pt). */
export const HEADING_SZ: Record<string, number> = {
  h1: 64,
  h2: 52,
  h3: 44,
  h4: 36,
  h5: 32,
  h6: 28,
};

/** Append a page break: fold it into the previous paragraph when one exists. */
export function appendPageBreak(out: string[]): void {
  const last = out[out.length - 1];
  if (last?.endsWith('</w:p>')) {
    out[out.length - 1] = `${last.slice(0, -6)}<w:r><w:br w:type="page"/></w:r></w:p>`;
    return;
  }
  out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
}
