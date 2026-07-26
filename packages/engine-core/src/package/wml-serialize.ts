// WordprocessingML leaf serializers (document-engine task 2.10). Regenerate a single
// block's XML from the authored model. Attacker-derived text is XML-escaped. These are
// intentionally minimal (only the modeled run content); a caller that needs byte-faithful
// output uses verbatim preservation instead and only regenerates fully-captured blocks.

import { escapeXmlChecked } from './sinks.ts';
import {
  isRunPropertiesCapsule,
  isParagraphPropertiesCapsule,
  isParagraphAttrsCapsule,
} from './preservation-capsule.ts';
import { readXml, childElements } from './xml-reader.ts';
import { parseRPr } from './wml-parse.ts';
import { canonicalize } from '../comparators/index.ts';
import {
  type Block,
  type ParagraphRecord,
  type ParagraphProps,
  type RunRecord,
  canonicalParagraphProps,
  canonicalRunProps,
  registerCoreBlockCapability,
  blockSerialize,
  type RunProps,
} from '../model/index.ts';

/** Escape run text: validate fail-closed, then escape a literal CR as &#xD;. An unescaped CR is
 *  legal XML but silently normalized to LF by every parser's line-ending rule, so it would not
 *  survive a round-trip; the numeric reference preserves it exactly. */
function escapeRunText(text: string): string {
  return escapeXmlChecked(text, 'run text').replace(/\r/g, '&#xD;');
}

/** Serialize the modeled CT_RPr subset in schema order. Theme attributes use
 * OOXML's exact lexical names, including lowercase `w:cstheme`. */
export function runPropsChildrenXml(props: RunProps, includeStyle = true): string {
  const p = canonicalRunProps(props);
  if (!p) return '';
  const style =
    includeStyle && p.styleId
      ? `<w:rStyle w:val="${escapeXmlChecked(p.styleId, 'run styleId')}"/>`
      : '';
  const fonts = p.fonts
    ? [
        ['ascii', 'ascii'],
        ['hAnsi', 'hAnsi'],
        ['eastAsia', 'eastAsia'],
        ['cs', 'cs'],
        ['asciiTheme', 'asciiTheme'],
        ['hAnsiTheme', 'hAnsiTheme'],
        ['eastAsiaTheme', 'eastAsiaTheme'],
        ['csTheme', 'cstheme'],
      ]
        .flatMap(([key, attribute]) => {
          const value = p.fonts?.[key as keyof NonNullable<RunProps['fonts']>];
          return value === undefined
            ? []
            : [` w:${attribute}="${escapeXmlChecked(value, `run font ${key}`)}"`];
        })
        .join('')
    : '';
  const rFonts = fonts ? `<w:rFonts${fonts}/>` : '';
  const bold = p.bold !== undefined ? (p.bold ? '<w:b/>' : '<w:b w:val="0"/>') : '';
  const italic = p.italic !== undefined ? (p.italic ? '<w:i/>' : '<w:i w:val="0"/>') : '';
  const color =
    p.color !== undefined ? `<w:color w:val="${escapeXmlChecked(p.color, 'run color')}"/>` : '';
  const size = p.sizeHalfPoints !== undefined ? `<w:sz w:val="${p.sizeHalfPoints}"/>` : '';
  const underline =
    p.underline !== undefined
      ? p.underline
        ? '<w:u w:val="single"/>'
        : '<w:u w:val="none"/>'
      : '';
  return `${style}${rFonts}${bold}${italic}${color}${size}${underline}`;
}

function capsuleModeledProps(capsule: string): RunProps | undefined {
  const parsed = readXml(capsule);
  if (!parsed.ok) return undefined;
  const rPr = parsed.nodes.find(
    (node): node is Extract<(typeof parsed.nodes)[number], { type: 'element' }> =>
      node.type === 'element' && node.name === 'w:rPr'
  );
  if (!rPr) return undefined;
  const props: RunProps = { ...parseRPr(rPr) };
  const styleId = childElements(rPr, 'w:rStyle')[0]?.attributes['w:val'];
  return canonicalRunProps(styleId ? { ...props, styleId } : props);
}

function runXml(run: RunRecord): string {
  // An ownership-scoped w:rPr capsule (verbatim, full run properties) is re-spliced INSTEAD of
  // regenerating rPr. SECURITY: the capsule is interpolated verbatim, so it MUST be a lone balanced
  // w:rPr — validate at the sink so a forged capsule from ANY path (a direct setParagraphRuns DocOp,
  // a paste) can never break out of the tag / inject sibling OOXML. Fail closed on an invalid one.
  if (run.rPrCapsule) {
    if (!isRunPropertiesCapsule(run.rPrCapsule))
      throw new Error('run rPr capsule is not a lone balanced w:rPr (rejected at serialize)');
    if (
      canonicalize(capsuleModeledProps(run.rPrCapsule) ?? null) !==
      canonicalize(canonicalRunProps(run.props) ?? null)
    )
      throw new Error(
        'run rPr capsule does not match semantic formatting; remove the capsule to own and regenerate formatting'
      );
    return `<w:r>${run.rPrCapsule}<w:t xml:space="preserve">${escapeRunText(run.text)}</w:t></w:r>`;
  }
  const children = run.props ? runPropsChildrenXml(run.props) : '';
  const rPr = children ? `<w:rPr>${children}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeRunText(run.text)}</w:t></w:r>`;
}

/** Serialize modeled paragraph properties (w:pStyle / w:numPr) into a w:pPr. Used only when the
 *  paragraph carries no verbatim pPr capsule (a from-scratch or fully-modeled paragraph); a captured
 *  capsule always wins and is re-spliced verbatim instead. Props are canonicalized first so a
 *  degenerate value never emits (matching what the parser yields on reopen). */
function pPrFromProps(raw: ParagraphProps): string {
  const props = canonicalParagraphProps(raw);
  if (!props) return '';
  const pStyle = props.styleId
    ? `<w:pStyle w:val="${escapeXmlChecked(props.styleId, 'paragraph styleId')}"/>`
    : '';
  let numPr = '';
  if (props.numId !== undefined || props.ilvl !== undefined) {
    const ilvl = props.ilvl !== undefined ? `<w:ilvl w:val="${props.ilvl}"/>` : '';
    const numId =
      props.numId !== undefined
        ? `<w:numId w:val="${escapeXmlChecked(props.numId, 'numId')}"/>`
        : '';
    numPr = `<w:numPr>${ilvl}${numId}</w:numPr>`;
  }
  return pStyle || numPr ? `<w:pPr>${pStyle}${numPr}</w:pPr>` : '';
}

export function paragraphXml(p: ParagraphRecord): string {
  // An empty-string capsule is a no-op splice, treated as ABSENT so it never suppresses modeled props
  // (a `??` on '' would keep the empty string and drop the props).
  const attrsCapsule = p.pAttrsCapsule ? p.pAttrsCapsule : undefined;
  const pPrCapsule = p.pPrCapsule ? p.pPrCapsule : undefined;
  // SECURITY: the paragraph capsules are interpolated verbatim, so validate them at the sink — the
  // attrs capsule must be a well-formed attribute list (no tag breakout) and the pPr capsule a lone
  // balanced w:pPr — so a forged capsule from any path cannot inject sibling OOXML. Fail closed.
  if (attrsCapsule !== undefined && !isParagraphAttrsCapsule(attrsCapsule)) {
    throw new Error(
      'paragraph attrs capsule is not a well-formed attribute list (rejected at serialize)'
    );
  }
  if (pPrCapsule !== undefined && !isParagraphPropertiesCapsule(pPrCapsule)) {
    throw new Error('paragraph pPr capsule is not a lone balanced w:pPr (rejected at serialize)');
  }
  // A verbatim pPr capsule wins (re-spliced byte-exact); otherwise emit modeled props (w:pStyle /
  // w:numPr). Undefined capsule + no props => `<w:p>` + runs only.
  const pPr = pPrCapsule ?? (p.props ? pPrFromProps(p.props) : '');
  return `<w:p${attrsCapsule ?? ''}>${pPr}${p.runs.map(runXml).join('')}</w:p>`;
}

// Register the block-serialize capabilities (comprehensive 3.3). A paragraph regenerates from the
// coarse model; a TABLE or block-level SDT cannot be regenerated byte-faithfully (grid, borders,
// w14/w15 control payload would be lost), so its capability fails closed — the verbatim
// preservation range is the only byte-faithful source and is reused while unchanged.
registerCoreBlockCapability({
  kind: 'paragraph',
  serialize: (block) => paragraphXml(block as ParagraphRecord),
});
const failClosedSerialize = (what: string) => (): never => {
  throw new Error(
    `${what} regeneration is not implemented: byte-faithful output requires the verbatim preservation range`
  );
};
registerCoreBlockCapability({ kind: 'table', serialize: failClosedSerialize('table') });
registerCoreBlockCapability({ kind: 'sdt', serialize: failClosedSerialize('SDT') });

/** Regenerate one block's XML by dispatching to its registered serialize capability. */
export function blockXml(block: Block): string {
  return blockSerialize(block);
}
