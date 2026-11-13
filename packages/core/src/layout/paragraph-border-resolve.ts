// Cascade-aware `w:pBdr` resolution for the layout prepass.
//
// `resolveParagraphLayoutInputs` publishes the bottom edge only; placement needs all six.
// The "does any style declare pBdr?" probe is cached per cascade table so documents without
// style borders skip a second cascade walk on every paragraph.

import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  cascadedParagraphBorders,
  paragraphBorders,
  type ParagraphBorders,
} from './paragraph-style.ts';
import { cascadeParagraphFormatting, type StyleCascadeTable } from './style-cascade.ts';

const cascadeBorderDeclarations = new WeakMap<StyleCascadeTable, boolean>();

function styleCascadeDeclaresBorders(table: StyleCascadeTable): boolean {
  const cached = cascadeBorderDeclarations.get(table);
  if (cached !== undefined) return cached;
  const declaresPBdr = (props: readonly OoxmlProperty[]): boolean =>
    props.some((property) => property.localName === 'pBdr');
  let declares = declaresPBdr(table.docDefaultsParagraph);
  if (!declares) {
    for (const style of table.styles.values()) {
      if (declaresPBdr(style.paragraphProperties)) {
        declares = true;
        break;
      }
    }
  }
  cascadeBorderDeclarations.set(table, declares);
  return declares;
}

/**
 * Resolve `w:pBdr` for one paragraph, through the style cascade when a style could contribute.
 *
 * Direct `w:pPr` is enough when no style in the table declares a border; otherwise the same
 * last-`w:pBdr`-wins cascade as spacing/indent is walked for all six edges.
 */
export function resolveParagraphBorders(
  pPr: OoxmlNode | undefined,
  styleCascade: StyleCascadeTable | undefined
): ParagraphBorders {
  if (!styleCascade || !styleCascadeDeclaresBorders(styleCascade)) return paragraphBorders(pPr);
  return cascadedParagraphBorders(
    cascadeParagraphFormatting(styleCascade, pPr).paragraphPropertyNodes
  );
}

function pBdrOf(node: OoxmlNode): OoxmlNode | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'pBdr' &&
      child.namespaceUri === WML_NAMESPACE_URI
  );
}

/** A copy of a `w:pPr` without its `w:pBdr`, naming `styleId` when one is given. */
function withoutOwnBorders(pPr: OoxmlNode | undefined, styleId: string | undefined): OoxmlNode {
  const kept =
    pPr && pPr.kind !== 'textValue'
      ? pPr.children.filter(
          (child) =>
            child.kind === 'textValue' ||
            (child.localName !== 'pBdr' && (styleId === undefined || child.localName !== 'pStyle'))
        )
      : [];
  const pStyle =
    styleId === undefined
      ? []
      : [
          {
            kind: 'generic',
            id: '',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'pStyle',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [
              { namespaceUri: WML_NAMESPACE_URI, localName: 'val', prefix: 'w', value: styleId },
            ],
            children: [],
          },
        ];
  const base =
    pPr && pPr.kind !== 'textValue'
      ? pPr
      : { kind: 'generic', id: '', namespaceUri: WML_NAMESPACE_URI, localName: 'pPr' };
  return { attributes: [], ...base, children: [...pStyle, ...kept] } as unknown as OoxmlNode;
}

/**
 * The last `w:pBdr` a paragraph inherits from its style chain and the document defaults,
 * ignoring its own. The same cascade `resolveParagraphBorders` paints from.
 *
 * `styleId` resolves it as if the paragraph named that style, for a write that changes the
 * style and the borders together.
 */
export function inheritedParagraphBorderElement(
  styleCascade: StyleCascadeTable,
  pPr: OoxmlNode | undefined,
  styleId?: string
): OoxmlNode | undefined {
  if (!styleCascadeDeclaresBorders(styleCascade)) return undefined;
  const direct = withoutOwnBorders(pPr, styleId);
  let found: OoxmlNode | undefined;
  for (const node of cascadeParagraphFormatting(styleCascade, direct).paragraphPropertyNodes) {
    if (node) found = pBdrOf(node) ?? found;
  }
  return found;
}
