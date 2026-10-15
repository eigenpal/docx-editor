// Host chrome for bookmarks: the Bookmark dialog the host registers, and the options that
// shape Show bookmarks' marks.
//
// Both live on the editor, not on a surface: chrome mounts after the editor exists, and a
// document that reloads must keep the host's registration. The surface reads them on use.

import type { BookmarkChromeHandlers, BookmarkMarkOptions } from './docx-editor-types.ts';
import { createChromeHandlerStack } from './chrome-handler-stack.ts';

/** What the bookmark chrome tells the editor. */
export interface BookmarkChromeHost {
  /** A dialog registered or went away: `openBookmarkDialog` changed whether it can run. */
  readonly changed?: () => void;
  /** A host `decorate` callback threw. The mark keeps its default element. */
  readonly error?: (error: unknown) => void;
}

/**
 * The surface's view of the mark options.
 *
 * @public
 */
export interface BookmarkMarkOptionsSource {
  readonly current: () => BookmarkMarkOptions;
  /** Name the repaint to run when the options change. One slot: a remount replaces it. */
  readonly onChange: (repaint: (() => void) | null) => void;
  /** Report an error a host callback threw while marks were painted. */
  readonly reportError: (error: unknown) => void;
}

export function createBookmarkChrome(host: BookmarkChromeHost = {}) {
  const dialog = createChromeHandlerStack<BookmarkChromeHandlers>({});
  const marks = createChromeHandlerStack<BookmarkMarkOptions>({});
  let repaintMarks: (() => void) | null = null;
  const bookmarkMarks: BookmarkMarkOptionsSource = {
    current: marks.current,
    onChange: (repaint) => {
      repaintMarks = repaint;
    },
    reportError: (error) => host.error?.(error),
  };
  // Whether a dialog can open, as last published. A registration publishes at once. A
  // removal waits for the end of the task: a host that registers again (a prop change re-runs
  // its effect) removes and registers in one task, the answer does not change, and nothing is
  // published.
  let published = false;
  let pending = false;
  const publish = (): void => {
    const now = dialog.current().onRequest !== undefined;
    if (now === published) return;
    published = now;
    host.changed?.();
  };
  const publishLater = (): void => {
    if (pending) return;
    pending = true;
    globalThis.queueMicrotask(() => {
      pending = false;
      publish();
    });
  };
  const openBookmarkDialog = (): boolean => {
    const request = dialog.current().onRequest;
    request?.();
    return request !== undefined;
  };
  return {
    surfaceOptions: { onRequestBookmark: openBookmarkDialog, bookmarkMarks },
    /** The `openBookmarkDialog` command: open the host's dialog, if a host shows one. */
    bookmarkDialog: {
      canOpen: () => dialog.current().onRequest !== undefined,
      open: openBookmarkDialog,
    },
    setters: {
      setBookmarkChrome(handlers: BookmarkChromeHandlers): () => void {
        const dispose = dialog.push(handlers);
        publish();
        return () => {
          dispose();
          publishLater();
        };
      },
      setBookmarkMarks(options: BookmarkMarkOptions): () => void {
        const dispose = marks.push(options);
        repaintMarks?.();
        return () => {
          dispose();
          repaintMarks?.();
        };
      },
    },
  };
}
