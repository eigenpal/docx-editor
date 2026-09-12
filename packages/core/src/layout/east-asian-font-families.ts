// Resolve language-selected font needs through the same cascade and slots as layout.
import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { validFontFamily } from '../store/package/run-defaults.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import { piecesOfParagraph } from './field-projection.ts';
import { readTableStructure } from './semantic-table.ts';
import type { ThemeFonts } from './run-style.ts';

/** Font origins must receive language-selected faces before the first shaping pass. */
export function eastAsianLanguageFontFamilies(
  roots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  theme: ThemeFonts
): readonly string[] {
  const styles = buildStyleCascadeTable(stylesRoot, theme);
  const families = new Set<string>();
  const supplementalFamilies = new Set([
    ...Object.values(theme.majorSupplemental ?? {}),
    ...Object.values(theme.minorSupplemental ?? {}),
  ]);
  const stack: Array<{ node: OoxmlNode; cellStyle?: TableCellStyleFormatting; depth: number }> = [];
  for (const root of roots) stack.push({ node: root, depth: 0 });
  while (stack.length) {
    const { node, cellStyle, depth } = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.kind === 'table') {
      // Width does not affect conditional font selection. Reuse the bounded grid/merge
      // reader so row bands, corners, and nested tables match the layout cascade.
      const structure = readTableStructure(node, 468, depth, styles);
      for (const row of structure?.rows ?? []) {
        for (const cell of row.cells) {
          for (const block of cell.blocks)
            stack.push({ node: block, cellStyle: cell.styleFormatting, depth: depth + 1 });
        }
      }
      continue;
    }
    if (node.kind === 'paragraph') {
      const pPr = node.children.find((child) => child.kind === 'paragraphProperties');
      const inherited = cascadeParagraphFormatting(styles, pPr, cellStyle).runProperties;
      for (const piece of piecesOfParagraph(
        node,
        inherited,
        undefined,
        (base, direct) => cascadeRunProperties(base, direct, styles),
        undefined,
        undefined,
        'all-markup',
        undefined,
        undefined,
        theme
      )) {
        if (!piece.text) continue;
        if (
          piece.fontSlot !== 'eastAsia' &&
          !supplementalFamilies.has(piece.style.fontFamily ?? '')
        )
          continue;
        const family = validFontFamily(
          (piece.fontSlot === 'eastAsia'
            ? piece.style.fontFamilyEastAsia
            : piece.style.fontFamily) ?? undefined
        );
        if (family) families.add(family);
      }
    }
    for (const child of node.children) {
      stack.push({
        node: child,
        cellStyle: node.localName === 'txbxContent' ? undefined : cellStyle,
        depth,
      });
    }
  }
  return [...families];
}
