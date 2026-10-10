// One text digest for a document, used to compare replicas and the server's saved file.

import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  TreePackageStore,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';

export function storeFrom(bytes: Uint8Array): TreePackageStore {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('the document has no main part');
  return new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
}

function textOf(node: OoxmlNode): string {
  return node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
}

/** The text of every body paragraph, one per line, hashed. */
export function documentTextDigest(store: TreePackageStore): string {
  const paragraphs: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      paragraphs.push(textOf(node));
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  return new Bun.CryptoHasher('sha256').update(paragraphs.join('\n')).digest('hex');
}
