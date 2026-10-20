/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { CollaborationFailureCode } from '@docx-editor.dev/core/collaboration';

/** The status a degraded session returns to on its next clean remote apply. */
export interface HealTarget {
  readonly status: 'ready' | 'disconnected';
  readonly code?: CollaborationFailureCode;
  readonly detail?: string;
}

/** The heal target for a status, or null when that status cannot be healed back to. */
export function healTargetOf(snapshot: {
  readonly status: string;
  readonly reason?: { readonly code: CollaborationFailureCode; readonly detail?: string };
}): HealTarget | null {
  const { status, reason } = snapshot;
  if (status !== 'ready' && status !== 'disconnected') return null;
  return { status, ...(reason ? { code: reason.code, detail: reason.detail } : {}) };
}

/** One refused journal recovers; a run of them means the next edit refuses too. */
const MAX_REFUSALS_IN_A_ROW = 3;
/**
 * A refusal that waits on a peer's update does not count toward that cap until it has
 * repeated this often. A source that never arrives, such as a peer that left mid-update,
 * would otherwise refuse and realign every edit in that run for the life of the room.
 */
const MAX_TRANSIENT_REFUSALS_IN_A_ROW = 20;

/** Consecutive refused local journals, and whether the session may still recover. */
export class RefusalStreak {
  private refused = 0;
  private transient = 0;

  /** A journal published cleanly: the streak ends. */
  published(): void {
    this.refused = 0;
    this.transient = 0;
  }

  /** A journal was refused. `transient` means it waits on an update still in flight. */
  refusedOne(transient: boolean): void {
    if (!transient || ++this.transient > MAX_TRANSIENT_REFUSALS_IN_A_ROW) this.refused += 1;
  }

  /** Whether a realign is still expected to bring the session back. */
  recoverable(): boolean {
    return this.refused < MAX_REFUSALS_IN_A_ROW;
  }
}
