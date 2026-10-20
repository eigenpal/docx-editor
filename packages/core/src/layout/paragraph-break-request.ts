import { paragraphAlignment } from './paragraph-alignment.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
/** Internal contract shared by body flow and bounded/table stories. */
import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { FieldPageContext } from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import {
  breakParagraph,
  frozenLine,
  type ParagraphFlowOptions,
  type PendingLine,
} from './paragraph-flow.ts';
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
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

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
  let tabStops = withDefaultTabInterval(inputs.tabStops, defaultTabStopPt);
  // Word supplies a left tab at a hanging paragraph's text origin. An authored stop
  // at that position takes precedence; later custom stops must not swallow this tab.
  // It stays marked as implied: the numbering suffix places the indent by its own rule.
  // Stops count from the leading margin, which is the right one in a right-to-left paragraph.
  const { hanging, firstLine } = inputs.indent;
  const leading = paragraphIsRtl(inputs.props) ? inputs.indent.right : inputs.indent.left;
  if (
    (hanging > 0 || firstLine < 0) &&
    leading > 0 &&
    !tabStops.stops.some((stop) => stop.positionPt === leading && !stop.numberingOnly)
  ) {
    tabStops = {
      ...tabStops,
      stops: [
        ...tabStops.stops,
        { positionPt: leading, alignment: 'left' as const, implied: true as const },
      ].sort((a, b) => a.positionPt - b.positionPt),
    };
  }
  const token =
    tabStops === inputs.tabStops ? inputs.tabStopsCacheToken : tabStopsFingerprint(tabStops);
  return {
    tabStops,
    properties: [
      ...inputs.props,
      ...inputs.inheritedRunProperties,
      ...inputs.markRunProperties,
      { localName: 'tabStops', attributes: { token } },
      // The line grid comes from the SECTION, not the paragraph, so its props cannot name it.
      ...(inputs.lineSpacing.gridPitch !== undefined
        ? [{ localName: 'lineGrid', attributes: { pitch: String(inputs.lineSpacing.gridPitch) } }]
        : []),
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
    readonly anchorParagraphStartY?: number;
    /** Spacing above the first line; a topAndBottom band inside it moves the line. */
    readonly paragraphSpaceBefore?: number;
    /** The paragraph anchors its own topAndBottom band, which the spacing moves. */
    readonly anchorsTopAndBottom?: boolean;
    /** That band sits at a fixed page position, so the paragraph's start Y moves its lines. */
    readonly ownBandPageFramed?: boolean;
    /**
     * That band sits at a fixed horizontal page position, so the page's left margin and its
     * parity (mirrored margins) move it within the content box.
     */
    readonly ownBandPageFramedHorizontally?: boolean;
    /** The page's left margin, for a horizontally page-framed band. */
    readonly frameMarginLeft?: number;
    /** The one-based page number, whose parity mirrored margins and inside frames read. */
    readonly pageNumber?: number;
    /**
     * The region bottom. An opening line that would clear its own band past it keeps to the
     * passages beside the band, so a paragraph with its own band keys the room below it.
     */
    readonly regionBottomY?: number;
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
  const spaceBefore = placement.paragraphSpaceBefore ?? 0;
  if ((positioned || placement.anchorsTopAndBottom) && spaceBefore > 0)
    key += `\0before:${spaceBefore.toFixed(3)}`;
  // The paragraph's own band is synthesized during the break, so it is in no exclusion
  // token: its position inputs join here instead.
  if (placement.anchorsTopAndBottom && placement.regionBottomY !== undefined)
    key += `\0region:${(placement.regionBottomY - placement.paragraphStartY).toFixed(3)}`;
  if (placement.ownBandPageFramed) key += `\0at:${placement.paragraphStartY.toFixed(3)}`;
  if (placement.ownBandPageFramedHorizontally)
    key += `\0x:${(placement.frameMarginLeft ?? 0).toFixed(3)}|${(placement.pageNumber ?? 1) % 2}`;
  if (
    placement.anchorParagraphStartY !== undefined &&
    placement.anchorParagraphStartY !== placement.paragraphStartY
  )
    key += `\0anchor:${placement.anchorParagraphStartY}`;
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
  readonly compatibilityMode?: number;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly tabStops: ResolvedTabStops;
  readonly pageContext?: FieldPageContext;
  readonly flow: Omit<
    ParagraphFlowOptions,
    'lineSpacing' | 'typography' | 'equationCacheToken' | 'themeFonts' | 'markRunProperties'
  >;
}

/** Build placement-dependent flow options only when the measured break is absent. */
export function breakPreparedParagraphLazily(
  cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined,
  cacheKey: string | null,
  prepare: () => Omit<ParagraphBreakRequest, 'cache' | 'cacheKey'>,
  reuse?: () => readonly PendingLine[] | undefined
): readonly PendingLine[] {
  const cached = cache && cacheKey !== null ? cache.get(cacheKey) : undefined;
  if (cached) return cached;
  const reused = reuse?.();
  if (reused) return reused;
  const lines = breakPreparedParagraph({ ...prepare(), cache: undefined, cacheKey: null });
  // Preserve the breaker's snapshot ownership and single lookup on a cache miss.
  if (cache && cacheKey !== null)
    cache.set(cacheKey, cache.retainAcrossPasses === false ? lines : lines.map(frozenLine));
  return lines;
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
      paragraphRtl: paragraphIsRtl(formatting.props),
      // Modern justification is mode 15 and every newer mode. An absent mode stays legacy.
      justifySpaceShrink:
        hasCompatibilityRule(request.compatibilityMode, 'justifiedSpaceShrink') &&
        paragraphAlignment(formatting.props) === 'both',
      lineSpacing: formatting.lineSpacing,
      typography: resolveCjkTypography(formatting.props, styleCascade?.typography),
      equationCacheToken: request.producer,
      ...(styleCascade ? { themeFonts: styleCascade.themeFonts } : {}),
      markRunProperties: formatting.markRunProperties,
    }
  );
}

/** Track releasable one-shot break entries until their paragraph has been placed. */
export function createParagraphBreakRetention(
  cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined
) {
  // A one-shot cache releases a paragraph only after its final placement. This preserves
  // keep-with-next lookahead hits without retaining a second document-sized line tree beside
  // the published layout. Live caches implement `release` as a no-op.
  const breakKeysByParagraph = new Map<string, Set<string>>();
  const rememberBreakKey = (paragraphId: string, key: string): void => {
    let keys = breakKeysByParagraph.get(paragraphId);
    if (!keys) {
      keys = new Set();
      breakKeysByParagraph.set(paragraphId, keys);
    }
    keys.add(key);
  };
  const releasePlacedBreaks = (paragraphId: string): void => {
    const keys = breakKeysByParagraph.get(paragraphId);
    if (!keys || !cache) return;
    for (const key of keys) cache.release?.(key);
    breakKeysByParagraph.delete(paragraphId);
  };

  return { rememberBreakKey, releasePlacedBreaks };
}
