import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';

const WORD_PARAGRAPH_CLASSES: Readonly<Record<string, string>> = {
  Normal: 'MsoNormal',
  ListParagraph: 'MsoListParagraph',
  Title: 'MsoTitle',
  Subtitle: 'MsoSubtitle',
  Caption: 'MsoCaption',
  Quote: 'MsoQuote',
  IntenseQuote: 'MsoIntenseQuote',
};

export function wordParagraphClassOf(styleId: string | undefined): string | null {
  if (styleId === undefined) return null;
  if (/^Heading[7-9]$/.test(styleId)) return `Mso${styleId}`;
  return WORD_PARAGRAPH_CLASSES[styleId] ?? null;
}

/** ST_HighlightColor names to CSS colors. */
export const WORD_HIGHLIGHT_COLORS: Readonly<Record<string, string>> = {
  yellow: 'yellow',
  green: 'green',
  cyan: 'cyan',
  magenta: 'magenta',
  blue: 'blue',
  red: 'red',
  darkBlue: 'darkblue',
  darkCyan: 'darkcyan',
  darkGreen: 'darkgreen',
  darkMagenta: 'darkmagenta',
  darkRed: 'darkred',
  darkYellow: '#808000',
  darkGray: '#a9a9a9',
  lightGray: '#d3d3d3',
  black: 'black',
  white: 'white',
};

/** `w:jc` values to CSS `text-align`. */
export const WORD_JC_TO_TEXT_ALIGN: Readonly<Record<string, string>> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  distribute: 'justify',
};

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

export function wordLineSpacingCss(
  line: number | null,
  rule: string | undefined
): readonly string[] {
  if (line === null || line <= 0) return [];
  if (rule === 'exact' || rule === 'atLeast') {
    const points = `${Math.round((line / 20) * 100) / 100}pt`;
    return [
      `line-height:${points}`,
      `mso-line-height-rule:${rule === 'exact' ? 'exactly' : 'at-least'}`,
    ];
  }
  return [`line-height:${Math.round((line / 240) * 100) / 100}`];
}

export function wordUnderlineCss(underline: OoxmlElement | null): readonly string[] {
  if (underline === null) return [];
  const value = attributeValueOf(underline, 'val', WML_NAMESPACE_URI);
  const style =
    value === 'double'
      ? 'double'
      : value === 'dotted'
        ? 'dotted'
        : value === 'dash'
          ? 'dashed'
          : value === 'wave'
            ? 'wavy'
            : 'solid';
  const rules = [`text-decoration-style:${style}`];
  const color = attributeValueOf(underline, 'color', WML_NAMESPACE_URI);
  if (color !== undefined && /^[0-9A-Fa-f]{6}$/.test(color)) {
    rules.push(`text-decoration-color:#${color.toLowerCase()}`);
  }
  if (value === 'thick') rules.push('text-decoration-thickness:2px');
  return rules;
}

export function wordTableRowCss(height: number | null, rule: string | undefined): string {
  if (height === null || height <= 0) return '';
  const points = Math.round((height / 20) * 100) / 100;
  return `height:${points}pt;mso-height-rule:${rule === 'exact' ? 'exactly' : 'at-least'}`;
}

export interface WordNoteBodyContext {
  readonly kind: 'footnote' | 'endnote';
  readonly id: number;
}

export function wordNoteReferenceHtml(
  node: OoxmlElement,
  noteBody: WordNoteBodyContext | null
): string {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return '';
  const bodyKind =
    node.localName === 'footnoteRef'
      ? 'footnote'
      : node.localName === 'endnoteRef'
        ? 'endnote'
        : null;
  const referenceKind =
    node.localName === 'footnoteReference'
      ? 'footnote'
      : node.localName === 'endnoteReference'
        ? 'endnote'
        : null;
  const kind = bodyKind ?? referenceKind;
  if (kind === null) return '';
  const rawId = attributeValueOf(node, 'id', WML_NAMESPACE_URI);
  const id =
    bodyKind === null
      ? rawId !== undefined && /^[1-9]\d{0,4}$/.test(rawId)
        ? Number.parseInt(rawId, 10)
        : undefined
      : noteBody?.id;
  if (id === undefined || !Number.isInteger(id) || id < 1) return '';
  if (bodyKind !== null && noteBody?.kind !== bodyKind) return '';
  if (id > 32_767) return '';
  const footnote = kind === 'footnote';
  const inNoteBody = bodyKind !== null;
  const className = footnote ? 'MsoFootnoteReference' : 'MsoEndnoteReference';
  const prefix = footnote ? 'ftn' : 'edn';
  const href = inNoteBody ? `#_${prefix}ref${id}` : `#_${prefix}${id}`;
  const name = inNoteBody ? `_${prefix}${id}` : `_${prefix}ref${id}`;
  return (
    `<a style="mso-${footnote ? 'footnote' : 'endnote'}-id:${prefix}${id}" ` +
    `href="${href}" name="${name}"><span class="${className}">` +
    `<span style="mso-special-character:footnote">[${id}]</span></span></a>`
  );
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
