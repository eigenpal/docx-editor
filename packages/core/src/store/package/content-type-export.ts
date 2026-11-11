// A package rebuilt from a collaboration room has an up-to-date content type index, but the
// [Content_Types].xml bytes it was seeded with. Export writes back only the Overrides that
// differ from the index. Malformed, duplicate and orphan records, and extension content, stay
// as authored.
import { buildTolerantContentTypeIndex, type OverrideRecord } from './content-types.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { contentTypesPartBytes, withContentTypeOverrides } from './package-edit.ts';
import { partNameKey } from './opc-names.ts';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlNode } from './ooxml-tree.ts';
import { runWithoutJournalCapture } from './canonical-primitive-capture.ts';

const NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

function attribute(node: OoxmlNode, name: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((a) => a.namespaceUri === '' && a.localName === name)?.value;
}

/** Export projection only: never write repairs back into a store or its primitive journal. */
export function contentTypeExportPackage(pkg: OoxmlPackage): OoxmlPackage {
  const entry = contentTypesPartBytes(pkg);
  if (!entry) return pkg;
  const parsed = readOoxmlPart(new TextDecoder().decode(entry.bytes), {
    name: '/[Content_Types].xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) return pkg;
  const records: OverrideRecord[] = [];
  const collect = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === NS && node.localName === 'Override') {
      const partName = attribute(node, 'PartName');
      const contentType = attribute(node, 'ContentType');
      if (partName !== undefined && contentType !== undefined) {
        records.push({ partName, contentType, order: records.length });
      }
    }
    for (const child of node.children) collect(child);
  };
  collect(parsed.part.root);
  const authored = buildTolerantContentTypeIndex({ defaults: [], overrides: records });
  if (!authored.ok) return pkg;
  const removed = new Set<string>();
  for (const key of authored.index.overrides.keys()) {
    if (!pkg.contentTypes.overrides.has(key)) removed.add(key);
  }
  const names = new Map<string, string>();
  for (const name of pkg.partBytes.keys()) names.set(partNameKey(name), name);
  for (const name of pkg.parts.keys()) names.set(partNameKey(name), name);
  const changed: [string, string][] = [];
  for (const [key, type] of pkg.contentTypes.overrides) {
    if (authored.index.overrides.get(key) !== type) changed.push([names.get(key) ?? key, type]);
  }
  if (removed.size === 0 && changed.length === 0) return pkg;
  // Remove only declarations that the authored index recognizes. Invalid declarations
  // absent from that index stay inert, as they do in an ordinary open/save cycle.
  const prune = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    const children = node.children
      .filter((child) => {
        if (
          child.kind === 'textValue' ||
          child.namespaceUri !== NS ||
          child.localName !== 'Override'
        )
          return true;
        const name = attribute(child, 'PartName');
        return name === undefined || !removed.has(partNameKey(name));
      })
      .map(prune);
    return { ...node, children } as OoxmlNode;
  };
  let next = pkg;
  if (removed.size > 0) {
    const root = prune(parsed.part.root);
    if (root.kind === 'textValue') return pkg;
    const partBytes = new Map(pkg.partBytes);
    partBytes.set(
      entry.storageKey,
      new TextEncoder().encode(serializeOoxmlPart({ ...parsed.part, root }))
    );
    next = { ...pkg, partBytes };
  }
  return runWithoutJournalCapture(() => withContentTypeOverrides(next, changed));
}
