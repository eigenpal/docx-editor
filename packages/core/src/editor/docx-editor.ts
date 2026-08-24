// The `Editor` facade over the paginated surface.
//
// `createDocxEditor` implements the FULL `Editor` contract over the paginated surface —
// the document session, semantic layout and painted pages. This is the composition root
// the framework adapters mount.
//
// - REAL: load/save, the exec subset below (marks, mark attributes via `setMarkAttr`,
//   alignment, indent, line break, undo/redo, semantic setSelection, selection-addressed
//   insert/delete text), selection formatting, `isActive` for marks and alignment, page
//   setup, page counts, the cached snapshot (with canUndo/canRedo),
//   change/selectionChange/error events, focus, destroy, attach/detach, `query` for
//   `selectedText` and `selectionFormatting`, and the document catalogs
//   (`getDocumentFonts`/`getDocumentStyles`, derived from the canonical trees).
// THE GEOMETRY/INTERACTION CLUSTER IS GONE, not stubbed. `getInteractionFrame`, `hitTest`,
// `dispatchInteraction`, `resolvePointer`, the caret and selection rect readers and the
// accessibility observation were all placeholders here, and none of them had a caller. They
// were removed from the contract rather than filled in, because the honest-empty rule does
// NOT extend to them: `getComments()` returning `[]` is a true statement about a document,
// while `hitTest` returning `null` is indistinguishable from "you clicked the page margin",
// so a caller could not tell an unimplemented member from a real answer. `getPageGeometry`
// is the one survivor and is now REAL — it had the cluster's only consumer, and returning
// `[]` had silently made both Vue rulers render nothing.
//
// Filling any of these in later lights up whichever control reads it, with no change to
// callers — which is the point of wiring the full contract now.
//
// STATE TICK + CACHED SNAPSHOT (the external-store contract).
//
// The facade keeps a monotonic `stateVersion`, bumped at EVERY place observable state can
// move: a committed change, a selection move, zoom, load success AND failure, the async
// font remount (which goes through `mountBytes`), attach/detach, and destroy. `snapshot()`
// derives lazily ONCE per version, deep-freezes, and returns the SAME reference until the
// next bump — `useSyncExternalStore`'s getSnapshot contract, and N subscribers pay one
// derivation instead of N. When it re-derives, the previous `formatting` and `page`
// sub-objects are reused if value-equal, so selector results stay reference-stable too.

import {
  anchorLineY,
  commentBodyText,
  commentInitials,
  documentOrder,
  paragraphFragmentsOfBlocks,
  reviewItemGeometry,
  reviewItemKey,
  type ReviewItem,
  type ReviewParagraphAnchor,
  type ReviewRange,
  type SemanticLayout,
  type SemanticPosition,
} from '../layout/index.ts';
import type {
  DocumentEditingMode,
  ReviewActivationOptions,
  ReviewItemPlacement,
  ReviewItemQuery,
  ReviewRevisionKind,
} from '../contracts/editor.ts';
import { resolveEditorModules, type ReviewModelInput } from '../contracts/modules.ts';
import {
  NO_TRACKING_SETTINGS,
  type DocumentTrackingSettings,
} from '../store/package/tracking-settings.ts';
import type { StoryScope } from '@docx-editor.dev/core/store';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import type {
  CanResult,
  ContainerRef,
  ContentControlFilter,
  DocumentChange,
  DocumentHandle,
  EditorError,
  EditorEvents,
  EditorQueries,
  EditorQueryResults,
  EditorScope,
  EditorSnapshot,
  ExecResult,
  TextMatch,
  Unsubscribe,
  ViewScope,
} from '@docx-editor.dev/core/contracts/editor';
import { EditorFontError } from '@docx-editor.dev/core/contracts/editor';
import {
  FontResolutionError,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARFBUZZ_SHAPING_LIBRARY,
  HarfBuzzShapingError,
  fontRequestKey,
  createShapedMeasurer,
  resolveDefaultSurfaceMeasurer,
  type SemanticSelection as SurfaceSelection,
  type TextMeasurer,
} from '@docx-editor.dev/core/layout';
import { createAnchorIndex } from './docx-editor-anchors.ts';
import { fragmentParagraphs } from '../layout/line-segments.ts';
import {
  classifyCommand,
  deepFreezeValue,
  docRangeEqual,
  createTocContextCache,
  editorError,
  formattingEqual,
  normalizeSource,
  pageEqual,
  pageSetupEqual,
  selectionsMatch,
  snapshotsEqual,
  unloadableSourceReason,
} from './docx-editor-support.ts';
import {
  createT,
  deepMerge,
  en,
  locales,
  type LocaleCode,
  type LocaleStrings,
} from '@docx-editor.dev/i18n';
import { execEditorCommand } from './docx-editor-exec.ts';
import { resolveDocTargetSelection } from './doc-target-resolution.ts';
import { createOpenScheduler } from './docx-editor-open-scheduler.ts';
import {
  customNodeDiagnosticReporter,
  sweepCustomNodePayloadsOnOpen,
} from './custom-node-wiring.ts';
import {
  currentPage as currentPageOf,
  pageSetupOf,
  gateCommand,
  hyperlinkAtOf,
  paragraphSummaries,
  runFormattingOf,
  selectionFormattingHalfPoints,
  selectionRangeOf,
  totalPages as totalPagesOf,
  tableContextOf,
  selectedTableOf,
} from './docx-editor-derive.ts';
import { setReviewCommentResolved } from './docx-editor-comment-resolution.ts';
import { reviewReplyRefusal } from './review-reply.ts';
import {
  canContentControlCommand,
  runContentControlCommand,
  gateModeOf,
  contentControlAtOf,
  contentControlsOf,
  isContentControlEditorCommand,
} from './content-controls.ts';
import {
  imageContextEqual,
  selectedImageStateOf,
  canExecuteImageCommand as canExecuteImageCommandOf,
  canAsyncImageCommand as canAsyncImageCommandOf,
  executeImageCommand as executeImageCommandOf,
  captureImageMutationPreconditions,
  verifyImageCommandIdentity,
  isImageCommand,
  imageCommandHasIdentityFields,
} from './docx-editor-images.ts';
import {
  createLayoutShaping,
  disposeLayoutShaping,
  toEditorFontError,
  warnFontFailureOnce,
} from './font-configuration.ts';
import {
  MAX_RESOLVER_FAMILIES,
  composeFontConfiguration,
  type FontConfigurationBase,
} from './font-composition.ts';
import { availableFontFamilies, configuredDefaultFontFamily } from './font-catalog.ts';
import { embeddedFontSources } from './embedded-font-sources.ts';
import { createLocalFontProbe, detectFontSubstitutions } from './font-availability.ts';
import { tryCreateBrowserCanvasContext } from './browser-canvas-context.ts';
import {
  registerEmbeddedFontFaces,
  type EmbeddedFontFaceRegistration,
} from './embedded-font-faces.ts';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceOptions,
  type PaginatedSurfaceState,
} from './paginated-surface.ts';
import { drawingPaintStringsFromTranslate } from '../output/semantic-paint-drawings.ts';
import { surfaceScroller } from './surface-pages.ts';
import { createZoomLane, zoomFacadeMembers } from './docx-editor-zoom.ts';
import {
  documentTrackingAdoption,
  PRO_REVIEW_REASON,
  resolveOpeningEditingMode,
} from './opening-editing-mode.ts';
import { createRevisionStyleState, EMPTY_AUTHOR_SLOTS } from './revision-style-state.ts';
import type {
  DocxEditorConfig,
  DocxEditorInstance,
  HyperlinkChromeHandlers,
} from './docx-editor-types.ts';

export type {
  DocxEditorConfig,
  DocxEditorInstance,
  FontMeasurementState,
  HyperlinkChromeHandlers,
} from './docx-editor-types.ts';

/** The one frozen scope object every snapshot shares, so scope stays reference-equal. */
const SCOPE_BODY: EditorScope = Object.freeze({ kind: 'body' as const });
/** One frozen empty answer, so "nothing substituted" never mints a new reference. */
const EMPTY_FONT_SUBSTITUTIONS: readonly string[] = Object.freeze([]);

/**
 * Build an editor: the full `Editor` contract over a paginated surface.
 *
 * Construction is separate from mounting. Pass a `container` and the document mounts
 * immediately; omit it and nothing touches the DOM until `attach(el)` — the provider-first
 * shape. `detach()` remounts from the saved bytes, which resets undo and the caret.
 *
 * `snapshot()` is version-cached: the same reference until state actually moves, with
 * reference-stable sub-objects, so it is safe as a `useSyncExternalStore` source.
 *
 * @example
 * ```ts
 * const editor = createDocxEditor({ document: bytes, modules: [reviewModule()] });
 * editor.attach(element);
 * editor.on('change', () => setDirty(true));
 * ```
 *
 * @public
 */
export function createDocxEditor(config: DocxEditorConfig): DocxEditorInstance {
  const localeCode =
    config.locale && config.locale in locales ? (config.locale as LocaleCode) : ('en' as const);
  const t = createT(
    deepMerge(en, localeCode === 'en' ? undefined : locales[localeCode]) as LocaleStrings,
    localeCode
  );
  const tocLabels = { title: t('toolbar.tableOfContents') };
  let container: HTMLElement | null = config.container ?? null;
  /**
   * The capability registry, resolved once — module registration is
   * construction-time and immutable for the instance's lifetime.
   */
  const modules = resolveEditorModules(config.modules);
  const reportDiagnostic = customNodeDiagnosticReporter(modules);
  const reviewEnabled = modules.review !== null;
  /** Document bytes waiting for a container — set when constructed or loaded detached. */
  let pendingBytes: Uint8Array | null = null;
  /** A big document's mount, deferred behind one painted frame so a loading screen can
   *  show — `snapshot().isOpening` holds for that window. See `docx-editor-open-scheduler.ts`. */
  const openScheduler = createOpenScheduler({
    mount: (bytes) => mountBytes(bytes),
    scheduled: () => {
      bump();
      emitSelectionChange();
    },
  });
  /**
   * How edits are written. `mode: 'view'` opens in viewing; everything else starts editing
   * and the opening-mode decision below may move it. Declared here because the surface is
   * handed it at mount, and a document reload keeps the reader's choice.
   */
  let editingMode: DocumentEditingMode = config.mode === 'view' ? 'viewing' : 'editing';

  /**
   * The host rail's activation filter, held here so a surface rebuilt on load or font
   * remount comes back up with it (the surface holds the working copy). Declared before
   * the first mount, which reads it.
   */
  let reviewActivationExclusions: readonly ReviewRevisionKind[] | null = null;
  // How tracked changes are coloured, replaceable live; a reload mounts with the latest.
  const revisionStyleState = createRevisionStyleState(config.revisionStyles);
  /**
   * True once the reader has moved the mode themselves.
   *
   * A document reload must not undo their choice: `w:trackRevisions` says what the FILE asks
   * for, and the reader saying otherwise outranks it for the rest of the session.
   */
  let readerChoseMode = false;
  /** A refusal this facade made before the surface could see the request; see `snapshot`. */
  let facadeRejection: string | null = null;
  const mode = config.mode ?? 'edit';

  // The HOST's opening mode, when `config.mode` is explicit — precedence and reasons live
  // in `opening-editing-mode.ts`. Applied before the first mount reads `editingMode`.
  const openingModeDecision = resolveOpeningEditingMode(config.mode, {
    reviewEnabled,
    hasAuthor: Boolean(config.author),
  });
  if (openingModeDecision.mode !== null) editingMode = openingModeDecision.mode;
  if (openingModeDecision.rejection !== null) facadeRejection = openingModeDecision.rejection;

  let surface: PaginatedSurface | null = null;
  let parseError: string | null = null;
  let unsubscribeSession: Unsubscribe | null = null;
  let lastSelection: SurfaceSelection | null = null;
  /**
   * The armed typing format the last tick reported (Word's stored marks).
   *
   * Arming moves NO document revision and NO caret, so neither of this facade's two change
   * signals fires for it — and a host that only ever hears events would leave its Bold
   * button unpressed while the engine had it armed. Reference-compared: the surface hands
   * back the same array while the armed set is unchanged.
   */
  let lastPendingFormat: PaginatedSurfaceState['pendingFormat'] = null;
  /** Furniture scope key — chrome must wake even when caret text offsets did not move. */
  let lastHeaderFooterKey: string | null = null;
  /**
   * Registered hyperlink chrome, as a STACK — the top entry is live.
   *
   * Save-and-restore only survives strictly nested teardown. Two hosts registering and then
   * unregistering out of order (React does not promise effect-cleanup order between
   * siblings) had the outer one's cleanup resurrect a handler whose owner had already
   * unmounted: the engine went on reporting chrome as wired while every click and Ctrl+K
   * called into a dead component, and the popover silently stopped opening. Splicing by
   * identity is order-independent.
   */
  const hyperlinkChromeStack: HyperlinkChromeHandlers[] = [];
  const liveHyperlinkChrome = (): HyperlinkChromeHandlers =>
    hyperlinkChromeStack[hyperlinkChromeStack.length - 1] ?? {};
  let destroyed = false;

  /** The measurer built per LOAD from `config.fonts` plus the document's embedded faces. */
  let shapedMeasurer: TextMeasurer | undefined;
  let shapedProducer: string | undefined;
  /**
   * Browser registration for this document's embedded faces, under engine-minted aliases
   * (issue #78 — a file's own family name must never reach the page-global FontFaceSet).
   * Owned per load: a replaced document and `destroy()` remove exactly these faces.
   */
  let embeddedFaces: EmbeddedFontFaceRegistration | null = null;
  function disposeEmbeddedFaces(): void {
    embeddedFaces?.dispose();
    embeddedFaces = null;
  }
  /**
   * Which DOCUMENT the shaped measurer belongs to. Embedded faces are a property of the
   * loaded file, so `loadSeq` bumps per `load()` (and per constructor document) and every
   * async resolution carries the sequence it was started for — a resolution that lands
   * after the next `load()` must not install the previous document's fonts.
   */
  let loadSeq = 0;
  /**
   * What the app's font configuration turned out to BE for the loaded document.
   *
   * Identical to `config.fonts` when that is a value; the resolver's answer when it is a
   * function, which is only known once a document has been parsed. Reads that describe
   * the editor's font capability — the picker catalog, the reported default face — go
   * through {@link fontConfiguration} so the on-demand form does not report an empty
   * catalog for the whole of a document's life.
   */
  let resolvedFontConfiguration: FontConfigurationBase | undefined;
  const fontConfiguration = (): FontConfigurationBase | undefined =>
    typeof config.fonts === 'function' ? resolvedFontConfiguration : config.fonts;
  /**
   * The sequence font resolution has been KICKED for. Checked inside `mountBytes` so the
   * shaped remount (which goes back through `mountBytes` with the same document) and an
   * `attach` of the same document never restart resolution — restarting from the shaped
   * remount would resolve → remount → resolve forever.
   */
  let fontKickSeq = -1;
  /** True from the moment a load starts font work until it lands (or fails). */
  let fontsResolving = false;

  /**
   * Local-resolution probe for the compatibility notice, created against the attached
   * container's document and dropped with it — a probe answers for ONE platform's font
   * set, and headless (no container) honestly reports nothing substituted.
   */
  let localFontProbe: ((family: string) => boolean) | null = null;
  const probeLocalFont = (family: string): boolean => {
    if (!localFontProbe) {
      localFontProbe = createLocalFontProbe(
        container ? tryCreateBrowserCanvasContext(container.ownerDocument) : null
      );
    }
    return localFontProbe(family);
  };
  /**
   * Families the app's font configuration supplies or substitutes, case-folded.
   *
   * Derived rather than captured at construction: an on-demand resolver's coverage is not
   * known until a document has been loaded, and a set frozen at construction would report
   * every family the resolver went on to supply as rendering in a substitute face.
   * Memoized on the configuration's identity, which moves at most once per load.
   */
  let coveredFamiliesCache: {
    readonly configuration: FontConfigurationBase | undefined;
    readonly families: ReadonlySet<string>;
  } | null = null;
  const configCoveredFamilies = (): ReadonlySet<string> => {
    const configuration = fontConfiguration();
    if (coveredFamiliesCache === null || coveredFamiliesCache.configuration !== configuration) {
      coveredFamiliesCache = {
        configuration,
        families: new Set<string>(
          [
            ...(configuration?.sources ?? []).map((source) => source.request.family),
            ...(configuration?.substitutions ?? []).map((substitution) => substitution.from.family),
          ]
            .filter((family) => typeof family === 'string' && family.trim().length > 0)
            .map((family) => family.toLowerCase())
        ),
      };
    }
    return coveredFamiliesCache.families;
  };
  const fontFamilyCovered = (family: string): boolean =>
    configCoveredFamilies().has(family.toLowerCase()) || embeddedFaces?.alias(family) !== undefined;
  /**
   * While font work is still in flight the answer would flicker: embedded faces register
   * at resolution, so a file whose own fonts are arriving must not flash a notice first.
   *
   * A document that renders no character has nothing a substitute face could get wrong.
   * That is not a special case for the blank template but the notice's own definition:
   * `documentFonts()` reports DECLARED families, and Word's `w:docDefaults` declares
   * Calibri over a document with no runs at all — so the first thing a user saw on a page
   * they had just created was a warning about text that does not exist. The gate lifts on
   * the first typed character, when the claim becomes true.
   */
  const deriveFontSubstitutions = (): readonly string[] => {
    if (!surface || fontsResolving) return EMPTY_FONT_SUBSTITUTIONS;
    if (!surface.session.rendersText()) return EMPTY_FONT_SUBSTITUTIONS;
    return detectFontSubstitutions(
      surface.session.documentFonts(),
      fontFamilyCovered,
      probeLocalFont
    );
  };

  // ── State tick + cached snapshot ─────────────────────────────────────────────────────
  let stateVersion = 0;
  let cachedSnapshot: EditorSnapshot | null = null;
  /** The caret the cached snapshot was derived for — see `snapshotNow`. */
  let cachedCaret: ReturnType<PaginatedSurface['state']>['selection'] | null = null;
  /** The document revision the cached snapshot was derived for — see `snapshotNow`. */
  let cachedRevision = -1;
  /** Monotonic mount generation for async image mutation preconditions. */
  let mountGeneration = 0;
  let cachedVersion = -1;

  /** Called at every place observable state can move. Derivation stays lazy. */
  function bump(): void {
    stateVersion += 1;
  }

  const handlers: { [E in keyof EditorEvents]: Set<EditorEvents[E]> } = {
    change: new Set(),
    selectionChange: new Set(),
    error: new Set(),
  };

  function emitError(error: EditorError): void {
    for (const handler of [...handlers.error]) handler(error);
  }

  function emitDocumentChange(change: DocumentChange): void {
    for (const handler of [...handlers.change]) handler(change);
  }

  function emitSelectionChange(): void {
    if (handlers.selectionChange.size === 0) return;
    const snapshot = snapshotNow();
    for (const handler of [...handlers.selectionChange]) handler(snapshot);
  }

  function teardownSurface(): void {
    unsubscribeSession?.();
    unsubscribeSession = null;
    surface?.destroy();
    surface = null;
    lastSelection = null;
    lastPendingFormat = null;
    lastHeaderFooterKey = null;
    mountGeneration += 1;
  }

  // The scale, the mode, and the fit that keeps them agreeing. Callbacks rather than values,
  // because both are replaced under it — a load rebuilds the surface, `attach` replaces the
  // container — and a lane handed either directly would go on rescaling the previous one.
  const zoomLane = createZoomLane(config, {
    container: () => container,
    surface: () => surface,
    bump,
    emitSelectionChange,
  });
  const scaleOf = (): number => zoomLane.scale();

  function mountBytes(bytes: Uint8Array): void {
    if (!container) {
      // Detached: no DOM work. The bytes wait for `attach`, which mounts them under
      // whatever measurer has resolved by then. A previous document's parse failure is
      // not THESE bytes' state — `attach` re-derives any real error.
      pendingBytes = bytes;
      parseError = null;
      bump();
      return;
    }
    teardownSurface();
    const result = mountPaginatedSurface(container, bytes, {
      scale: scaleOf(),
      // What a run with no authored font is REPORTED as, matching what it is measured
      // as (`resolveFont`'s fallback below) — so a blank document's font box reads
      // "Calibri", not an em-dash.
      defaultFontFamily: configuredDefaultFontFamily(fontConfiguration()),
      ...(config.translate
        ? { drawingStrings: drawingPaintStringsFromTranslate(config.translate) }
        : {}),
      // Suggesting needs both: an author to attribute a proposal to, and the mode itself,
      // which survives a document reload because the reader chose it, not the file.
      ...(config.author ? { author: config.author } : {}),
      // Presentation policy for tracked changes, applied wherever revision markup paints.
      // The facade's state, not `config`: a reload keeps a live `setRevisionStyles`.
      ...(revisionStyleState.current() !== undefined
        ? { revisionStyles: revisionStyleState.current() }
        : {}),
      editingMode:
        editingMode === 'suggesting' ? 'suggest' : editingMode === 'viewing' ? 'view' : 'edit',
      // The free engine renders the FINAL-STATE projection (Word's "No Markup"):
      // insertions applied, deletions hidden, lossless on save. Markup rendering is a
      // review-module display mode; with one registered the surface keeps the layout
      // default (`all-markup`), which is what the review rail annotates.
      ...(reviewEnabled ? {} : { revisionDisplayMode: 'proposed' as const }),
      // The module's derivation reaches the session through the surface: the session
      // owns the per-revision memo, the module owns the algorithm. Registered custom-node
      // definitions ride along OPAQUELY so the derivation can contribute `custom` cards;
      // core never looks inside them.
      ...(modules.review
        ? {
            reviewModel: {
              ...modules.review,
              collectReviewItems: (input: ReviewModelInput) =>
                modules.review!.collectReviewItems(
                  modules.customNodes.length > 0
                    ? {
                        ...input,
                        customNodes: modules.customNodes,
                        ...(modules.customNodeDiagnostics.length > 0
                          ? { reportCustomNodeDiagnostic: reportDiagnostic }
                          : {}),
                      }
                    : input
                ),
            },
          }
        : {}),
      ...(shapedMeasurer
        ? { measurer: shapedMeasurer, ...(shapedProducer ? { producer: shapedProducer } : {}) }
        : {}),
      ...(embeddedFaces ? { fontAlias: embeddedFaces.alias } : {}),
      ...(config.tableInteractionLabel
        ? { tableInteractionLabel: config.tableInteractionLabel }
        : {}),
      ...(config.imageDecodePort ? { imageDecodePort: config.imageDecodePort } : {}),
      // Read through the holder rather than captured: the popover mounts AFTER the editor
      // exists (the provider-first shape), and a document that reloads must not leave the
      // host's chrome wired to the surface it replaced.
      onHyperlinkPopover: (activation) => liveHyperlinkChrome().onPopover?.(activation),
      onRequestHyperlink: () => liveHyperlinkChrome().onRequest?.(),
      onTrackedChange: () => {
        if (reviewPaneOpen) return;
        reviewPaneOpen = true;
        bump();
        emitSelectionChange();
      },
      tocLabels,
      onChange: (state) => {
        // The mount-time render reports before `surface` is assigned; nothing observable
        // has changed at that point, so it is not a selection change.
        if (!surface) return;
        // A publish can change layout-derived state without moving the selection —
        // toggling bold moves formatting agreement, not the caret. Worse, a `change`
        // handler may have read `snapshot()` MID-COMMIT (the session notifies before the
        // layout publishes) and cached a derivation against the layout this publish just
        // replaced. Either way the cache is stale: bump unconditionally. A value-equal
        // re-derivation returns the previous snapshot reference, so a no-op publish costs
        // one comparison, never a spurious re-render.
        bump();
        // The armed typing format is observable state with no other channel: it moves no
        // revision (so no `change`) and no caret (so the guard below would return). A host
        // learns about a Bold press at a collapsed caret here or not at all.
        const pendingMoved = state.pendingFormat !== lastPendingFormat;
        lastPendingFormat = state.pendingFormat;
        const hf = surface.headerFooterState?.();
        const hfKey = hf?.editing && hf.rId ? `${hf.editing}:${hf.rId}` : null;
        const hfMoved = hfKey !== lastHeaderFooterKey;
        lastHeaderFooterKey = hfKey;
        if (selectionsMatch(state.selection, lastSelection) && !pendingMoved && !hfMoved) {
          return;
        }
        lastSelection = state.selection;
        emitSelectionChange();
      },
    } as PaginatedSurfaceOptions & { readonly onTrackedChange?: () => void });
    if (!result.ok) {
      parseError = result.detail ? `${result.reason}: ${result.detail}` : result.reason;
      // Failure is observable state too: `snapshot().parseError` moved.
      bump();
      emitError(editorError(result.reason, `failed to open document: ${parseError}`));
      return;
    }
    parseError = null;
    surface = result.surface;
    adoptDocumentTracking();
    sweepCustomNodePayloadsOnOpen(surface, modules);
    mountGeneration += 1;
    // A surface is rebuilt on load and on the font remount, and it comes up editable. The
    // engine's own guards refuse the WRITE, but the pages layer stays `contenteditable`
    // without this — so a document open for viewing still drew a caret, still opened an IME,
    // and still told a screen reader it was writable. Reads the CURRENT mode, not just the
    // constructed one, so a remount after `setEditingMode('viewing')` comes up right.
    surface.setEditable(editingMode !== 'viewing');
    // Same remount rule for the host's activation filter: the rail set it once, and a
    // rebuilt surface that forgot it would activate cards the rail does not render.
    if (reviewActivationExclusions !== null) {
      surface.setReviewActivationExclusions(reviewActivationExclusions);
    }
    lastSelection = surface.state().selection;
    // `result.surface`, not the reassignable `surface`: this subscription is THIS session's.
    unsubscribeSession = result.surface.session.subscribe((change) => {
      const documentChange: DocumentChange = {
        // The PACKAGE revision, never `change.toRevision`: a header/footer or notes change
        // carries THAT part's counter, which starts at zero, so reporting it sent this
        // number backwards and then repeated values it had already emitted.
        revision: result.surface.session.packageRevision(),
        created: change.created,
        deleted: change.deleted,
        dirty: change.dirty,
      };
      // A commit can move a fit's numerator: `setPageSetup` directly, and undo by both of its
      // routes (the keymap's `surface.undo()` and `exec`), neither of which passes a command
      // hook. Guarded on the authored page width, so a keystroke pays one comparison.
      zoomLane.refitIfPageResized();
      // Bump BEFORE dispatch, so a handler reading `snapshot()` sees the new state.
      bump();
      emitDocumentChange(documentChange);
    });
    // The page's size is only knowable now — it comes from this document's section properties
    // — so a fit mode resolves here. Synchronous on purpose: it lands in the same task as the
    // mount, so the browser paints once at the fitted scale rather than painting 100% and
    // correcting on the next frame.
    //
    // AFTER the subscription above, because a fit that moves the scale EMITS, and a host
    // handler that throws from that emit would otherwise abort this function with the surface
    // assigned but `unsubscribeSession` unset — an editor that types but never re-renders.
    zoomLane.attach();
    // The document arrived: an external store subscribed to `change`/`selectionChange`
    // must learn about it, exactly as it learns about any later commit. Without these a
    // store bound before `load()` never re-reads and keeps rendering "no document".
    bump();
    emitDocumentChange({ revision: surface.session.packageRevision() });
    emitSelectionChange();
    // Fonts resolve per DOCUMENT (embedded faces live in the file), and only once per
    // load: the shaped remount re-enters this function with `fontKickSeq` already
    // current, so it mounts under the measurer it carries instead of restarting.
    if (fontKickSeq !== loadSeq) {
      fontKickSeq = loadSeq;
      void resolveDocumentFonts(loadSeq, surface);
    }
  }

  /** A NEW document: forget the previous document's measurer, then mount. */
  function loadBytes(bytes: Uint8Array): void {
    // A load supersedes any open still waiting on its frame: drop the superseded bytes.
    openScheduler.cancel();
    loadSeq += 1;
    shapedMeasurer = undefined;
    shapedProducer = undefined;
    // An on-demand answer describes the document that asked for it. Carrying it into the
    // next one would offer the previous file's families in this file's font picker.
    resolvedFontConfiguration = undefined;
    disposeEmbeddedFaces();
    // A superseded in-flight resolution belongs to the PREVIOUS sequence; its stale
    // guard will refuse to touch state, so the flag must reset here or a load that
    // starts no font work of its own reports `resolving: true` forever.
    fontsResolving = false;
    // A NEW document opens at its first page. The scroller is the host's element and
    // survives the remount, so the previous document's scroll offset would otherwise
    // carry over — a reader ten pages into one file opened the next file ten pages in.
    // BEFORE the mount, so the initial paint materializes the pages actually in view.
    // Only here, never in `mountBytes`: the font remount and `attach` re-enter that
    // function for the SAME document and must keep the reader's place.
    if (container) {
      const scroller = surfaceScroller(container);
      if (scroller) {
        scroller.scrollTop = 0;
        scroller.scrollLeft = 0;
      }
    }
    // A big document into a live container yields one painted frame first. Detached
    // loads only stash bytes; the later `attach` decides whether the mount earns a yield.
    if (container && openScheduler.shouldYield(bytes)) openScheduler.schedule(bytes);
    else mountBytes(bytes);
  }

  function reportFontError(error: EditorFontError): void {
    // A shaper that never loaded is not a per-face degradation: NOTHING measures correctly,
    // and the fault is the host's build rather than the document's content. Said out loud
    // exactly once, and only when nobody is listening — a host that reports it in its own
    // UI does not need library noise it cannot switch off. Before this was fixed the same
    // misconfiguration failed the BUILD, so a green build with a silent console would be a
    // strictly worse trade (#282).
    const shaperNeverLoaded =
      error.code === 'wasmUnavailable' ||
      (error.cause instanceof HarfBuzzShapingError && error.cause.code === 'unsupportedRuntime');
    if (shaperNeverLoaded && !config.onFontError && handlers.error.size === 0) {
      warnFontFailureOnce(error);
    }
    // A host handler that throws must not abort font resolution — reporting a dropped
    // face would then cost the whole shaped measurer, and the catch's own report would
    // throw again as an unhandled rejection.
    try {
      config.onFontError?.(error);
    } catch {
      /* the host's reporting problem, not the document's */
    }
    emitError(error);
  }

  // Fonts resolve asynchronously (HarfBuzz init + validation) PER LOAD, composing the
  // app's `config.fonts` with the faces the document itself embeds — explicit sources
  // beat embedded ones, and both beat substitutions. The surface samples its measurer at
  // mount, so the document opens on the fixed measurer immediately, and when the shaped
  // measurer arrives the surface is remounted FROM THE CURRENT TREE — `session.save()` —
  // so every edit made before fonts resolved survives. What does not survive is the undo
  // stack; the semantic selection is restored after the shaped surface mounts so an
  // `onReady` selection does not disappear as fonts settle. In the not-yet-attached case
  // there is nothing to remount: the measurer is simply picked up by the next mount.
  //
  // Failure is DEGRADATION, never a blocked load: a face the validator refuses drops
  // with a typed report and the remaining faces admit; a wholly failed resolution leaves
  // the document editable on the fixed measurer.
  async function resolveDocumentFonts(seq: number, mounted: PaginatedSurface): Promise<void> {
    // A bare fragment ({ sources, substitutions }) is a valid base: every other
    // configuration field takes the documented defaults, with the load sequence as the
    // epoch when the app pinned none.
    const configured = config.fonts;
    const embedded = mounted.session.embeddedFonts();
    // The zero-config, nothing-embedded common case does NO font work at all: no
    // hashing, no HarfBuzz initialization, no remount.
    if (!configured && embedded.length === 0) return;
    fontsResolving = true;
    bump();
    try {
      // On-demand configurations resolve HERE rather than at construction, which is the
      // whole point of the function form: the document is parsed and mounted by now, so
      // the resolver is told what the file actually asks for and can skip everything
      // else. A resolver that throws lands in this function's catch and degrades to the
      // fixed measurer, exactly like a failed byte source.
      const explicit: FontConfigurationBase | undefined =
        typeof configured === 'function'
          ? await configured({
              families: mounted.session.documentFonts().slice(0, MAX_RESOLVER_FAMILIES),
              defaultFamily: configuredDefaultFontFamily(fontConfiguration()),
            })
          : configured;
      // Awaiting handed control back: this load may have been superseded (or the editor
      // destroyed) while the resolver ran, and installing its answer would overwrite a
      // newer document's fonts.
      if (destroyed || seq !== loadSeq) {
        if (seq === loadSeq) fontsResolving = false;
        return;
      }
      resolvedFontConfiguration = explicit;
      // A resolver covering none of this document's families is a normal answer, not a
      // failure — and with nothing embedded there is no font work left to do.
      if (!explicit && embedded.length === 0) {
        fontsResolving = false;
        bump();
        return;
      }
      const maxFontBytes =
        (explicit && 'maxFontBytes' in explicit ? explicit.maxFontBytes : undefined) ??
        HARD_MAX_FONT_BYTES;
      // Embedded faces spend only what explicit sources left of the aggregate budget: a
      // file must not be able to starve the fonts the app itself supplied.
      const explicitBytes = (explicit?.sources ?? []).reduce(
        (total, source) => total + source.bytes.byteLength,
        0
      );
      // Faces the app's explicit sources already cover can never win composition:
      // skipped up front so they spend neither budget nor hashing time. Key derivation
      // is guarded by the same validity rule the mapper applies per-face.
      const shadowedRequests = new Set(
        (explicit?.sources ?? [])
          .filter((source) => source.request.family.trim().length > 0)
          .map((source) => fontRequestKey(source.request))
      );
      const fromDocument = embeddedFontSources(embedded, {
        maxFontBytes,
        aggregateBudget: Math.max(0, HARD_MAX_AGGREGATE_FONT_BYTES - explicitBytes),
        shadowedRequests,
      });
      for (const drop of fromDocument.dropped) {
        reportFontError(
          new EditorFontError(
            drop.reason,
            drop.reason === 'overLimit'
              ? `embedded font ${drop.request.family} (${drop.partName}) exceeds the font byte budget`
              : `embedded font part ${drop.partName} declares an invalid family name`,
            { request: drop.request }
          )
        );
      }
      const fonts = composeFontConfiguration({ epoch: seq, ...explicit }, fromDocument);
      // Nothing to shape: the fixed measurer stays. An app that DID supply a
      // configuration deserves to hear that it contributed no usable source (every
      // fetch failed, or the fragment was substitutions-only against no document
      // faces) rather than a byte-limit error from the validator.
      if (fonts.sources.length === 0) {
        fontsResolving = false;
        bump();
        if (explicit) {
          reportFontError(
            new EditorFontError(
              'missing',
              'the supplied font configuration contains no usable sources; the fixed measurer stays in effect'
            )
          );
        }
        return;
      }
      let shaping = await createLayoutShaping(fonts);
      if (destroyed || seq !== loadSeq) {
        // This shaping can never be installed; release its wasm objects rather than
        // dropping it unreferenced. Every load builds a new shaper.
        disposeLayoutShaping(shaping);
        if (seq === loadSeq) fontsResolving = false;
        return;
      }
      // Per-face degradation, reported: an embedded face the validator refused still
      // resolves — to a typed error. Probing here (map lookups, no shaping work) is what
      // turns a silent fixed-measurer fallback into a diagnosable one.
      const refusedEmbedded = new Set<string>();
      for (const source of fromDocument.sources) {
        const resolved = shaping.fonts.resolve(source.request);
        if (resolved instanceof FontResolutionError) {
          reportFontError(toEditorFontError(resolved));
          refusedEmbedded.add(source.id);
        }
      }
      // A refused embedded face is worse than no embedded face: composition drops a
      // substitution whenever a DIRECT source exists for that family, so a damaged
      // (or crafted) embedded "Calibri" would disable a perfectly good Carlito for the
      // whole document. Composition cannot know admission outcomes, so recompose once
      // without the refused faces and let the substitutions come back.
      if (refusedEmbedded.size > 0 && refusedEmbedded.size < fromDocument.sources.length) {
        const survivors = fromDocument.sources.filter((source) => !refusedEmbedded.has(source.id));
        const superseded = shaping;
        shaping = await createLayoutShaping(
          composeFontConfiguration({ epoch: seq, ...explicit }, { sources: survivors })
        );
        disposeLayoutShaping(superseded);
        if (destroyed || seq !== loadSeq) {
          disposeLayoutShaping(shaping);
          if (seq === loadSeq) fontsResolving = false;
          return;
        }
      } else if (refusedEmbedded.size === fromDocument.sources.length && !explicit) {
        // Nothing embedded survived and the app supplied nothing: the fixed measurer is
        // already the right answer, and every failure has been reported.
        fontsResolving = false;
        bump();
        return;
      }
      // Paint-side twin, BEFORE the remount so the first shaped paint already carries the
      // glyphs. Only faces the validator ADMITTED are handed over, and each resolves
      // through the shaping snapshot so the bytes registered are the validated, owned
      // copies — never the raw file view.
      //
      // App-supplied sources register alongside the embedded ones. They measure shaped
      // either way, but unregistered they PAINT in whatever the platform picks for the
      // name, so a document laid out on Carlito metrics would be drawn in something else
      // — correct pagination, wrong glyphs. Aliasing (rather than registering the family
      // name itself) is what keeps that safe; see `embedded-font-faces.ts`.
      const admitted = [...(explicit?.sources ?? []), ...fromDocument.sources]
        .filter((source) => !refusedEmbedded.has(source.id))
        .map((source) => {
          const resolved = shaping.fonts.resolve(source.request);
          return resolved instanceof FontResolutionError || resolved.id !== source.id
            ? null
            : {
                request: source.request,
                id: resolved.id,
                bytes: resolved.bytes,
                hash: resolved.hash,
                faceIndex: resolved.faceIndex,
              };
        })
        .filter((source): source is NonNullable<typeof source> => source !== null);
      const registration = await registerEmbeddedFontFaces(
        admitted,
        undefined,
        fonts.substitutions ?? []
      );
      if (destroyed || seq !== loadSeq) {
        registration.dispose();
        disposeLayoutShaping(shaping);
        if (seq === loadSeq) fontsResolving = false;
        return;
      }
      disposeEmbeddedFaces();
      embeddedFaces = registration;
      // HarfBuzz can only shape faces whose bytes reached its resource snapshot. A run may
      // still name a locally installed browser face (Helvetica is the common macOS case):
      // paint resolves that face through CSS, so falling back to the deterministic monospace
      // grid here makes every later caret drift farther from the glyphs. Resolve the fallback
      // through the same browser canvas + alias stack the unshaped surface uses. Headless
      // environments still receive the fixed measurer from this resolver.
      const fallbackResolution = resolveDefaultSurfaceMeasurer(scaleOf(), {
        context: container ? tryCreateBrowserCanvasContext(container.ownerDocument) : null,
        ...(embeddedFaces ? { fontAlias: embeddedFaces.alias } : {}),
      });
      const resolvedFonts = new Map<
        string,
        Exclude<ReturnType<typeof shaping.fonts.resolve>, FontResolutionError> | null
      >();
      shapedMeasurer = createShapedMeasurer({
        shaper: shaping.shaper,
        resolveFont: (style) => {
          // The run family is FILE-DERIVED and reaches `resolve` on every measured run.
          // `resolve` ASSERTS its request (a whitespace-only family throws), and the
          // measurer calls this outside its own guard, so an unusable family must return
          // the fixed fallback here rather than throw through layout — which would fail
          // the remount and take the mounted document with it.
          const family = style.fontFamily ?? fonts.defaultFont.family;
          if (family.trim().length === 0) return null;
          const request = {
            family,
            weight: style.bold ? 700 : 400,
            style: style.italic ? ('italic' as const) : ('normal' as const),
          };
          const key = fontRequestKey(request);
          if (resolvedFonts.has(key)) return resolvedFonts.get(key) ?? null;
          let resolved: ReturnType<typeof shaping.fonts.resolve>;
          try {
            resolved = shaping.fonts.resolve(request);
          } catch {
            resolvedFonts.set(key, null);
            return null;
          }
          const usable = resolved instanceof FontResolutionError ? null : resolved;
          resolvedFonts.set(key, usable);
          return usable;
        },
        fallback: fallbackResolution.measurer,
        shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
        unicodeDataVersion: '16.0.0',
        ...(fonts.language ? { language: fonts.language } : {}),
      });
      // The fallback is part of the geometry producer: the same HarfBuzz faces over a
      // different unresolved-family measurer must never share paragraph-cache entries.
      shapedProducer = `shaped:${shaping.operation.extensionFingerprint}+fallback:${fallbackResolution.producer}@scale:${scaleOf()}`;
      fontsResolving = false;
      if (surface) {
        // The remount tears the surface down BEFORE building the replacement, so the
        // saved bytes are the only copy of the live document while it runs. Hold them:
        // a mount that throws must leave a recoverable editor, not an empty container
        // with the document gone. Font fidelity is never worth losing the document.
        surface.flushPendingInput();
        const saved = surface.session.save();
        // Selection is facade state just like the live tree. In particular, `onReady` can
        // set and reveal a range while embedded fonts are still resolving; keeping only the
        // scroller's offset made that first call travel to the right text and then lose its
        // highlight when this remount replaced the surface.
        const savedSelection = surface.state().selection;
        // A remount replaces the whole subtree, so focus lands on `document.body` — the
        // user typing while fonts resolved would silently stop being able to type.
        // Restore it when the OLD surface had it; never steal it otherwise.
        const hadFocus =
          typeof document !== 'undefined' &&
          document.activeElement !== null &&
          container !== null &&
          container.contains(document.activeElement);
        try {
          mountBytes(saved);
        } catch (remountError) {
          shapedMeasurer = undefined;
          shapedProducer = undefined;
          if (!surface) {
            pendingBytes = saved;
            mountBytes(saved);
          }
          reportFontError(toEditorFontError(remountError));
        }
        if (hadFocus) surface?.focus();
        surface?.setSelection(savedSelection);
      } else bump();
    } catch (error) {
      if (destroyed || seq !== loadSeq) return;
      fontsResolving = false;
      bump();
      reportFontError(toEditorFontError(error));
    }
  }

  /** The right-click TOC context, reference-stable while the id holds — see support. */
  const tocContextOf = createTocContextCache();

  function deriveSnapshot(): EditorSnapshot {
    const state = surface?.state() ?? null;
    const scope = surface?.activeScope?.() ?? SCOPE_BODY;
    return {
      scope,
      // "No document to work with, and nothing went wrong" — deliberately NOT "nothing
      // painted". Bytes count from the moment they are handed over, whether they are
      // still waiting for `attach` (`pendingBytes`) or already mounted (`surface`), so
      // this survives a detach/remount and never depends on a mount point existing.
      //
      // That distinction is load-bearing: a host may legitimately gate its
      // `DocxEditor.Content` on this flag, and a definition that only cleared once pages
      // painted would deadlock — nothing paints until Content mounts, and Content never
      // mounts while the flag is set. A parse failure clears it too; a document that
      // cannot open is not still arriving, and `parseError` is how that is reported.
      // A scheduled open counts as "bytes handed over" too, or a host gating its mount
      // point on this flag would unmount the container the scheduled mount needs.
      isLoading:
        parseError === null &&
        surface === null &&
        pendingBytes === null &&
        !openScheduler.isScheduled(),
      // A supplied document on its way to painted pages. OVERLAY state only — gate
      // chrome on it, never the mount point; `isLoading` remains the gate-safe flag.
      isOpening: openScheduler.isScheduled(),
      parseError,
      // The LIVE mode, not only the construction-time one: hosts gate their chrome on this,
      // and it read `true` while every command was being refused with `locked`.
      editable:
        surface !== null &&
        surface.session.editable &&
        mode !== 'view' &&
        editingMode !== 'viewing',
      zoom: zoomLane.zoom(),
      zoomMode: zoomLane.mode(),
      selection: selectionRangeOf(surface),
      // Whether the selection is a CARET rather than a range.
      //
      // Cheap on purpose. The only way to ask this used to be
      // `query({ type: 'selectedText' }) === ''`, which materializes the whole selected
      // string to answer a boolean — and hosts ask it from selector functions that re-run on
      // every tick, so a select-all on a long document allocated megabytes per tick to learn
      // one bit. `selection` cannot carry it: `DocRange` addresses paragraphs by paraId and
      // has no offsets, so a caret and a within-paragraph range look identical there.
      selectionCollapsed:
        state === null ||
        (state.selection.anchor.paragraphId === state.selection.head.paragraphId &&
          state.selection.anchor.offset === state.selection.head.offset),
      formatting: runFormattingOf(surface),
      table: tableContextOf(surface),
      tocContext: tocContextOf(state?.contextTocId ?? null),
      image: selectedImageStateOf(surface),
      page: { current: currentPageOf(surface), total: totalPagesOf(surface) },
      canUndo: state?.canUndo ?? false,
      canRedo: state?.canRedo ?? false,
      pageSetup: pageSetupOf(surface),
      reviewPaneOpen,
      hasReviewContent: surface?.session.hasReviewContent() ?? false,
      editingMode,
      // The facade's own refusal wins while it stands: the surface never saw the request.
      // A document that ASKS for tracked changes and cannot get them — no author configured
      // — is refused before any keystroke reaches the surface, so there is nothing in the
      // surface state to report it. Cleared the moment the surface refuses anything itself.
      lastRejection: state?.lastRejection ?? facadeRejection,
      fontSubstitutions: deriveFontSubstitutions(),
    };
  }

  /**
   * The cached read model. Derives at most once per state tick, deep-freezes, and reuses
   * the previous `formatting`/`page` sub-objects (or the whole previous snapshot) when
   * value-equal, so references only change when values do.
   */
  function snapshotNow(): EditorSnapshot {
    if (cachedSnapshot && cachedVersion === stateVersion) return cachedSnapshot;
    const previous = cachedSnapshot;
    const caret = surface?.state().selection ?? null;
    const caretUnmoved = selectionsMatch(caret, cachedCaret);
    cachedCaret = caret;
    const revision = surface?.session.packageRevision() ?? -1;
    const documentUnmoved = revision === cachedRevision;
    cachedRevision = revision;
    const fresh = deriveSnapshot();
    let next: EditorSnapshot = fresh;
    if (previous) {
      const formatting = formattingEqual(fresh.formatting, previous.formatting)
        ? previous.formatting
        : fresh.formatting;
      const page = pageEqual(fresh.page, previous.page) ? previous.page : fresh.page;
      const pageSetup = pageSetupEqual(fresh.pageSetup ?? null, previous.pageSetup ?? null)
        ? previous.pageSetup
        : fresh.pageSetup;
      const selection = docRangeEqual(fresh.selection, previous.selection)
        ? previous.selection
        : fresh.selection;
      const image = imageContextEqual(fresh.image, previous.image) ? previous.image : fresh.image;
      const fontSubstitutions =
        previous.fontSubstitutions !== undefined &&
        fresh.fontSubstitutions !== undefined &&
        previous.fontSubstitutions.length === fresh.fontSubstitutions.length &&
        fresh.fontSubstitutions.every((family, i) => previous.fontSubstitutions![i] === family)
          ? previous.fontSubstitutions
          : fresh.fontSubstitutions;
      next = { ...fresh, formatting, page, pageSetup, selection, image, fontSubstitutions };
      // Reuse the previous REFERENCE only when neither the caret NOR the document moved.
      //
      // The snapshot is a lossy projection: `selection` is paragraph-granular (a
      // `DocRange` addresses paragraphs by `w14:paraId`, never by offset), and nothing in
      // it names the document revision. So two genuinely different states — a caret move
      // WITHIN a paragraph, a structural edit at an unmoved caret — derive value-equal
      // snapshots, and a host subscribed through `useSyncExternalStore` never re-renders —
      // freezing every control whose state is a question the snapshot does not carry,
      // because `toolbarCommandState` re-asks `Editor.can`/`isActive` only when the store
      // ticks.
      //
      // Caret: Decrease Indent stayed live on a list item already at the outermost level,
      // and the bullet button stayed pressed after the caret moved into a numbered one.
      //
      // Revision: an edit that changes only STRUCTURE leaves formatting, page, canUndo and
      // canRedo all equal at an unmoved caret. Toggling a bullet OFF (a second press) left
      // the button pressed, and one Increase Indent that reached the deepest level a
      // definition declares left the button live for a press that could only be refused.
      if (snapshotsEqual(next, previous) && caretUnmoved && documentUnmoved) next = previous;
    }
    cachedSnapshot = deepFreezeValue(next);
    cachedVersion = stateVersion;
    return cachedSnapshot;
  }

  if (config.document) {
    const bytes = normalizeSource(config.document);
    if (bytes) loadBytes(bytes);
    else {
      parseError = unloadableSourceReason(config.document);
      emitError(editorError('unsupported', parseError));
    }
  }

  /**
   * A counter that moves when the queue could differ, and not otherwise.
   *
   * Three inputs, because any one alone misses a case. The store REVISION covers edits, but a
   * freshly loaded document starts back at revision 0 — a sidebar keyed on that alone stays
   * empty forever after the first load, which is exactly how this was found. The SURFACE
   * IDENTITY covers the load. The ACTIVE KEY covers a caret move, which changes no document
   * state at all but does change which card is open.
   *
   * A monotonic tick rather than a hash of the three, so a subscriber can compare with `!==`
   * and never sees a value repeat after an edit is undone.
   */
  let reviewTick = 0;
  let reviewSurface: unknown = null;
  let reviewSeenRevision = '';
  let reviewSeenActive: string | null = null;
  let reviewSeenPaneOpen = true;
  let reviewSeenSelectionAnchor: number | null = null;

  function reviewRevision(): number {
    // BOTH revisions, like the session's own queue cache: an accept inside a header moves
    // only the package revision, and a tick watching the body alone left the rail frozen —
    // undoing that accept put the tracked change back with no card beside it.
    const revision = `${surface?.session.packageRevision() ?? -1}:${
      surface?.session.revision() ?? -1
    }`;
    const active = activeReviewKeyNow();
    // The selection is an input too: the "comment on this" affordance appears and moves with
    // it, and a counter blind to it left the button absent no matter what was selected.
    const selectionAnchor = selectionPlacement()?.anchorY ?? null;
    if (
      surface !== reviewSurface ||
      revision !== reviewSeenRevision ||
      active !== reviewSeenActive ||
      reviewPaneOpen !== reviewSeenPaneOpen ||
      selectionAnchor !== reviewSeenSelectionAnchor
    ) {
      reviewSurface = surface;
      reviewSeenRevision = revision;
      reviewSeenActive = active;
      reviewSeenPaneOpen = reviewPaneOpen;
      reviewSeenSelectionAnchor = selectionAnchor;
      reviewTick += 1;
    }
    return reviewTick;
  }

  /*
   * The ACTIVE card is the one the caret is in — not something a click stores. Clicking a
   * card moves the caret into its range, so both routes converge on one rule, and a caret
   * arriving by keyboard, by find, or by an outline jump opens the same card a click would.
   * A stored key would have had to be invalidated by every one of those. The surface
   * answers, because it also paints the band, and two derivations of "which item is open"
   * can disagree.
   */

  function firstReviewRange(item: ReviewItem): ReviewRange | null {
    if (item.kind === 'revision') return item.ranges[0] ?? null;
    return item.range;
  }

  /**
   * Whether `setActiveReviewItem` would take this item.
   *
   * The one definition both the flag on a placement and the verb itself read, so a rail can
   * never be told an item is clickable by one and refused by the other. Two grounds, and
   * they are the ones activation checks first: an item with no range has nothing to select,
   * and a kind the host's rail hides must not be reachable — the band would light a card
   * nothing on screen renders.
   */
  function reviewItemActivatable(item: ReviewItem): boolean {
    if (firstReviewRange(item) === null) return false;
    return !(
      item.kind === 'revision' &&
      reviewActivationExclusions !== null &&
      reviewActivationExclusions.includes(item.revisionKind)
    );
  }

  const anchorIndexOf = createAnchorIndex();

  /**
   * Paragraph id → note scope id, built once per LAYOUT from the painted note stories.
   *
   * The layout already states which note each paragraph belongs to (`NoteStoryRecord`
   * carries `scopeId`), so this is a lookup rather than a search. The first version walked
   * the notes part per item — O(items x notes x subtree), which measured 91 ms per
   * `getTrackedChanges()` call on a document with 600 note revisions.
   */
  const noteScopeIndexCache = new WeakMap<SemanticLayout, Map<string, string>>();
  function noteScopeIndexOf(layout: SemanticLayout): Map<string, string> {
    const cached = noteScopeIndexCache.get(layout);
    if (cached) return cached;
    const index = new Map<string, string>();
    for (const page of layout.pages) {
      for (const area of [page.footnotes, page.endnotes]) {
        if (!area) continue;
        for (const note of area.notes) {
          for (const fragment of paragraphFragmentsOfBlocks(note.fragments)) {
            // Every paragraph the fragment DRAWS. A note whose paragraphs a resolved view
            // merges publishes one fragment, and an absorbed member with no scope made its
            // card look like a body card: no note to accept it in, no note to scroll to.
            for (const paragraphId of fragmentParagraphs(fragment)) {
              if (!index.has(paragraphId)) index.set(paragraphId, note.scopeId);
            }
          }
        }
      }
    }
    noteScopeIndexCache.set(layout, index);
    return index;
  }

  /**
   * Which story a review item lives in, from the part name its ranges carry.
   *
   * `null` rId means the part is not a header/footer this document's sections resolve —
   * i.e. the body (or an unknown part, which is treated as body rather than guessed at).
   */
  function furnitureHomeOf(
    item: ReviewItem
  ): { readonly kind: 'header' | 'footer'; readonly rId: string } | null {
    const partName = firstReviewRange(item)?.partName;
    if (!partName || !surface || partName === surface.session.part().name) return null;
    for (const section of surface.session.headerFooterResolutionBySection()) {
      for (const kind of ['header', 'footer'] as const) {
        const slots = kind === 'header' ? section.headers : section.footers;
        for (const slot of slots.values()) {
          if (slot.partName === partName) return { kind, rId: slot.rId };
        }
      }
    }
    return null;
  }

  /**
   * The note a card's range sits in, as the scope id `enterNote` takes.
   *
   * A note is a story like a header, but it is addressed by the NOTE rather than by the
   * part: one `footnotes.xml` holds every footnote, and entering it means entering one of
   * them. So the walk is part → note → its paragraphs, and the answer is the note whose
   * subtree holds the card's paragraph.
   */
  function noteHomeOf(item: ReviewItem): string | null {
    const range = firstReviewRange(item);
    const layout = surface?.publishedLayout();
    if (!range || !layout) return null;
    return noteScopeIndexOf(layout).get(range.start.paragraphId) ?? null;
  }

  /**
   * The notes PART a card lives in, for a write that must land there.
   *
   * Derived from the part NAME, not from the note: which part a write targets is a
   * question the range answers by itself, and routing it through the per-note lookup made
   * it fail whenever that lookup did — a note whose `w:id` the file omits, or one the
   * layout has not painted. The card was then treated as a body card, so Accept reported
   * `unknown-revision` on a card the queue itself listed as resolvable.
   */
  function noteStoryScopeOf(
    item: ReviewItem
  ): { readonly kind: 'notesPart'; readonly noteKind: 'footnote' | 'endnote' } | null {
    const partName = firstReviewRange(item)?.partName;
    if (!partName || !surface) return null;
    // Read from the PACKAGE, never `partFor`: resolving a notes scope opens a story store,
    // and this runs per item on read paths (`getTrackedChanges`, the review placements).
    for (const noteKind of ['footnote', 'endnote'] as const) {
      if (resolveNotesPart(surface.session.currentPackage(), noteKind)?.name === partName) {
        return { kind: 'notesPart', noteKind };
      }
    }
    return null;
  }

  /** The story a card's range lives in, for a write that must land in that part. */
  function storyScopeOfReviewItem(item: ReviewItem): StoryScope {
    const home = furnitureHomeOf(item);
    if (home !== null) return { kind: 'headerFooter', rId: home.rId };
    return noteStoryScopeOf(item) ?? { kind: 'body' };
  }

  /**
   * Leave the open header/footer or note story when the paragraph being navigated to does
   * not live in it.
   *
   * Every "go to this position" API addresses a paragraph, and an open furniture scope makes
   * that address ambiguous: a body id set while a header is open clamps the caret back into
   * the story the reader is in, and the surface then refuses each keystroke as
   * `unknown-paragraph` — the page scrolls to the target and typing goes nowhere. Called
   * BEFORE the selection is set, so the caret lands in the story that owns it.
   */
  function leaveScopeForParagraph(paragraphId: string): void {
    if (!surface || surface.activeScope().kind === 'body') return;
    // Only for a BODY target. A paragraph belonging to some other story is not somewhere
    // leaving this one would help, and in-story navigation must not close the story the
    // reader opened.
    if (!surface.session.paragraphIds().includes(paragraphId)) return;
    surface.exitNote?.();
    surface.exitHeaderFooter?.();
  }

  /** Word writes `@w:date` to the second; milliseconds group with nothing. */
  const secondsPrecisionNow = (): string => `${new Date().toISOString().slice(0, 19)}Z`;

  /** Open by default: a document with comments should show them without being asked. */
  let reviewPaneOpen = true;

  /** Paragraph id to document position, memoized per layout. */
  const paragraphOrderCache = new WeakMap<SemanticLayout, Map<string, number>>();
  function paragraphOrderOf(layout: SemanticLayout): Map<string, number> {
    const cached = paragraphOrderCache.get(layout);
    if (cached) return cached;
    const index = new Map<string, number>();
    for (const [position, id] of documentOrder(layout).entries()) index.set(id, position);
    paragraphOrderCache.set(layout, index);
    return index;
  }

  /**
   * The range a new comment would cover: the RETAINED pin when a panel took focus, else the
   * live selection. Null when nothing is selected, or the selection is a caret.
   */
  function commentTargetRange(): { from: SemanticPosition; to: SemanticPosition } | null {
    // The captured offsets outlive this read (they anchor the comment), so any
    // queued typing must land before they are taken.
    surface?.flushPendingInput();
    const selection = surface?.retainedSelection() ?? surface?.state().selection ?? null;
    if (!selection) return null;
    const { anchor, head } = selection;
    if (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset) return null;
    const layout = surface?.publishedLayout();
    if (!layout) return null;
    // Document order, not the order the user swept in: a backwards drag has its head first.
    // Through the memoized INDEX, not `indexOf` over the id list — this runs on every
    // snapshot read, and a linear scan of a 2432-paragraph document twice per read is the
    // kind of cost that only shows up on the documents that can least afford it.
    const order = paragraphOrderOf(layout);
    let anchorIndex = order.get(anchor.paragraphId) ?? -1;
    let headIndex = order.get(head.paragraphId) ?? -1;
    if (anchorIndex === -1 || headIndex === -1) {
      // The body layout order only knows body paragraphs, so a range selected inside a
      // header, footer or note resolved to nothing: `selectionAnchorY` came back null, the
      // "comment on this" affordance never appeared, and `addComment` reported that a
      // comment needs a selected range while one was plainly on screen. The open story
      // publishes its own order, and that is the ruler for a selection inside it.
      const scoped = openStoryParagraphOrder();
      anchorIndex = scoped.get(anchor.paragraphId) ?? -1;
      headIndex = scoped.get(head.paragraphId) ?? -1;
    }
    if (anchorIndex === -1 || headIndex === -1) return null;
    const forwards =
      anchorIndex < headIndex || (anchorIndex === headIndex && anchor.offset <= head.offset);
    return forwards ? { from: anchor, to: head } : { from: head, to: anchor };
  }

  /** The story the reader has open, in the vocabulary the store's writes take. */
  function openStoryScope(): StoryScope {
    const scope = surface?.activeScope();
    if (scope?.kind === 'headerFooter') return { kind: 'headerFooter', rId: scope.rId };
    if (scope?.kind === 'note') {
      const parsed = parseNoteScopeId(scope.id);
      if (parsed) return { kind: 'notesPart', noteKind: parsed.noteKind };
    }
    return { kind: 'body' };
  }

  /**
   * The story a PARAGRAPH lives in, which is what a write about that paragraph must target.
   *
   * The open scope is a near-enough proxy most of the time and wrong exactly when it
   * matters: nothing binds the selection to it, so a host that sets a body selection while
   * a header is open got an affordance offering to comment and a write that was then
   * refused. Paragraph ids are part-qualified, so the range answers this by itself.
   */
  function storyScopeOfParagraph(paragraphId: string): StoryScope {
    if (!surface) return { kind: 'body' };
    // From the id's own PART NAME. Asking each story for its paragraph list instead would
    // resolve every scope in turn, and resolving a scope OPENS a story store: one call
    // opened every header and footer in the document, and the store cap (64) is a
    // permanent ceiling because a store whose part is still in the package is never
    // evicted. On a 40-section document that left 18 headers unopenable for the rest of
    // the session — commenting in a footnote broke header editing.
    const partName = paragraphId.slice(0, paragraphId.indexOf('#'));
    if (partName.length === 0 || partName === surface.session.part().name) {
      return { kind: 'body' };
    }
    for (const section of surface.session.headerFooterResolutionBySection()) {
      for (const slots of [section.headers, section.footers]) {
        for (const slot of slots.values()) {
          if (slot.partName === partName) return { kind: 'headerFooter', rId: slot.rId };
        }
      }
    }
    for (const noteKind of ['footnote', 'endnote'] as const) {
      if (resolveNotesPart(surface.session.currentPackage(), noteKind)?.name === partName) {
        return { kind: 'notesPart', noteKind };
      }
    }
    // Unknown to every story: fall back to where the reader is, which is what the write
    // would have used anyway, and let the store refuse it.
    return openStoryScope();
  }

  /** Paragraph order of the story the reader currently has open, empty for the body. */
  function openStoryParagraphOrder(): ReadonlyMap<string, number> {
    if (!surface) return new Map();
    const story = openStoryScope();
    if (story.kind === 'body') return new Map();
    const index = new Map<string, number>();
    for (const [position, id] of surface.session.paragraphIdsIn(story).entries()) {
      index.set(id, position);
    }
    return index;
  }

  /**
   * The whole span a card covers. Content kinds (insert/delete/replace) span first range
   * start to last range end — their ranges are contiguous by construction, a replacement's
   * two halves included. Everything else anchors at its first range only.
   */
  function reviewItemSpan(
    item: ReviewItem
  ): { readonly start: SemanticPosition; readonly end: SemanticPosition } | null {
    if (item.kind === 'revision') {
      const ranges = item.ranges;
      if (ranges.length === 0) return null;
      const contiguous =
        item.revisionKind === 'replace' ||
        item.revisionKind === 'insert' ||
        item.revisionKind === 'delete';
      const last = contiguous ? ranges[ranges.length - 1]! : ranges[0]!;
      return { start: ranges[0]!.start, end: last.end };
    }
    const range = firstReviewRange(item);
    return range ? { start: range.start, end: range.end } : null;
  }

  /** Where a comment on the current selection would sit. */
  function selectionPlacement(): { readonly anchorY: number; readonly pageIndex: number } | null {
    // STILL LOAD-BEARING, though it covers less than it used to. Activation leaves a
    // collapsed caret, and `commentTargetRange` already declines a collapsed selection — so
    // the ordinary case needs no help. What this catches is the RETAINED range: a reader who
    // had text selected, then opened a card whose caret landed inside it, would otherwise be
    // offered a second comment on a selection they are no longer looking at. Asked of the
    // SURFACE, which owns the pin and invalidates it by value the moment the reader selects
    // anything else; a copy kept here was written on only one of activation's three branches,
    // so a header or note card still offered to comment on itself. `commentTargetRange` stays
    // untouched, so replying over the activated text still works.
    if (surface && surface.activatedReviewKey() !== null) return null;
    const range = commentTargetRange();
    const layout = surface?.publishedLayout();
    if (!range || !layout) return null;
    const anchor = anchorIndexOf(layout).get(range.from.paragraphId);
    if (!anchor) return null;
    return {
      pageIndex: anchor.pageIndex,
      anchorY: anchor.contentY + anchorLineY(anchor, range.from.paragraphId, range.from.offset),
    };
  }

  /** Which item is open, as the SURFACE reports it — it also paints the band. */
  function activeReviewKeyNow(): string | null {
    return surface?.activeReviewKey() ?? null;
  }

  /**
   * The queue plus geometry, re-derived per call and cheap because the session memoizes the
   * queue itself per revision.
   */

  function reviewPlacements(query?: ReviewItemQuery): readonly ReviewItemPlacement[] {
    if (!reviewEnabled) return [];
    let items = surface?.session.reviewItems() ?? [];
    const excluded = query?.excludeRevisionKinds;
    if (excluded && excluded.length > 0) {
      const excludedKinds = new Set(excluded);
      items = items.filter(
        (item) => item.kind !== 'revision' || !excludedKinds.has(item.revisionKind)
      );
      // A comment that answers a change this QUERY dropped is a top-level card again. The
      // link is only a reason to render the comment inside the change's card, so publishing
      // it beside a change the caller cannot see makes the comment unrenderable: the rail
      // skips it as a reply and no card claims it. The rail hides `format` and `structural`
      // by default, and a tracked formatting change anchors on exactly the run it decorates
      // — the same span a reviewer's comment on that word covers — so this is the ordinary
      // case, not a corner one.
      const present = new Set(
        items.filter((item) => item.kind === 'revision').map((item) => item.id)
      );
      items = items.map((item) => {
        if (item.kind !== 'comment' || item.parentRevisionId === undefined) return item;
        if (present.has(item.parentRevisionId)) return item;
        const { parentRevisionId: _dropped, ...rest } = item;
        return rest;
      });
    }
    const withPlacement = query?.placement !== false;
    let anchors: Map<string, ReviewParagraphAnchor> | null = null;
    if (withPlacement && items.length > 0) {
      const layout = surface?.publishedLayout() ?? null;
      if (layout) anchors = anchorIndexOf(layout);
    }
    const activeReviewKey = activeReviewKeyNow();
    // The queue ranks furniture stories after the whole body (tree order), but the rail
    // stacks cards top-down and never moves one UP past its anchor — a header card sorted
    // after page 40's cards would render at the rail's bottom, pages away from the header
    // it annotates. Reorder by the page a card sits beside; within a page, header cards
    // first, then body cards in document order, then footer cards. The sort is stable, so
    // body cards keep the tree order the queue promised.
    const groupOf = (item: ReviewItem): number => {
      const home = furnitureHomeOf(item);
      return home === null ? 1 : home.kind === 'header' ? 0 : 2;
    };
    const ranked = items.map((item, position) => ({
      item,
      position,
      pageIndex: anchors ? (reviewItemGeometry(item, anchors)?.pageIndex ?? null) : null,
      group: groupOf(item),
    }));
    ranked.sort((a, b) => {
      const aPage = a.pageIndex ?? Number.MAX_SAFE_INTEGER;
      const bPage = b.pageIndex ?? Number.MAX_SAFE_INTEGER;
      if (aPage !== bPage) return aPage - bPage;
      if (a.group !== b.group) return a.group - b.group;
      return a.position - b.position;
    });
    return ranked.map(({ item }): ReviewItemPlacement => {
      const key = reviewItemKey(item);
      const geometry = anchors ? reviewItemGeometry(item, anchors) : null;
      const shared = {
        key,
        id: item.id,
        ...(dateOfItem(item) !== undefined ? { date: dateOfItem(item)! } : {}),
        // Derived from the two facts activation itself checks, so the flag and the verb
        // cannot disagree. Not from `geometry`, which is null for a whole page that has not
        // been laid out yet — an item is addressable long before it has a Y.
        activatable: reviewItemActivatable(item),
        anchorY: geometry?.y ?? null,
        pageIndex: geometry?.pageIndex ?? null,
        isActive: key === activeReviewKey,
      };
      if (item.kind === 'comment') {
        return {
          ...shared,
          kind: 'comment',
          author: item.comment.author,
          initials: commentInitials(item.comment),
          text: commentBodyText(item.comment),
          resolved: item.resolved,
          ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
          ...(item.parentRevisionId !== undefined
            ? { parentRevisionId: item.parentRevisionId }
            : {}),
          replyIds: item.replyIds,
          readOnly: false,
          item,
        };
      }
      if (item.kind === 'revision') {
        return {
          ...shared,
          kind: 'revision',
          revisionKind: item.revisionKind,
          author: item.author,
          initials: initialsOfAuthor(item.author),
          text: item.text,
          ...(item.replacedText ? { replacedText: item.replacedText } : {}),
          replyIds: item.replyIds,
          readOnly: item.readOnly,
          item,
        };
      }
      // A custom card is informational: nothing to accept, reject, or reply to.
      return {
        ...shared,
        kind: 'custom',
        author: '',
        initials: '',
        text: item.detail ?? item.text,
        replyIds: [],
        readOnly: true,
        item,
      };
    });
  }

  /** What the OPEN document asks for, or nothing when no document is mounted. */
  function documentTracking(): DocumentTrackingSettings {
    return surface?.session.trackingSettings() ?? NO_TRACKING_SETTINGS;
  }

  /**
   * Enter suggesting mode when the DOCUMENT asked for it — `w:trackRevisions` asks, and
   * enforced trackedChanges protection requires. What overrides what, and why a refusal
   * is published, lives with the decision: `documentTrackingAdoption` in
   * `opening-editing-mode.ts`.
   */
  function adoptDocumentTracking(): void {
    const tracking = documentTracking();
    const decision = documentTrackingAdoption({
      viewOnly: mode === 'view',
      reviewEnabled,
      hasAuthor: Boolean(config.author),
      hostChoseMode: config.mode !== undefined,
      readerChoseMode,
      currentMode: editingMode,
      trackRevisions: tracking.trackRevisions,
      restrictedToTrackedChanges: tracking.restrictedToTrackedChanges,
    });
    if (decision.rejection !== null) facadeRejection = decision.rejection;
    if (decision.mode !== 'suggesting') return;
    editingMode = 'suggesting';
    surface?.setEditingMode('suggest');
  }

  /**
   * The document's own refusal of a mode change, or null.
   *
   * `w:documentProtection/@w:edit="trackedChanges"` says the document permits editing ONLY as
   * tracked changes, so leaving suggesting is refused. It is ADVISORY and never presented as
   * enforcement — the password hash is not verified and the file is editable by anyone
   * holding it — but ignoring it silently produces exactly the untracked edits its author
   * asked not to have. Viewing is always reachable: reading less than the document permits
   * is not something a protection setting has an interest in.
   */
  function modeRestriction(next: DocumentEditingMode): ExecResult | null {
    if (next !== 'editing') return null;
    if (!documentTracking().restrictedToTrackedChanges) return null;
    return {
      ok: false,
      code: 'locked',
      reason: 'this document permits editing only as tracked changes',
    };
  }

  function dateOfItem(item: ReviewItem): string | undefined {
    if (item.kind === 'comment') return item.comment.date;
    return item.kind === 'revision' ? item.date : undefined;
  }

  /** Initials from a name, for a revision — `CT_TrackChange` carries no `@w:initials`. */
  function initialsOfAuthor(author: string): string {
    const words = author.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    return words
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join('');
  }

  function resolveReviewItem(key: string, action: 'accept' | 'reject'): ExecResult {
    if (!reviewEnabled) {
      return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    }
    const placement = reviewPlacements().find((entry) => entry.key === key);
    const item = placement?.item as ReviewItem | undefined;
    if (!item || item.kind !== 'revision') {
      return { ok: false, code: 'notFound', reason: 'no revision with that key' };
    }
    if (item.readOnly) {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'this revision kind has no structural accept/reject yet',
      };
    }
    // EVERY address the card stands for, in ONE transaction. A replacement is two revisions
    // in the file and one decision to the reviewer; resolving half of it — the deletion
    // accepted, the replacement text still pending — is a state nobody asked for and one
    // undo would not take back.
    let applied: { committed: boolean; reason?: unknown } | undefined;
    // A revision in a header/footer resolves against ITS story store, not the body's. The
    // default body scope simply failed to find the address, so an Accept on a header card
    // reported "refused" over a change the queue itself had listed. A note is the same
    // case, now that note revisions reach the queue at all.
    surface?.commitReviewOps(() => {
      applied = surface!.session.applyTreeOps(
        item.addresses.map((revision) =>
          action === 'accept'
            ? ({ op: 'acceptRevision', revision } as const)
            : ({ op: 'rejectRevision', revision } as const)
        ),
        undefined,
        undefined,
        storyScopeOfReviewItem(item)
      );
      return applied;
    });
    if (!applied?.committed) {
      const reason =
        typeof applied?.reason === 'string' ? applied.reason : 'the revision was refused';
      return { ok: false, code: 'unsupported', reason };
    }
    return { ok: true, changed: true };
  }

  const editor: DocxEditorInstance = {
    get mountGeneration() {
      return mountGeneration;
    },
    get surface() {
      return surface;
    },

    setHyperlinkChrome(handlers) {
      hyperlinkChromeStack.push(handlers);
      return () => {
        // Splice by IDENTITY, not by position: unregistering out of order must remove this
        // entry and leave whatever else is registered alone, never resurrect a handler whose
        // owner has already torn down.
        const at = hyperlinkChromeStack.lastIndexOf(handlers);
        if (at >= 0) hyperlinkChromeStack.splice(at, 1);
      };
    },

    stateVersion: () => stateVersion,

    fontMeasurement: () => ({
      measurer: shapedMeasurer ? ('shaped' as const) : ('fixed' as const),
      resolving: fontsResolving,
      ...(shapedMeasurer && shapedProducer ? { producer: shapedProducer } : {}),
    }),

    attach(el) {
      if (destroyed) {
        // Terminal by design: React StrictMode double-invokes effects, and a component
        // that destroyed its instance must create a new one rather than resurrect this.
        emitError(
          editorError('destroyed', 'this editor was destroyed; create a new instance to remount')
        );
        return;
      }
      if (surface && container === el) return;
      if (surface) {
        // Moving containers: carry the live content, not the original bytes.
        surface.flushPendingInput();
        pendingBytes = surface.session.save();
        teardownSurface();
      }
      // A scheduled open was aimed at the PREVIOUS container — and being the newer
      // document, it outranks any bytes saved off the old surface.
      const reclaimed = openScheduler.cancel();
      if (reclaimed) pendingBytes = reclaimed;
      // BEFORE the container moves, unconditionally. The observer is on a scroller found
      // through the OLD container, and only the successful-mount path below re-targets it: a
      // load that failed to parse leaves no surface and no pending bytes, so attaching to a
      // new element took the `else bump()` branch and left the observer watching an element
      // this editor no longer uses — and holding it alive if the host dropped it.
      zoomLane.detach();
      container = el;
      // A probe answers for one document's font set; the new container may live in a
      // different one (an iframe host), so it re-creates on the next derivation.
      localFontProbe = null;
      const bytes = pendingBytes;
      pendingBytes = null;
      // A mount bumps the tick and emits change/selectionChange itself. A big document
      // yields one painted frame first, instead of freezing the commit the attach ran in.
      if (bytes && openScheduler.shouldYield(bytes)) openScheduler.schedule(bytes);
      else if (bytes) mountBytes(bytes);
      else bump();
    },

    detach() {
      if (destroyed) return;
      // Before the container goes: the observer is on an element found THROUGH it, and one
      // left running would keep re-fitting a document that is no longer mounted.
      zoomLane.detach();
      // Reclaimed before the surface save, applied after: the scheduled document is
      // the newer one, so it wins the pending slot.
      const reclaimed = openScheduler.cancel();
      if (surface) {
        surface.flushPendingInput();
        pendingBytes = surface.session.save();
        teardownSurface();
      }
      if (reclaimed) pendingBytes = reclaimed;
      container = null;
      localFontProbe = null;
      bump();
    },

    load(document) {
      const bytes = normalizeSource(document);
      if (!bytes) {
        // A handle is identity, not content — there are no bytes to reopen, and an
        // unrecognized string is a typo. The current document (if any) stays mounted
        // rather than being torn down for nothing.
        emitError(editorError('unsupported', unloadableSourceReason(document)));
        return;
      }
      loadBytes(bytes);
    },

    save() {
      // A save inside the open's yield window sees the just-loaded document: mount now.
      openScheduler.flush();
      if (!surface) return Promise.reject(editorError('notFound', 'no document is loaded'));
      // Ctrl+S can race a typing burst: queued keystrokes belong in the bytes.
      surface.flushPendingInput();
      // A fresh copy, so the returned ArrayBuffer is exactly the document — not a window
      // into a larger allocation.
      const bytes = surface.session.save();
      const copy = bytes.slice();
      return Promise.resolve(copy.buffer as ArrayBuffer);
    },

    getDocumentHandle(): DocumentHandle {
      // Package revision: the body's own stands still for header/footer/note work.
      return Object.freeze({ revision: surface?.session.packageRevision() ?? 0 });
    },

    exec(command, options) {
      // A command inside the yield window addresses the just-loaded document: mount now.
      // (`can` does NOT flush — chrome polls it per render; a read must not defeat the yield.)
      openScheduler.flush();
      // A view command: it edits nothing, so it runs before the document gate, and it works
      // on a document that failed to open — the pane is still the reader's to close. Not on a
      // DESTROYED editor, though: there is no reader left.
      if (destroyed && (command.type === 'toggleReviewPane' || command.type === 'setEditingMode')) {
        return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
      }
      if (command.type === 'setEditingMode') {
        // A document opened with `mode: 'view'` is read-only for the session. Letting the
        // control move off Viewing put "Editing" on the pill of a document where every
        // command was still refused.
        if (mode === 'view' && command.mode !== 'viewing') {
          return { ok: false, code: 'locked', reason: 'this document was opened for viewing' };
        }
        if (command.mode === 'suggesting' && !reviewEnabled) {
          return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
        }
        const restriction = modeRestriction(command.mode);
        if (restriction) return restriction;
        readerChoseMode = true;
        facadeRejection = null;
        editingMode = command.mode;
        // The SURFACE decides what an op becomes, so it has to hear about this; `viewing`
        // additionally gates every command below through `gateCommand`.
        surface?.setEditingMode(
          command.mode === 'suggesting' ? 'suggest' : command.mode === 'viewing' ? 'view' : 'edit'
        );
        // The DOM affordance is separate from the op gate: `setEditingMode` decides what a
        // write becomes, this decides whether the browser offers one at all.
        surface?.setEditable(command.mode !== 'viewing');
        bump();
        emitSelectionChange();
        return { ok: true, changed: false };
      }
      if (command.type === 'toggleReviewPane') {
        if (!reviewEnabled) {
          return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
        }
        reviewPaneOpen = !reviewPaneOpen;
        bump();
        emitSelectionChange();
        return { ok: true, changed: false };
      }
      if (isContentControlEditorCommand(command)) {
        // The LIVE mode, not the constructed one — see `gateModeOf`.
        return runContentControlCommand(command, surface, gateModeOf(editingMode), options);
      }
      // Viewing refuses every EDIT, reversibly — the reader chose it and can choose again.
      // Checked HERE as well as in `can`, because a host that calls `exec` directly is not
      // required to ask first and must not get a write it was told it could not have.
      //
      // Mutating only. A blanket refusal also blocked `selectAll` and `copy`, which is a
      // viewer that cannot select or copy the document it exists to show — and it disagreed
      // with the construction-time `mode: 'view'` path, which has always gated on `mutating`
      // through `gateCommand`. Same visible state, two behaviours.
      const viewingGate = classifyCommand(command);
      if (editingMode === 'viewing' && viewingGate.supported && viewingGate.mutating) {
        return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
      }
      const gated = gateCommand(command, surface, mode, options);
      if (!gated.ok) return gated.refusal;
      const mounted = surface!;
      // Package revision covers body, furniture stories, and lifecycle ops; body-only
      // revision would report HF / create-header edits as `changed: false`.
      const before = mounted.session.packageRevision();

      const result = execEditorCommand(mounted, command, {
        ...(gated.tablePlan ? { admittedTablePlan: gated.tablePlan } : {}),
        editor,
      });
      if (result) return result;
      // `changed` is read from the model, not assumed: reporting `changed: true` where the
      // document did not move would be a lie. It answers for the DOCUMENT, not for
      // observable state — a mark toggled at a collapsed caret ARMS the typing format
      // (`toggleRunProperty`), which moves the snapshot and fires a tick while committing
      // nothing, so it correctly reports `changed: false`. Package revision covers body,
      // furniture stories, and lifecycle ops; body-only revision would miss HF edits.
      return { ok: true, changed: mounted.session.packageRevision() !== before };
    },

    can(command, options): CanResult {
      if (command.type === 'insertImage' || command.type === 'replaceImage') {
        if (destroyed) return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
        if (options?.scope) {
          const scoped = gateCommand(command, surface, mode, options);
          if (!scoped.ok) return scoped.refusal;
        }
        return canAsyncImageCommandOf(command, surface);
      }
      if (command.type === 'toggleReviewPane' || command.type === 'setEditingMode') {
        // Not on a destroyed instance, and not for a mode this document refuses. `can` is
        // the one thing chrome trusts; answering `ok` for an editor that no longer exists is
        // the invention the enabled-state rule exists to prevent.
        // `notFound` rather than a new code: a destroyed editor answers the same way for
        // every command, and the established contract for "there is nothing here" is this.
        if (destroyed) return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
        if (command.type === 'toggleReviewPane' && !reviewEnabled) {
          return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
        }
        if (command.type === 'setEditingMode' && mode === 'view' && command.mode !== 'viewing') {
          return { ok: false, code: 'locked', reason: 'this document was opened for viewing' };
        }
        if (command.type === 'setEditingMode') {
          if (command.mode === 'suggesting' && !reviewEnabled) {
            return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
          }
          const restriction = modeRestriction(command.mode);
          if (restriction) return restriction;
        }
        return { ok: true };
      }
      if (isContentControlEditorCommand(command)) {
        return canContentControlCommand(command, surface, gateModeOf(editingMode), options);
      }
      // Viewing refuses every EDIT, the same way `mode: 'view'` does at construction — but
      // reversibly, because the reader chose it and can choose again. Mutating only, so a
      // reader can still select and copy; see the note at the `exec` twin.
      const viewingSupport = classifyCommand(command);
      if (editingMode === 'viewing' && viewingSupport.supported && viewingSupport.mutating) {
        return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
      }
      const gated = gateCommand(command, surface, mode, options);
      if (!gated.ok) return gated.refusal;
      if (
        command.type === 'proposeInsertion' ||
        command.type === 'proposeDeletion' ||
        command.type === 'proposeReplacement'
      ) {
        const writer = (command.author ?? config.author ?? '').trim();
        if (!writer) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: `${command.type} requires a non-empty author`,
          };
        }
        const resolved =
          command.target === undefined
            ? { ok: true as const, selection: surface!.state().selection }
            : resolveDocTargetSelection(surface!, command.target);
        if (!resolved.ok) return resolved;
        const { anchor, head } = resolved.selection;
        const collapsed = anchor.paragraphId === head.paragraphId && anchor.offset === head.offset;
        if (command.type !== 'proposeInsertion' && collapsed) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: `${command.type} needs a non-collapsed selection`,
          };
        }
        if (command.type === 'proposeReplacement' && anchor.paragraphId !== head.paragraphId) {
          return {
            ok: false,
            code: 'unsupported',
            reason: 'tracked replacement across paragraph marks is not supported',
          };
        }
      }
      if (isImageCommand(command) && imageCommandHasIdentityFields(command)) {
        const pre = captureImageMutationPreconditions(editor);
        if (pre) {
          const identity = verifyImageCommandIdentity(editor, command, pre);
          if (identity) return identity;
        }
      }
      return { ok: true };
    },

    // Derived for marks and alignment from the cached snapshot's formatting — Word's
    // agreement rule, the same one `toggleRunProperty` toggles against. Everything else
    // stays honest-false until its derivation exists.
    isActive(command) {
      if (command.type === 'toggleReviewPane') return reviewPaneOpen;
      if (command.type === 'setEditingMode') return editingMode === command.mode;
      const formatting = surface ? snapshotNow().formatting : null;
      if (!formatting) return false;
      switch (command.type) {
        case 'toggleMark':
          switch (command.mark) {
            case 'bold':
              return formatting.bold === true;
            case 'italic':
              return formatting.italic === true;
            case 'underline':
              return formatting.underline === true;
            case 'strike':
              return formatting.strike === true;
            // One property, two of its values: each is pressed only for its OWN value, so
            // superscripted text shows Subscript un-pressed rather than both lit.
            case 'superscript':
              return formatting.superscript === true;
            case 'subscript':
              return formatting.subscript === true;
            default:
              return false;
          }
        case 'setAlignment':
          // `exec` writes `justify` as `both`; compare in the same vocabulary.
          return formatting.alignment === (command.align === 'justify' ? 'both' : command.align);
        case 'toggleList':
          // Pressed only when the WHOLE selection is that list, matching the toggle's own
          // rule: a mixed selection is not "on".
          return surface?.isListActive(command.kind) ?? false;
        default:
          return false;
      }
    },

    // Real derivations from the canonical trees (session-memoized), no longer stubs.
    getDocumentStyles: () => surface?.session.documentStyles() ?? [],
    getDocumentFonts: () => surface?.session.documentFonts() ?? [],
    // The picker's list: the configured catalog is offerable with no document at all,
    // and the document's declared families join it once one is mounted.
    getAvailableFonts: () =>
      availableFontFamilies(fontConfiguration(), surface?.session.documentFonts() ?? []),
    getDocumentThemeColors: () => surface?.session.documentThemeColors() ?? [],
    getOutline: () => surface?.session.documentOutline() ?? [],
    getComments: () => [],

    // Reads the SAME unified derivation as `snapshot().formatting` (one code path),
    // reshaped to this member's declared vocabulary (half-points).
    getSelectionFormatting: () =>
      selectionFormattingHalfPoints(surface ? snapshotNow().formatting : null),

    // Search reads the canonical tree through the session's memo, so repeated identical
    // questions (a find panel re-rendering, a next/previous press) cost nothing. The
    // `truncated` half of the derivation is dropped here because this member's declared
    // answer is an array; a caller comparing the length against the documented cap learns
    // the same thing.
    findMatches: (query, options) =>
      surface?.session.findText(query, {
        ...(options?.matchCase !== undefined ? { matchCase: options.matchCase } : {}),
        ...(options?.wholeWord !== undefined ? { wholeWord: options.wholeWord } : {}),
      }).matches ?? [],

    // Finding is a read and selecting is a write, so this is the only half that moves the
    // caret. The match already carries the paragraph id and the offsets in the surface's
    // own vocabulary, so there is nothing to re-derive — and REVEALING is separate from
    // selecting, because moving the caret does not move the viewport: a match twenty pages
    // down would otherwise be selected where nobody could see it.
    selectMatch(match: TextMatch): ExecResult {
      // Same rule as `exec`: a selection aimed into the yield window lands, not refuses.
      openScheduler.flush();
      if (!surface) {
        return { ok: false, code: 'notFound', reason: 'no document is loaded' };
      }
      if (
        typeof match?.blockId !== 'string' ||
        match.blockId.length === 0 ||
        !Number.isInteger(match.start) ||
        match.start < 0 ||
        !Number.isInteger(match.length) ||
        match.length < 0
      ) {
        return { ok: false, code: 'invalidArgs', reason: 'match must carry a blockId and offsets' };
      }
      // A hit in the body while a header is open belongs to the body: land the caret in the
      // story that owns it, or the selection clamps back into the furniture and the reader
      // types into nothing.
      leaveScopeForParagraph(match.blockId);
      surface.setSelection({
        anchor: { paragraphId: match.blockId, offset: match.start },
        head: { paragraphId: match.blockId, offset: match.start + match.length },
      });
      surface.revealParagraph(match.blockId);
      return { ok: true, changed: false };
    },

    getSelectedImage: () => snapshotNow().image,
    getSelectedTable: () => selectedTableOf(surface),

    getTableCellSelection: () => {
      const cells = surface?.state().cellSelection;
      if (!cells) return null;
      return {
        tableId: cells.tableId,
        rows: cells.rows,
        columns: cells.columns,
        cellIds: cells.cellIds,
      };
    },

    setTableInteractionLabel(resolver) {
      surface?.setTableInteractionLabel(resolver);
    },

    canExecuteImageCommand(command, options) {
      if (destroyed) return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
      if (options?.scope) {
        const gated = gateCommand(command, surface, mode, options);
        if (!gated.ok) return gated.refusal;
      }
      return canExecuteImageCommandOf(command, surface);
    },

    executeImageCommand(command) {
      if (destroyed)
        return Promise.resolve({ ok: false, code: 'notFound', reason: 'the editor was destroyed' });
      return executeImageCommandOf(editor, command);
    },

    getPageSetup: () => pageSetupOf(surface),

    getWatermark: () => null,
    getTrackedChanges: () =>
      (surface?.session.reviewItems() ?? [])
        .filter((item) => item.kind === 'revision')
        .map((item) => {
          const home = furnitureHomeOf(item);
          return {
            id: item.id,
            kind: item.kind === 'revision' ? item.revisionKind : 'revision',
            ...(item.kind === 'revision' && item.author ? { author: item.author } : {}),
            // From the PART, so a note whose id the file omits still names its story.
            story:
              home !== null ? home.kind : (noteStoryScopeOf(item)?.noteKind ?? ('body' as const)),
          };
        }),

    getReviewItems: (query?: ReviewItemQuery) => reviewPlacements(query),
    getCustomNodeDefinitions: () => modules.customNodes,
    reportCustomNodeDiagnostic: reportDiagnostic,

    addComment(text: string, author?: string): ExecResult {
      // Comment AUTHORING is the review module's capability, like every other
      // review write above. Missed in the first gating pass — caught by review.
      if (!reviewEnabled) {
        return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
      }
      const range = commentTargetRange();
      if (!range || !surface) {
        return { ok: false, code: 'invalidArgs', reason: 'a comment needs a selected range' };
      }
      const writer = (author ?? config.author ?? '').trim();
      if (writer.length === 0 || text.trim().length === 0) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'a comment needs both an author and text',
        };
      }
      let created: string | null = null;
      surface.commitReviewOps(() => {
        created = surface!.session.replyToComment(
          null,
          {
            paragraphId: range.from.paragraphId,
            start: range.from.offset,
            end: range.to.offset,
            ...(range.to.paragraphId === range.from.paragraphId
              ? {}
              : { endParagraphId: range.to.paragraphId }),
          },
          text,
          writer,
          secondsPrecisionNow(),
          // The story the SELECTED PARAGRAPH is in, not the one the reader happens to have
          // open. Commenting on header or note text wrote against the body store, which has
          // never heard of that paragraph, so the write was refused — after the affordance
          // had already invited it.
          storyScopeOfParagraph(range.from.paragraphId)
        );
        return { committed: created !== null };
      });
      if (created === null) {
        return { ok: false, code: 'unsupported', reason: 'the comment could not be committed' };
      }
      return { ok: true, changed: true };
    },

    getSelectionPlacement: () => selectionPlacement(),

    isReviewPaneOpen: () => reviewPaneOpen,

    getEditingMode: () => editingMode,
    getReviewAuthors: () =>
      revisionStyleState.authorsFor(surface?.revisionAuthors() ?? EMPTY_AUTHOR_SLOTS),
    getConfiguredAuthor: () => config.author?.trim() || null,
    getReviewAuthorStyle: (author) => revisionStyleState.styleFor(author),
    setRevisionStyles(colors) {
      revisionStyleState.set(colors);
      surface?.setRevisionStyles(colors);
      // Presentation state moved: bump so snapshot readers re-render, and broadcast the
      // way a mode change does, so subscribed hooks hear it.
      bump();
      emitSelectionChange();
    },
    setEditingMode: (mode) => editor.exec({ type: 'setEditingMode', mode }),

    getReviewRevision: () => reviewRevision(),

    setActiveReviewItem(key: string | null, options?: ReviewActivationOptions): ExecResult {
      // Dismissing is the only thing a key of `null` can mean here. A card the reader closed
      // stays closed until the caret next moves, and closing also drops the activation pin —
      // so the answer goes back to the caret rather than to the card that was just closed.
      if (key === null) {
        surface?.dismissActiveReview();
        bump();
        emitSelectionChange();
        return { ok: true, changed: false };
      }
      if (!surface) {
        return { ok: false, code: 'notFound', reason: 'no document is open' };
      }
      // The span offsets taken from the placements below outlive this call twice over — they
      // become the selection AND the activation pin, which then validates itself against that
      // selection by value. Queued typing landing afterwards would shift the caret out from
      // under a pin that had just recorded where it was, and the card the reader opened would
      // close by itself. Same rule as `commentTargetRange` and `replyToReviewItem`.
      surface.flushPendingInput();
      const placement = reviewPlacements().find((entry) => entry.key === key);
      const item = placement?.item;
      if (!item) {
        return { ok: false, code: 'notFound', reason: 'no review item with that key' };
      }
      const range = firstReviewRange(item);
      if (!range) {
        return {
          ok: false,
          code: 'unsupported',
          reason: 'this review item has no resolvable range',
        };
      }
      // The rail's own exclusion filter. Refused OUT LOUD rather than by falling through to
      // a selection nothing lights up: the caret would land on the text, no card would open,
      // and a host stepping through its queue would see the viewport move and the active key
      // stay put with nothing to explain it.
      if (!reviewItemActivatable(item)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: `review items of kind '${(item as { revisionKind?: string }).revisionKind}' are excluded from activation`,
        };
      }
      // A card whose range lives in a header/footer opens that scope, exactly as Word does:
      // the body selection cannot address a furniture paragraph, so setting it would only
      // clamp the caret to some unrelated body position. The mounted `enterHeaderFooter`
      // reveals the band on the way. Falls THROUGH to the announcement below — returning
      // here left the rail unre-rendered, so the header card never lit up.
      const home = item ? furnitureHomeOf(item) : null;
      // A note is a story on the same terms — one `footnotes.xml` holds every footnote, so
      // its scope names the NOTE rather than the part. Without this the note's own
      // paragraph id went to a body selection, which clamps it to an unrelated position.
      const note = home === null && item ? noteHomeOf(item) : null;
      if (home !== null) {
        const entered = surface.enterHeaderFooter?.({
          rId: home.rId,
          kind: home.kind,
          position: { paragraphId: range.start.paragraphId, offset: range.start.offset },
        });
        if (!entered) {
          return {
            ok: false,
            code: 'unsupported',
            reason: 'the header or footer this change lives in could not be opened',
          };
        }
      } else if (note !== null) {
        const entered = surface.enterNote?.(note, {
          paragraphId: range.start.paragraphId,
          offset: range.start.offset,
        });
        if (!entered) {
          return {
            ok: false,
            code: 'unsupported',
            reason: 'the note this change lives in could not be opened',
          };
        }
      } else {
        // Card to document. The caret may be parked in a furniture or note scope from the
        // PREVIOUS card — leave it first, exactly as the pointer path does, or the body
        // selection below gets clamped inside the open story and no body card can ever
        // become active again.
        surface.exitNote?.();
        surface.exitHeaderFooter?.();
        // A CARET AT THE START, not a selection over the span.
        //
        // Opening a card is a request to look at a change, not a request to select its
        // text — and selecting it took the reader's own selection away to say something
        // the page already said: the open item draws its own `--active` band, at full
        // tint with a rule under it, which is what marks the change while the card is
        // open. The selection added a second, competing highlight and left the reader
        // holding a range they never made, one keystroke away from replacing the very
        // text under review.
        //
        // The caret still MOVES, to the start of the span. That is what keeps the keyboard
        // where the reader is looking, what `activeReviewKey` classifies at, and what the
        // reveal below scrolls to; a header, footer or note card has always landed a bare
        // caret this way, so the body branch now agrees with them.
        const span = reviewItemSpan(item!) ?? range;
        const caret = { paragraphId: span.start.paragraphId, offset: span.start.offset };
        // Through `activateReview`, not `setSelection`: the card this opens has to be named
        // before the selection is published, or the surface reports whichever card the caret
        // classifies to — the wrong twin, when two cards share one span — and corrects itself
        // a frame later.
        surface.activateReview(key, { anchor: caret, head: caret });
        // Focus-independent by design: the rail card focused itself on mousedown, which is
        // exactly what keeps the caret-follow scroll from ever firing here.
        // `centerIfNeeded` by default, not `nearest`: opening a card the reader can already
        // see must not yank the page, but a card 20 pages away scrolled the MINIMUM distance
        // parked the change flush against the bottom edge — the reader arrived looking at the
        // last line of the window rather than at the edit they had just asked to see. A host
        // whose own list drives the scroll passes `reveal: false` and gets the caret move
        // without the engine competing for the viewport.
        const reveal = options?.reveal ?? 'centerIfNeeded';
        if (reveal !== false) surface.revealPosition?.(span.start, { block: reveal });
      }
      // A header, footer or note card pins here instead: those branches install the selection
      // themselves, inside the scope they open, so there is nothing to hand down. The body
      // branch above has already pinned with its own selection.
      if (home !== null || note !== null) surface.activateReview(key);
      // ANNOUNCED, exactly as dismissing is. Opening a card is observable state of its own,
      // and the surface's `onChange` deliberately stays quiet when the caret did not move —
      // which is precisely this case whenever the card is reopened after being DISMISSED:
      // dismissing leaves the caret inside the range, so setting it back to the range start
      // moves nothing, no `selectionChange` was emitted, and the rail never re-rendered. The
      // engine considered the card open and the reader was looking at a closed one that would
      // not respond to any number of further clicks.
      bump();
      emitSelectionChange();
      // `changed: false` — activation moves the caret and the open card, and neither is
      // document state. A host must not mark its document dirty for opening a card.
      return { ok: true, changed: false };
    },

    setReviewActivationExclusions(kinds: readonly ReviewRevisionKind[] | null) {
      reviewActivationExclusions = kinds === null ? null : [...kinds];
      surface?.setReviewActivationExclusions(reviewActivationExclusions);
    },

    acceptReviewItem: (key: string) => resolveReviewItem(key, 'accept'),
    rejectReviewItem: (key: string) => resolveReviewItem(key, 'reject'),

    setCommentResolved(key: string, resolved: boolean): ExecResult {
      return setReviewCommentResolved(
        {
          reviewEnabled,
          editingMode,
          placements: reviewPlacements,
          surface,
          proReviewReason: PRO_REVIEW_REASON,
          bump,
        },
        key,
        resolved
      );
    },

    deleteReviewItem(key: string): ExecResult {
      if (!reviewEnabled) {
        return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
      }
      const placement = reviewPlacements().find((entry) => entry.key === key);
      const item = placement?.item as ReviewItem | undefined;
      if (!item || !surface) {
        return { ok: false, code: 'notFound', reason: 'no review item with that key' };
      }
      // Discarding a suggestion IS rejecting it — same transaction, same undo step, and the
      // refusal rules for an unresolvable kind already live there.
      if (item.kind === 'revision') return resolveReviewItem(key, 'reject');
      if (item.kind !== 'comment') {
        return { ok: false, code: 'unsupported', reason: 'a custom node card cannot be deleted' };
      }
      // An active key naming an item the queue no longer holds leaves the rail with nothing to
      // draw and a band painted over text that has no card, so the open card is dismissed
      // first — but ONLY when it is this one. `dismissActiveReview` acts on whatever the caret
      // is in, and the delete button keeps the caret exactly where it was, so deleting a
      // comment further down the page closed the card the reader was replying in and threw
      // the draft away with it.
      if (activeReviewKeyNow() === key) surface.dismissActiveReview();
      let deleted = false;
      surface.commitReviewOps(() => {
        const note = noteHomeOf(item);
        const parsed = note === null ? null : parseNoteScopeId(note);
        deleted = surface!.session.deleteComment(
          item.id,
          storyScopeOfReviewItem(item),
          parsed?.noteId
        );
        return { committed: deleted };
      });
      if (!deleted) {
        return { ok: false, code: 'unsupported', reason: 'the comment could not be deleted' };
      }
      bump();
      return { ok: true, changed: true };
    },

    replyToReviewItem(key: string, text: string, author?: string): ExecResult {
      if (!reviewEnabled) {
        return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
      }
      // The reply's anchor offsets are captured from the placements below and
      // outlive this call; queued typing must land before they are taken, the
      // same rule as commentTargetRange.
      surface?.flushPendingInput();
      const placement = reviewPlacements().find((entry) => entry.key === key);
      const item = placement?.item as ReviewItem | undefined;
      if (!item || !surface) {
        return { ok: false, code: 'notFound', reason: 'no review item with that key' };
      }
      const range = firstReviewRange(item);
      if (!range) {
        return { ok: false, code: 'invalidArgs', reason: 'the item has no anchorable range' };
      }
      const writer = (author ?? config.author ?? '').trim();
      const refusal = reviewReplyRefusal(item, text, writer);
      if (refusal) return refusal;
      // Against a REVISION this is a comment over that revision's range: OOXML gives `w:ins`
      // and `w:del` no body and no thread, so there is nowhere else for the text to live.
      const parent = item.kind === 'comment' ? item.id : null;
      let created: string | null = null;
      surface.commitReviewOps(() => {
        created = surface!.session.replyToComment(
          parent,
          {
            paragraphId: range.start.paragraphId,
            start: range.start.offset,
            end: range.end.offset,
          },
          text,
          writer,
          // Word stamps every comment it writes, and a card with no date reads as older
          // than the ones around it. The clock is the HOST's, which is why the store takes
          // the value rather than reading one: a store that called `Date.now()` could not
          // be tested for a deterministic round trip.
          secondsPrecisionNow(),
          // The story the card's range lives in. Written against the body, a header
          // anchor names a paragraph the body store does not have, and every reply to a
          // header or footer card was refused.
          storyScopeOfReviewItem(item)
        );
        return { committed: created !== null };
      });
      if (created === null) {
        return { ok: false, code: 'unsupported', reason: 'the reply could not be committed' };
      }
      return { ok: true, changed: true };
    },

    getHeaderFooterState: () => surface?.headerFooterState() ?? null,
    getNotePropertiesState: () => surface?.notePropertiesState?.() ?? null,
    getNotePreviewText: (scopeId) => surface?.notePreviewText?.(scopeId) ?? null,
    setActiveScope(scope: ViewScope) {
      if (surface?.setActiveScope(scope)) bump();
    },
    getActiveScope: (): ViewScope => surface?.activeScope() ?? { kind: 'body' },

    query<K extends keyof EditorQueries>(query: { type: K } & EditorQueries[K]) {
      // The real answers, and the typed empty value for everything else.
      switch (query.type as keyof EditorQueries) {
        case 'selectedText':
          return (surface?.selectedText() ?? '') as EditorQueryResults[K];
        case 'selectionFormatting':
          return (surface ? snapshotNow().formatting : null) as EditorQueryResults[K];
        case 'selection':
          return selectionRangeOf(surface) as EditorQueryResults[K];
        case 'paragraphs':
          return paragraphSummaries(
            surface,
            (query as { container?: ContainerRef }).container
          ) as unknown as EditorQueryResults[K];
        case 'isInsideToc':
          return (
            surface ? surface.isInsideToc(surface.state().selection.head.paragraphId) : false
          ) as EditorQueryResults[K];
        case 'hyperlinkAt':
          return hyperlinkAtOf(surface) as EditorQueryResults[K];
        case 'contentControls':
          return contentControlsOf(
            surface,
            (query as { filter?: ContentControlFilter }).filter
          ) as unknown as EditorQueryResults[K];
        case 'trackedChanges':
        case 'revisions':
        case 'findText':
        case 'comments':
          return [] as unknown as EditorQueryResults[K];
        case 'styles':
          return {
            paragraph: new Map(),
            character: new Map(),
            table: new Map(),
          } as unknown as EditorQueryResults[K];
        case 'variables':
          return {} as EditorQueryResults[K];
        case 'contentControlAt':
          return contentControlAtOf(
            surface,
            (query as { filter?: ContentControlFilter }).filter
          ) as unknown as EditorQueryResults[K];
        case 'tableContext':
          return tableContextOf(surface) as EditorQueryResults[K];
        default:
          // watermark, splitCellConfig and pageContent are nullable and underived.
          return null as EditorQueryResults[K];
      }
    },

    snapshot: () => snapshotNow(),

    getTotalPages: () => totalPagesOf(surface),
    getCurrentPage: (mode) => currentPageOf(surface, mode),

    // Page NUMBERS are 1-based in this contract; the layout indexes from 0.
    scrollToPage: (pageNumber: number) => {
      if (!Number.isInteger(pageNumber) || pageNumber < 1) return false;
      // A scroll aimed into the open's yield window addresses the just-loaded document:
      // mount it now, or the call would silently report "no such page".
      openScheduler.flush();
      return surface?.revealPage(pageNumber - 1) ?? false;
    },
    scrollToBlock: (blockId: string) => {
      if (typeof blockId !== 'string' || blockId.length === 0) return false;
      // Same yield-window rule as `scrollToPage`.
      openScheduler.flush();
      // Revealing a body block is a move OUT of an open header or note: the outline and the
      // search pane both drive this, and leaving the scope on the furniture left the reader
      // looking at the body with every keystroke going to a story off screen.
      leaveScopeForParagraph(blockId);
      return surface?.revealParagraph(blockId) ?? false;
    },

    ...zoomFacadeMembers(zoomLane, () => surface),

    relayout(options?: { sync?: boolean }) {
      // `layout()` flushes any commit the scheduler has not published yet; the surface
      // repaints from its own publish path, so there is nothing further to trigger — which
      // is what `sync: true` asks for, and the only thing this can do. Read rather than
      // ignored: a declared parameter that vanishes into nothing is how a caller comes to
      // believe it changed something.
      void options?.sync;
      surface?.layout();
    },
    retainSelection: () => surface?.retainSelection() ?? null,
    releaseSelection: (pin) => surface?.releaseSelection(pin),
    focus(scope?: EditorScope) {
      // Same yield-window rule as `exec`: focusing the just-loaded document mounts it.
      openScheduler.flush();
      if (!surface) {
        return { ok: false, code: 'invalidTarget', reason: 'no document is loaded' };
      }
      // The ARGUMENT was declared and ignored, so `focus({kind:'body'})` — the obvious call
      // for a host trying to leave an open header — reported success and changed nothing.
      // Refused rather than silently dropped when the scope cannot be opened. `all` is a
      // reading scope with no caret home, so it is not a thing to focus.
      if (scope && scope.kind === 'all') {
        return { ok: false, code: 'invalidTarget', reason: 'the all scope cannot take focus' };
      }
      if (scope && !surface.setActiveScope(scope)) {
        return { ok: false, code: 'invalidTarget', reason: 'that scope cannot be opened' };
      }
      surface.focus();
      return { ok: true, value: undefined };
    },

    destroy() {
      destroyed = true;
      openScheduler.cancel();
      zoomLane.detach();
      disposeEmbeddedFaces();
      teardownSurface();
      container = null;
      pendingBytes = null;
      mountGeneration += 1;
      bump();
      for (const set of Object.values(handlers)) set.clear();
    },

    on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe {
      // `display` handlers are accepted but never called: the surface paints its own
      // pages instead of publishing a render list. Documented at the top of this file.
      handlers[event].add(handler);
      return () => {
        handlers[event].delete(handler);
      };
    },
  };

  return editor;
}
