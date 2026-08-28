import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';

const WORD_PARAGRAPH_CLASSES: Readonly<Record<string, string>> = {
  Title: 'MsoTitle',
  Subtitle: 'MsoSubtitle',
  Caption: 'MsoCaption',
  Quote: 'MsoQuote',
};

export function wordParagraphClassOf(styleId: string | undefined): string | null {
  return styleId === undefined ? null : (WORD_PARAGRAPH_CLASSES[styleId] ?? null);
}

export function wordBorderCss(edge: OoxmlElement | null): string | null {
  if (edge === null) return null;
  const val = attributeValueOf(edge, 'val', WML_NAMESPACE_URI);
  if (val === undefined || val === 'nil' || val === 'none') return null;
  const style =
    val === 'double'
      ? 'double'
      : val === 'dotted'
        ? 'dotted'
        : val === 'dashed'
          ? 'dashed'
          : 'solid';
  const rawSize = attributeValueOf(edge, 'sz', WML_NAMESPACE_URI);
  const size =
    rawSize !== undefined && /^\d{1,4}$/.test(rawSize) ? Number.parseInt(rawSize, 10) : 0;
  const width = size > 0 ? `${Math.round((size / 8) * 100) / 100}pt` : '1pt';
  const rawColor = attributeValueOf(edge, 'color', WML_NAMESPACE_URI);
  const color =
    rawColor !== undefined && /^[0-9A-Fa-f]{6}$/.test(rawColor) ? `#${rawColor}` : '#000000';
  return `${width} ${style} ${color.toLowerCase()}`;
}

/** Map a closed-enumeration OOXML positional tab to Word clipboard HTML. */
export function wordPositionalTabHtml(node: OoxmlElement): string {
  if (node.namespaceUri !== WML_NAMESPACE_URI || node.localName !== 'ptab') return '';
  const alignment = attributeValueOf(node, 'alignment', WML_NAMESPACE_URI);
  const relativeTo = attributeValueOf(node, 'relativeTo', WML_NAMESPACE_URI);
  const leader = attributeValueOf(node, 'leader', WML_NAMESPACE_URI);
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') return '';
  if (relativeTo !== 'margin' && relativeTo !== 'indent') return '';
  if (
    leader !== 'none' &&
    leader !== 'dot' &&
    leader !== 'hyphen' &&
    leader !== 'underscore' &&
    leader !== 'middleDot'
  ) {
    return '';
  }
  return (
    `<w:PTab Alignment="${alignment.toUpperCase()}" ` +
    `RelativeTo="${relativeTo.toUpperCase()}" Leader="${leader.toUpperCase()}"></w:PTab>`
  );
}
