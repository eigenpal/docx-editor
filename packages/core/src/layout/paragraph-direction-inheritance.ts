// The base direction a paragraph inherits, without its own `w:bidi`.
//
// Internal, for automation reads and writes of paragraph direction. The cascade is the one layout
// paints with: document defaults, the table style of an enclosing cell, then the paragraph style
// chain. A direction write that knows it can state `w:bidi` only where the paragraph would not
// already read that way, which is what the editor's own direction command does.

import { createFormattingCellStyles } from './complex-script-table-context.ts';
import { propertyContainer } from '../store/store/direct-properties.ts';
import type { FormattingDisplayMode } from '../store/store/formattable-runs.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import { buildStyleCascadeTable, cascadeParagraphFormatting } from './style-cascade.ts';

type Resolver = (part: OoxmlPart, paragraph: OoxmlNode, mode: FormattingDisplayMode) => boolean;

const absent = {};
const resolvers = new WeakMap<object, WeakMap<object, Resolver>>();

function createResolver(styles: OoxmlElement | null, settings: OoxmlElement | null): Resolver {
  const table = buildStyleCascadeTable(styles, undefined, settings);
  const cellStyleOf = createFormattingCellStyles(table);
  return (part, paragraph, mode) => {
    const cascaded = cascadeParagraphFormatting(
      table,
      propertyContainer(paragraph, 'paragraphProperties', 'pPr'),
      cellStyleOf(part, paragraph, mode)
    );
    return paragraphIsRtl(cascaded.inheritedParagraphProperties);
  };
}

/**
 * Whether `paragraph` is right to left when its own `w:bidi` is ignored.
 *
 * One cascade table per styles and settings part, as the complex-script formatting context keeps.
 */
export function paragraphInheritsRtl(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null,
  part: OoxmlPart,
  paragraph: OoxmlNode,
  mode: FormattingDisplayMode
): boolean {
  const styleKey = styles ?? absent;
  let bySettings = resolvers.get(styleKey);
  if (!bySettings) resolvers.set(styleKey, (bySettings = new WeakMap()));
  const settingKey = settings ?? absent;
  let resolve = bySettings.get(settingKey);
  if (!resolve) bySettings.set(settingKey, (resolve = createResolver(styles, settings)));
  return resolve(part, paragraph, mode);
}
