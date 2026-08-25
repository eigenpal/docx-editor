import type { OoxmlElement, OoxmlPart, OoxmlTextNode } from '@docx-editor.dev/core/store';
import type { EncodedAttribute, EncodedBinding } from './contract.ts';

export interface SeedSink {
  writePartIdentity(part: OoxmlPart): void;
  writeElement(
    node: OoxmlElement,
    attributes: readonly EncodedAttribute[],
    bindings: readonly EncodedBinding[]
  ): void;
  writeText(node: OoxmlTextNode): void;
  appendChild(parentId: string, childId: string): void;
  setRoot(id: string): void;
}

export function encodedAttributesOf(node: OoxmlElement): EncodedAttribute[] {
  return node.attributes.map((attribute) => ({
    namespaceUri: attribute.namespaceUri,
    localName: attribute.localName,
    prefix: attribute.prefix,
    value: attribute.value,
  }));
}

export function encodedBindingsOf(node: OoxmlElement): EncodedBinding[] {
  return node.namespaceBindings.map((binding) => ({
    prefix: binding.prefix,
    namespaceUri: binding.namespaceUri,
  }));
}

export function writePart(sink: SeedSink, part: OoxmlPart): void {
  sink.writePartIdentity(part);
  const visit = (node: OoxmlElement | OoxmlTextNode, parentId: string | null): void => {
    if (node.kind === 'textValue') sink.writeText(node);
    else {
      sink.writeElement(node, encodedAttributesOf(node), encodedBindingsOf(node));
      for (const child of node.children) visit(child, node.id);
    }
    if (parentId) sink.appendChild(parentId, node.id);
  };
  visit(part.root, null);
  sink.setRoot(part.root.id);
}
