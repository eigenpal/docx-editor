// Property-container rewrites (tree-ops seam).
//
// `w:pPr` and `w:rPr` are the two containers an op rebuilds from a FLAT `OoxmlProperty[]`,
// and that projection cannot express everything they hold: children carry structure in
// their own children (`w:numPr`, `w:tabs`, `w:pBdr`), and both containers legitimately hold
// elements OUTSIDE the authorable D8 boundary — `w:rStyle`, `w:lang`, `w:sectPr`, the
// paragraph mark, a tracked-change record. This module owns the merge that keeps them:
// an op states the properties it names, and everything it cannot name survives untouched.

import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  type OoxmlProperty,
} from './tree-op-types.ts';

/**
 * `CT_PPr`'s child sequence (ECMA-376 17.3.1.26). A `w:pPr` whose children are out of this
 * order is not merely untidy — Word reports the file as unreadable — and the flat property
 * list an op carries has no order of its own, so the merge imposes this one.
 */
const CT_PPR_SEQUENCE: readonly string[] = [
  'pStyle',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'framePr',
  'widowControl',
  'numPr',
  'suppressLineNumbers',
  'pBdr',
  'shd',
  'tabs',
  'suppressAutoHyphens',
  'kinsoku',
  'wordWrap',
  'overflowPunct',
  'topLinePunct',
  'autoSpaceDE',
  'autoSpaceDN',
  'bidi',
  'adjustRightInd',
  'snapToGrid',
  'spacing',
  'ind',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  'jc',
  'textDirection',
  'textAlignment',
  'textboxTightWrap',
  'outlineLvl',
  'divId',
  'cnfStyle',
  'rPr',
  'sectPr',
  'pPrChange',
];

/**
 * `CT_RPr` (17.3.2.28), with `CT_ParaRPr`'s leading revision marks in front so the paragraph
 * mark's own run properties order by the same table.
 */
const CT_RPR_SEQUENCE: readonly string[] = [
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'snapToGrid',
  'vanish',
  'webHidden',
  'color',
  'spacing',
  'w',
  'kern',
  'position',
  'sz',
  'szCs',
  'highlight',
  'u',
  'effect',
  'bdr',
  'shd',
  'fitText',
  'vertAlign',
  'rtl',
  'cs',
  'em',
  'lang',
  'eastAsianLayout',
  'specVanish',
  'oMath',
  'rPrChange',
];

/** What one container's merge is allowed to author, and the order it must emit. */
export interface PropertyVocabulary {
  readonly authorable: ReadonlySet<string>;
  readonly sequence: readonly string[];
}

export const PARAGRAPH_VOCABULARY: PropertyVocabulary = {
  authorable: new Set(ACCEPTED_PARAGRAPH_PROPERTIES),
  sequence: CT_PPR_SEQUENCE,
};

export const RUN_VOCABULARY: PropertyVocabulary = {
  authorable: new Set(ACCEPTED_RUN_PROPERTIES),
  sequence: CT_RPR_SEQUENCE,
};

/**
 * Build one property container child from a flat property, KEEPING the structure of the node
 * it replaces.
 *
 * `OoxmlProperty` is flat — a name and attributes — but several children carry their meaning
 * in CHILDREN: `w:numPr` holds `w:ilvl`/`w:numId`, `w:tabs` holds `w:tab`, `w:pBdr` holds its
 * edges. Rebuilding those from the flat projection alone emitted an empty element, so
 * centring a list paragraph silently deleted its numbering and the bullet vanished. When the
 * incoming property matches what is already there, the existing node is reused verbatim;
 * when its attributes changed, the children still come across.
 */
export function propertyElement(property: OoxmlProperty, id: string, prior?: OoxmlNode): OoxmlNode {
  const attributes = Object.entries(property.attributes ?? {}).map(([localName, value]) => ({
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  }));
  const priorElement = prior && prior.kind !== 'textValue' ? prior : undefined;
  if (priorElement && sameAttributes(priorElement, attributes)) return prior!;
  return {
    id,
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: property.localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children: priorElement?.children ?? [],
  } as unknown as OoxmlNode;
}

function sameAttributes(
  node: Exclude<OoxmlNode, { kind: 'textValue' }>,
  attributes: readonly { readonly localName: string; readonly value: string }[]
): boolean {
  const existing = node.attributes ?? [];
  if (existing.length !== attributes.length) return false;
  for (const attribute of attributes) {
    const match = existing.find((entry) => entry.localName === attribute.localName);
    if (!match || match.value !== attribute.value) return false;
  }
  return true;
}

/** Position in the container's declared sequence; an unmodelled name sorts last. */
function rankOf(sequence: readonly string[], node: OoxmlNode): number {
  if (node.kind === 'textValue') return sequence.length;
  const index = sequence.indexOf(node.localName);
  return index === -1 ? sequence.length : index;
}

/**
 * The children a rewritten `w:pPr` / `w:rPr` gets: the op's properties, merged over what the
 * container already held.
 *
 * A property the op NAMES is rewritten (or dropped, when the op no longer names it) — that
 * is what the op is for. A child the op vocabulary cannot express is kept exactly as
 * authored, because an op that cannot say a thing cannot mean to delete it: `setRunProperties`
 * pressing Bold once erased the run's `w:rStyle` character style and its `w:lang`, and
 * `setParagraphProperties` centring a paragraph erased its `w:sectPr`, its paragraph mark and
 * its `w:pBdr`. New children land at their schema position, so an op naming its properties in
 * toolbar order still emits a `w:pPr` Word will open.
 */
export function mergedPropertyChildren(
  prior: readonly OoxmlNode[],
  properties: readonly OoxmlProperty[],
  vocabulary: PropertyVocabulary,
  nextId: () => string
): OoxmlNode[] {
  const wanted = new Map<string, OoxmlProperty[]>();
  for (const property of properties) {
    const bucket = wanted.get(property.localName);
    if (bucket) bucket.push(property);
    else wanted.set(property.localName, [property]);
  }

  // Authored children in authored order; repeats of one name pair up with the op's repeats
  // of that name, in order.
  const taken = new Map<string, number>();
  const children: OoxmlNode[] = [];
  for (const child of prior) {
    if (child.kind === 'textValue' || !vocabulary.authorable.has(child.localName)) {
      children.push(child);
      continue;
    }
    const index = taken.get(child.localName) ?? 0;
    taken.set(child.localName, index + 1);
    const property = wanted.get(child.localName)?.[index];
    if (property) children.push(propertyElement(property, nextId(), child));
  }

  for (const [localName, bucket] of wanted) {
    // Only the vocabulary is authorable. Validation refuses an op that names anything
    // else, so this is the second lock on the same door: a merge is the one place a name
    // becomes an ELEMENT, and it must not be reachable from a caller that forgot to
    // validate.
    if (!vocabulary.authorable.has(localName)) continue;
    for (let index = taken.get(localName) ?? 0; index < bucket.length; index += 1) {
      const node = propertyElement(bucket[index]!, nextId());
      const rank = rankOf(vocabulary.sequence, node);
      const at = children.findIndex((child) => rankOf(vocabulary.sequence, child) > rank);
      if (at === -1) children.push(node);
      else children.splice(at, 0, node);
    }
  }
  return inSchemaOrder(children, vocabulary.sequence);
}

/**
 * The container's MODELLED children in `CT_PPr` order, leaving everything else where it was
 * authored.
 *
 * Placing only the NEW children by rank is enough when the container was already ordered,
 * and not otherwise: `CT_PPr` is a strict `xsd:sequence`, an out-of-order `w:pPr` still
 * reads as a typed container (only the mark's position is checked), and a rewrite that
 * preserved the authored positions of the children it rewrote emitted the same invalid
 * order back — `<w:pPr><w:jc/><w:pStyle/></w:pPr>` centred through the op came out
 * `<w:ind/><w:jc/><w:pStyle/>`, which Word reports as unreadable. An element the sequence
 * does not model (a `w14:` text effect, an `mc:AlternateContent`) keeps its authored slot:
 * its position is not ours to decide, and moving it could reorder it past the very child
 * it was written to modify.
 */
function inSchemaOrder(children: readonly OoxmlNode[], sequence: readonly string[]): OoxmlNode[] {
  const slots: number[] = [];
  const modelled: OoxmlNode[] = [];
  children.forEach((child, index) => {
    if (rankOf(sequence, child) === sequence.length) return;
    slots.push(index);
    modelled.push(child);
  });
  const result = [...children];
  if (modelled.length < 2) return result;
  // Stable, so repeats of one name keep their authored order relative to each other.
  const sorted = [...modelled].sort((a, b) => rankOf(sequence, a) - rankOf(sequence, b));
  slots.forEach((slot, index) => {
    result[slot] = sorted[index]!;
  });
  return result;
}
