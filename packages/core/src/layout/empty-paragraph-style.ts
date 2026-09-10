import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { LineRecord, ParagraphFragmentRecord } from './semantic-records.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle, type ThemeFonts } from './run-style.ts';

/** Keep the exact mark style when an empty paragraph has no text span to carry it. */
export function emptyParagraphStyleFields(
  lines: readonly LineRecord[],
  properties: readonly OoxmlProperty[],
  themeFonts?: ThemeFonts
): Pick<ParagraphFragmentRecord, 'emptyParagraphStyle'> {
  if (lines.some((line) => line.spans.length > 0 || (line.drawings?.length ?? 0) > 0)) return {};
  return {
    emptyParagraphStyle:
      properties.length === 0 ? DEFAULT_RUN_STYLE : resolveRunStyle(properties, themeFonts),
  };
}
