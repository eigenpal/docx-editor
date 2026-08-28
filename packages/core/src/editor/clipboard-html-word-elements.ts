import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';

const WORD_PARAGRAPH_CLASSES: Readonly<Record<string, string>> = {
  Title: 'MsoTitle',
  Subtitle: 'MsoSubtitle',
  Caption: 'MsoCaption',
  Quote: 'MsoQuote',
};

export function wordParagraphClassOf(styleId: string | undefined): string | null {
  if (styleId === undefined) return null;
  if (/^Heading[7-9]$/.test(styleId)) return `Mso${styleId}`;
  return WORD_PARAGRAPH_CLASSES[styleId] ?? null;
}

/** Quote a file-supplied font name without removing Unicode letters. */
export function wordCssFontFamily(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 255) return null;
  let escaped = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code === 0 || code === 0x0a || code === 0x0d || code === 0x0c) {
      escaped += '\\a ';
    } else if (char === '\\' || char === '"') {
      escaped += `\\${char}`;
    } else if (code >= 0x20 && code !== 0x7f) {
      escaped += char;
    }
  }
  return escaped.length === 0 ? null : `"${escaped}"`;
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
