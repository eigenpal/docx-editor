import { hardBreakAttributes } from '../package/hard-break.ts';
import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';

/**
 * A `w:t`, or a `w:delText` when the text being rebuilt was already struck.
 *
 * SPLITTING a run must not change what the run is. This built a `w:t` unconditionally, so
 * every ordinary gesture that splits a run inside a `w:del` — commenting on struck text,
 * bolding across it — silently re-labelled the deletion as live text (§17.3.3.7 requires
 * `w:delText` there), and the damage only showed when the file reached Word.
 */
export function textElement(
  nextId: () => string,
  text: string,
  kind: 'text' | 'deletedText' = 'text'
): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName: kind === 'deletedText' ? 'delText' : 't',
    prefix: 'w',
    namespaceBindings: [],
    // `xml:space="preserve"` is not added here: the serializer owns lexical form, and a
    // leading/trailing space is preserved by the tree regardless of the attribute.
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

export function simpleElement(
  nextId: () => string,
  localName: 'tab' | 'br',
  breakKind: 'line' | 'page' = 'line'
): OoxmlNode {
  return {
    id: nextId(),
    kind: localName === 'tab' ? 'tab' : 'hardBreak',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: localName === 'br' ? [...hardBreakAttributes(breakKind)] : [],
    children: [],
  } as unknown as OoxmlNode;
}
