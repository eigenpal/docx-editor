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
  presenceAvatarUrlOf,
  type PresenceAccent,
} from '../collaboration/presence-chrome.ts';
import { useCollaborationParticipants } from './useCollaborationParticipants.ts';
import { useCollaborationSession } from './useCollaborationSession.ts';

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
  /**
   * The image declared for this collaborator with `DocxEditorAuthorStyle`, or `undefined`.
   *
   * Presence carries no picture, so this is the host's own declaration, resolved by display
   * name — the same key a comment card resolves. Declare it once and it reaches the caret,
   * the avatar stack and the review card together.
   */
  readonly avatarUrl?: string;
}

/**
 * Props for {@link DocxEditorCollaboration}.CaretLabels.
 *
 * The rendered content lands in the engine's label layer, which is furniture: the layer is
 * `aria-hidden` and takes no pointer events. Assistive technology does not read a label,
 * and nothing inside one is clickable or focusable. Keep interactive or announced presence
 * UI in your own chrome, such as the avatar stack.
 *
 * @public
 */
export interface CollaborationCaretLabelsProps {
  /**
   * The session whose collaborators label the carets. Omit it and the part uses the one the
   * editor above holds; `null` renders nothing.
   */
  readonly session?: CollaborationSession | null;
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
  /** The image declared for this participant with `DocxEditorAuthorStyle`, or `undefined`. */
  readonly avatarUrl?: string;
}

/** Props for {@link DocxEditorCollaboration}.Avatars. @public */
export interface CollaborationAvatarsProps {
  /**
   * The session whose participants the stack shows. Omit it and the part uses the one the
   * editor above holds; `null` renders nothing.
   */
  readonly session?: CollaborationSession | null;
  /** Avatars shown before the rest collapse into one "+N" chip. Omit to show everyone. */
  readonly max?: number;
  readonly className?: string;
  /** Scoped slot: `#default="{ participant, color, initials, avatarUrl }"` replaces the disc. */
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

/**
 * `avatarUrl` spread only when there is one.
 *
 * `exactOptionalPropertyTypes` is on across the packages, so an absent picture has to be an
 * absent KEY rather than an explicit `undefined`.
 */
function avatarUrlProp(avatarUrl: string | undefined): { readonly avatarUrl?: string } {
  return avatarUrl !== undefined ? { avatarUrl } : {};
}

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
 * One collaborator's avatar: their declared picture, or initials in a disc filled with their
 * resolved accent — the published colour, or the review roster's colour for their name, so
 * the disc matches their tracked changes and comments with no wiring.
 */
const CollaborationAvatar = defineComponent({
  name: 'CollaborationAvatar',
  props: {
    participant: { type: Object as PropType<CollaborationParticipant>, required: true },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const roster = useReviewAuthors();
    const stackAccents = inject(AvatarAccentKey, null);
    return () => {
      // With an editor in context the ENGINE resolves the accent (`presenceColorFor`), so
      // the disc takes the same colour as the painted caret; the arithmetic is the
      // no-editor fallback.
      const editor = editorRef.value;
      const accent =
        stackAccents?.value.get(props.participant.actorId) ??
        presenceAccentOf(
          roster.value,
          props.participant,
          editor ? (name) => editor.presenceColorFor(name) : undefined,
          editor ? (name) => editor.getReviewAuthorStyle(name)?.color : undefined
        );
      const avatarUrl = presenceAvatarUrlOf(
        roster.value,
        props.participant.name,
        editor ? (author) => editor.getReviewAuthorStyle(author) : undefined
      );
      // A slot wins outright; otherwise the declared picture, and initials only when there is
      // none — the accent stays behind the image, so a broken URL still reads.
      const content =
        slots.default?.() ??
        (avatarUrl !== undefined
          ? h('img', { class: 'docx-collaboration-avatar__image', src: avatarUrl, alt: '' })
          : participantInitials(props.participant.name));
      return avatarVNode(props.participant, accent, props.className, content);
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
    session: { type: Object as PropType<CollaborationSession | null>, default: undefined },
    max: { type: Number, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const fromContext = useCollaborationSession();
    const active = computed(() =>
      props.session === undefined ? fromContext.session.value : props.session
    );
    const { participants } = useCollaborationParticipants(active);
    const roster = useReviewAuthors();
    const { t } = useTranslation();
    // With an editor in context the ENGINE resolves each accent (`presenceColorFor`), from
    // the same allocator the painted carets use; the session-order arithmetic is the
    // no-editor fallback. Only display sorts — resolution order stays session order.
    const accents = computed(() => {
      const editor = editorRef.value;
      return presenceAccentsOf(
        roster.value,
        participants.value,
        editor ? (name) => editor.presenceColorFor(name) : undefined,
        editor ? (name) => editor.getReviewAuthorStyle(name)?.color : undefined
      );
    });
    // One lookup per participant, beside the accents, so a stack of ten is ten resolutions
    // rather than ten components each walking the roster.
    const avatarUrls = computed(() => {
      const editor = editorRef.value;
      const styleFor = editor ? (author: string) => editor.getReviewAuthorStyle(author) : undefined;
      const urls = new Map<string, string>();
      for (const participant of participants.value) {
        if (urls.has(participant.name)) continue;
        const url = presenceAvatarUrlOf(roster.value, participant.name, styleFor);
        if (url !== undefined) urls.set(participant.name, url);
      }
      return urls;
    });
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
                    ...avatarUrlProp(avatarUrls.value.get(participant.name)),
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
    session: { type: Object as PropType<CollaborationSession | null>, default: undefined },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const fromContext = useCollaborationSession();
    // Omitted means "the editor's room"; an explicit `null` means "no room", and the two
    // must not collapse — which is why the prop defaults to `undefined`.
    const active = computed(() =>
      props.session === undefined ? fromContext.session.value : props.session
    );
    const { participants } = useCollaborationParticipants(active);
    const roster = useReviewAuthors();
    const anchors = shallowRef<readonly RemoteCaretLabelAnchor[]>([]);
    watch(
      [editorRef, active],
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
          slots.default
            ? slots.default({
                selection,
                participant,
                color,
                ...avatarUrlProp(
                  presenceAvatarUrlOf(
                    roster.value,
                    selection.name,
                    editorRef.value
                      ? (author) => editorRef.value!.getReviewAuthorStyle(author)
                      : undefined
                  )
                ),
              })
            : selection.name,
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
