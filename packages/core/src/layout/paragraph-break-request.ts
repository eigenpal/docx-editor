/** Internal contract shared by body flow and bounded/table stories. */
import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { FieldPageContext } from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import { breakParagraph, type ParagraphFlowOptions, type PendingLine } from './paragraph-flow.ts';
import {
  tabStopsFingerprint,
  withDefaultTabInterval,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';
import type { TextMeasurer } from './semantic-records.ts';
import {
  cascadeRunProperties,
  type ParagraphLayoutInputs,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { resolveCjkTypography } from './cjk-typography.ts';

/**
 * External values can change while the source paragraph retains its identity.
 * Lists move first-line text; hosted lists remeasure inline textbox stories; REF values
 * change projected text. Empty optional tokens keep the historical key shape, while
 * an existing list still contributes its property even when its token is empty.
 */
export interface ParagraphBreakDependencies {
  readonly listToken: string | undefined;
  readonly hostedListToken: string;
  readonly refToken: string;
}

/**
 * Keep measured tab stops and their key dependency together. The default interval comes
 * from settings.xml, outside the paragraph cascade. Property order is deliberate.
 */
export function prepareParagraphBreakInputs(
  inputs: ParagraphLayoutInputs,
  defaultTabStopPt: number | undefined,
  dependencies: ParagraphBreakDependencies
): { readonly tabStops: ResolvedTabStops; readonly properties: readonly OoxmlProperty[] } {
  const tabStops = withDefaultTabInterval(inputs.tabStops, defaultTabStopPt);
  const token =
    tabStops === inputs.tabStops ? inputs.tabStopsCacheToken : tabStopsFingerprint(tabStops);
  return {
    tabStops,
    properties: [
      ...inputs.props,
      ...inputs.inheritedRunProperties,
      ...inputs.markRunProperties,
      { localName: 'tabStops', attributes: { token } },
      ...(dependencies.listToken !== undefined
        ? [{ localName: 'list', attributes: { token: dependencies.listToken } }]
        : []),
      ...(dependencies.hostedListToken
        ? [{ localName: 'txbxList', attributes: { token: dependencies.hostedListToken } }]
        : []),
      ...(dependencies.refToken
        ? [{ localName: 'refFields', attributes: { token: dependencies.refToken } }]
        : []),
    ],
  };
}

/**
 * Placement key adapters preserve the existing body suffix and cell key framing.
 * Both consume the same paragraph-start Y precision. Body keys retain their original
 * string on the ordinary path, including for key retention and cached string hashes.
 * Y matters because exclusions remain page-content bands: identical content can cross
 * a float at one position and clear it at another. NUL-framed suffixes cannot be forged
 * by XML text, which cannot contain U+0000.
 */
export function positionedParagraphExclusionToken(
  exclusionToken: string,
  paragraphStartY: number
): string {
  return exclusionToken ? `${paragraphStartY.toFixed(3)}|${exclusionToken}` : '';
}

export function bodyParagraphBreakKey(
  baseKey: string,
  placement: {
    readonly exclusionToken: string;
    readonly paragraphStartY: number;
    readonly columnIndex: number;
    readonly startOffset: number;
  }
): string {
  const positioned = positionedParagraphExclusionToken(
    placement.exclusionToken,
    placement.paragraphStartY
  );
  let key = baseKey;
  if (positioned) key += `\0excl:${placement.columnIndex}|${positioned}`;
  if (placement.startOffset > 0) key += `\0from:${placement.startOffset}`;
  return key;
}

/** Named internal boundary; the exported positional breakParagraph API remains compatible. */
export interface ParagraphBreakRequest {
  readonly paragraph: OoxmlNode;
  readonly paragraphId: string;
  readonly indentLeft: number;
  readonly available: number;
  readonly measurer: TextMeasurer;
  readonly cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined;
  readonly cacheKey: string | null;
  readonly formatting: {
    readonly props: readonly OoxmlProperty[];
    readonly inheritedRunProperties: readonly OoxmlProperty[];
    readonly markRunProperties: readonly OoxmlProperty[];
    readonly lineSpacing: ParagraphLayoutInputs['lineSpacing'];
  };
  readonly producer: string;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly tabStops: ResolvedTabStops;
  readonly pageContext?: FieldPageContext;
  readonly flow: Omit<
    ParagraphFlowOptions,
    'lineSpacing' | 'typography' | 'equationCacheToken' | 'themeFonts' | 'markRunProperties'
  >;
}

export function breakPreparedParagraph(request: ParagraphBreakRequest): readonly PendingLine[] {
  const { formatting, styleCascade } = request;
  return breakParagraph(
    request.paragraph,
    request.paragraphId,
    request.indentLeft,
    request.available,
    request.measurer,
    request.cache,
    request.cacheKey,
    formatting.inheritedRunProperties,
    request.tabStops,
    request.pageContext,
    styleCascade
      ? (inherited, direct) => cascadeRunProperties(inherited, direct, styleCascade)
      : undefined,
    {
      ...request.flow,
      lineSpacing: formatting.lineSpacing,
      typography: resolveCjkTypography(formatting.props, styleCascade?.typography),
      equationCacheToken: request.producer,
      ...(styleCascade ? { themeFonts: styleCascade.themeFonts } : {}),
      markRunProperties: formatting.markRunProperties,
    }
  );
}
