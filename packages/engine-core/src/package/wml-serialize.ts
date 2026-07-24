// WordprocessingML leaf serializers (document-engine task 2.10). Regenerate a single
// block's XML from the authored model. Attacker-derived text is XML-escaped. These are
// intentionally minimal (only the modeled run content); a caller that needs byte-faithful
// output uses verbatim preservation instead and only regenerates fully-captured blocks.

import { escapeXmlChecked } from './sinks.ts';
import { isRunPropertiesCapsule, isParagraphPropertiesCapsule, isParagraphAttrsCapsule } from './preservation-capsule.ts';
import { type Block, type ParagraphRecord, type ParagraphProps, type RunRecord, canonicalParagraphProps, canonicalRunProps, registerCoreBlockCapability, blockSerialize } from '../model/index.ts';

/** Escape run text: validate fail-closed, then escape a literal CR as &#xD;. An unescaped CR is
 *  legal XML but silently normalized to LF by every parser's line-ending rule, so it would not
 *  survive a round-trip; the numeric reference preserves it exactly. */
function escapeRunText(text: string): string {
  return escapeXmlChecked(text, 'run text').replace(/\r/g, '&#xD;');
}

function runXml(run: RunRecord): string {
  // An ownership-scoped w:rPr capsule (verbatim, full run properties) is re-spliced INSTEAD of
  // regenerating rPr. SECURITY: the capsule is interpolated verbatim, so it MUST be a lone balanced
  // w:rPr — validate at the sink so a forged capsule from ANY path (a direct setParagraphRuns DocOp,
  // a paste) can never break out of the tag / inject sibling OOXML. Fail closed on an invalid one.
  if (run.rPrCapsule) {
    if (!isRunPropertiesCapsule(run.rPrCapsule)) throw new Error('run rPr capsule is not a lone balanced w:rPr (rejected at serialize)');
    return `<w:r>${run.rPrCapsule}<w:t xml:space="preserve">${escapeRunText(run.text)}</w:t></w:r>`;
  }
  // Regenerate rPr from the modeled props in OOXML child order (w:rStyle before the toggles). Only
  // the round-trippable subset (styleId + bold/italic PRESENCE) can be regenerated symmetrically —
  // underline and explicit-false toggles do not reparse to the same value (the direct-run parser is
  // presence-based), so fail closed rather than silently drop them (applies to EVERY path, including
  // an edited preserved run, not only from-scratch).
  const props = canonicalRunProps(run.props);
  if (props?.underline !== undefined) throw new Error('run underline is not round-trippable via the presence-based parser (rejected at serialize)');
  if (props?.bold === false || props?.italic === false) throw new Error('explicit-false run toggle is not round-trippable (rejected at serialize)');
  const rStyle = props?.styleId ? `<w:rStyle w:val="${escapeXmlChecked(props.styleId, 'run styleId')}"/>` : '';
  const b = props?.bold ? '<w:b/>' : '';
  const i = props?.italic ? '<w:i/>' : '';
  const rPr = rStyle || b || i ? `<w:rPr>${rStyle}${b}${i}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeRunText(run.text)}</w:t></w:r>`;
}

/** Serialize modeled paragraph properties (w:pStyle / w:numPr) into a w:pPr. Used only when the
 *  paragraph carries no verbatim pPr capsule (a from-scratch or fully-modeled paragraph); a captured
 *  capsule always wins and is re-spliced verbatim instead. Props are canonicalized first so a
 *  degenerate value never emits (matching what the parser yields on reopen). */
function pPrFromProps(raw: ParagraphProps): string {
  const props = canonicalParagraphProps(raw);
  if (!props) return '';
  const pStyle = props.styleId ? `<w:pStyle w:val="${escapeXmlChecked(props.styleId, 'paragraph styleId')}"/>` : '';
  let numPr = '';
  if (props.numId !== undefined || props.ilvl !== undefined) {
    const ilvl = props.ilvl !== undefined ? `<w:ilvl w:val="${props.ilvl}"/>` : '';
    const numId = props.numId !== undefined ? `<w:numId w:val="${escapeXmlChecked(props.numId, 'numId')}"/>` : '';
    numPr = `<w:numPr>${ilvl}${numId}</w:numPr>`;
  }
  return pStyle || numPr ? `<w:pPr>${pStyle}${numPr}</w:pPr>` : '';
}

export function paragraphXml(p: ParagraphRecord): string {
  // SECURITY: the paragraph capsules are interpolated verbatim, so validate them at the sink — the
  // attrs capsule must be a well-formed attribute list (no tag breakout) and the pPr capsule a lone
  // balanced w:pPr — so a forged capsule from any path cannot inject sibling OOXML. Fail closed.
  if (p.pAttrsCapsule !== undefined && !isParagraphAttrsCapsule(p.pAttrsCapsule)) {
    throw new Error('paragraph attrs capsule is not a well-formed attribute list (rejected at serialize)');
  }
  if (p.pPrCapsule !== undefined && !isParagraphPropertiesCapsule(p.pPrCapsule)) {
    throw new Error('paragraph pPr capsule is not a lone balanced w:pPr (rejected at serialize)');
  }
  // A verbatim pPr capsule wins (re-spliced byte-exact); otherwise emit modeled props (w:pStyle /
  // w:numPr). Undefined capsule + no props => `<w:p>` + runs only.
  const pPr = p.pPrCapsule ?? (p.props ? pPrFromProps(p.props) : '');
  return `<w:p${p.pAttrsCapsule ?? ''}>${pPr}${p.runs.map(runXml).join('')}</w:p>`;
}

// Register the block-serialize capabilities (comprehensive 3.3). A paragraph regenerates from the
// coarse model; a TABLE or block-level SDT cannot be regenerated byte-faithfully (grid, borders,
// w14/w15 control payload would be lost), so its capability fails closed — the verbatim
// preservation range is the only byte-faithful source and is reused while unchanged.
registerCoreBlockCapability({ kind: 'paragraph', serialize: (block) => paragraphXml(block as ParagraphRecord) });
const failClosedSerialize = (what: string) => (): never => {
  throw new Error(`${what} regeneration is not implemented: byte-faithful output requires the verbatim preservation range`);
};
registerCoreBlockCapability({ kind: 'table', serialize: failClosedSerialize('table') });
registerCoreBlockCapability({ kind: 'sdt', serialize: failClosedSerialize('SDT') });

/** Regenerate one block's XML by dispatching to its registered serialize capability. */
export function blockXml(block: Block): string {
  return blockSerialize(block);
}
