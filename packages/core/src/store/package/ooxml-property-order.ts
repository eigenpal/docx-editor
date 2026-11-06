// Schema child orders of the property containers. The read repairs, the property writes and
// the serializer all emit children in these orders, and the read cannot import the write modules.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

/**
 * `CT_PPr`'s child sequence (ECMA-376 17.3.1.26). A `w:pPr` whose children are out of this
 * order is not merely untidy — Word reports the file as unreadable — and the flat property
 * list an op carries has no order of its own, so the merge imposes this one.
 */
export const CT_PPR_SEQUENCE: readonly string[] = [
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
export const CT_RPR_SEQUENCE: readonly string[] = [
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

/** `CT_TblPrBase` child sequence (ECMA-376 17.4.78), plus trailing `tblPrChange`. */
export const CT_TBLPR_SEQUENCE: readonly string[] = [
  'tblStyle',
  'tblpPr',
  'tblOverlap',
  'bidiVisual',
  'tblStyleRowBandSize',
  'tblStyleColBandSize',
  'tblW',
  'jc',
  'tblCellSpacing',
  'tblInd',
  'tblBorders',
  'shd',
  'tblLayout',
  'tblCellMar',
  'tblLook',
  'tblCaption',
  'tblDescription',
  'tblPrChange',
];

/**
 * Position in the container's declared sequence; an unmodelled name sorts last. Only WML
 * children rank: `w14:shadow` is an extension, not the `w:shadow` the sequence names.
 */
export function rankOf(sequence: readonly string[], node: OoxmlNode): number {
  if (node.kind === 'textValue' || node.namespaceUri !== WML_NAMESPACE_URI) return sequence.length;
  const index = sequence.indexOf(node.localName);
  return index === -1 ? sequence.length : index;
}

/**
 * The container's MODELLED children in schema order, leaving everything else where it was
 * authored, or `children` itself when they already are.
 *
 * `CT_PPr` is a strict `xsd:sequence`, and consumers refuse a file with an out-of-order
 * `w:pPr`. `CT_RPr` is a choice between its leading revision marks and its trailing
 * `w:rPrChange`, so only those positions matter there; ordering the rest by the same table
 * gives one canonical order and costs nothing.
 *
 * An element the sequence does not model (a `w14:` text effect, an `mc:AlternateContent`)
 * keeps its authored slot: its position is not ours to decide, and moving it could reorder
 * it past the very child it was written to modify.
 */
export function inSchemaOrder(
  children: readonly OoxmlNode[],
  sequence: readonly string[]
): readonly OoxmlNode[] {
  const slots: number[] = [];
  const modelled: { readonly node: OoxmlNode; readonly rank: number }[] = [];
  let ordered = true;
  let last = -1;
  children.forEach((child, index) => {
    const rank = rankOf(sequence, child);
    if (rank === sequence.length) return;
    if (rank < last) ordered = false;
    last = rank;
    slots.push(index);
    modelled.push({ node: child, rank });
  });
  if (ordered) return children;
  // Stable, so repeats of one name keep their authored order relative to each other.
  const sorted = [...modelled].sort((a, b) => a.rank - b.rank);
  const result = [...children];
  slots.forEach((slot, index) => {
    result[slot] = sorted[index]!.node;
  });
  return result;
}

const SEQUENCE_OF: Readonly<Record<string, readonly string[]>> = {
  pPr: CT_PPR_SEQUENCE,
  rPr: CT_RPR_SEQUENCE,
};

/**
 * `children` of the element named `namespaceUri` / `localName` in schema order when it is a
 * WML `w:pPr` or `w:rPr`, wherever it sits, or `children` itself otherwise.
 *
 * The reader and the serializer both order through this one test, so a file opens in the
 * order a save writes and a save then reopen keeps its fingerprint. Concurrent collaborators
 * can still each add a property to one container, and the merge keeps both in the order the
 * shared list holds them. Every replica shows that same order, so the tree stays as merged
 * and only the saved file is written in schema order.
 */
export function propertyContainerOrder(
  namespaceUri: string,
  localName: string,
  children: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  if (namespaceUri !== WML_NAMESPACE_URI || !Object.hasOwn(SEQUENCE_OF, localName)) {
    return children;
  }
  return inSchemaOrder(children, SEQUENCE_OF[localName]!);
}

/** `children` of `node` in the order a save writes them; see {@link propertyContainerOrder}. */
export function serializedPropertyOrder(
  node: OoxmlElement,
  children: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  return propertyContainerOrder(node.namespaceUri, node.localName, children);
}
