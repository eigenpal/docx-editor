import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { matchAllowlistedPageField } from './field-instruction.ts';
import { shiftParagraphFragment } from './note-fragment-geometry.ts';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from './semantic-records.ts';

const MAX_PT = 31_680 / 20;
const isElement = (node: OoxmlNode): node is OoxmlElement => node.kind !== 'textValue';
const isW = (node: OoxmlNode, name: string): boolean =>
  isElement(node) && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
const elements = (node: OoxmlElement): OoxmlElement[] =>
  (node.children as readonly OoxmlNode[]).filter(isElement);
const attr = (node: OoxmlElement, name: string): string | undefined => {
  const matches = node.attributes.filter((item) => item.localName === name);
  return matches.length === 1 && matches[0]!.namespaceUri === WML_NAMESPACE_URI
    ? matches[0]!.value
    : undefined;
};
function one(node: OoxmlElement, name: string): OoxmlElement | undefined {
  const matches = elements(node).filter((child) => child.localName === name);
  return matches.length === 1 && isW(matches[0]!, name) ? matches[0] : undefined;
}
/**
 * A PAGE instruction the live page-field projection evaluates: bare `PAGE`, with the
 * `\* MERGEFORMAT` Word appends, or a `\#` numeric picture. It is the same allowlist
 * `hf-layout.ts` uses to compute the value, so the frame lanes never claim a field whose
 * result the page context will not refresh (`\* roman`, `\* Arabic` and every other switch
 * stay in ordinary flow with their cached text).
 */
export function isPageInstruction(instruction: string): boolean {
  return matchAllowlistedPageField(instruction)?.kind === 'PAGE';
}
function twips(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,5}$/.test(value)) return undefined;
  const pt = Number(value) / 20;
  return pt <= MAX_PT ? pt : undefined;
}

/** Bounded only-PAGE paragraphs; decoration is content, never a deduplication key. */
function pageText(paragraph: OoxmlElement, leadingTab: boolean): string | undefined {
  let state = 0,
    instruction = '',
    prefix = '',
    suffix = '',
    tabs = 0;
  for (const run of elements(paragraph)) {
    if (isW(run, 'pPr')) continue;
    if (!isW(run, 'r')) return undefined;
    for (const node of elements(run)) {
      if (isW(node, 'rPr')) continue;
      if (
        isW(node, 'tab') &&
        state === 0 &&
        !prefix &&
        !tabs &&
        leadingTab &&
        !node.children.length
      ) {
        tabs++;
        continue;
      }
      if (isW(node, 'fldChar') && !node.children.length) {
        const type = attr(node, 'fldCharType');
        if (state === 0 && type === 'begin') state = 1;
        else if (state === 1 && type === 'separate' && isPageInstruction(instruction)) state = 2;
        else if (state === 2 && type === 'end') state = 3;
        else return undefined;
        continue;
      }
      if (node.children.some(isElement)) return undefined;
      const value = node.children
        .map((child) => (child.kind === 'textValue' ? child.value : ''))
        .join('');
      if (isW(node, 'instrText') && state === 1) instruction += value;
      else if (isW(node, 't') && state === 0) prefix += value;
      else if (isW(node, 't') && state === 3) suffix += value;
      else if (!(isW(node, 't') && state === 2 && /^\d*$/.test(value))) return undefined;
    }
  }
  return state === 3 &&
    isPageInstruction(instruction) &&
    tabs === Number(leadingTab) &&
    ((!prefix && !suffix) || (prefix === '- ' && suffix === ' -'))
    ? prefix + suffix
    : undefined;
}

function simple(fragment: BlockFragmentRecord): fragment is ParagraphFragmentRecord {
  return (
    fragment.kind === 'paragraph' &&
    fragment.lines.length === 1 &&
    !fragment.marker &&
    !fragment.borders?.length &&
    !fragment.shading &&
    !fragment.lines[0]!.drawings?.length &&
    fragment.spacing.before === 0 &&
    fragment.spacing.after === 0 &&
    fragment.indent.left === 0 &&
    fragment.indent.firstLine === 0 &&
    fragment.indent.hanging === 0
  );
}

function emptyAnchor(paragraph: OoxmlElement, fragment: ParagraphFragmentRecord): boolean {
  return (
    fragment.lines[0]!.spans.length === 0 &&
    elements(paragraph).every(
      (node) =>
        isW(node, 'pPr') || (isW(node, 'r') && elements(node).every((child) => isW(child, 'rPr')))
    )
  );
}

function supportedProperties(fragment: ParagraphFragmentRecord, framed: boolean): boolean {
  const allowed = new Set([
    'pStyle',
    'tabs',
    'jc',
    'rPr',
    'ind',
    'spacing',
    'widowControl',
    'contextualSpacing',
    'snapToGrid',
    ...(framed ? ['framePr'] : []),
  ]);
  return (
    fragment.props.length <= 64 &&
    fragment.props.every((property) => allowed.has(property.localName)) &&
    fragment.props.filter((property) => property.localName === 'framePr').length === Number(framed)
  );
}

/**
 * Fixed-width, page-X/text-center footer frames. The caller bounds the entire source tree.
 * This lane preserves both fields, including text outside the frame's clipping rectangle.
 * It does not support multi-paragraph frames, arbitrary text wrapping or partial-line reflow.
 */
export function positionFixedFooterPageFrame<
  T extends { blocks: BlockFragmentRecord[]; bottom: number },
>(
  part: OoxmlPart,
  flow: T,
  geometry: { readonly marginLeft: number; readonly pageWidth: number } | undefined
): T {
  if (
    !geometry ||
    !isW(part.root, 'ftr') ||
    flow.blocks.length !== 2 ||
    !Number.isFinite(geometry.pageWidth) ||
    geometry.pageWidth <= 0 ||
    geometry.pageWidth > MAX_PT ||
    !Number.isFinite(geometry.marginLeft) ||
    geometry.marginLeft < 0 ||
    geometry.marginLeft > geometry.pageWidth
  )
    return flow;
  const paragraphs = elements(part.root);
  const [first, anchor] = flow.blocks;
  if (
    paragraphs.length !== 2 ||
    paragraphs.some((p) => p.kind !== 'paragraph') ||
    !first ||
    !anchor ||
    !simple(first) ||
    !simple(anchor) ||
    !supportedProperties(first, true) ||
    !supportedProperties(anchor, false) ||
    first.paragraphId !== paragraphs[0]!.id ||
    anchor.paragraphId !== paragraphs[1]!.id ||
    first.alignment !== 'left' ||
    first.indent.right !== 0 ||
    anchor.indent.right < 0 ||
    anchor.indent.right > MAX_PT
  )
    return flow;
  const firstProps = one(paragraphs[0]!, 'pPr'),
    anchorProps = one(paragraphs[1]!, 'pPr');
  if (
    !firstProps ||
    !anchorProps ||
    elements(firstProps).some(
      (p) => !['framePr', 'pStyle', 'tabs', 'jc', 'rPr'].some((name) => isW(p, name))
    ) ||
    elements(anchorProps).some((p) => !['pStyle', 'jc', 'ind', 'rPr'].some((name) => isW(p, name)))
  )
    return flow;
  const decoration = pageText(paragraphs[0]!, true);
  if (
    decoration === undefined ||
    (pageText(paragraphs[1]!, false) === undefined && !emptyAnchor(paragraphs[1]!, anchor))
  )
    return flow;
  const frame = one(firstProps, 'framePr');
  const allowed = new Set(['w', 'wrap', 'vAnchor', 'hAnchor', 'x', 'yAlign']);
  if (
    !frame ||
    frame.children.length ||
    frame.attributes.some(
      (a) => a.namespaceUri !== WML_NAMESPACE_URI || !allowed.has(a.localName)
    ) ||
    attr(frame, 'wrap') !== 'around' ||
    attr(frame, 'vAnchor') !== 'text' ||
    attr(frame, 'hAnchor') !== 'page' ||
    attr(frame, 'yAlign') !== 'center'
  )
    return flow;
  const width = twips(attr(frame, 'w')),
    x = twips(attr(frame, 'x'));
  if (width === undefined || width <= 0 || x === undefined || x + width > geometry.pageWidth)
    return flow;
  const line = first.lines[0]!;
  let left = Infinity,
    right = -Infinity;
  for (const span of line.spans) {
    if (span.box.width <= 0 || span.text === '\t' || span.text.trim() === '') continue;
    left = Math.min(left, span.box.x - first.box.x);
    right = Math.max(right, span.box.x + span.box.width - first.box.x);
  }
  // A tab can place the entire value past the frame (Word keeps the value but clips its ink).
  // If it instead straddles the edge, wrapping requires a frame-width text-flow pass; defer it.
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    left < 0 ||
    !(right <= width || left >= width)
  )
    return flow;
  const shiftedAnchor = shiftParagraphFragment(anchor, -anchor.box.y);
  const y = (anchor.box.height - first.box.height) / 2;
  if (y < 0) return flow;
  const shifted = shiftParagraphFragment(first, y - first.box.y);
  const dx = x - geometry.marginLeft - first.box.x;
  const clipped: ParagraphFragmentRecord = {
    ...shifted,
    clipToBox: true,
    box: { ...shifted.box, x: first.box.x + dx, width },
    lines: shifted.lines.map((item) => ({
      ...item,
      box: { ...item.box, x: item.box.x + dx },
      contentX: item.contentX + dx,
      spans: item.spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + dx } })),
    })),
  };
  return { ...flow, blocks: [clipped, shiftedAnchor], bottom: shiftedAnchor.box.height };
}
