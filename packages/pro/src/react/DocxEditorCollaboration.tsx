/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Presence chrome for a live collaboration session: host-rendered remote-caret labels and
// the packaged avatar stack, both coloured by the same review-roster derivation the painted
// presence uses. Compose inside `DocxEditor.Root` from `@docx-editor.dev/react`.

import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDocxEditor, useReviewAuthors, useTranslation } from '@docx-editor.dev/react';
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
 * The renderer mounts inside the adapter's provider tree, so every hook works in it —
 * `useDocxEditor`, `useEditorState`, the review hooks. It has the opened document, not only
 * the collaborator.
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
   * The image declared for this collaborator with `DocxEditor.AuthorStyle`, or `undefined`.
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
   * Renders one label's content. Without it the label shows the collaborator's name,
   * matching the engine default, so mounting the part bare changes nothing visible.
   */
  readonly children?: (props: CollaborationCaretLabelRenderProps) => ReactNode;
}

/** Render props for {@link DocxEditorCollaboration}.Avatars' per-participant override. @public */
export interface CollaborationAvatarRenderProps {
  readonly participant: CollaborationParticipant;
  /** The resolved accent — published colour, or the review roster's colour for the name. */
  readonly color: string;
  /** The first letter of up to two name words, uppercased. */
  readonly initials: string;
  /** The image declared for this participant with `DocxEditor.AuthorStyle`, or `undefined`. */
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
  /** Renders one participant's avatar in place of the packaged disc. */
  readonly children?: (props: CollaborationAvatarRenderProps) => ReactNode;
}

/** Props for {@link DocxEditorCollaboration}.Avatar. @public */
export interface CollaborationAvatarProps {
  readonly participant: CollaborationParticipant;
  readonly className?: string;
  /** Replaces the initials inside the disc; the accent background stays. */
  readonly children?: ReactNode;
}

/**
 * The stack's resolved accents, so an avatar inside it shares the stack's slot allocation.
 * A stack of colourless names the roster does not carry must still fan out across the ramp,
 * and two standalone resolutions would both take the first free slot.
 */
const AvatarAccentContext = createContext<ReadonlyMap<string, PresenceAccent> | null>(null);

function accentStyle(accent: PresenceAccent): CSSProperties {
  return { '--doc-collaboration-accent': accent.color } as CSSProperties;
}

/**
 * `avatarUrl` spread only when there is one.
 *
 * `exactOptionalPropertyTypes` is on across the packages, so an absent picture has to be an
 * absent KEY rather than an explicit `undefined`.
 */
function avatarUrlProp(avatarUrl: string | undefined): { readonly avatarUrl?: string } {
  return avatarUrl !== undefined ? { avatarUrl } : {};
}

/**
 * One collaborator's avatar: their declared picture, or initials in a disc filled with their
 * resolved accent — the published colour, or the review roster's colour for their name, so
 * the disc matches their tracked changes and comments with no wiring.
 */
function CollaborationAvatar({ participant, className, children }: CollaborationAvatarProps) {
  const editor = useDocxEditor();
  const roster = useReviewAuthors();
  const stackAccents = useContext(AvatarAccentContext);
  // With an editor in context the ENGINE resolves the accent (`presenceColorFor`), so the
  // disc takes the same colour as the painted caret; the arithmetic is the no-editor fallback.
  const accent =
    stackAccents?.get(participant.actorId) ??
    presenceAccentOf(
      roster,
      participant,
      editor ? (name) => editor.presenceColorFor(name) : undefined,
      editor ? (name) => editor.getReviewAuthorStyle(name)?.color : undefined
    );
  const avatarUrl = useParticipantAvatarUrl(participant.name);
  return (
    <span
      className={`docx-collaboration-avatar${className ? ` ${className}` : ''}`}
      data-collaboration-avatar=""
      {...(participant.isLocal ? { 'data-local': '' } : {})}
      {...(accent.slot !== null ? { 'data-collaboration-author-slot': accent.slot } : {})}
      title={participant.name}
      role="img"
      aria-label={participant.name}
      style={accentStyle(accent)}
    >
      {/* An override wins outright; otherwise the declared picture, and initials only when
          there is none — the accent stays behind the image, so a broken URL still reads. */}
      {children ??
        (avatarUrl !== undefined ? (
          <img className="docx-collaboration-avatar__image" src={avatarUrl} alt="" />
        ) : (
          participantInitials(participant.name)
        ))}
    </span>
  );
}

/**
 * The picture declared for one display name, or `undefined`.
 *
 * The roster covers anyone who has written in the document; the editor's per-author style
 * covers everyone else, which in a live room is most people — someone who joined and typed
 * nothing appears in no roster.
 */
function useParticipantAvatarUrl(name: string): string | undefined {
  const editor = useDocxEditor();
  const roster = useReviewAuthors();
  return presenceAvatarUrlOf(
    roster,
    name,
    editor ? (author) => editor.getReviewAuthorStyle(author) : undefined
  );
}

/**
 * The avatar stack: everyone in the room, the local participant first, coloured by the same
 * review-roster derivation the painted presence and the review cards use.
 */
function CollaborationAvatars({ session, max, className, children }: CollaborationAvatarsProps) {
  const editor = useDocxEditor();
  const participants = useCollaborationParticipants(session);
  const roster = useReviewAuthors();
  const { t } = useTranslation();
  // With an editor in context the ENGINE resolves each accent (`presenceColorFor`), from the
  // same allocator the painted carets use; the session-order arithmetic is the no-editor
  // fallback. Only display sorts — resolution order stays session order.
  const accents = useMemo(
    () =>
      presenceAccentsOf(
        roster,
        participants,
        editor ? (name) => editor.presenceColorFor(name) : undefined,
        editor ? (name) => editor.getReviewAuthorStyle(name)?.color : undefined
      ),
    [roster, participants, editor]
  );
  // One lookup per participant, beside the accents, so a stack of ten is ten resolutions
  // rather than ten components each walking the roster.
  const avatarUrls = useMemo(() => {
    const styleFor = editor ? (author: string) => editor.getReviewAuthorStyle(author) : undefined;
    const urls = new Map<string, string>();
    for (const participant of participants) {
      if (urls.has(participant.name)) continue;
      const url = presenceAvatarUrlOf(roster, participant.name, styleFor);
      if (url !== undefined) urls.set(participant.name, url);
    }
    return urls;
  }, [editor, participants, roster]);
  const sorted = useMemo(() => orderedParticipants(participants), [participants]);
  if (sorted.length === 0) return null;
  const shown = max === undefined ? sorted : sorted.slice(0, Math.max(0, max));
  const overflow = sorted.length - shown.length;
  const overflowLabel = t('collaboration.moreParticipants', { count: overflow });
  return (
    <span
      className={`docx-collaboration-avatars${className ? ` ${className}` : ''}`}
      data-collaboration-avatars=""
      role="group"
      aria-label={t('collaboration.participants')}
    >
      <AvatarAccentContext.Provider value={accents}>
        {shown.map((participant) =>
          children ? (
            <Fragment key={participant.actorId}>
              {children({
                participant,
                color: accents.get(participant.actorId)!.color,
                initials: participantInitials(participant.name),
                ...avatarUrlProp(avatarUrls.get(participant.name)),
              })}
            </Fragment>
          ) : (
            <CollaborationAvatar key={participant.actorId} participant={participant} />
          )
        )}
      </AvatarAccentContext.Provider>
      {overflow > 0 ? (
        <span
          className="docx-collaboration-avatar"
          data-collaboration-avatar=""
          data-overflow=""
          title={overflowLabel}
          role="img"
          aria-label={overflowLabel}
        >
          {`+${overflow}`}
        </span>
      ) : null}
    </span>
  );
}

const EMPTY_ANCHORS: readonly RemoteCaretLabelAnchor[] = Object.freeze([]);

function readEmptyAnchors(): readonly RemoteCaretLabelAnchor[] {
  return EMPTY_ANCHORS;
}

/** What the engine publishes into, and what this part renders out of. */
interface AnchorStore {
  readonly subscribe: (onStoreChange: () => void) => () => void;
  readonly read: () => readonly RemoteCaretLabelAnchor[];
  readonly write: (next: readonly RemoteCaretLabelAnchor[]) => void;
}

/**
 * The published anchors as an EXTERNAL store rather than component state.
 *
 * The engine publishes whenever it repaints, and a repaint can happen inside another
 * component's render — chrome reads the engine while rendering, and that read paints. A
 * `useState` setter called there is React's "Cannot update a component while rendering a
 * different component", and the update it warns about is the one that draws the labels.
 *
 * So the value moves SYNCHRONOUSLY and the notification does not. A store React re-reads
 * cannot tear: a publish during a render is already visible to `read` when React finishes and
 * compares the snapshot, so the labels land in that same commit. The deferred notify is what
 * covers a publish with no render in flight — and deferring it is what keeps the write out of
 * React's render phase, which subscribing alone does not, because a subscriber notified mid
 * render schedules exactly the update React warns about.
 *
 * The store is per component instance, because the anchors are: two mounted parts would
 * fight over `setRemoteCaretLabelHost` anyway.
 */
function useAnchorStore(): AnchorStore {
  const ref = useRef<AnchorStore | null>(null);
  if (ref.current === null) {
    let anchors = EMPTY_ANCHORS;
    let notifying = false;
    const listeners = new Set<() => void>();
    ref.current = {
      subscribe: (onStoreChange) => {
        listeners.add(onStoreChange);
        return () => listeners.delete(onStoreChange);
      },
      read: () => anchors,
      // The engine builds a fresh array per publish, so identity already tracks change; the
      // empty case is the shared frozen one, which keeps a cleared store from re-rendering.
      write: (next) => {
        anchors = next.length === 0 ? EMPTY_ANCHORS : next;
        // Coalesced: a paint can publish more than once before the microtask runs, and every
        // listener reads the same latest value anyway.
        if (notifying) return;
        notifying = true;
        queueMicrotask(() => {
          notifying = false;
          for (const listener of [...listeners]) listener();
        });
      },
    };
  }
  return ref.current;
}

/**
 * Host-rendered remote-caret labels.
 *
 * Mount it anywhere inside `DocxEditor.Root`. It registers this tree as the engine's
 * remote-caret label host: the engine keeps creating, positioning and colouring each label,
 * and this part portals the host's content into it — so the content lives in the NORMAL
 * React tree and every provider above this part reaches it. Unmounting restores the
 * engine's default name labels.
 */
function CollaborationCaretLabels({ session, children }: CollaborationCaretLabelsProps) {
  const editor = useDocxEditor();
  const fromContext = useCollaborationSession();
  const active = session === undefined ? fromContext : session;
  const participants = useCollaborationParticipants(active);
  const roster = useReviewAuthors();
  const store = useAnchorStore();
  const anchors = useSyncExternalStore(store.subscribe, store.read, readEmptyAnchors);
  useEffect(() => {
    // Registered only WITH a session: a host that never renders content would leave the
    // engine's labels empty, so without one the engine keeps its default name labels.
    if (!editor || !active) return undefined;
    editor.setRemoteCaretLabelHost({ publish: store.write });
    return () => {
      editor.setRemoteCaretLabelHost(null);
      // Anchors from the unregistered host are dead elements; portals into them would leak.
      store.write(EMPTY_ANCHORS);
    };
  }, [editor, active, store]);
  if (anchors.length === 0) return null;
  const accents = presenceAccentsOf(roster, participants);
  return (
    <>
      {anchors.map((anchor) => {
        const { selection } = anchor;
        const participant =
          participants.find((candidate) => candidate.actorId === selection.actorId) ?? null;
        // The engine wrote its resolved colour onto the label it positioned; reading it back
        // means chrome and paint CANNOT disagree. The roster derivation only stands in for a
        // label painted without one.
        const painted = anchor.element.style.getPropertyValue('--doc-remote-color');
        const color =
          painted !== ''
            ? painted
            : (accents.get(selection.actorId)?.color ??
              presenceAccentOf(roster, {
                actorId: selection.actorId,
                name: selection.name,
                ...(selection.color !== undefined ? { color: selection.color } : {}),
                isLocal: false,
              }).color);
        return createPortal(
          children
            ? children({
                selection,
                participant,
                color,
                ...avatarUrlProp(
                  presenceAvatarUrlOf(
                    roster,
                    selection.name,
                    editor ? (author) => editor.getReviewAuthorStyle(author) : undefined
                  )
                ),
              })
            : selection.name,
          anchor.element,
          selection.actorId
        );
      })}
    </>
  );
}

/**
 * The collaboration presence compound.
 *
 * @public
 */
export interface DocxEditorCollaborationNamespace {
  /** Host-rendered remote-caret labels, with full adapter context inside each label. */
  readonly CaretLabels: typeof CollaborationCaretLabels;
  /** The packaged avatar stack, coloured to match the review module's author colours. */
  readonly Avatars: typeof CollaborationAvatars;
  /** One participant's avatar, for hosts arranging their own presence chrome. */
  readonly Avatar: typeof CollaborationAvatar;
}

/**
 * Presence chrome over a live collaboration session.
 *
 * Compose the parts inside `DocxEditor.Root` with the collaboration module registered:
 *
 * @example
 * ```tsx
 * <DocxEditorCollaboration.Avatars session={session} max={4} />
 * <DocxEditorCollaboration.CaretLabels session={session}>
 *   {({ selection, color }) => <MyLabel name={selection.name} color={color} />}
 * </DocxEditorCollaboration.CaretLabels>
 * ```
 *
 * @public
 */
export const DocxEditorCollaboration: DocxEditorCollaborationNamespace = Object.freeze({
  CaretLabels: CollaborationCaretLabels,
  Avatars: CollaborationAvatars,
  Avatar: CollaborationAvatar,
});
