import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { resolveRelationship } from './relationships.ts';
import { fontFamilyName } from './font-family-name.ts';

const FONT_TABLE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';
const MAX_FONT_TABLE_NAMES = 256;
/** `w:altName` is limited to 31 characters. A longer value is ignored, never truncated. */
const MAX_ALTERNATE_NAME_LENGTH = 31;

function wordElement(node: OoxmlNode, name: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' && node.localName === name && node.namespaceUri === WML_NAMESPACE_URI
  );
}

function wordAttribute(node: OoxmlElement, name: string): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.localName === name && attribute.namespaceUri === WML_NAMESPACE_URI
  )?.value;
}

/** Read whole alternate names without changing the canonical font table. */
export function fontTableAlternates(pkg: OoxmlPackage): ReadonlyMap<string, string> {
  const relationship = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
    (record) => record.type === FONT_TABLE_REL
  );
  const resolved = relationship ? resolveRelationship(relationship) : undefined;
  const part =
    resolved?.mode === 'Internal' && resolved.target.ok
      ? pkg.parts.get(resolved.target.partName)
      : undefined;
  const root = (part ?? pkg.parts.get('/word/fontTable.xml'))?.root;
  const alternatives = new Map<string, string>();
  if (!root || !wordElement(root, 'fonts')) return alternatives;
  let inspected = 0;
  for (const font of root.children) {
    if (!wordElement(font, 'font')) continue;
    if (++inspected > MAX_FONT_TABLE_NAMES) break;
    const family = fontFamilyName(wordAttribute(font, 'name'));
    if (!family) continue;
    const alternateNode = font.children.find((node) => wordElement(node, 'altName'));
    const rawAlternate =
      alternateNode && alternateNode.kind !== 'textValue'
        ? wordAttribute(alternateNode, 'val')
        : undefined;
    const alternate =
      rawAlternate !== undefined && rawAlternate.length <= MAX_ALTERNATE_NAME_LENGTH
        ? fontFamilyName(rawAlternate)
        : null;
    const key = family.trim().toLowerCase();
    if (alternate && !alternatives.has(key)) alternatives.set(key, alternate);
  }
  return alternatives;
}
