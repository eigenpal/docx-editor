// Previews of drawings from a host rendering service: one cache per editor, shared by every
// component that shows a preview. A preview is keyed by the drawing's source, so typing
// elsewhere reuses it and an edit to the drawing asks for a new one. The previous image stays
// visible while the new one loads.

import type { UnsupportedElement } from '../layout/unsupported-content-types.ts';
import {
  createDrawingPreviewPackage,
  type DrawingPreviewPackageResult,
} from '../store/package/drawing-preview-package.ts';
import { canonicalOoxmlFingerprint } from '../store/package/ooxml-serialize.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import { editorHostWindow } from './host-realm.ts';

/** What a {@link DrawingPreviewRender} receives. @public */
export interface DrawingPreviewRequest {
  /** A small DOCX that holds only this drawing and the parts it needs. */
  readonly docx: Uint8Array;
  /**
   * True when the first page of `docx` has the drawing's size. False when the size is
   * unknown; then trim the white space around the rendered drawing.
   */
  readonly pageFitsDrawing: boolean;
  /** The occurrence being previewed. */
  readonly element: UnsupportedElement;
  /**
   * Aborted when a newer request for a changed drawing replaces this one, or when the cache is
   * released 30 seconds after the last preview component unmounts.
   */
  readonly signal: AbortSignal;
}

/**
 * Your rendering service call. Resolve with an image `Blob`, an image URL, or `null` to keep
 * the editor's drawing. Reject to report an error. A returned URL goes into an `img` element
 * as is, so return a `blob:`, `data:image/`, or `https:` URL that you trust. The editor
 * creates an object URL for a `Blob` and revokes it when the image leaves its cache.
 *
 * @public
 */
export type DrawingPreviewRender = (
  request: DrawingPreviewRequest
) => Promise<Blob | string | null>;

/**
 * Why a preview is missing: the drawing could not be packaged (`package`, with the refusal
 * reason), or the render function rejected (`render`, with what it rejected with).
 *
 * @public
 */
export type DrawingPreviewError =
  | {
      readonly kind: 'package';
      readonly reason: Extract<DrawingPreviewPackageResult, { ok: false }>['reason'];
    }
  | { readonly kind: 'render'; readonly cause: unknown };

/**
 * The preview for one occurrence.
 *
 * - `idle`: no request yet. Preview components and hooks start the request as soon as the
 *   drawing's page is shown.
 * - `loading`: a request is running or waiting for a free slot. `url` holds the previous
 *   image of this drawing, if any.
 * - `ready`: `url` holds the image.
 * - `unavailable`: no preview will come. The render function returned `null`, and `error` is
 *   `null`; or the drawing cannot be packaged, and `error` is a `package` error.
 * - `error`: the render function rejected. `error` is a `render` error, and `url` holds the
 *   previous image, if any.
 *
 * `retry()` requests again after `error` or `unavailable`.
 *
 * @public
 */
export type DrawingPreviewState =
  | { readonly status: 'idle'; readonly url: null; readonly error: null }
  | { readonly status: 'loading'; readonly url: string | null; readonly error: null }
  | { readonly status: 'ready'; readonly url: string; readonly error: null }
  | {
      readonly status: 'unavailable';
      readonly url: null;
      readonly error: DrawingPreviewError | null;
    }
  | { readonly status: 'error'; readonly url: string | null; readonly error: DrawingPreviewError };

/**
 * A preview with its retry action, as preview components pass it to your content. `retry()`
 * requests again after `error` or `unavailable`.
 *
 * @public
 */
export type DrawingPreviewView = DrawingPreviewState & { readonly retry: () => void };

/** One preview cache for an editor. Adapters read it through their hook. @public */
export interface DrawingPreviewController {
  /** The current state of an occurrence. Stable until the state changes. */
  state(element: UnsupportedElement): DrawingPreviewState;
  /** Start a request unless the drawing already has a preview or a request is running. */
  request(element: UnsupportedElement, render: DrawingPreviewRender): void;
  /** Forget a failed or unavailable result and request again. */
  retry(element: UnsupportedElement, render: DrawingPreviewRender): void;
  /** Call `listener` after any state changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

interface Entry {
  state: DrawingPreviewState;
  controller: AbortController | null;
  /** True when this cache created the object URL and must revoke it. */
  ownsUrl: boolean;
}

const IDLE: DrawingPreviewState = Object.freeze({ status: 'idle', url: null, error: null });
const UNAVAILABLE: DrawingPreviewState = Object.freeze({
  status: 'unavailable',
  url: null,
  error: null,
});
const MAX_READY = 64;
const MAX_RUNNING = 4;
const RELEASE_DELAY_MS = 30_000;
const controllers = new WeakMap<DocxEditorInstance, DrawingPreviewController>();
const fingerprints = new WeakMap<OoxmlElement, string>();

function sourceKey(element: UnsupportedElement): string | null {
  const source = element.source;
  if (!source) return null;
  let fingerprint = fingerprints.get(source);
  if (fingerprint === undefined) {
    fingerprint = canonicalOoxmlFingerprint(source);
    fingerprints.set(source, fingerprint);
  }
  return `${element.ownerPartName}\0${fingerprint}`;
}

/**
 * The preview DOCX for an occurrence, built from the editor's current document. Use it when
 * you call your rendering service yourself instead of through a preview hook.
 *
 * @public
 */
export function drawingPreviewDocx(
  editor: DocxEditorInstance,
  element: Pick<UnsupportedElement, 'ownerPartName' | 'nodeId'>
): DrawingPreviewPackageResult {
  const session = editor.surface?.session;
  if (!session) return { ok: false, reason: 'drawing-not-found' };
  return createDrawingPreviewPackage(session.currentPackage(), element);
}

/**
 * The shared preview cache of an editor. Every call with the same editor returns the same
 * controller, whichever render function you pass. Previews are keyed by the drawing's source,
 * so typing elsewhere reuses them. At most 4 requests run at once; the rest wait their turn.
 * The cache keeps the 64 most recent images while any component shows a preview, and releases
 * everything 30 seconds after the last one unmounts, so pagination does not request again.
 *
 * @public
 */
export function drawingPreviewController(editor: DocxEditorInstance): DrawingPreviewController {
  const existing = controllers.get(editor);
  if (existing) return existing;
  const entries = new Map<string, Entry>();
  // The last image of each occurrence, shown while a changed drawing loads.
  const latest = new Map<string, string>();
  const listeners = new Set<() => void>();
  const running = new Map<string, { key: string; entry: Entry }>();
  let releaseTimer: number | undefined;
  // Requests beyond the running limit wait here, in the order they were made.
  const waiting: (() => void)[] = [];
  let active = 0;
  const startNext = () => {
    while (active < MAX_RUNNING && waiting.length) waiting.shift()!();
  };

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const occurrence = (element: UnsupportedElement) => `${element.ownerPartName}\0${element.nodeId}`;
  const revoke = (entry: Entry) => {
    if (!entry.ownsUrl || !entry.state.url) return;
    const url = entry.state.url;
    editorHostWindow(editor).URL.revokeObjectURL(url);
    for (const [key, value] of latest) if (value === url) latest.delete(key);
  };
  const evict = () => {
    const ready = [...entries].filter(([, entry]) => entry.state.status === 'ready');
    for (const [key, entry] of ready.slice(0, Math.max(0, ready.length - MAX_READY))) {
      revoke(entry);
      entries.delete(key);
    }
  };
  const release = () => {
    for (const entry of entries.values()) {
      entry.controller?.abort();
      revoke(entry);
    }
    entries.clear();
    latest.clear();
    running.clear();
    waiting.length = 0;
    notify();
  };
  const set = (key: string, entry: Entry, state: DrawingPreviewState) => {
    entry.state = Object.freeze(state);
    entries.delete(key);
    entries.set(key, entry);
    notify();
  };

  const controller: DrawingPreviewController = {
    state(element) {
      const key = sourceKey(element);
      const entry = key === null ? undefined : entries.get(key);
      if (entry) return entry.state;
      return key === null ? UNAVAILABLE : IDLE;
    },
    request(element, render) {
      const key = sourceKey(element);
      if (key === null || entries.has(key)) return;
      const packaged = drawingPreviewDocx(editor, element);
      const entry: Entry = { state: IDLE, controller: null, ownsUrl: false };
      if (!packaged.ok) {
        set(key, entry, {
          status: 'unavailable',
          url: null,
          error: { kind: 'package', reason: packaged.reason },
        });
        return;
      }
      // A changed drawing supersedes the request still running for its previous source.
      const place = occurrence(element);
      const superseded = running.get(place);
      if (superseded) {
        superseded.entry.controller?.abort();
        entries.delete(superseded.key);
      }
      const abort = new AbortController();
      entry.controller = abort;
      running.set(place, { key, entry });
      const previous = latest.get(place) ?? null;
      set(key, entry, { status: 'loading', url: previous, error: null });
      const settle = (state: DrawingPreviewState) => {
        if (abort.signal.aborted || entries.get(key) !== entry) return false;
        entry.controller = null;
        if (running.get(place)?.entry === entry) running.delete(place);
        set(key, entry, state);
        return true;
      };
      const run = () => {
        if (abort.signal.aborted) return;
        active++;
        void Promise.resolve()
          .then(() =>
            render({
              docx: packaged.docx,
              pageFitsDrawing: packaged.pageFitsDrawing,
              element,
              signal: abort.signal,
            })
          )
          .finally(() => {
            active--;
            startNext();
          })
          .then(
            (result) => {
              if (result === null) {
                settle({ status: 'unavailable', url: null, error: null });
                return;
              }
              if (abort.signal.aborted || entries.get(key) !== entry) return;
              const url =
                typeof result === 'string'
                  ? result
                  : editorHostWindow(editor).URL.createObjectURL(result);
              entry.ownsUrl = typeof result !== 'string';
              if (!settle({ status: 'ready', url, error: null })) return;
              latest.set(place, url);
              evict();
            },
            (error: unknown) => {
              settle({ status: 'error', url: previous, error: { kind: 'render', cause: error } });
            }
          );
      };
      waiting.push(run);
      startNext();
    },
    retry(element, render) {
      const key = sourceKey(element);
      const entry = key === null ? undefined : entries.get(key);
      if (
        key === null ||
        !entry ||
        entry.state.status === 'loading' ||
        entry.state.status === 'ready'
      )
        return;
      entries.delete(key);
      controller.request(element, render);
    },
    subscribe(listener) {
      listeners.add(listener);
      editorHostWindow(editor).clearTimeout(releaseTimer);
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        editorHostWindow(editor).clearTimeout(releaseTimer);
        releaseTimer = editorHostWindow(editor).setTimeout(release, RELEASE_DELAY_MS);
      };
    },
  };
  controllers.set(editor, controller);
  return controller;
}
