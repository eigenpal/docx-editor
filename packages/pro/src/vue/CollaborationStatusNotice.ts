/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  shallowRef,
  watch,
  type PropType,
  type VNode,
} from 'vue';
import { useTranslation } from '@docx-editor.dev/vue';
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

/** What the {@link DocxEditorCollaboration}.Status default slot renders with. @public */
export interface CollaborationStatusNoticeRenderProps {
  /** Which notice to show. */
  readonly kind: CollaborationNoticeKind;
  /** The packaged message for `kind`, in the editor's language. */
  readonly message: string;
  /** Emits `rejoin`; present for `outOfSync` and `stalled` when the part has a listener. */
  readonly rejoin?: () => void;
}

/**
 * Props for {@link DocxEditorCollaboration}.Status. The default slot,
 * `#default="{ kind, message, rejoin }"`, replaces the packaged notice.
 *
 * @public
 */
export interface CollaborationStatusNoticeProps {
  /**
   * The session to report on. Omit it and the part uses the one the editor above holds;
   * `null` renders nothing.
   */
  readonly session?: CollaborationSession | null;
  /**
   * The `rejoin` event: the part's "Rejoin" button when this copy is out of sync, or when
   * edits have waited too long for the room. Listen with
   * `@rejoin`, save the editor, and pass the bytes to your provider composable's `rejoin`.
   * Without a listener the part shows the message only.
   */
  readonly onRejoin?: () => void;
  /** Classes added to the notice region. */
  readonly className?: string;
}

/**
 * The room's state in one line, shown only when the user needs to know: while connecting,
 * offline, catching up, waiting, out of sync, or when the room refused an edit.
 *
 * The `role="status"` region stays mounted while a session exists, so screen readers
 * announce each message as it appears; it is empty while everything is in order.
 */
export const CollaborationStatusNotice = defineComponent({
  name: 'CollaborationStatusNotice',
  props: {
    session: { type: Object as PropType<CollaborationSession | null>, default: undefined },
    // `@rejoin` binds this prop, so the part knows whether anyone listens.
    onRejoin: { type: Function as PropType<() => void>, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const { t } = useTranslation();
    const fromContext = useCollaborationSession();
    // Omitted means "the editor's room"; an explicit `null` means "no room".
    const active = computed(() =>
      props.session === undefined ? fromContext.session.value : props.session
    );
    const state = useCollaborationStatus(active);
    // The room refused an edit within the last few seconds: the failure count rose while the
    // session stayed usable, which is how a refused, undone edit shows. A new session counts
    // from zero, so its count starts a new baseline.
    const refusedRecently = shallowRef(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = (): void => {
      clearTimeout(timer);
      refusedRecently.value = false;
    };
    watch(
      () => [active.value?.sessionId ?? null, state.failureCount.value] as const,
      ([sessionId, failureCount], previous) => {
        if (!previous || previous[0] !== sessionId) {
          hide();
          return;
        }
        if (failureCount <= previous[1]) return;
        const status = state.status.value;
        if (status !== 'ready' && status !== 'disconnected') return;
        hide();
        refusedRecently.value = true;
        timer = setTimeout(hide, EDIT_REFUSED_NOTICE_MS);
      }
    );
    // Edits have waited for the room longer than `STALLED_AFTER_MS`.
    const stalled = shallowRef(false);
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    watch(
      state.waiting,
      (waiting) => {
        clearTimeout(stallTimer);
        stalled.value = false;
        if (waiting) {
          stallTimer = setTimeout(() => {
            stalled.value = true;
          }, STALLED_AFTER_MS);
        }
      },
      { immediate: true }
    );
    onBeforeUnmount(() => {
      clearTimeout(timer);
      clearTimeout(stallTimer);
    });
    return () => {
      const session = active.value;
      if (!session || state.status.value === 'inactive') return null;
      const kind = collaborationNoticeOf({
        status: state.status.value,
        reasonCode: (state.reason.value ?? state.lastFailure.value)?.code,
        recovering: state.recovering.value,
        waiting: state.waiting.value,
        stalled: stalled.value,
        refusedRecently: refusedRecently.value,
        offlineEditing: session.offlineEditing !== false,
      });
      const message = kind ? t(NOTICE_MESSAGE_KEYS[kind]) : '';
      const rejoin = kind === 'outOfSync' || kind === 'stalled' ? props.onRejoin : undefined;
      let content: VNode | VNode[] | (VNode | null)[] | null = null;
      if (kind && slots.default) {
        content = slots.default({ kind, message, ...(rejoin ? { rejoin } : {}) });
      } else if (kind) {
        content = [
          h('span', { class: 'docx-collaboration-status__message' }, message),
          rejoin
            ? h(
                'button',
                { type: 'button', class: 'docx-collaboration-status__action', onClick: rejoin },
                t('collaboration.status.rejoin')
              )
            : null,
        ];
      }
      return h(
        'div',
        {
          class: `docx-collaboration-status${props.className ? ` ${props.className}` : ''}`,
          ...(kind ? { 'data-collaboration-status': kind } : {}),
          role: 'status',
        },
        content ?? []
      );
    };
  },
});
