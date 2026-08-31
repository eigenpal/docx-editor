// One neutral document layout session shared by all exporters.

import {
  openHeadlessDocument,
  type HeadlessDocumentRejection,
  type HeadlessDocumentView,
  type ImageDecodePort,
  type ImageResourceState,
} from '@docx-editor.dev/core/store';
import {
  createDocumentFurnitureSource,
  createDocumentLinkProjectors,
  createDocumentStyleDependencies,
  createFieldLinkRegistry,
  forEachSemanticDrawing,
  type CreateDocumentFurnitureSourceOptions,
} from '../layout/index.ts';
import {
  layoutDocumentView,
  type LayoutDocumentViewOptions,
} from '../layout/document-layout-coordinator.ts';
import { createFixedMeasurer } from '../layout/fixed-measurer.ts';
import { createInlineDrawingLayoutBundle } from '../layout/inline-drawing-source.ts';
import { releasePageFieldProjectionState } from '../layout/field-page-furniture.ts';
import { createParagraphLayoutCache } from '../layout/layout-cache.ts';
import { createLayoutSession } from '../layout/layout-session.ts';
import { releaseOverflowPageShellState } from '../layout/page-furniture-insets.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { SemanticLayout, TextMeasurer } from '../layout/semantic-records.ts';
import type { RevisionDisplayMode } from '../layout/revision-projection.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  revisionAuthorFilter,
} from '../layout/revision-projection.ts';
import {
  createNodeImageDecodePort,
  type PreservedImageConverter,
} from './node-image-decode-port.ts';
import { publishImmutableSemanticLayout } from './semantic-layout-publication.ts';

/** Source accepted by every exporter: untrusted bytes or an already-open live view. @public */
export type ExportDocumentSource = Uint8Array | HeadlessDocumentView;

/** Shared session options; translators add their own format-specific options. @public */
export interface OpenDocumentForExportOptions {
  /**
   * Revision projection applied before records reach an exporter. Default: `all-markup`.
   *
   * The safe reader default keeps every pending insertion and deletion visible. Choose
   * `proposed` or `original` explicitly only when a resolved view is intended.
   */
  readonly displayMode?: RevisionDisplayMode;
  /** Reviewers whose revisions project as accepted across body, furniture, and notes. */
  readonly hiddenRevisionAuthors?: readonly string[];
  /** Host-owned measurement override; omit to use the core fixed fallback. */
  readonly measurer?: TextMeasurer;
  /** Stable measurement implementation identity used by layout caches and diagnostics. */
  readonly producer?: string;
  /** Host image metadata decoder; omit for the bounded DOM-free Node decoder. */
  readonly imageDecodePort?: ImageDecodePort;
  /** Optional converter for preserved image formats the default decoder cannot inspect. */
  readonly convertPreservedImage?: PreservedImageConverter;
  /** Cancels resource waits and subsequent layouts. */
  readonly signal?: AbortSignal;
  /** Maximum time spent waiting for image resources in one layout call. Default: 60 seconds. */
  readonly resourceTimeoutMs?: number;
  /** Retain incremental state for a live view. Defaults to true for views and false for bytes. */
  readonly reuseAcrossRevisions?: boolean;
}

/** Bounded resource-settlement failure from a headless export session. @public */
export class ExportResourceError extends Error {
  constructor(
    readonly code: 'aborted' | 'timedOut' | 'nonConvergent' | 'disposed',
    message: string
  ) {
    super(message);
    this.name = 'ExportResourceError';
  }
}

/**
 * A single semantic-layout substrate reusable by Markdown, PDF, and later exporters.
 * @public
 */
export interface ExportSession {
  /** Settle resources and return the default revision projection. */
  layout(): Promise<SemanticLayout>;
  /** Settle resources and cache one explicit revision projection. */
  layoutFor(displayMode: RevisionDisplayMode): Promise<SemanticLayout>;
  /** Mint a defensive copy only for a ready drawing from this session. */
  validatedImageBytes(drawing: InlineDrawingRecord | AnchoredDrawingRecord): Uint8Array | null;
  /** Release per-document caches and pending resource work. Idempotent. */
  dispose(): void;
}

/** Typed refusal for bytes that cannot become a document view. @public */
export type OpenDocumentForExportResult =
  | { readonly ok: true; readonly session: ExportSession }
  | { readonly ok: false; readonly reason: HeadlessDocumentRejection; readonly detail?: string };

function normalizedResourceTimeout(value: number | undefined): number {
  if (value === undefined) return 60_000;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('resourceTimeoutMs must be a positive finite number');
  }
  return Math.max(1, value);
}

const REVISION_POLL_INTERVAL_MS = 50;

function resourceIsPending(resource: ImageResourceState): boolean {
  switch (resource.kind) {
    case 'pending':
      return true;
    case 'ready':
    case 'unrenderable':
    case 'external':
    case 'missing':
      return false;
    default:
      return resource satisfies never;
  }
}

function layoutHasPendingImages(layout: SemanticLayout): boolean {
  let pending = false;
  forEachSemanticDrawing(layout, ({ drawing }) => {
    if (resourceIsPending(drawing.resource)) pending = true;
  });
  return pending;
}

function isDocumentView(source: ExportDocumentSource): source is HeadlessDocumentView {
  return !ArrayBuffer.isView(source);
}

/** Open bytes or a live neutral view into one reusable layout session. @public */
export function openDocumentForExport(
  source: ExportDocumentSource,
  options: OpenDocumentForExportOptions = {}
): OpenDocumentForExportResult {
  const sourceIsView = isDocumentView(source);
  const opened = isDocumentView(source)
    ? { ok: true as const, view: source }
    : openHeadlessDocument(source);
  if (!opened.ok) return opened;

  const initialView = opened.view;
  const reuseAcrossRevisions = options.reuseAcrossRevisions ?? sourceIsView;
  const timeoutMs = normalizedResourceTimeout(options.resourceTimeoutMs);
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const authorFilter = revisionAuthorFilter(options.hiddenRevisionAuthors ?? []);
  const initialMeasurer = options.measurer ?? createFixedMeasurer();
  const producer =
    options.producer ?? (options.measurer ? 'host-export-measurer' : 'export-fixed-measurer');
  // Byte exports are immutable one-shot snapshots. Their break cache exists only to share work
  // inside the pass, so cap it much more tightly than a live editor's cross-revision cache.
  const initialParagraphCache = createParagraphLayoutCache<never>({
    retainAcrossPasses: reuseAcrossRevisions,
  });
  let resourceEpoch = 0;
  const waiters = new Set<() => void>();
  const resourcesChanged = (): void => {
    resourceEpoch += 1;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const initialDrawingBundle = createInlineDrawingLayoutBundle({
    session: initialView,
    decodePort:
      options.imageDecodePort ??
      createNodeImageDecodePort(
        options.convertPreservedImage
          ? { convertPreserved: options.convertPreservedImage }
          : undefined
      ),
    onResourcesChanged: resourcesChanged,
  });
  let activeState: {
    readonly view: HeadlessDocumentView;
    readonly measurer: TextMeasurer;
    readonly paragraphCache: ReturnType<typeof createParagraphLayoutCache<never>>;
    readonly sessions: Map<RevisionDisplayMode, ReturnType<typeof createLayoutSession>>;
    readonly completed: Map<
      RevisionDisplayMode,
      {
        readonly revision: number;
        readonly pkg: ReturnType<HeadlessDocumentView['currentPackage']>;
        readonly internal: SemanticLayout;
        readonly published: SemanticLayout;
      }
    >;
    readonly inFlight: Map<RevisionDisplayMode, Promise<SemanticLayout>>;
    readonly styles: ReturnType<typeof createDocumentStyleDependencies>;
    readonly fieldLinks: Map<
      RevisionDisplayMode,
      {
        readonly revision: number;
        readonly pkg: ReturnType<HeadlessDocumentView['currentPackage']>;
        readonly registry: ReturnType<typeof createFieldLinkRegistry>;
      }
    >;
    readonly links: ReturnType<typeof createDocumentLinkProjectors>;
    readonly drawingBundle: ReturnType<typeof createInlineDrawingLayoutBundle>;
    readonly furniture: Map<RevisionDisplayMode, ReturnType<typeof createDocumentFurnitureSource>>;
  } | null = {
    view: initialView,
    measurer: initialMeasurer,
    paragraphCache: initialParagraphCache,
    sessions: new Map(),
    completed: new Map(),
    inFlight: new Map(),
    styles: createDocumentStyleDependencies(initialView),
    fieldLinks: new Map(),
    links: createDocumentLinkProjectors(initialView),
    drawingBundle: initialDrawingBundle,
    furniture: new Map(),
  };
  const resourceAbort = new AbortController();
  const callerSignal = options.signal;
  const abortFromCaller = (): void => resourceAbort.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerSignal?.aborted) abortFromCaller();
  const assertActive = (): void => {
    if (!activeState) throw new ExportResourceError('disposed', 'Export session has been disposed');
    if (resourceAbort.signal.aborted) {
      throw new ExportResourceError('aborted', 'Export resource settlement was aborted');
    }
  };

  const waitForResourceChange = (
    observedEpoch: number,
    observedRevision: number,
    observedPackage: ReturnType<HeadlessDocumentView['currentPackage']>,
    deadline: number
  ): Promise<void> => {
    if (
      resourceEpoch !== observedEpoch ||
      activeState?.view.packageRevision() !== observedRevision ||
      activeState?.view.currentPackage() !== observedPackage
    ) {
      return Promise.resolve();
    }
    assertActive();
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: ExportResourceError): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        waiters.delete(changed);
        resourceAbort.signal.removeEventListener('abort', aborted);
        if (error) reject(error);
        else resolve();
      };
      const changed = (): void => finish();
      const aborted = (): void =>
        finish(new ExportResourceError('aborted', 'Export resource settlement was aborted'));
      const pollRevision = (): void => {
        if (
          activeState?.view.packageRevision() !== observedRevision ||
          activeState?.view.currentPackage() !== observedPackage
        ) {
          finish();
          return;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          finish(
            new ExportResourceError(
              'timedOut',
              `Image resources did not settle within ${timeoutMs}ms`
            )
          );
          return;
        }
        timer = setTimeout(pollRevision, Math.min(REVISION_POLL_INTERVAL_MS, remaining));
      };
      waiters.add(changed);
      resourceAbort.signal.addEventListener('abort', aborted, { once: true });
      // Close the registration window. A custom live view or host resource callback can advance
      // either source between the outer precheck and waiter installation.
      if (
        resourceEpoch !== observedEpoch ||
        activeState?.view.packageRevision() !== observedRevision ||
        activeState?.view.currentPackage() !== observedPackage
      ) {
        finish();
        return;
      }
      pollRevision();
    });
  };

  const runLayout = async (
    mode: RevisionDisplayMode,
    revisionRestarts = 0,
    absoluteDeadline = Date.now() + timeoutMs
  ): Promise<SemanticLayout> => {
    assertActive();
    if (Date.now() >= absoluteDeadline) {
      throw new ExportResourceError(
        'timedOut',
        `Export layout did not stabilize within ${timeoutMs}ms`
      );
    }
    const state = activeState!;
    const deadline = absoluteDeadline;
    const revision = state.view.packageRevision();
    const pkg = state.view.currentPackage();
    const cached = state.completed.get(mode);
    if (cached && cached.revision === revision && cached.pkg === pkg) return cached.published;

    let fieldLinkState = state.fieldLinks.get(mode);
    if (!fieldLinkState || fieldLinkState.revision !== revision || fieldLinkState.pkg !== pkg) {
      fieldLinkState?.registry.clear();
      fieldLinkState = { revision, pkg, registry: createFieldLinkRegistry() };
      state.fieldLinks.set(mode, fieldLinkState);
      // Furniture captures its mode/revision registry. A live-view edit must not reuse it.
      state.furniture.delete(mode);
    }
    const fieldLinks = fieldLinkState.registry;

    const session = state.sessions.get(mode) ?? createLayoutSession();
    state.sessions.set(mode, session);
    let source = state.furniture.get(mode);
    if (!source) {
      source = createDocumentFurnitureSource({
        view: state.view,
        measurer: state.measurer,
        producer,
        cache: state.paragraphCache,
        styleCascade: state.styles.styleCascade,
        numberingIndex: state.styles.numberingIndex,
        defaultTabStopPt: state.styles.defaultTabStopPt,
        displayMode: mode,
        revisionAuthorFilter: authorFilter,
        inlineDrawingLayoutForPart: (partName) => state.drawingBundle.contextForPart(partName),
        drawingLayoutTokenForPart: (partName) => state.drawingBundle.cacheTokenForPart(partName),
        drawingTokenForParagraphForPart: (partName, paragraph) =>
          state.drawingBundle.drawingTokenForParagraph(paragraph, partName),
        linkProjectors: state.links,
        projectFieldLink: (spec) => fieldLinks.project(spec),
      } satisfies CreateDocumentFurnitureSourceOptions &
        Record<keyof CreateDocumentFurnitureSourceOptions, unknown>);
      state.furniture.set(mode, source);
    }

    for (let pass = 0; pass < 64; pass += 1) {
      const observedEpoch = resourceEpoch;
      state.drawingBundle.sync(state.view);
      if (state.view.packageRevision() !== revision || state.view.currentPackage() !== pkg) {
        if (revisionRestarts >= 63) {
          throw new ExportResourceError(
            'nonConvergent',
            'Document revision did not stabilize during export layout'
          );
        }
        return runLayout(mode, revisionRestarts + 1, deadline);
      }
      const layout = layoutDocumentView({
        view: state.view,
        revision: state.view.packageRevision(),
        measurer: state.measurer,
        cache: state.paragraphCache,
        session,
        producer,
        styleCascade: state.styles.styleCascade,
        defaultTabStopPt: state.styles.defaultTabStopPt,
        numberingIndex: state.styles.numberingIndex,
        furniture: source,
        linkProjectors: state.links,
        projectFieldLink: (spec) => fieldLinks.project(spec),
        inlineDrawingLayout: state.drawingBundle.bodyContext,
        inlineDrawingLayoutForPart: (partName) => state.drawingBundle.contextForPart(partName),
        drawingTokenForParagraph: (paragraph) =>
          state.drawingBundle.drawingTokenForParagraph(paragraph, state.view.part().name),
        drawingTokenForParagraphForPart: (partName, paragraph) =>
          state.drawingBundle.drawingTokenForParagraph(paragraph, partName),
        drawingLayoutEpoch: state.drawingBundle.cacheTokenForPart(state.view.part().name),
        drawingLayoutEpochForPart: (partName) => state.drawingBundle.cacheTokenForPart(partName),
        displayMode: mode,
        revisionAuthorFilter: authorFilter,
      } satisfies LayoutDocumentViewOptions & Record<keyof LayoutDocumentViewOptions, unknown>);
      if (!layoutHasPendingImages(layout)) {
        if (state.view.packageRevision() !== revision || state.view.currentPackage() !== pkg) {
          if (revisionRestarts >= 63) {
            throw new ExportResourceError(
              'nonConvergent',
              'Document revision did not stabilize during export layout'
            );
          }
          return runLayout(mode, revisionRestarts + 1, deadline);
        }
        const published = publishImmutableSemanticLayout(layout);
        state.completed.set(mode, { revision, pkg, internal: layout, published });
        if (!reuseAcrossRevisions) {
          releasePageFieldProjectionState(layout);
          releaseOverflowPageShellState(layout);
          state.paragraphCache.clear();
          state.sessions.delete(mode);
        }
        return published;
      }
      // One pass discovers every image referenced by the laid-out stories. Await the whole
      // discovered batch before laying the document out again; relayout on each individual
      // decode made 65 valid staggered images hit the 64-pass convergence guard.
      let settlementEpoch = observedEpoch;
      while (state.drawingBundle.pendingResourceCount() > 0) {
        await waitForResourceChange(settlementEpoch, revision, pkg, deadline);
        settlementEpoch = resourceEpoch;
        assertActive();
        if (state.view.packageRevision() !== revision || state.view.currentPackage() !== pkg) {
          if (revisionRestarts >= 63) {
            throw new ExportResourceError(
              'nonConvergent',
              'Document revision did not stabilize during export layout'
            );
          }
          return runLayout(mode, revisionRestarts + 1, deadline);
        }
      }
      assertActive();
      if (state.view.packageRevision() !== revision || state.view.currentPackage() !== pkg) {
        if (revisionRestarts >= 63) {
          throw new ExportResourceError(
            'nonConvergent',
            'Document revision did not stabilize during export layout'
          );
        }
        return runLayout(mode, revisionRestarts + 1, deadline);
      }
    }
    throw new ExportResourceError(
      'nonConvergent',
      'Image resources did not reach quiescence after 64 layout passes'
    );
  };

  const layoutFor = (mode: RevisionDisplayMode): Promise<SemanticLayout> => {
    if (!activeState) {
      return Promise.reject(
        new ExportResourceError('disposed', 'Export session has been disposed')
      );
    }
    const state = activeState;
    const existing = state.inFlight.get(mode);
    if (existing) return existing;
    const promise = runLayout(mode).finally(() => state.inFlight.delete(mode));
    state.inFlight.set(mode, promise);
    return promise;
  };

  const exportSession: ExportSession = {
    layout: () => layoutFor(displayMode),
    layoutFor,
    validatedImageBytes(drawing) {
      const state = activeState;
      if (!state || drawing.resource.kind !== 'ready') return null;
      return (
        state.drawingBundle
          .mintValidatedBytes(drawing.resource.validatedHandle, drawing.resource.contentId)
          ?.slice() ?? null
      );
    },
    dispose() {
      const state = activeState;
      if (!state) return;
      activeState = null;
      callerSignal?.removeEventListener('abort', abortFromCaller);
      resourceAbort.abort();
      state.drawingBundle.dispose();
      state.paragraphCache.clear();
      for (const completed of state.completed.values()) {
        releasePageFieldProjectionState(completed.internal);
        releaseOverflowPageShellState(completed.internal);
      }
      for (const fieldLinks of state.fieldLinks.values()) fieldLinks.registry.clear();
      state.fieldLinks.clear();
      state.completed.clear();
      state.inFlight.clear();
      state.furniture.clear();
      state.sessions.clear();
      resourcesChanged();
    },
  };
  return { ok: true, session: exportSession };
}
