import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ParagraphSpacing } from './paragraph-style.ts';
import {
  cascadeParagraphFormatting,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import { propertiesOf } from './paragraph-flow.ts';

/** An unnamed paragraph uses the same implicit default style as its unnamed neighbours. */
export function contextualParagraphSpacing(
  spacing: ParagraphSpacing,
  enabled: boolean,
  styleId: string | null,
  previous: string | null | undefined,
  next: string | null | undefined
): ParagraphSpacing {
  return enabled
    ? {
        before: previous !== undefined && previous === styleId ? 0 : spacing.before,
        after: next !== undefined && next === styleId ? 0 : spacing.after,
      }
    : spacing;
}

export function neighbourParagraphStyle(
  block: OoxmlElement | undefined,
  styles: StyleCascadeTable | undefined,
  cellStyle?: TableCellStyleFormatting
): string | null | undefined {
  if (block?.kind !== 'paragraph') return undefined;
  const pPr = block.children.find((node) => node.kind === 'paragraphProperties');
  return styles
    ? cascadeParagraphFormatting(styles, pPr, cellStyle).styleId
    : (propertiesOf(pPr).find((property) => property.localName === 'pStyle')?.attributes?.val ??
        null);
}

export function cellContextualSpacing(
  spacing: ParagraphSpacing,
  enabled: boolean,
  styleId: string | null,
  neighbours: { readonly previous?: OoxmlElement; readonly next?: OoxmlElement } | undefined,
  styles: StyleCascadeTable | undefined,
  cellStyle?: TableCellStyleFormatting
): ParagraphSpacing {
  if (!enabled) return spacing;
  return contextualParagraphSpacing(
    spacing,
    true,
    styleId,
    neighbourParagraphStyle(neighbours?.previous, styles, cellStyle),
    neighbourParagraphStyle(neighbours?.next, styles, cellStyle)
  );
}
