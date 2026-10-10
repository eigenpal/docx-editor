/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '@docx-editor.dev/react';
import type { CollaborationSession } from '../collaboration/types.ts';
import {
  collaborationNoticeOf,
  EDIT_REFUSED_NOTICE_MS,
  NOTICE_MESSAGE_KEYS,
  STALLED_AFTER_MS,
  type CollaborationNoticeKind,
} from '../collaboration/status-notice.ts';
import { useCollaborationSession } from './useCollaborationSession.ts';
import { useCollaborationStatus } from './useCollaborationStatus.ts';

/** What a custom {@link DocxEditorCollaboration}.Status renders with. @public */
export interface CollaborationStatusNoticeRenderProps {
  /** Which notice to show. */
  readonly kind: CollaborationNoticeKind;
  /** The packaged message for `kind`, in the editor's language. */
  readonly message: string;
  /** Calls `onRejoin`; present for `outOfSync` and `stalled` when the part has one. */
  readonly rejoin?: () => void;
}

/** Props for {@link DocxEditorCollaboration}.Status. @public */
export interface CollaborationStatusNoticeProps {
  /**
   * The session to report on. Omit it and the part uses the one the editor above holds;
   * `null` renders nothing.
   */
  readonly session?: CollaborationSession | null;
  /**
   * Called from the part's "Rejoin" button when this copy is out of sync, or when edits
   * have waited too long for the room. Save the editor
   * and pass the bytes to your provider hook's `rejoin`. Without it the part shows the
   * message only.
   */
  readonly onRejoin?: () => void;
  /** Classes added to the notice region. */
  readonly className?: string;
  /** Renders the notice in place of the packaged one. */
  readonly children?: (props: CollaborationStatusNoticeRenderProps) => ReactNode;
}

/**
 * The room's state in one line, shown only when the user needs to know: while connecting,
 * offline, catching up, waiting, out of sync, or when the room refused an edit.
 *
 * The `role="status"` region stays mounted while a session exists, so screen readers
 * announce each message as it appears; it is empty while everything is in order.
 */
export function CollaborationStatusNotice({
  session,
  onRejoin,
  className,
  children,
}: CollaborationStatusNoticeProps) {
  const { t } = useTranslation();
  const fromContext = useCollaborationSession();
  const active = session === undefined ? fromContext : session;
  const state = useCollaborationStatus(active);
  const refusedRecently = useRefusedRecently(
    active?.sessionId ?? null,
    state.failureCount,
    state.status
  );
  const stalled = useStalled(state.waiting);
  if (!active || state.status === 'inactive') return null;
  const kind = collaborationNoticeOf({
    status: state.status,
    reasonCode: (state.reason ?? state.lastFailure)?.code,
    recovering: state.recovering,
    waiting: state.waiting,
    stalled,
    refusedRecently,
    offlineEditing: active.offlineEditing !== false,
  });
  const message = kind ? t(NOTICE_MESSAGE_KEYS[kind]) : '';
  const rejoin = kind === 'outOfSync' || kind === 'stalled' ? onRejoin : undefined;
  let content: ReactNode = null;
  if (kind && children) {
    content = children({ kind, message, ...(rejoin ? { rejoin } : {}) });
  } else if (kind) {
    content = (
      <>
        <span className="docx-collaboration-status__message">{message}</span>
        {rejoin ? (
          <button type="button" className="docx-collaboration-status__action" onClick={rejoin}>
            {t('collaboration.status.rejoin')}
          </button>
        ) : null}
      </>
    );
  }
  return (
    <div
      className={`docx-collaboration-status${className ? ` ${className}` : ''}`}
      {...(kind ? { 'data-collaboration-status': kind } : {})}
      role="status"
    >
      {content}
    </div>
  );
}

/** Whether edits have waited for the room longer than `STALLED_AFTER_MS`. */
function useStalled(waiting: boolean): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!waiting) return;
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return waiting && stalled;
}

/**
 * Whether the room refused an edit within the last few seconds: the failure count rose
 * while the session stayed usable, which is how a refused, undone edit shows. A new
 * session counts from zero, so its count starts a new baseline.
 */
function useRefusedRecently(sessionId: string | null, failureCount: number, status: string) {
  const seen = useRef({ sessionId, failureCount });
  // The failure count the notice is shown for, or 0 when none is.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const before = seen.current;
    seen.current = { sessionId, failureCount };
    if (before.sessionId !== sessionId) {
      setShown(0);
      return;
    }
    if (failureCount <= before.failureCount) return;
    if (status === 'ready' || status === 'disconnected') setShown(failureCount);
  }, [sessionId, failureCount, status]);
  useEffect(() => {
    if (shown === 0) return;
    const timer = setTimeout(() => setShown(0), EDIT_REFUSED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return shown !== 0;
}
