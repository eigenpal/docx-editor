/** Selection and unsupported-change policy for a bulk review decision. @public */
export interface ResolveReviewChangesOptions {
  action: 'accept' | 'reject';
  /** Defaults to revisions included by author visibility and the tracked-changes predicate. */
  scope?: 'visible' | 'document';
  /** Exact keys from getReviewItems(); overrides scope. Duplicate keys resolve once. */
  keys?: readonly string[];
  /** Defaults to skip. Strict refuses the entire selection if any target cannot resolve. */
  unsupported?: 'skip' | 'fail';
}

export type { ReviewDisplayMode } from '../layout/revision-projection.ts';

/**
 * How a keystroke reaches the document.
 *
 * `'suggesting'` changes what an edit MEANS rather than whether it is allowed: typing writes
 * `w:ins` and deleting writes `w:del` over the words it would have removed, so every change
 * arrives as a proposal somebody else accepts or rejects.
 */
export type DocumentEditingMode = 'editing' | 'suggesting' | 'viewing';
