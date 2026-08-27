/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Presence chrome for a live collaboration session — the Vue twin of the React compound:
// host-rendered remote-caret labels (Teleport where React portals) and the packaged avatar
// stack, both coloured by the same review-roster derivation the painted presence uses.
// Compose inside `DocxEditorRoot` from `@docx-editor.dev/vue`.

import {
  Fragment,
  Teleport,
  computed,
  defineComponent,
  h,
  inject,
  provide,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
  type PropType,
  type VNode,
} from 'vue';
import { useDocxEditor, useReviewAuthors, useTranslation } from '@docx-editor.dev/vue';
import type {
  CollaborationParticipant,
  CollaborationRemoteSelection,
} from '@docx-editor.dev/core/collaboration';
import type { RemoteCaretLabelAnchor } from '@docx-editor.dev/core/editor';
import type { CollaborationSession } from '../collaboration/session.ts';
import {
  orderedParticipants,
  participantInitials,
  presenceAccentOf,
  presenceAccentsOf,
  type PresenceAccent,
} from '../collaboration/presence-chrome.ts';
import { useCollaborationParticipants } from './useCollaborationParticipants.ts';

/**
 * What a custom remote-caret label renders with.
 *
 * The renderer mounts inside the adapter's provider tree, so every composable works in it —
 * `useDocxEditor`, `useEditorState`, the review composables. It has the opened document, not
 * only the collaborator.
 *
 * @public
 */
export interface CollaborationCaretLabelRenderProps {
  /** The remote selection this label marks, resolved into this replica's addresses. */
  readonly selection: CollaborationRemoteSelection;
  /** The session roster entry for the selection's actor, or null while presence catches up. */
  readonly participant: CollaborationParticipant | null;
  /**
   * The resolved accent: the published colour when the engine can paint it, otherwise the
   * review roster's colour for the name — the same resolution the painted label uses.
   */
  readonly color: string;
}

/** Props for {@link DocxEditorCollaboration}.CaretLabels. @public */
export interface CollaborationCaretLabelsProps {
  /** The live session whose participants label the carets. `null` renders nothing. */
  readonly session: CollaborationSession | null;
  /**
   * Scoped slot: `#default="{ selection, participant, color }"`. Without it the label shows
   * the collaborator's name, matching the engine default.
   */
  readonly children?: (props: CollaborationCaretLabelRenderProps) => VNode | VNode[];
}

/** Render props for {@link DocxEditorCollaboration}.Avatars' per-participant override. @public */
export interface CollaborationAvatarRenderProps {
  readonly participant: CollaborationParticipant;
  /** The resolved accent — published colour, or the review roster's colour for the name. */
  readonly color: string;
  /** The first letter of up to two name words, uppercased. */
  readonly initials: string;
}

/** Props for {@link DocxEditorCollaboration}.Avatars. @public */
export interface CollaborationAvatarsProps {
  /** The live session whose participants the stack shows. `null` renders nothing. */
  readonly session: CollaborationSession | null;
  /** Avatars shown before the rest collapse into one "+N" chip. Omit to show everyone. */
  readonly max?: number;
  readonly className?: string;
  /** Scoped slot: `#default="{ participant, color, initials }"` replaces the packaged disc. */
  readonly children?: (props: CollaborationAvatarRenderProps) => VNode | VNode[];
}

/** Props for {@link DocxEditorCollaboration}.Avatar. @public */
export interface CollaborationAvatarProps {
  readonly participant: CollaborationParticipant;
  readonly className?: string;
  /** Default slot: replaces the initials inside the disc; the accent background stays. */
  readonly children?: VNode | VNode[];
}

/**
 * The stack's resolved accents, so an avatar inside it shares the stack's slot allocation.
 * A stack of colourless names the roster does not carry must still fan out across the ramp,
 * and two standalone resolutions would both take the first free slot.
 */
const AvatarAccentKey: InjectionKey<ComputedRef<ReadonlyMap<string, PresenceAccent>>> = Symbol(
  'docx-collaboration-avatar-accents'
);

function avatarVNode(
  participant: CollaborationParticipant,
  accent: PresenceAccent,
  className: string | undefined,
  content: VNode | VNode[] | string
): VNode {
  return h(
    'span',
    {
      class: `docx-collaboration-avatar${className ? ` ${className}` : ''}`,
      'data-collaboration-avatar': '',
      ...(participant.isLocal ? { 'data-local': '' } : {}),
      ...(accent.slot !== null ? { 'data-collaboration-author-slot': accent.slot } : {}),
      title: participant.name,
      role: 'img',
      'aria-label': participant.name,
      style: { '--doc-collaboration-accent': accent.color },
    },
    content
  );
}

/**
 * One collaborator's avatar: initials in a disc filled with their resolved accent — the
 * published colour, or the review roster's colour for their name, so the disc matches
 * their tracked changes and comments with no wiring.
 */
const CollaborationAvatar = defineComponent({
  name: 'CollaborationAvatar',
  props: {
    participant: { type: Object as PropType<CollaborationParticipant>, required: true },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const roster = useReviewAuthors();
    const stackAccents = inject(AvatarAccentKey, null);
    return () => {
      const accent =
        stackAccents?.value.get(props.participant.actorId) ??
        presenceAccentOf(roster.value, props.participant);
      return avatarVNode(
        props.participant,
        accent,
        props.className,
        slots.default?.() ?? participantInitials(props.participant.name)
      );
    };
  },
});

/**
 * The avatar stack: everyone in the room, the local participant first, coloured by the same
 * review-roster derivation the painted presence and the review cards use.
 */
const CollaborationAvatars = defineComponent({
  name: 'CollaborationAvatars',
  props: {
    session: { type: Object as PropType<CollaborationSession | null>, default: null },
    max: { type: Number, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const { participants } = useCollaborationParticipants(() => props.session);
    const roster = useReviewAuthors();
    const { t } = useTranslation();
    // Accents allocate in SESSION order (the engine's appearance order); only display sorts.
    const accents = computed(() => presenceAccentsOf(roster.value, participants.value));
    const sorted = computed(() => orderedParticipants(participants.value));
    provide(AvatarAccentKey, accents);
    return () => {
      if (sorted.value.length === 0) return null;
      const shown =
        props.max === undefined ? sorted.value : sorted.value.slice(0, Math.max(0, props.max));
      const overflow = sorted.value.length - shown.length;
      const overflowLabel = t('collaboration.moreParticipants', { count: overflow });
      return h(
        'span',
        {
          class: `docx-collaboration-avatars${props.className ? ` ${props.className}` : ''}`,
          'data-collaboration-avatars': '',
          role: 'group',
          'aria-label': t('collaboration.participants'),
        },
        [
          ...shown.map((participant) =>
            slots.default
              ? h(Fragment, { key: participant.actorId }, [
                  slots.default({
                    participant,
                    color: accents.value.get(participant.actorId)!.color,
                    initials: participantInitials(participant.name),
                  }),
                ])
              : h(CollaborationAvatar, { key: participant.actorId, participant })
          ),
          overflow > 0
            ? h(
                'span',
                {
                  class: 'docx-collaboration-avatar',
                  'data-collaboration-avatar': '',
                  'data-overflow': '',
                  title: overflowLabel,
                  role: 'img',
                  'aria-label': overflowLabel,
                },
                `+${overflow}`
              )
            : null,
        ]
      );
    };
  },
});

/**
 * Host-rendered remote-caret labels.
 *
 * Mount it anywhere inside `DocxEditorRoot`. It registers this tree as the engine's
 * remote-caret label host: the engine keeps creating, positioning and colouring each label,
 * and this part teleports the host's content into it — so the content lives in the NORMAL
 * Vue tree and every provider above this part reaches it. Unmounting restores the engine's
 * default name labels.
 */
const CollaborationCaretLabels = defineComponent({
  name: 'CollaborationCaretLabels',
  props: {
    session: { type: Object as PropType<CollaborationSession | null>, default: null },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const { participants } = useCollaborationParticipants(() => props.session);
    const roster = useReviewAuthors();
    const anchors = shallowRef<readonly RemoteCaretLabelAnchor[]>([]);
    watch(
      [editorRef, () => props.session],
      ([editor, session], _previous, onCleanup) => {
        // Registered only WITH a session: a host that never renders content would leave the
        // engine's labels empty, so without one the engine keeps its default name labels.
        if (!editor || !session) return;
        editor.setRemoteCaretLabelHost({
          publish: (next) => {
            anchors.value = [...next];
          },
        });
        onCleanup(() => {
          editor.setRemoteCaretLabelHost(null);
          // Anchors from the unregistered host are dead elements; teleports would leak.
          anchors.value = [];
        });
      },
      { immediate: true }
    );
    return () => {
      if (anchors.value.length === 0) return null;
      const accents = presenceAccentsOf(roster.value, participants.value);
      return anchors.value.map((anchor) => {
        const { selection } = anchor;
        const participant =
          participants.value.find((candidate) => candidate.actorId === selection.actorId) ?? null;
        // The engine wrote its resolved colour onto the label it positioned; reading it back
        // means chrome and paint CANNOT disagree. The roster derivation only stands in for a
        // label painted without one.
        const painted = anchor.element.style.getPropertyValue('--doc-remote-color');
        const color =
          painted !== ''
            ? painted
            : (accents.get(selection.actorId)?.color ??
              presenceAccentOf(roster.value, {
                actorId: selection.actorId,
                name: selection.name,
                ...(selection.color !== undefined ? { color: selection.color } : {}),
                isLocal: false,
              }).color);
        return h(Teleport, { to: anchor.element, key: selection.actorId }, [
          slots.default ? slots.default({ selection, participant, color }) : selection.name,
        ]);
      });
    };
  },
});

/**
 * Presence chrome over a live collaboration session.
 *
 * Compose the parts inside `DocxEditorRoot` with the collaboration module registered:
 *
 * @example
 * ```html
 * <DocxEditorCollaboration.Avatars :session="session" :max="4" />
 * <DocxEditorCollaboration.CaretLabels :session="session" v-slot="{ selection, color }">
 *   <MyLabel :name="selection.name" :color="color" />
 * </DocxEditorCollaboration.CaretLabels>
 * ```
 *
 * @public
 */
export const DocxEditorCollaboration = {
  /** Host-rendered remote-caret labels, with full adapter context inside each label. */
  CaretLabels: CollaborationCaretLabels,
  /** The packaged avatar stack, coloured to match the review module's author colours. */
  Avatars: CollaborationAvatars,
  /** One participant's avatar, for hosts arranging their own presence chrome. */
  Avatar: CollaborationAvatar,
};

/** @public */
export type DocxEditorCollaborationNamespace = typeof DocxEditorCollaboration;
