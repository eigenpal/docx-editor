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

/** The effective `w:rtl`, `w:cs`, `w:sz`, and `w:szCs` of a run or paragraph mark. */
interface RunScriptFlags {
  readonly rtl: boolean;
  readonly cs: boolean;
  /** Half-points, or null when no level of the cascade states one. */
  readonly sz: number | null;
  readonly szCs: number | null;
}

type ScriptFlagsContext = (...args: Parameters<ComplexScriptContext>) => RunScriptFlags;

const absent = {};
const contexts = new WeakMap<object, WeakMap<object, ScriptFlagsContext>>();

function scriptFlagsContext(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null
): ScriptFlagsContext {
  const key = styles ?? absent;
  let bySettings = contexts.get(key);
  if (!bySettings) contexts.set(key, (bySettings = new WeakMap()));
  const settingKey = settings ?? absent;
  let context = bySettings.get(settingKey);
  if (!context) bySettings.set(settingKey, (context = createContext(styles, settings)));
  return context;
}

/** Internal, shared by selection, caret, and automation writes. */
export function complexScriptFormattingContext(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null = null,
  displayMode: FormattingDisplayMode = 'all-markup',
  authorFilter?: FormattingRevisionAuthorFilter
): ComplexScriptContext {
  const resolve = scriptFlagsContext(styles, settings);
  return (paragraph, container, mark, part, mode = displayMode, filter = authorFilter) => {
    const flags = resolve(paragraph, container, mark, part, mode, filter);
    return flags.rtl || flags.cs;
  };
}

/**
 * Like {@link complexScriptFormattingContext}, but answers only the effective run direction
 * (`w:rtl`), without `w:cs`. Typed text uses it to decide the direction of a new run.
 */
export function runDirectionFormattingContext(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null = null,
  displayMode: FormattingDisplayMode = 'all-markup',
  authorFilter?: FormattingRevisionAuthorFilter
): ComplexScriptContext {
  const resolve = scriptFlagsContext(styles, settings);
  return (paragraph, container, mark, part, mode = displayMode, filter = authorFilter) =>
    resolve(paragraph, container, mark, part, mode, filter).rtl;
}

/**
 * The effective font size of a run or paragraph mark, in half-points, through the full cascade
 * layout paints from: document defaults, table style, paragraph style, character style, and the
 * run's own properties. A complex-script run reads only `w:szCs`, as layout paints it: its
 * `w:sz` does not apply. Null when nothing states the size that applies.
 */
export function runFontSizeFormattingContext(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null = null,
  displayMode: FormattingDisplayMode = 'all-markup',
  authorFilter?: FormattingRevisionAuthorFilter
): (...args: Parameters<ComplexScriptContext>) => number | null {
  const resolve = scriptFlagsContext(styles, settings);
  return (paragraph, container, mark, part, mode = displayMode, filter = authorFilter) => {
    const flags = resolve(paragraph, container, mark, part, mode, filter);
    return flags.rtl || flags.cs ? flags.szCs : flags.sz;
  };
}

/** A positive integer half-point size from a `w:sz` or `w:szCs` value, or null. */
function halfPointsOf(value: string | undefined): number | null {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createContext(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null
): ScriptFlagsContext {
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
    let sz: number | null = null;
    let szCs: number | null = null;
    for (const property of properties) {
      const value = property.attributes?.val;
      if (property.localName === 'sz') sz = halfPointsOf(value) ?? sz;
      if (property.localName === 'szCs') szCs = halfPointsOf(value) ?? szCs;
      if (property.localName !== 'rtl' && property.localName !== 'cs') continue;
      const on = value === undefined || ['1', 'true', 'on'].includes(value);
      if (property.localName === 'rtl') rtl = on;
      else cs = on;
    }
    return { rtl, cs, sz, szCs };
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
