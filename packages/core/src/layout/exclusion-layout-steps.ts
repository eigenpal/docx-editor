// Layout under the exclusion zones that anchored drawings, paragraph frames and floating tables
// produce. Moving one moves the text that wraps around it, which can move it again, so the
// blocks are laid out until the zones settle. Steps, so a long pass may pause; see
// `layout-steps.ts`.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { createDrawingExclusionPasses } from './drawing-exclusion-passes.ts';
import {
  collectExclusionZonesByPage,
  collectExclusionZonesByPageMemoized,
  DrawingExclusionConvergenceError,
  exclusionMapsEqual,
  MAX_DRAWING_EXCLUSION_REFLOW_PASSES,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { noteExclusionLayoutPass } from './exclusion-pass-observer.ts';
import { createLayoutSession, replaceLayoutSession, type LayoutSession } from './layout-session.ts';
import type { LayoutSteps } from './layout-steps.ts';
import * as frameWrap from './paragraph-frame-exclusion.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';
import type { PageRecord } from './semantic-records.ts';
import type { ResolvedSectionColumns } from './section-columns.ts';
import * as tableWrap from './table-float-exclusion.ts';
import type { BlockLayoutResult } from './column-balance-layout.ts';
import type { BlockLayoutOptions } from './semantic-layout.ts';

/** Extra full-document layouts after the reflow pass budget to detect a stable 2-cycle. */
const MAX_DRAWING_EXCLUSION_STABILIZATION_PASSES = 2;

/**
 * The converged layout of `bodies` under their exclusion zones, or null when nothing in them
 * produces zones (the caller then lays them out once). `layout` is one ordinary pass.
 */
export function* convergeExclusionLayout(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions,
  columns: ResolvedSectionColumns,
  contentWidthForReflow: number,
  layout: (
    bodies: readonly OoxmlElement[],
    revision: number,
    options: BlockLayoutOptions
  ) => LayoutSteps<BlockLayoutResult>
): LayoutSteps<BlockLayoutResult | null> {
  if (
    !(
      (options.inlineDrawingLayout ||
        frameWrap.hasParagraphFrames(bodies, options.styleCascade) ||
        tableWrap.hasFloatingTables(
          bodies,
          contentWidthForReflow,
          options.styleCascade,
          options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
          options.revisionAuthorFilter,
          options.compatibilityMode
        )) &&
      options.drawingExclusionPass === undefined &&
      !options.drawingExclusionConverged
    )
  )
    return null;
  const sourceOrderOf = (drawingNodeId: string): number | undefined => {
    const projectedId =
      options.inlineDrawingLayout?.projectionForAtom?.(drawingNodeId)?.drawingNodeId ??
      drawingNodeId;
    return options.drawingSourceOrder?.get(projectedId);
  };
  const exclusionColumnLayout = Object.freeze({
    columnCount: columns.count,
    columnGapPt: columns.gaps[0] ?? 0,
    contentWidth: contentWidthForReflow,
    columnLefts: columns.lefts,
    columnWidths: columns.widths,
  });
  const collectZones = (pages: readonly PageRecord[], memoized = false) => {
    const drawingZones = !options.inlineDrawingLayout
      ? new Map<number, readonly ExclusionZone[]>()
      : memoized
        ? collectExclusionZonesByPageMemoized(
            pages,
            options.inlineDrawingLayout,
            options.drawingLayoutEpoch,
            contentWidthForReflow,
            options.drawingSourceOrder,
            exclusionColumnLayout
          )
        : collectExclusionZonesByPage(
            pages,
            options.inlineDrawingLayout,
            contentWidthForReflow,
            sourceOrderOf,
            exclusionColumnLayout
          );
    return frameWrap.addParagraphFrameExclusions(
      pages,
      tableWrap.addFloatingTableExclusions(pages, drawingZones, exclusionColumnLayout),
      exclusionColumnLayout
    );
  };
  let zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]> = new Map();
  let result: BlockLayoutResult | null = null;
  let converged = false;
  const exclusionPasses = createDrawingExclusionPasses(
    bodies,
    options.inlineDrawingLayout,
    MAX_DRAWING_EXCLUSION_REFLOW_PASSES,
    options.compatibilityMode
  );
  function* layoutExclusionCandidate(
    candidateOptions: BlockLayoutOptions
  ): LayoutSteps<BlockLayoutResult> {
    noteExclusionLayoutPass();
    return yield* layout(bodies, revision, candidateOptions);
  }
  function* fallbackUnplaceableFrames(
    candidate: BlockLayoutResult
  ): LayoutSteps<BlockLayoutResult | null> {
    const ids = frameWrap.unplaceableParagraphFrameIds(candidate.pages);
    if (ids.size === 0) return null;
    // IDs only accumulate. After three admission rounds, ordinary flow handles all
    // remaining frames, bounding recursive retries even with changing page reserves.
    const round = options.paragraphFrameFallbackRound ?? 0;
    const disabled = new Set(options.disabledParagraphFrameIds);
    for (const id of round >= 3
      ? frameWrap.unplaceableParagraphFrameIds(candidate.pages, true)
      : ids)
      disabled.add(id);
    const coldSession = options.session ? createLayoutSession() : undefined;
    const fallback = yield* layout(bodies, revision, {
      ...options,
      session: coldSession,
      disabledParagraphFrameIds: disabled,
      paragraphFrameFallbackRound: round + 1,
    });
    if (options.session && coldSession) replaceLayoutSession(options.session, coldSession);
    return fallback;
  }
  const previousPages = options.session?.previous?.pages;
  if (previousPages) {
    zonesByPage = collectZones(previousPages, true);
    result = yield* layoutExclusionCandidate({
      ...options,
      drawingExclusionPass: 0,
      drawingExclusionZonesByPage: zonesByPage,
    });
    const fallback = yield* fallbackUnplaceableFrames(result);
    if (fallback) return fallback;
    // A pass that hands the previous pages back BY IDENTITY was laid under `zonesByPage`
    // and re-collecting from the same page records under the same inputs reproduces the
    // same zones — the equality below is true by construction. Every no-change section of
    // a multi-section document takes this path on every keystroke.
    if (result.pages === previousPages) return result;
    const nextZones = collectZones(result.pages, true);
    if (exclusionMapsEqual(zonesByPage, nextZones)) return result;
    zonesByPage = new Map(nextZones);
    exclusionPasses.remember(nextZones);
  }
  // The common document has an image-layout port but no exclusion-producing anchors. Build
  // pass zero with a disposable session so that, when its collected zone map is empty, that
  // very pass is publishable and can seed the caller's incremental state. Previously the
  // engine retained this complete probe while constructing an identical final layout.
  const publishCandidate = (
    candidate: BlockLayoutResult,
    candidateSession: LayoutSession | undefined
  ): BlockLayoutResult => {
    if (options.session && candidateSession)
      replaceLayoutSession(options.session, candidateSession);
    return candidate;
  };
  function* publishConverged(
    zones: ReadonlyMap<number, readonly ExclusionZone[]>
  ): LayoutSteps<BlockLayoutResult> {
    // The caller's session still owns pre-relay pages; resuming it could replay the seeded
    // geometry. Build the converged result cold, then replace the session atomically.
    const candidateSession = options.session ? createLayoutSession() : undefined;
    return publishCandidate(
      yield* layoutExclusionCandidate({
        ...options,
        session: candidateSession,
        drawingExclusionConverged: true,
        drawingExclusionZonesByPage: zones,
      }),
      candidateSession
    );
  }
  for (let pass = 0; pass < exclusionPasses.maxPasses; pass += 1) {
    const candidateSession = options.session ? createLayoutSession() : undefined;
    result = yield* layoutExclusionCandidate({
      ...options,
      session: candidateSession,
      drawingExclusionPass: exclusionPasses.passIndex(pass),
      drawingExclusionZonesByPage: zonesByPage,
    });
    const fallback = yield* fallbackUnplaceableFrames(result);
    if (fallback) return fallback;
    const nextZones = collectZones(result.pages);
    if (nextZones.size === 0) {
      // A candidate laid under seeded zones cannot publish merely because it collected none.
      if (pass === 0 && zonesByPage.size === 0) {
        return publishCandidate(result, candidateSession);
      }
      return yield* publishConverged(nextZones);
    }
    const transition = exclusionPasses.advance(zonesByPage, nextZones);
    if (transition === 'stable') return publishCandidate(result, candidateSession);
    zonesByPage = new Map(nextZones);
    if (transition === 'cycle') {
      converged = true;
      break;
    }
  }
  if (!converged) {
    for (let stab = 0; stab < MAX_DRAWING_EXCLUSION_STABILIZATION_PASSES && !converged; stab += 1) {
      const candidateSession = options.session ? createLayoutSession() : undefined;
      result = yield* layoutExclusionCandidate({
        ...options,
        session: candidateSession,
        drawingExclusionPass: exclusionPasses.maxPasses + stab,
        drawingExclusionZonesByPage: zonesByPage,
      });
      const fallback = yield* fallbackUnplaceableFrames(result);
      if (fallback) return fallback;
      const nextZones = collectZones(result.pages);
      const transition = exclusionPasses.advance(zonesByPage, nextZones, true);
      if (transition === 'stable') return publishCandidate(result, candidateSession);
      zonesByPage = new Map(nextZones);
      if (transition === 'cycle') {
        converged = true;
        break;
      }
    }
  }
  if (!converged) {
    throw new DrawingExclusionConvergenceError(
      `wrap exclusion reflow did not converge within ${exclusionPasses.maxPasses} passes`
    );
  }
  return yield* publishConverged(zonesByPage);
}
