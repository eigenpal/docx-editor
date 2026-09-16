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
