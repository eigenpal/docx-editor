// The `Editor` facade over the paginated surface.
//
// `createDocxEditor` implements the FULL `Editor` contract over the paginated surface —
// the document session, semantic layout and painted pages. This is the composition root
// the framework adapters mount.
//
// DELIBERATE PLACEHOLDER SHAPE — the `isActive` precedent, applied to a whole facade.
//
// The contract itself blesses honest-empty stubs: a control that shows nothing is better
// than one that shows a guess. This facade follows that rule everywhere:
//
// - REAL: load/save, the exec subset below (marks, mark attributes via `setMarkAttr`,
//   alignment, indent, line break, undo/redo, semantic setSelection, selection-addressed
//   insert/delete text), selection formatting, `isActive` for marks and alignment, page
//   setup, page counts, the cached snapshot (with canUndo/canRedo),
//   change/selectionChange/error events, focus, destroy, attach/detach, `query` for
//   `selectedText` and `selectionFormatting`, and the document catalogs
//   (`getDocumentFonts`/`getDocumentStyles`, derived from the canonical trees).
// - HONEST EMPTY: outline, comments, tracked changes, find, image/table
//   context, watermark, header/footer state, and the entire geometry/interaction cluster
//   (`getInteractionFrame`, `hitTest`, `dispatchInteraction`, …) — the paginated surface
//   owns caret, selection and hit testing INTERNALLY through the browser's own selection,
//   so there is no engine-published geometry to project yet. Every member returns its
//   typed empty value, never an invented one.
// - The `display` event never fires: the surface paints its own pages into the container
//   rather than handing the host a render list.
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

import type {
  CanResult,
  ContainerRef,
  DocumentChange,
  DocumentHandle,
  DocumentSource,
  Editor,
  EditorError,
  EditorEvents,
  EditorQueries,
  EditorQueryResults,
  EditorScope,
  EditorSnapshot,
  ExecResult,
  FontConfiguration,
  TextMatch,
  Unsubscribe,
  ViewScope,
} from '@docx-editor.dev/core-contract/contracts/editor';
import { EditorFontError } from '@docx-editor.dev/core-contract/contracts/editor';
import {
  FontResolutionError,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARFBUZZ_SHAPING_LIBRARY,
  fontRequestKey,
  createFixedMeasurer,
  createShapedMeasurer,
  type SemanticSelection as SurfaceSelection,
  type TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';
import {
  deepFreezeValue,
  docRangeEqual,
  editorError,
  emptyInteractionFrame,
  formattingEqual,
  normalizeSource,
  pageEqual,
  pageSetupEqual,
  selectionsMatch,
  snapshotsEqual,
} from './docx-editor-support.ts';
import { execEditorCommand } from './docx-editor-exec.ts';
import {
  currentPage as currentPageOf,
  pageSetupOf,
  gateCommand,
  hyperlinkAtOf,
  paragraphSummaries,
  runFormattingOf,
  selectionRangeOf,
  totalPages as totalPagesOf,
  tableContextOf,
} from './docx-editor-derive.ts';
import {
  createLayoutShaping,
  disposeLayoutShaping,
  toEditorFontError,
} from './font-configuration.ts';
import { composeFontConfiguration, type FontConfigurationFragment } from './font-composition.ts';
import { embeddedFontSources } from './embedded-font-sources.ts';
import {
  registerEmbeddedFontFaces,
  type EmbeddedFontFaceRegistration,
} from './embedded-font-faces.ts';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceState,
} from './paginated-surface.ts';
import type { HyperlinkActivation } from './surface-navigation.ts';

export interface DocxEditorConfig {
  /**
   * The element the paginated surface mounts into. The surface owns this subtree.
   *
   * Optional: an instance created WITHOUT a container stashes its document bytes and does
   * no DOM work until `attach(el)` — the provider-first shape, where the editor exists
   * before any component has rendered a mount point. With a container, the document mounts
   * immediately at construction, exactly as before.
   */
  container?: HTMLElement;
  /**
   * A document to load at construction. Bytes only in practice: a `DocumentHandle` cannot
   * be re-opened (the handle is identity, not content), so passing one emits a typed
   * `error` event rather than silently loading nothing.
   */
  document?: DocumentSource;
  /**
   * Font bytes for Word-accurate (HarfBuzz-shaped) line wrap and pagination. Omitted,
   * layout falls back to a fixed-width estimate; fonts embedded in the document are
   * wired in automatically either way. For Word's default faces (Calibri, Times New
   * Roman, …) pass `await loadDefaultFonts()` from `@docx-editor.dev/fonts` — a bare
   * fragment (`{ sources, substitutions }`) is accepted and composed with defaults, or
   * merge several origins yourself with `composeFontConfiguration`. Sampled per load;
   * failures degrade to the fixed measurer and report through `onFontError`.
   */
  fonts?: FontConfiguration | FontConfigurationFragment;
  author?: string;
  locale?: string;
  /** `'view'` refuses every mutating command through the facade; default `'edit'`. */
  mode?: 'edit' | 'view';
  zoom?: number;
  onFontError?: (error: EditorFontError) => void;
}

/**
 * Which measurer the current document's layout runs on, and whether shaped resolution is
 * still in flight. Returned by {@link DocxEditorInstance.fontMeasurement}.
 */
export interface FontMeasurementState {
  /** `fixed` estimates advance widths; `shaped` measures real font bytes with HarfBuzz. */
  readonly measurer: 'fixed' | 'shaped';
  /** True while font resolution for the current document is still running. */
  readonly resolving: boolean;
  /** The shaped measurer's identity (admitted face hashes); absent while fixed. */
  readonly producer?: string;
}

/**
 * The host chrome that answers the engine's hyperlink gestures.
 *
 * A CLICK on an external link and Ctrl/Cmd+K both mean "the user wants the link UI", and the
 * engine deliberately does not know what that looks like. Registered rather than passed at
 * construction because the chrome mounts after the editor does, and it survives a document
 * reload — the surface is rebuilt, the handlers are not.
 */
export interface HyperlinkChromeHandlers {
  /** A plain click on an external or inert link: show the popover at `activation.rect`. */
  readonly onPopover?: (activation: HyperlinkActivation) => void;
  /** Ctrl/Cmd+K: open insert-or-edit for the selection. */
  readonly onRequest?: () => void;
}

/**
 * The concrete facade type: the full `Editor` contract plus the instance-only surface.
 *
 * `surface`, `stateVersion`, `attach` and `detach` live HERE rather than on `Editor`:
 * they are what a store binding and a mounting host need, not what document commands
 * need. Production adapters program against `Editor` for everything else.
 */
export interface DocxEditorInstance extends Editor {
  /**
   * The underlying paginated surface for harnesses and tests that need capabilities the
   * contract does not carry yet (select-all, node-id addressed selection).
   */
  readonly surface: PaginatedSurface | null;
  /**
   * Wire the host's hyperlink chrome to the engine's gestures — a click on an external
   * link, and Ctrl/Cmd+K. Returns an unsubscribe that restores whatever was registered
   * before, so a popover component can register in an effect and clean up in its teardown.
   *
   * Instance-only, like `surface`: it is what a MOUNTING host needs, not what a document
   * command needs.
   */
  setHyperlinkChrome(handlers: HyperlinkChromeHandlers): Unsubscribe;
  /**
   * Monotonic version of the observable editor state. Bumps whenever anything
   * `snapshot()` reports could have moved — a committed change, a selection move, zoom,
   * load success or failure, attach/detach, destroy. An external store (React's
   * `useSyncExternalStore`) uses it as a cheap "did anything change" signal; `snapshot()`
   * itself is cached per version and returns a stable reference between bumps.
   */
  stateVersion(): number;
  /**
   * Which measurer the current document's layout runs on, and whether shaped
   * resolution is still in flight — the honest "are wrap points Word-accurate yet?"
   * readout a host shows instead of guessing. `fixed` with `resolving: false` is the
   * steady state for a document with no usable font source (the documented zero-config
   * fallback); `shaped` means HarfBuzz measurement over real font bytes. Changes bump
   * `stateVersion()`.
   */
  fontMeasurement(): FontMeasurementState;
  /**
   * Mount into `el`. If the instance holds pending document bytes (created without a
   * container, or previously detached), they mount now — under the shaped measurer when
   * fonts have resolved in the meantime. Attaching while already mounted elsewhere moves
   * the live content via `session.save()`.
   *
   * HONEST COSTS: a mount from bytes is a fresh session — the undo stack and the caret do
   * not survive re-attach (the same cost as the async font remount). After `destroy()`
   * this is a no-op that emits a typed `error` event: a destroyed instance never remounts.
   */
  attach(el: HTMLElement): void;
  /**
   * Tear down the painted surface, stashing the CURRENT document bytes
   * (`session.save()`) so a later `attach` restores the content — but not the undo stack
   * or the caret. No-op when already detached or destroyed.
   */
  detach(): void;
}

/** The one frozen scope object every snapshot shares, so scope stays reference-equal. */
const SCOPE_BODY: EditorScope = Object.freeze({ kind: 'body' as const });

export function createDocxEditor(config: DocxEditorConfig): DocxEditorInstance {
  let container: HTMLElement | null = config.container ?? null;
  /** Document bytes waiting for a container — set when constructed or loaded detached. */
  let pendingBytes: Uint8Array | null = null;
  const mode = config.mode ?? 'edit';
  let zoom =
    config.zoom !== undefined &&
    Number.isFinite(config.zoom) &&
    config.zoom >= 0.1 &&
    config.zoom <= 5
      ? config.zoom
      : 1;

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
   * The sequence font resolution has been KICKED for. Checked inside `mountBytes` so the
   * shaped remount (which goes back through `mountBytes` with the same document) and an
   * `attach` of the same document never restart resolution — restarting from the shaped
   * remount would resolve → remount → resolve forever.
   */
  let fontKickSeq = -1;
  /** True from the moment a load starts font work until it lands (or fails). */
  let fontsResolving = false;

  // ── State tick + cached snapshot ─────────────────────────────────────────────────────
  let stateVersion = 0;
  let cachedSnapshot: EditorSnapshot | null = null;
  /** The caret the cached snapshot was derived for — see `snapshotNow`. */
  let cachedCaret: ReturnType<PaginatedSurface['state']>['selection'] | null = null;
  /** The document revision the cached snapshot was derived for — see `snapshotNow`. */
  let cachedRevision = -1;
  let cachedVersion = -1;

  /** Called at every place observable state can move. Derivation stays lazy. */
  function bump(): void {
    stateVersion += 1;
  }

  const handlers: { [E in keyof EditorEvents]: Set<EditorEvents[E]> } = {
    change: new Set(),
    selectionChange: new Set(),
    display: new Set(),
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
  }

  /** Points to CSS pixels: zoom 1 paints at the browser's 96dpi reading of a 72dpi point. */
  const scaleOf = (): number => zoom * (96 / 72);

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
      ...(shapedMeasurer
        ? { measurer: shapedMeasurer, ...(shapedProducer ? { producer: shapedProducer } : {}) }
        : {}),
      ...(embeddedFaces ? { fontAlias: embeddedFaces.alias } : {}),
      // Read through the holder rather than captured: the popover mounts AFTER the editor
      // exists (the provider-first shape), and a document that reloads must not leave the
      // host's chrome wired to the surface it replaced.
      onHyperlinkPopover: (activation) => liveHyperlinkChrome().onPopover?.(activation),
      onRequestHyperlink: () => liveHyperlinkChrome().onRequest?.(),
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
        if (selectionsMatch(state.selection, lastSelection) && !pendingMoved) return;
        lastSelection = state.selection;
        emitSelectionChange();
      },
    });
    if (!result.ok) {
      parseError = result.detail ? `${result.reason}: ${result.detail}` : result.reason;
      // Failure is observable state too: `snapshot().parseError` moved.
      bump();
      emitError(editorError(result.reason, `failed to open document: ${parseError}`));
      return;
    }
    parseError = null;
    surface = result.surface;
    lastSelection = surface.state().selection;
    unsubscribeSession = surface.session.subscribe((change) => {
      const documentChange: DocumentChange = {
        revision: change.toRevision,
        created: change.created,
        deleted: change.deleted,
        dirty: change.dirty,
      };
      // Bump BEFORE dispatch, so a handler reading `snapshot()` sees the new state.
      bump();
      emitDocumentChange(documentChange);
    });
    // The document arrived: an external store subscribed to `change`/`selectionChange`
    // must learn about it, exactly as it learns about any later commit. Without these a
    // store bound before `load()` never re-reads and keeps rendering "no document".
    bump();
    emitDocumentChange({ revision: surface.session.revision() });
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
    loadSeq += 1;
    shapedMeasurer = undefined;
    shapedProducer = undefined;
    disposeEmbeddedFaces();
    // A superseded in-flight resolution belongs to the PREVIOUS sequence; its stale
    // guard will refuse to touch state, so the flag must reset here or a load that
    // starts no font work of its own reports `resolving: true` forever.
    fontsResolving = false;
    mountBytes(bytes);
  }

  function reportFontError(error: EditorFontError): void {
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
  // stack and the caret, the honest cost of a full remount; a rescale-in-place path on
  // the surface would remove it. In the not-yet-attached case there is nothing to
  // remount: the measurer is simply picked up by the next mount.
  //
  // Failure is DEGRADATION, never a blocked load: a face the validator refuses drops
  // with a typed report and the remaining faces admit; a wholly failed resolution leaves
  // the document editable on the fixed measurer.
  async function resolveDocumentFonts(seq: number, mounted: PaginatedSurface): Promise<void> {
    // A bare fragment ({ sources, substitutions }) is a valid base: every other
    // configuration field takes the documented defaults, with the load sequence as the
    // epoch when the app pinned none.
    const explicit = config.fonts;
    const embedded = mounted.session.embeddedFonts();
    // The zero-config, nothing-embedded common case does NO font work at all: no
    // hashing, no HarfBuzz initialization, no remount.
    if (!explicit && embedded.length === 0) return;
    fontsResolving = true;
    bump();
    try {
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
      // embedded glyphs. Only faces the validator ADMITTED are handed over, and each
      // resolves through the shaping snapshot so the bytes registered are the validated,
      // owned copies — never the raw file view.
      const admitted = fromDocument.sources
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
      const registration = await registerEmbeddedFontFaces(admitted);
      if (destroyed || seq !== loadSeq) {
        registration.dispose();
        disposeLayoutShaping(shaping);
        if (seq === loadSeq) fontsResolving = false;
        return;
      }
      disposeEmbeddedFaces();
      embeddedFaces = registration;
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
          let resolved: ReturnType<typeof shaping.fonts.resolve>;
          try {
            resolved = shaping.fonts.resolve({
              family,
              weight: style.bold ? 700 : 400,
              style: style.italic ? 'italic' : 'normal',
            });
          } catch {
            return null;
          }
          return resolved instanceof FontResolutionError ? null : resolved;
        },
        fallback: createFixedMeasurer(),
        shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
        unicodeDataVersion: '16.0.0',
        ...(fonts.language ? { language: fonts.language } : {}),
      });
      shapedProducer = `shaped:${shaping.operation.extensionFingerprint}`;
      fontsResolving = false;
      if (surface) {
        // The remount tears the surface down BEFORE building the replacement, so the
        // saved bytes are the only copy of the live document while it runs. Hold them:
        // a mount that throws must leave a recoverable editor, not an empty container
        // with the document gone. Font fidelity is never worth losing the document.
        const saved = surface.session.save();
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
          if (hadFocus) surface?.focus();
        } catch (remountError) {
          shapedMeasurer = undefined;
          shapedProducer = undefined;
          if (!surface) {
            pendingBytes = saved;
            mountBytes(saved);
          }
          reportFontError(toEditorFontError(remountError));
        }
      } else bump();
    } catch (error) {
      if (destroyed || seq !== loadSeq) return;
      fontsResolving = false;
      bump();
      reportFontError(toEditorFontError(error));
    }
  }

  function deriveSnapshot(): EditorSnapshot {
    const state = surface?.state() ?? null;
    return {
      scope: SCOPE_BODY,
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
      isLoading: parseError === null && surface === null && pendingBytes === null,
      parseError,
      editable: surface !== null && surface.session.editable && mode !== 'view',
      zoom,
      selection: selectionRangeOf(surface),
      formatting: runFormattingOf(surface),
      table: tableContextOf(surface),
      image: null,
      page: { current: currentPageOf(surface), total: totalPagesOf(surface) },
      canUndo: state?.canUndo ?? false,
      canRedo: state?.canRedo ?? false,
      pageSetup: pageSetupOf(surface),
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
    const revision = surface?.session.revision() ?? -1;
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
      next = { ...fresh, formatting, page, pageSetup, selection };
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
      parseError = 'a DocumentHandle cannot be re-loaded; pass DOCX bytes';
      emitError(editorError('unsupported', parseError));
    }
  }

  const editor: DocxEditorInstance = {
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
        pendingBytes = surface.session.save();
        teardownSurface();
      }
      container = el;
      const bytes = pendingBytes;
      pendingBytes = null;
      // A mount bumps the tick and emits change/selectionChange itself.
      if (bytes) mountBytes(bytes);
      else bump();
    },

    detach() {
      if (destroyed) return;
      if (surface) {
        pendingBytes = surface.session.save();
        teardownSurface();
      }
      container = null;
      bump();
    },

    load(document) {
      const bytes = normalizeSource(document);
      if (!bytes) {
        // A handle is identity, not content — there are no bytes to reopen. The current
        // document (if any) stays mounted rather than being torn down for nothing.
        emitError(
          editorError('unsupported', 'a DocumentHandle cannot be re-loaded; pass DOCX bytes')
        );
        return;
      }
      loadBytes(bytes);
    },

    save() {
      if (!surface) return Promise.reject(editorError('notFound', 'no document is loaded'));
      // A fresh copy, so the returned ArrayBuffer is exactly the document — not a window
      // into a larger allocation.
      const bytes = surface.session.save();
      const copy = bytes.slice();
      return Promise.resolve(copy.buffer as ArrayBuffer);
    },

    getDocumentHandle(): DocumentHandle {
      return Object.freeze({ revision: surface?.session.revision() ?? 0 });
    },

    exec(command, options) {
      const gated = gateCommand(command, surface, mode, options);
      if (!gated.ok) return gated.refusal;
      const mounted = surface!;
      const before = mounted.session.revision();

      const result = execEditorCommand(mounted, command);
      if (result) return result;
      // `changed` is read from the model, not assumed: reporting `changed: true` where the
      // document did not move would be a lie. It answers for the DOCUMENT, not for
      // observable state — a mark toggled at a collapsed caret ARMS the typing format
      // (`toggleRunProperty`), which moves the snapshot and fires a tick while committing
      // nothing, so it correctly reports `changed: false`.
      return { ok: true, changed: mounted.session.revision() !== before };
    },

    can(command, options): CanResult {
      const gated = gateCommand(command, surface, mode, options);
      return gated.ok ? { ok: true } : gated.refusal;
    },

    // Derived for marks and alignment from the cached snapshot's formatting — Word's
    // agreement rule, the same one `toggleRunProperty` toggles against. Everything else
    // stays honest-false until its derivation exists.
    isActive(command) {
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
    getDocumentThemeColors: () => surface?.session.documentThemeColors() ?? [],
    getOutline: () => surface?.session.documentOutline() ?? [],
    getComments: () => [],

    // Reads the SAME unified derivation as `snapshot().formatting` (one code path),
    // reshaped to this member's declared vocabulary (half-points).
    getSelectionFormatting() {
      const formatting = surface ? snapshotNow().formatting : null;
      if (!formatting) return null;
      return {
        ...(formatting.bold !== undefined ? { bold: formatting.bold } : {}),
        ...(formatting.italic !== undefined ? { italic: formatting.italic } : {}),
        ...(formatting.underline !== undefined ? { underline: formatting.underline } : {}),
        ...(formatting.fontFamily ? { fontFamily: formatting.fontFamily } : {}),
        ...(formatting.fontSizePt !== undefined
          ? { fontSizeHalfPoints: Math.round(formatting.fontSizePt * 2) }
          : {}),
        ...(formatting.styleId ? { styleId: formatting.styleId } : {}),
        ...(formatting.alignment ? { alignment: formatting.alignment } : {}),
      };
    },

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
      surface.setSelection({
        anchor: { paragraphId: match.blockId, offset: match.start },
        head: { paragraphId: match.blockId, offset: match.start + match.length },
      });
      surface.revealParagraph(match.blockId);
      return { ok: true, changed: false };
    },

    getSelectedImage: () => null,
    getSelectedTable: () => null,

    getPageSetup: () => pageSetupOf(surface),

    getWatermark: () => null,
    getHeaderFooterState: () => null,
    getTrackedChanges: () => [],

    setActiveScope(_scope: ViewScope) {
      // The body is the only editable view; a non-body scope has nowhere to go. Nothing
      // observable changes, so the state tick does not move.
    },
    getActiveScope: (): ViewScope => ({ kind: 'body' }),

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
          return false as EditorQueryResults[K];
        case 'hyperlinkAt':
          return hyperlinkAtOf(surface) as EditorQueryResults[K];
        case 'trackedChanges':
        case 'revisions':
        case 'findText':
        case 'contentControls':
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
        default:
          // tableContext, watermark, splitCellConfig, contentControlAt, pageContent — all
          // nullable, all underived.
          return null as EditorQueryResults[K];
      }
    },

    snapshot: () => snapshotNow(),

    getTotalPages: () => totalPagesOf(surface),
    getCurrentPage: () => currentPageOf(surface),

    // Page NUMBERS are 1-based in this contract; the layout indexes from 0.
    scrollToPage: (pageNumber: number) =>
      Number.isInteger(pageNumber) && pageNumber >= 1
        ? (surface?.revealPage(pageNumber - 1) ?? false)
        : false,
    scrollToBlock: (blockId: string) =>
      typeof blockId === 'string' && blockId.length > 0
        ? (surface?.revealParagraph(blockId) ?? false)
        : false,

    getZoom: () => zoom,
    setZoom(next: number): ExecResult {
      // Refused rather than clamped: a caller that asked for
      // 0 or NaN has a bug, and silently substituting 1 hides it.
      if (!Number.isFinite(next) || next < 0.1 || next > 5) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: `zoom must be between 0.1 and 5, got ${next}`,
        };
      }
      if (next === zoom) return { ok: true, changed: false };
      zoom = next;
      // Zoom is snapshot state: bump and tell subscribers, with the fresh snapshot on the
      // selectionChange channel (the store listens to both channels either way).
      bump();
      emitSelectionChange();
      // The surface samples its scale at mount and exposes no rescale-in-place, and a
      // remount here would discard the user's undo history for a zoom click. So the stored
      // zoom applies from the NEXT mount (a `load`, or the shaped-measurer remount);
      // repaint-at-current-scale lands when the surface grows a rescale path.
      return { ok: true, changed: true };
    },

    // ── Geometry / interaction cluster: the surface owns interaction internally, so every
    // member below projects the typed empty frame rather than guessed geometry. ──────────
    getInteractionFrame: () => emptyInteractionFrame(),
    getDisplay: () => [],
    getSelectionRects: () => [],
    getCaretRect: () => null,
    getCaretGeometry: () => null,
    getSelectionGeometry: () => null,
    hitTest: () => null,
    getPageGeometry: () => [],
    getScrollGeometry: () => emptyInteractionFrame().scrollGeometry,
    resolvePointer: () => ({
      ok: false,
      code: 'unsupported',
      reason: 'the paginated surface owns pointer interaction internally',
    }),
    dispatchInteraction: () => ({
      outcome: {
        ok: false,
        code: 'unsupported',
        reason: 'the paginated surface owns interaction dispatch internally',
      },
      hostEffects: [],
    }),
    getAccessibilityObservation: () => ({
      owner: 'none',
      scope: { kind: 'body' },
      frameId: emptyInteractionFrame().id,
      modelRevision: surface?.session.revision() ?? 0,
      editable: surface !== null && surface.session.editable && mode !== 'view',
      name: { kind: 'absent' },
      entries: [],
      focus: { scope: null, focused: false },
      selection: null,
      paintedPagesAssistiveRole: null,
    }),
    getInputHostObservation: () => null,
    getInteractionHostMetrics: () => null,
    getCaretClientRect: () => null,

    relayout() {
      // `layout()` flushes any commit the scheduler has not published yet; the surface
      // repaints from its own publish path, so there is nothing further to trigger.
      surface?.layout();
    },

    focus() {
      if (!surface) {
        return { ok: false, code: 'invalidTarget', reason: 'no document is loaded' };
      }
      surface.focus();
      return { ok: true, value: undefined, frameId: { value: 0 } };
    },

    destroy() {
      destroyed = true;
      disposeEmbeddedFaces();
      teardownSurface();
      container = null;
      pendingBytes = null;
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
