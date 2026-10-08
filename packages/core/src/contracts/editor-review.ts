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

/**
 * Selection and attribution for a change of tracked-change author. The changes stay pending.
 * @public
 */
export interface SetReviewChangesAuthorOptions {
  /** The author to record. Required and nonblank, because `w:author` is required. */
  author: string;
  /** An ISO 8601 `xsd:dateTime` to record. Omit it to keep each change's own date. */
  date?: string;
  /** Defaults to revisions included by author visibility and the tracked-changes predicate. */
  scope?: 'visible' | 'document';
  /** Exact keys from getReviewItems(); overrides scope. Duplicate keys change once. */
  keys?: readonly string[];
  /**
   * Select only the changes made by these authors, within `scope`. Matches `w:author`
   * exactly. Not allowed with `keys`.
   */
  authors?: readonly string[];
  /** Defaults to skip. Strict refuses the entire selection if any target cannot change. */
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
