import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  withPart,
  type OoxmlElement,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { stylesPartOf } from '../store/package/ooxml-indexes.ts';
import { createNodeIdAllocator, insertChildren } from '../store/package/ooxml-edit.ts';
import {
  withNewPart,
  withRelationship,
  withRelationshipsPartFor,
} from '../store/package/package-edit.ts';
import { propertyElement } from '../store/store/tree-op-properties.ts';

/** Materialize Word's built-in only when Enter actually needs a blank list separator. */
export function ensureSeparatorStyle(
  defaultStyleId: string | null,
  styleId: string
): (pkg: OoxmlPackage) => OoxmlPackage {
  return (pkg) => {
    const existing = stylesPartOf(pkg);
    const name = existing?.name ?? '/word/styles.xml';
    const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
    const parsed = existing
      ? null
      : readOoxmlPart(
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
          { name, contentType }
        );
    const part = existing ?? (parsed?.ok ? parsed.part : null);
    if (!part) throw new Error('Cannot create list paragraph style');
    if (
      part.root.children.some(
        (node) =>
          node.kind !== 'textValue' &&
          node.attributes.some((a) => a.localName === 'styleId' && a.value === styleId)
      )
    )
      return pkg;
    const nextId = createNodeIdAllocator(part);
    const element = (
      localName: string,
      attributes: Record<string, string> = {},
      children: readonly OoxmlElement[] = []
    ): OoxmlElement =>
      ({
        ...(propertyElement({ localName, attributes }, nextId()) as OoxmlElement),
        children,
        ...(localName === 'pPr' ? { kind: 'paragraphProperties' } : {}),
      }) as OoxmlElement;
    const unboundStyle = element('style', { type: 'paragraph', styleId }, [
      element('name', { val: 'List Paragraph' }),
      ...(defaultStyleId ? [element('basedOn', { val: defaultStyleId })] : []),
      element('uiPriority', { val: '34' }),
      element('qFormat'),
      element('pPr', {}, [element('ind', { left: '720' }), element('contextualSpacing')]),
    ]);
    // Keep the inserted subtree valid even when the source uses another XML prefix.
    const style = {
      ...unboundStyle,
      namespaceBindings: [{ prefix: 'w', namespaceUri: WML_NAMESPACE_URI }],
    };
    if (existing) {
      const inserted = insertChildren(part, part.root.id, part.root.children.length, [style]);
      if (!inserted.ok) throw new Error('Cannot insert list paragraph style');
      return withPart(pkg, inserted.part);
    }
    let next = withNewPart(
      pkg,
      name,
      { ...part.root, children: [style] } as OoxmlElement,
      contentType
    );
    next = withRelationshipsPartFor(next, pkg.mainDocumentPart);
    const related = withRelationship(
      next,
      pkg.mainDocumentPart,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
      name
    );
    if (!related.ok) throw new Error('Cannot link list paragraph style');
    return related.pkg;
  };
}
