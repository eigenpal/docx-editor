// The base direction a paragraph inherits, without its own `w:bidi`.
//
// Internal, for automation reads and writes of paragraph direction. The cascade is the one layout
// paints with: document defaults, the table style of an enclosing cell, the paragraph style chain,
// and the paragraph's numbering level at the rank layout gives it. A direction write that knows it
// can state `w:bidi` only where the paragraph would not already read that way, which is what the
// editor's own direction command does.

import { createFormattingCellStyles } from './complex-script-table-context.ts';
import { readNumPr, withNumberingStyleLinks } from './list-resolve.ts';
import { buildNumberingIndex, resolveNumberingLevel } from './numbering-index.ts';
import { numberingParagraphProperties } from './numbering-paragraph-properties.ts';
import { propertyContainer } from '../store/store/direct-properties.ts';
import type { FormattingDisplayMode } from '../store/store/formattable-runs.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeParagraphWithNumbering,
} from './style-cascade.ts';

/** The parts a paragraph's inherited direction comes from. `null` where the package has none. */
export interface DirectionSources {
  readonly styles: OoxmlElement | null;
  readonly settings: OoxmlElement | null;
  readonly numbering: OoxmlElement | null;
}

type Resolver = (
  part: OoxmlPart,
  paragraph: OoxmlNode,
  mode: FormattingDisplayMode,
  styleId: string | undefined
) => boolean;

const absent = {};
const resolvers = new WeakMap<object, WeakMap<object, WeakMap<object, Resolver>>>();

/**
 * A read-only `w:pPr` view that names `styleId` as its paragraph style.
 *
 * Only the cascade reads it, and the cascade reads child names and attributes. It lets a write
 * that also changes the style resolve the direction the paragraph will have, not the one it had.
 */
function withParagraphStyle(pPr: OoxmlNode | undefined, styleId: string): OoxmlNode {
  const kept =
    pPr && pPr.kind !== 'textValue'
      ? pPr.children.filter((child) => child.kind === 'textValue' || child.localName !== 'pStyle')
      : [];
  const pStyle = {
    kind: 'generic',
    id: '',
    localName: 'pStyle',
    attributes: [{ localName: 'val', value: styleId }],
    children: [],
  };
  return {
    ...(pPr ?? { kind: 'generic', id: '', localName: 'pPr', attributes: [] }),
    children: [pStyle, ...kept],
  } as unknown as OoxmlNode;
}

function createResolver(sources: DirectionSources): Resolver {
  const table = buildStyleCascadeTable(sources.styles, undefined, sources.settings);
  const cellStyleOf = createFormattingCellStyles(table);
  const numbering = withNumberingStyleLinks(buildNumberingIndex(sources.numbering), table);
  return (part, paragraph, mode, styleId) => {
    const own = propertyContainer(paragraph, 'paragraphProperties', 'pPr');
    const direct = styleId === undefined ? own : withParagraphStyle(own, styleId);
    // The list level comes from the style chain and direct properties, without the cell style,
    // as layout resolves list items.
    const numPr = readNumPr(cascadeParagraphFormatting(table, direct).paragraphPropertyNodes);
    const level = numPr ? resolveNumberingLevel(numbering, numPr.numId, numPr.ilvl) : null;
    const cascaded = cascadeParagraphWithNumbering(
      table,
      direct,
      cellStyleOf(part, paragraph, mode),
      level ? numberingParagraphProperties(level.level) : undefined
    );
    return paragraphIsRtl(cascaded.inheritedParagraphProperties);
  };
}

/**
 * Whether `paragraph` is right to left when its own `w:bidi` is ignored.
 *
 * `styleId` resolves the paragraph as if it named that paragraph style, for a write that changes
 * the style and the direction together. One cascade per styles, settings, and numbering part.
 */
export function paragraphInheritsRtl(
  sources: DirectionSources,
  part: OoxmlPart,
  paragraph: OoxmlNode,
  mode: FormattingDisplayMode,
  styleId?: string
): boolean {
  let bySettings = resolvers.get(sources.styles ?? absent);
  if (!bySettings) resolvers.set(sources.styles ?? absent, (bySettings = new WeakMap()));
  let byNumbering = bySettings.get(sources.settings ?? absent);
  if (!byNumbering) bySettings.set(sources.settings ?? absent, (byNumbering = new WeakMap()));
  let resolve = byNumbering.get(sources.numbering ?? absent);
  if (!resolve) byNumbering.set(sources.numbering ?? absent, (resolve = createResolver(sources)));
  return resolve(part, paragraph, mode, styleId);
}
