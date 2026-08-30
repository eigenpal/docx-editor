import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { escapeCssString } from '../store/package/sinks.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { HIGHLIGHT_COLOR_HEX } from '../output/semantic-paint.ts';

const WORD_PARAGRAPH_CLASSES: Readonly<Record<string, string>> = {
  Normal: 'MsoNormal',
  ListParagraph: 'MsoListParagraph',
  Title: 'MsoTitle',
  Subtitle: 'MsoSubtitle',
  Caption: 'MsoCaption',
  Quote: 'MsoQuote',
  IntenseQuote: 'MsoIntenseQuote',
  BodyText: 'MsoBodyText',
  FootnoteText: 'MsoFootnoteText',
};

/**
 * Class → style id, the read lane's inverse of the table above. `MsoNormal` is
 * omitted ON PURPOSE: stamping `pStyle Normal` on every plain Word paragraph would
 * cover each paragraph mark and force the structural paste path. Word also emits
 * `CxSp` (contextual-spacing) variants of `MsoListParagraph`, which the read lane
 * accepts as plain `ListParagraph`.
 */
export const WORD_CLASS_PARAGRAPH_STYLES: ReadonlyMap<string, string> = new Map([
  ...Object.entries(WORD_PARAGRAPH_CLASSES)
    .filter(([styleId]) => styleId !== 'Normal')
    .map(([styleId, className]): [string, string] => [className, styleId]),
  ['MsoListParagraphCxSpFirst', 'ListParagraph'],
  ['MsoListParagraphCxSpMiddle', 'ListParagraph'],
  ['MsoListParagraphCxSpLast', 'ListParagraph'],
]);

export function wordParagraphClassOf(styleId: string | undefined): string | null {
  if (styleId === undefined) return null;
  if (/^Heading[7-9]$/.test(styleId)) return `Mso${styleId}`;
  // The style id is file-derived: guard the record lookup against prototype keys.
  return Object.hasOwn(WORD_PARAGRAPH_CLASSES, styleId) ? WORD_PARAGRAPH_CLASSES[styleId]! : null;
}

/** ST_HighlightColor names to CSS colors — the painter's own table, so copied HTML
 *  shows exactly the highlight the editor paints. */
export const WORD_HIGHLIGHT_COLORS: Readonly<Record<string, string>> =
  Object.fromEntries(HIGHLIGHT_COLOR_HEX);

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

/** Quote a file-supplied font name without removing Unicode letters. Character
 *  escaping delegates to the engine's ONE designated CSS-string escaper, so a
 *  future hardening there covers this sink too; only the trim/length guards and
 *  the quoting stay local. */
export function wordCssFontFamily(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 255) return null;
  const escaped = escapeCssString(value);
  return escaped.replace(/\\[0-9a-f]{1,6} ?/g, '').length === 0 ? null : `"${escaped}"`;
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
  // Solid is the CSS default; emitting it would shadow the double-strike marker.
  const rules = style === 'solid' ? [] : [`text-decoration-style:${style}`];
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
  noteBody: WordNoteBodyContext | null,
  ordinalOf: (kind: 'footnote' | 'endnote', id: number) => number,
  hasDefinition: (kind: 'footnote' | 'endnote', id: number) => boolean
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
      ? rawId !== undefined && /^[1-9]\d{0,9}$/.test(rawId)
        ? Number.parseInt(rawId, 10)
        : undefined
      : noteBody?.id;
  if (id === undefined || !Number.isInteger(id) || id < 1) return '';
  if (bodyKind !== null && noteBody?.kind !== bodyKind) return '';
  // The store allocates ids up to int32 (striped collab ids); match its cap.
  if (id > 0x7fffffff) return '';
  // A reference whose definition the package does not carry (a note referenced only
  // from another note's body, or a dangling id) renders nothing: a dead anchor
  // would skew visible ordinals and point at a nonexistent note on paste.
  if (bodyKind === null && !hasDefinition(kind, id)) return '';
  const footnote = kind === 'footnote';
  const inNoteBody = bodyKind !== null;
  const className = footnote ? 'MsoFootnoteReference' : 'MsoEndnoteReference';
  const prefix = footnote ? 'ftn' : 'edn';
  const href = inNoteBody ? `#_${prefix}ref${id}` : `#_${prefix}${id}`;
  const name = inNoteBody ? `_${prefix}${id}` : `_${prefix}ref${id}`;
  // The visible text shows the note's DISPLAY ordinal (ids are arbitrary after
  // edits); the id stays in the machine-readable attributes for the definition pair.
  return (
    `<a style="mso-${footnote ? 'footnote' : 'endnote'}-id:${prefix}${id}" ` +
    `href="${href}" name="${name}"><span class="${className}">` +
    `<span style="mso-special-character:footnote">[${ordinalOf(kind, id)}]</span></span></a>`
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
