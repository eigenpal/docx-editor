import { WML_NAMESPACE_URI, type OoxmlNode } from '../store/package/ooxml-tree.ts';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';
import { MAX_PART_SCAN_ELEMENTS } from '../store/package/drawing-projection.ts';

const allowedElements = new Set([
  'adjustRightInd',
  'bCs',
  'cnfStyle',
  'p',
  'pPr',
  'r',
  'rPr',
  't',
  'tab',
  'br',
  'b',
  'i',
  'u',
  'sz',
  'szCs',
  'rFonts',
  'color',
  'lang',
  'spacing',
  'jc',
  'ind',
  'keepNext',
  'keepLines',
  'widowControl',
  'contextualSpacing',
  'pStyle',
  'rStyle',
  'noProof',
  'proofErr',
  'kern',
  'position',
  'vertAlign',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'shd',
  'highlight',
]);
const ordinaryParagraphs = new WeakMap<OoxmlNode, boolean>();

export function ordinaryTableParagraph(root: OoxmlNode): boolean {
  const known = ordinaryParagraphs.get(root);
  if (known !== undefined) return known;
  let visited = 0;
  const visit = (node: OoxmlNode, depth: number): boolean => {
    if (++visited > MAX_PART_SCAN_ELEMENTS || depth > MAX_XML_DEPTH) return false;
    if (node.kind === 'textValue') return true;
    if (node.namespaceUri !== WML_NAMESPACE_URI) return false;
    // A saved pagination marker carries no content or break instruction.
    if (node.localName === 'lastRenderedPageBreak') return node.children.length === 0;
    if (!allowedElements.has(node.localName)) return false;
    return node.children.every((child) => visit(child, depth + 1));
  };
  const result = visit(root, 0);
  ordinaryParagraphs.set(root, result);
  return result;
}
