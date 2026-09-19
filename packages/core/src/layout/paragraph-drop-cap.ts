import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { breakPreparedParagraph } from './paragraph-break-request.ts';
import {
  readParagraphFrame,
  supportsParagraphFrameContent,
  type ParagraphFrame,
} from './paragraph-frame.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import type { LineRecord, ParagraphFragmentRecord, TextMeasurer } from './semantic-records.ts';
import type { ParagraphLayoutInputs, StyleCascadeTable } from './style-cascade.ts';

/** Resolve auto-width drop caps only when their authored size and line band are explicit. */
export function resolveParagraphFrame(
  paragraph: OoxmlElement,
  inputs: ParagraphLayoutInputs,
  measurer: TextMeasurer,
  styles: StyleCascadeTable | undefined
): ParagraphFrame | undefined {
  const ordinary = readParagraphFrame(inputs.props);
  if (ordinary) return supportsParagraphFrameContent(paragraph) ? ordinary : undefined;
  let attributes: OoxmlProperty['attributes'];
  for (const property of inputs.props)
    if (property.localName === 'framePr') attributes = property.attributes;
  if (
    !attributes ||
    attributes.dropCap !== 'drop' ||
    inputs.lineSpacing.rule !== 'exact' ||
    inputs.lineSpacing.value <= 0 ||
    inputs.lineSpacing.value > 1584 ||
    inputs.listItem ||
    inputs.spacing.before !== 0 ||
    inputs.spacing.after !== 0 ||
    inputs.shading !== undefined ||
    Object.values(inputs.borders).some(Boolean) ||
    inputs.alignment !== 'left' ||
    paragraphIsRtl(inputs.props)
  )
    return undefined;
  const count = Number(attributes.lines);
  if (
    !Number.isInteger(count) ||
    count < 2 ||
    count > 10 ||
    !supportsParagraphFrameContent(paragraph)
  )
    return undefined;
  // Anchored/explicit-width frames and margin drop caps need different admission geometry.
  if (
    Object.keys(attributes).some(
      (key) => !['dropCap', 'lines', 'wrap', 'hAnchor', 'vAnchor', 'hSpace'].includes(key)
    ) ||
    (attributes.wrap !== undefined && attributes.wrap !== 'around') ||
    (attributes.hAnchor !== undefined && attributes.hAnchor !== 'text') ||
    (attributes.vAnchor !== undefined && attributes.vAnchor !== 'text')
  )
    return undefined;
  // Refuse long/complex frame stories before shaping them as an auto-width cap.
  const nodes = [paragraph];
  let characters = 0;
  while (nodes.length) {
    for (const node of nodes.pop()!.children) {
      if (node.kind === 'textValue') characters += node.value.length;
      else nodes.push(node);
      if (characters > 32) return undefined;
    }
  }
  const lines = breakPreparedParagraph({
    paragraph,
    paragraphId: paragraph.id,
    indentLeft: inputs.indent.left,
    available: inputs.available,
    measurer,
    cache: undefined,
    cacheKey: null,
    formatting: inputs,
    producer: 'drop-cap-probe',
    styleCascade: styles,
    tabStops: inputs.tabStops,
    flow: { firstLineOffset: inputs.indent.firstLine - inputs.indent.hanging },
  });
  const line = lines[0];
  if (
    lines.length !== 1 ||
    !line ||
    line.spans.length === 0 ||
    line.spans.some(
      (span) =>
        span.equation ||
        span.projected ||
        span.style.baselineShiftPt !== line.spans[0]!.style.baselineShiftPt
    ) ||
    line.spans.reduce((sum, span) => sum + span.text.length, 0) > 32
  )
    return undefined;
  const width =
    Math.max(...line.spans.map((span) => span.box.x + span.box.width)) + inputs.indent.right;
  if (!(width > 0) || width >= inputs.available || width > 1584) return undefined;
  const frame = readParagraphFrame([
    {
      localName: 'framePr',
      attributes: {
        x: '0',
        y: '0',
        w: String(Math.ceil(width * 20)),
        hSpace: attributes.hSpace ?? '0',
      },
    },
  ]);
  return frame
    ? {
        ...frame,
        width: width + 0.001,
        dropCapLines: count,
        token: `drop-cap:${paragraph.id}:${frame.token}`,
      }
    : undefined;
}

/** The cap shares the baseline of the last occupied body line, independent of its font descent. */
export function alignDropCap(
  fragment: ParagraphFragmentRecord,
  count: number,
  anchorLines: readonly LineRecord[],
  anchorY: number
): { fragment: ParagraphFragmentRecord; height: number } {
  const first = fragment.lines[0];
  const anchor = anchorLines[0];
  if (!first || !anchor) return { fragment, height: fragment.box.height };
  const last = anchorLines[Math.min(count, anchorLines.length) - 1]!;
  const missing = Math.max(0, count - anchorLines.length) * last.box.height;
  const baseline = last.box.y + last.baseline + missing - anchorY;
  const height = last.box.y + last.box.height + missing - anchorY;
  // Export/paint subtract run position from the line baseline. The drop-cap frame owns
  // its baseline, so retain the style and compensate in the published line geometry.
  const shift = first.spans[0]?.style.baselineShiftPt ?? 0;
  const delta = baseline + shift - first.baseline - first.box.y;
  return {
    height,
    fragment: {
      ...fragment,
      box: { ...fragment.box, height },
      lines: fragment.lines.map((line) => ({
        ...line,
        baseline: line.baseline + delta,
        spans: line.spans.map((span) => ({ ...span, box: { ...span.box, y: span.box.y + delta } })),
      })),
    },
  };
}
