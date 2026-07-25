/**
 * Comment + tracked-change ID allocation and factories.
 *
 * The allocator and `createComment` factory now live in core (shared with Vue,
 * instance-scoped); re-exported here so existing React import sites stay stable.
 * `DocxEditor` owns one `CommentIdAllocator` per editor instance and threads it
 * into the hooks that allocate IDs.
 *
 * `EMPTY_ANCHOR_POSITIONS` is React-only sidebar state and stays here.
 */

// The allocator and `createComment` factory are not re-exported yet: they were
// ProseMirror comment ops, and this engine has no comment vocabulary to allocate
// into (see the `getComments` stub for what the model is missing).

/** Stable empty Map used as the initial anchor-positions state. */
export const EMPTY_ANCHOR_POSITIONS = new Map<string, number>();
