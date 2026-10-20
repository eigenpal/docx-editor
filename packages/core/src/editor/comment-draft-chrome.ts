// Host chrome for comment drafts: the UI the `review.addComment` control asks to open a draft.
//
// The press runs no engine command. A comment needs its text first, and the text comes from a
// draft that host chrome owns, the way the link popover owns `text.link`. So the control is
// enabled only while some chrome is registered to open that draft: the review rail when it
// mounts, or a host's own comment UI. Without one, an enabled control would do nothing.
//
// The registration lives on the editor, not on a surface: chrome mounts after the editor
// exists, and a document that reloads must keep it.

import type { CommentDraftChromeHandlers } from './docx-editor-types.ts';
import { createRequestChrome, type BookmarkChromeHost } from './bookmark-chrome.ts';

/** What the toolbar asks of the registered comment draft chrome. */
export interface CommentDraftRequests {
  /** Whether any chrome is registered to open a draft. */
  readonly canOpen: () => boolean;
  /** Ask the registered chrome to open a draft; false when none is registered. */
  readonly open: () => boolean;
}

/** The refusal while no chrome is registered to open a draft. */
export const NO_COMMENT_DRAFT_VIEW = 'no comment draft view is registered';

// Keyed by facade, so the toolbar can reach the requests without a member on the public
// instance type.
const requestsByEditor = new WeakMap<object, CommentDraftRequests>();

export function createCommentDraftChrome(host: BookmarkChromeHost = {}) {
  const chrome = createRequestChrome(host.changed);
  const requests: CommentDraftRequests = { canOpen: chrome.canOpen, open: chrome.open };
  return {
    requests,
    setters: {
      setCommentDraftChrome: (handlers: CommentDraftChromeHandlers): (() => void) =>
        chrome.register(handlers),
    },
  };
}

/** Make a facade's comment draft requests reachable from `commentDraftRequestsOf`. */
export function bindCommentDraftRequests(editor: object, requests: CommentDraftRequests): void {
  requestsByEditor.set(editor, requests);
}

/** The comment draft requests of a facade, or null for an editor that has none. */
export function commentDraftRequestsOf(editor: object): CommentDraftRequests | null {
  return requestsByEditor.get(editor) ?? null;
}
