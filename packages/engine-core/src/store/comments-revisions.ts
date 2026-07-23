// Semantic comments + tracked revisions (document-engine task 12.4 / design D12).
// Comments carry authorship, dates, threading (replies), and status; tracked
// revisions carry authorship, kind, and an accept/reject lifecycle. Both anchor
// through the durable range primitives (annotation.ts). Locked targets refuse
// mutation. State transitions are pure and explicit.

import type { AnnotationRange } from './annotation.ts';

export interface Comment {
  readonly id: string;
  readonly authorId: string;
  readonly at: number;
  readonly text: string;
  readonly status: 'open' | 'resolved';
  /** Parent comment id for a reply; absent for a thread root. */
  readonly parentId?: string;
  readonly anchor: AnnotationRange;
}

export type RevisionKind = 'insert' | 'delete' | 'format' | 'structural';
export type RevisionStatus = 'pending' | 'accepted' | 'rejected';

export interface TrackedRevision {
  readonly id: string;
  readonly kind: RevisionKind;
  readonly authorId: string;
  readonly at: number;
  readonly status: RevisionStatus;
  readonly anchor: AnnotationRange;
  /** A locked revision refuses accept/reject until unlocked. */
  readonly locked?: boolean;
}

export type RevisionResult =
  | { readonly ok: true; readonly revision: TrackedRevision }
  | { readonly ok: false; readonly reason: 'locked' | 'already-resolved' };

// --- comments ---

export function reply(parent: Comment, reply: Omit<Comment, 'parentId' | 'status'>): Comment {
  return { ...reply, parentId: parent.id, status: 'open' };
}

export function resolveComment(c: Comment): Comment {
  return c.status === 'resolved' ? c : { ...c, status: 'resolved' };
}
export function reopenComment(c: Comment): Comment {
  return c.status === 'open' ? c : { ...c, status: 'open' };
}

/** Order a flat comment list into thread roots each followed by their replies. */
export function threadOf(comments: readonly Comment[], rootId: string): Comment[] {
  const root = comments.find((c) => c.id === rootId && c.parentId === undefined);
  if (!root) return [];
  const replies = comments.filter((c) => c.parentId === rootId).sort((a, b) => a.at - b.at);
  return [root, ...replies];
}

// --- tracked revisions ---

export function acceptRevision(rev: TrackedRevision): RevisionResult {
  if (rev.locked) return { ok: false, reason: 'locked' };
  if (rev.status !== 'pending') return { ok: false, reason: 'already-resolved' };
  return { ok: true, revision: { ...rev, status: 'accepted' } };
}

export function rejectRevision(rev: TrackedRevision): RevisionResult {
  if (rev.locked) return { ok: false, reason: 'locked' };
  if (rev.status !== 'pending') return { ok: false, reason: 'already-resolved' };
  return { ok: true, revision: { ...rev, status: 'rejected' } };
}

/** Pending revisions across (possibly multiple) stories — resolved atomically by the caller. */
export function pendingRevisions(revs: readonly TrackedRevision[]): TrackedRevision[] {
  return revs.filter((r) => r.status === 'pending');
}
