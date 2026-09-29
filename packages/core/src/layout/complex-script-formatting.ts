import { createFormattingCellStyles } from './complex-script-table-context.ts';
import type {
  FormattingDisplayMode,
  FormattingRevisionAuthorFilter,
} from '../store/store/formattable-runs.ts';
// Resolve the formatting lane without copying inherited properties into a write.
import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { ComplexScriptContext } from '../store/store/direct-properties.ts';
import {
  propertyContainer,
  runPropertyEditsWithContext,
  mergedParagraphMarkPropertiesWithContext,
  type runPropertyEdits,
  type mergedParagraphMarkProperties,
} from '../store/store/direct-properties.ts';
import { propertiesOf } from './paragraph-flow.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
} from './style-cascade.ts';

const absent = {};
const contexts = new WeakMap<object, WeakMap<object, ComplexScriptContext>>();

/** Internal, shared by selection, caret, and automation writes. */
export function complexScriptFormattingContext(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null = null,
  displayMode: FormattingDisplayMode = 'all-markup',
  authorFilter?: FormattingRevisionAuthorFilter
): ComplexScriptContext {
  const key = styles ?? absent;
  let bySettings = contexts.get(key);
  if (!bySettings) contexts.set(key, (bySettings = new WeakMap()));
  const settingKey = settings ?? absent;
  let context = bySettings.get(settingKey);
  if (!context) bySettings.set(settingKey, (context = createContext(styles, settings)));
  const resolve = context;
  return (paragraph, container, mark, part, mode = displayMode, filter = authorFilter) =>
    resolve(paragraph, container, mark, part, mode, filter);
}

function createContext(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null
): ComplexScriptContext {
  const table = buildStyleCascadeTable(styles, undefined, settings);
  const cellStyleOf = createFormattingCellStyles(table);
  const paragraphs = new WeakMap<
    OoxmlNode,
    {
      cellStyle: ReturnType<typeof cellStyleOf>;
      inherited: ReturnType<typeof cascadeParagraphFormatting>;
    }
  >();
  return (paragraph, container, mark, part, mode = 'all-markup', filter) => {
    const cellStyle = cellStyleOf(part, paragraph, mode, filter);
    let cached = paragraphs.get(paragraph);
    if (!cached || cached.cellStyle !== cellStyle) {
      const inherited = cascadeParagraphFormatting(
        table,
        propertyContainer(paragraph, 'paragraphProperties', 'pPr'),
        cellStyle
      );
      cached = { cellStyle, inherited };
      paragraphs.set(paragraph, cached);
    }
    const { inherited } = cached;
    const properties = mark
      ? inherited.markRunProperties
      : cascadeRunProperties(inherited.runProperties, propertiesOf(container), table);
    let rtl = false;
    let cs = false;
    for (const property of properties) {
      if (property.localName !== 'rtl' && property.localName !== 'cs') continue;
      const value = property.attributes?.val;
      const on = value === undefined || ['1', 'true', 'on'].includes(value);
      if (property.localName === 'rtl') rtl = on;
      else cs = on;
    }
    return rtl || cs;
  };
}

/** Preserve the store write signatures while supplying document style context internally. */
export function createContextualRunFormatting(
  styles: () => OoxmlElement | null,
  settings: () => OoxmlElement | null = () => null,
  mode: () => FormattingDisplayMode = () => 'all-markup',
  filter: () => FormattingRevisionAuthorFilter | undefined = () => undefined
) {
  return {
    runPropertyEdits(...args: Parameters<typeof runPropertyEdits>) {
      return runPropertyEditsWithContext(
        args[0],
        args[1],
        args[2],
        args[3],
        args[4],
        args[5],
        args[6],
        complexScriptFormattingContext(styles(), settings(), mode(), filter())
      );
    },
    mergedParagraphMarkProperties(...args: Parameters<typeof mergedParagraphMarkProperties>) {
      return mergedParagraphMarkPropertiesWithContext(
        args[0],
        args[1],
        args[2],
        complexScriptFormattingContext(styles(), settings(), mode(), filter())
      );
    },
  };
}
