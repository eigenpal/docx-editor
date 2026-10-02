import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { LineRecord, ParagraphFragmentRecord } from './semantic-records.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle, type ThemeFonts } from './run-style.ts';

/**
 * The paragraph mark's resolved style, for the fragments that need it.
 *
 * An empty paragraph has no text span to carry it, so its fragment keeps it as
 * `emptyParagraphStyle`. The fragment that ends the paragraph keeps it as
 * `paragraphMarkStyle`, which sizes the painted pilcrow.
 */
export function emptyParagraphStyleFields(
  lines: readonly LineRecord[],
  properties: readonly OoxmlProperty[],
  themeFonts?: ThemeFonts,
  paragraphEnd = false
): Pick<ParagraphFragmentRecord, 'emptyParagraphStyle' | 'paragraphMarkStyle'> {
  const empty = !lines.some((line) => line.spans.length > 0 || (line.drawings?.length ?? 0) > 0);
  if (!empty && !paragraphEnd) return {};
  const style =
    properties.length === 0 ? DEFAULT_RUN_STYLE : resolveRunStyle(properties, themeFonts);
  return {
    ...(empty ? { emptyParagraphStyle: style } : {}),
    ...(paragraphEnd ? { paragraphMarkStyle: style } : {}),
  };
}
