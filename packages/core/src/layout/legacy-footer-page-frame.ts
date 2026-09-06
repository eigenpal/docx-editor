import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { shiftParagraphFragment } from './note-fragment-geometry.ts';
import { allowlistedPageField } from './field-instruction.ts';
import { positionFixedFooterPageFrame } from './legacy-footer-fixed-frame.ts';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from './semantic-records.ts';

const isElement = (node: OoxmlNode): node is OoxmlElement => node.kind !== 'textValue';
const isW = (node: OoxmlNode, name: string): boolean =>
  isElement(node) && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
const attr = (node: OoxmlElement, name: string) =>
  node.attributes.find((item) => item.namespaceUri === WML_NAMESPACE_URI && item.localName === name)
    ?.value;
function elements(node: OoxmlElement): OoxmlElement[] {
  const children: readonly OoxmlNode[] = node.children;
  return children.filter(isElement);
}

function bounded(part: OoxmlPart): boolean {
  const stack = [{ node: part.root as OoxmlNode, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++visited > 512 || depth > 16) return false;
    if (node.kind === 'textValue') {
      if (node.value.length > 256) return false;
    } else {
      if (visited + stack.length + node.children.length > 512 || node.attributes.length > 32)
        return false;
      if (node.attributes.some((item) => item.value.length > 1024)) return false;
      for (const child of node.children) {
        if (
          child.kind === 'textValue' &&
          child.value.trim() &&
          !isW(node, 't') &&
          !isW(node, 'instrText')
        )
          return false;
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return true;
}

function text(node: OoxmlElement): string | null {
  let value = '';
  for (const child of node.children) {
    if (child.kind !== 'textValue') return null;
    value += child.value;
  }
  return value;
}

function containsOnlyPageField(paragraph: OoxmlElement): boolean {
  let state = 0;
  let instruction: string | null = null;
  for (const run of elements(paragraph)) {
    if (isW(run, 'pPr')) continue;
    if (!isW(run, 'r')) return false;
    for (const node of elements(run)) {
      if (isW(node, 'rPr')) continue;
      if (isW(node, 'fldChar') && node.children.length === 0) {
        const kind = attr(node, 'fldCharType');
        if (state === 0 && kind === 'begin') state = 1;
        else if (
          state === 1 &&
          kind === 'separate' &&
          instruction !== null &&
          allowlistedPageField(instruction) === 'PAGE'
        )
          state = 2;
        else if (state === 2 && kind === 'end') state = 3;
        else return false;
      } else if (isW(node, 'instrText') && state === 1) {
        // Word may split one instruction across runs (` PAGE ` + `\* MERGEFORMAT`); the
        // fixed-width lane and the field projection concatenate them, so this lane must too.
        const value = text(node);
        if (value === null) return false;
        instruction = (instruction ?? '') + value;
      } else if (isW(node, 't') && state === 2) {
        const value = text(node);
        if (value === null || !/^\d*$/.test(value)) return false;
      } else return false;
    }
  }
  return state === 3 && instruction !== null && allowlistedPageField(instruction) === 'PAGE';
}

function framePair(
  part: OoxmlPart
): { first: string; empty: string; y: number; decoration: string } | null {
  if (!isW(part.root, 'ftr') || !bounded(part)) return null;
  const paragraphs = elements(part.root);
  if (paragraphs.length !== 2 || paragraphs.some((node) => node.kind !== 'paragraph')) return null;
  const [first, empty] = paragraphs as [OoxmlElement, OoxmlElement];
  const props = elements(first).find((node) => isW(node, 'pPr'));
  const emptyProps = elements(empty).find((node) => isW(node, 'pPr'));
  if (!props || !emptyProps) return null;
  const properties = elements(props),
    anchorProperties = elements(emptyProps);
  if (
    properties.filter((node) => isW(node, 'framePr')).length !== 1 ||
    properties.filter((node) => isW(node, 'pStyle')).length !== 1 ||
    anchorProperties.filter((node) => isW(node, 'pStyle')).length !== 1
  )
    return null;
  if (
    properties.some(
      (node) => !['pStyle', 'framePr', 'jc', 'rPr'].some((name) => isW(node, name))
    ) ||
    anchorProperties.some((node) => !['pStyle', 'jc', 'rPr'].some((name) => isW(node, name)))
  )
    return null;
  const style = properties.find((node) => isW(node, 'pStyle'))!;
  const anchorStyle = anchorProperties.find((node) => isW(node, 'pStyle'))!;
  const frame = properties.find((node) => isW(node, 'framePr'))!;
  if (!attr(style, 'val') || attr(style, 'val') !== attr(anchorStyle, 'val')) return null;
  let decoration = '';
  for (const run of elements(empty)) {
    if (isW(run, 'pPr')) continue;
    if (!isW(run, 'r')) return null;
    for (const node of elements(run)) {
      if (isW(node, 'rPr')) continue;
      if (!isW(node, 't')) return null;
      const value = text(node);
      if (value === null) return null;
      decoration += value;
    }
  }
  // Preserve a centered middle-dot decoration as authored; do not merge or delete runs.
  if (decoration && !/^· {1,15}·$/.test(decoration)) return null;
  const allowed = new Set(['wrap', 'vAnchor', 'hAnchor', 'xAlign', 'y']);
  if (
    frame.children.length ||
    frame.attributes.some(
      (item) => item.namespaceUri !== WML_NAMESPACE_URI || !allowed.has(item.localName)
    )
  )
    return null;
  if (
    attr(frame, 'wrap') !== 'around' ||
    attr(frame, 'vAnchor') !== 'text' ||
    attr(frame, 'hAnchor') !== 'margin' ||
    attr(frame, 'xAlign') !== 'center'
  )
    return null;
  const y = attr(frame, 'y') ?? '0';
  if (!['0', '1'].includes(y) || !containsOnlyPageField(first)) return null;
  return { first: first.id, empty: empty.id, y: Number(y) / 20, decoration };
}

function simpleLine(fragment: BlockFragmentRecord): fragment is ParagraphFragmentRecord {
  return (
    fragment.kind === 'paragraph' &&
    fragment.lines.length === 1 &&
    !fragment.marker &&
    !fragment.borders?.length &&
    !fragment.shading &&
    !fragment.lines[0]!.drawings?.length &&
    fragment.spacing.before === 0 &&
    fragment.spacing.after === 0 &&
    Object.values(fragment.indent).every((value) => value === 0)
  );
}

/** Position the narrowly supported PAGE/empty-paragraph footer pair in derived geometry only. */
export function positionLegacyFooterPageFrame<
  T extends { blocks: BlockFragmentRecord[]; bottom: number },
>(
  part: OoxmlPart,
  flow: T,
  contentWidth: number,
  pageGeometry?: { readonly marginLeft: number; readonly pageWidth: number }
): T {
  const pair = framePair(part);
  if (!pair) return bounded(part) ? positionFixedFooterPageFrame(part, flow, pageGeometry) : flow;
  if (flow.blocks.length !== 2) return flow;
  const [first, empty] = flow.blocks;
  if (
    !first ||
    !empty ||
    !simpleLine(first) ||
    !simpleLine(empty) ||
    first.paragraphId !== pair.first ||
    empty.paragraphId !== pair.empty ||
    (pair.decoration
      ? empty.alignment !== 'center' ||
        empty.lines[0]!.spans.map((span) => span.text).join('') !== pair.decoration
      : empty.lines[0]!.spans.length > 0)
  )
    return flow;
  const framed = shiftParagraphFragment(first, pair.y - first.box.y);
  const anchor = shiftParagraphFragment(empty, -empty.box.y);
  const line = framed.lines[0]!;
  const left = line.spans[0]?.box.x ?? line.contentX;
  const last = line.spans.at(-1);
  const right = last ? last.box.x + last.box.width : left;
  const dx = (contentWidth - (right - left)) / 2 - left;
  // The frame is auto-sized, so its box is the ink it holds, not the story width. Hit testing
  // is containment-first, and a full-width box here would claim every click in the band and
  // leave the anchor paragraph (and its decoration) unreachable by mouse.
  const centered: ParagraphFragmentRecord = {
    ...framed,
    alignment: 'center',
    box: { ...framed.box, x: left + dx, width: right - left },
    lines: [
      {
        ...line,
        box: { ...line.box, x: left + dx, width: right - left },
        contentX: line.contentX + dx,
        spans: line.spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + dx } })),
      },
    ],
  };
  // Both canonical paragraph identities remain addressable, even though the empty
  // anchor occupies the same band. Never delete it or rewrite framePr to fake pagination.
  return {
    ...flow,
    blocks: [centered, anchor],
    bottom: Math.max(centered.box.y + centered.box.height, anchor.box.y + anchor.box.height),
  };
}
