import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';

/** Property snapshots are historical copies, never live revision subtrees. */
export const REVISION_PROPERTY_CONTAINERS: ReadonlyMap<string, string> = new Map([
  ['rPrChange', 'rPr'],
  ['pPrChange', 'pPr'],
  ['trPrChange', 'trPr'],
  ['tcPrChange', 'tcPr'],
  ['tblPrChange', 'tblPr'],
  ['tblPrExChange', 'tblPrEx'],
  ['tblGridChange', 'tblGrid'],
  ['sectPrChange', 'sectPr'],
]);

export function preservedRevisionProperty(wrapperName: string, child: OoxmlNode): boolean {
  if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) return false;
  const name = child.localName;
  switch (wrapperName) {
    case 'pPrChange':
      return name === 'rPr' || name === 'sectPr';
    case 'rPrChange':
      return ['ins', 'del', 'moveFrom', 'moveTo'].includes(name);
    case 'trPrChange':
      return name === 'ins' || name === 'del';
    case 'tcPrChange':
      return name === 'cellIns' || name === 'cellDel' || name === 'cellMerge';
    case 'sectPrChange':
      return name === 'headerReference' || name === 'footerReference';
    default:
      return false;
  }
}

/** Reject ambiguous duplicate live records before choosing a historical state. */
export function validRevisionPropertyRecord(node: OoxmlNode, parent: OoxmlNode | null): boolean {
  if (node.kind === 'textValue' || !parent || parent.kind === 'textValue') return false;
  const container = REVISION_PROPERTY_CONTAINERS.get(node.localName);
  if (parent.namespaceUri !== WML_NAMESPACE_URI || parent.localName !== container) return false;
  const records = parent.children.filter(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === node.localName
  );
  if (records.length !== 1) return false;
  return (
    node.children.filter(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === container
    ).length <= 1
  );
}
