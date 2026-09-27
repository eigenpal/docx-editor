import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';

const child = (node: OoxmlElement | undefined, name: string): OoxmlElement | undefined =>
  node?.children.find(
    (item): item is OoxmlElement =>
      item.kind !== 'textValue' &&
      item.namespaceUri === WML_NAMESPACE_URI &&
      item.localName === name
  );
const attr = (node: OoxmlElement | undefined, name: string): string | undefined =>
  node?.attributes.find(
    (item) => item.namespaceUri === WML_NAMESPACE_URI && item.localName === name
  )?.value;

/** Frame context affects preview geometry, never the object's one-unit model identity. */
export function objectPreviewFrameReader(stylesPart?: OoxmlPart): (node: OoxmlNode) => boolean {
  const styles = new Map<string, OoxmlElement>();
  let defaultStyle: string | undefined;
  let defaultsFramed = false;
  if (stylesPart) {
    const defaults = child(child(stylesPart.root, 'docDefaults'), 'pPrDefault');
    defaultsFramed = !!child(child(defaults, 'pPr'), 'framePr');
    for (const node of stylesPart.root.children) {
      if (
        node.kind === 'textValue' ||
        node.namespaceUri !== WML_NAMESPACE_URI ||
        node.localName !== 'style'
      )
        continue;
      if (attr(node, 'type') !== 'paragraph') continue;
      const id = attr(node, 'styleId');
      if (!id) continue;
      styles.set(id, node);
      if (['1', 'true', 'on'].includes(attr(node, 'default') ?? '')) defaultStyle = id;
    }
  }
  return (node) => {
    if (
      node.kind === 'textValue' ||
      node.namespaceUri !== WML_NAMESPACE_URI ||
      node.localName !== 'p'
    )
      return false;
    const props = child(node, 'pPr');
    if (child(props, 'framePr') || defaultsFramed) return true;
    let id = attr(child(props, 'pStyle'), 'val') ?? defaultStyle;
    const seen = new Set<string>();
    for (let depth = 0; id && depth < 64 && !seen.has(id); depth++) {
      seen.add(id);
      const style = styles.get(id);
      if (child(child(style, 'pPr'), 'framePr')) return true;
      id = attr(child(style, 'basedOn'), 'val');
    }
    return false;
  };
}
