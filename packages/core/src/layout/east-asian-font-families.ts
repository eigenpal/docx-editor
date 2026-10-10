// Resolve language-selected font needs through the same cascade and slots as layout.
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { validFontFamily } from '../store/package/run-defaults.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type TableCellStyleFormatting,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { piecesOfParagraph } from './field-projection.ts';
import { readTableStructure } from './semantic-table.ts';
import type { ThemeFonts } from './run-style.ts';
import { createFontFamilyTreeCache, fontScanChildren } from './font-family-tree-cache.ts';

interface ScanContext {
  readonly key: string;
  readonly baseKey: string;
  readonly styles: StyleCascadeTable;
  readonly theme: ThemeFonts;
  readonly supplementalFamilies: ReadonlySet<string>;
  readonly cellStyle?: TableCellStyleFormatting;
  readonly depth: number;
}

function inspectFontNode(node: OoxmlElement, context: ScanContext) {
  const { styles, theme, supplementalFamilies, depth } = context;
  if (node.kind === 'table') {
    const structure = readTableStructure(node, 468, depth, styles);
    const children = [];
    for (const row of structure?.rows ?? []) {
      for (const cell of row.cells) {
        const next = {
          ...context,
          depth: depth + 1,
          cellStyle: cell.styleFormatting,
          key: `${context.baseKey}|${depth + 1}|${JSON.stringify(cell.styleFormatting)}`,
        };
        for (const block of cell.blocks) children.push({ node: block, context: next });
      }
    }
    return { children: children.reverse() };
  }
  const families = new Set<string>();
  if (node.kind === 'paragraph') {
    const pPr = node.children.find((child) => child.kind === 'paragraphProperties');
    const inherited = cascadeParagraphFormatting(styles, pPr, context.cellStyle).runProperties;
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
      if (piece.fontSlot !== 'eastAsia' && !supplementalFamilies.has(piece.style.fontFamily ?? ''))
        continue;
      const family = validFontFamily(
        (piece.fontSlot === 'eastAsia' ? piece.style.fontFamilyEastAsia : piece.style.fontFamily) ??
          undefined
      );
      if (family) families.add(family);
    }
  }
  const next =
    node.localName === 'txbxContent'
      ? { ...context, cellStyle: undefined, key: `${context.baseKey}|${depth}|undefined` }
      : context;
  return { families: [...families], children: fontScanChildren(node, next).reverse() };
}

/** Reusable discovery belongs to the live editor session that needs incremental updates. */
export function createEastAsianLanguageFontScanner(): typeof eastAsianLanguageFontFamilies {
  const scan = createFontFamilyTreeCache(inspectFontNode);
  let previousContext: ScanContext | undefined;
  let previousStylesRoot: OoxmlElement | null | undefined;
  return (roots, stylesRoot, theme) => {
    if (!previousContext || previousStylesRoot !== stylesRoot || previousContext.theme !== theme) {
      const styles = buildStyleCascadeTable(stylesRoot, theme);
      previousStylesRoot = stylesRoot;
      previousContext = {
        key: `${styles.cacheToken}|0|undefined`,
        baseKey: styles.cacheToken,
        styles,
        theme,
        depth: 0,
        supplementalFamilies: new Set([
          ...Object.values(theme.majorSupplemental ?? {}),
          ...Object.values(theme.minorSupplemental ?? {}),
        ]),
      };
    }
    return scan([...roots].reverse(), previousContext);
  };
}

/** One-shot export discovery releases its subtree cache before layout allocates its live set. */
export function eastAsianLanguageFontFamilies(
  roots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  theme: ThemeFonts
): readonly string[] {
  return createEastAsianLanguageFontScanner()(roots, stylesRoot, theme);
}
