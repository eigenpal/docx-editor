/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Presence chrome for a live collaboration session: host-rendered remote-caret labels and
// the packaged avatar stack, both coloured by the same review-roster derivation the painted
// presence uses. Compose inside `DocxEditor.Root` from `@docx-editor.dev/react`.

import { Fragment, createContext, useContext, useEffect, useMemo, useState } from 'react';
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
  type PresenceAccent,
} from '../collaboration/presence-chrome.ts';
import { useCollaborationParticipants } from './useCollaborationParticipants.ts';

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
}

/** Props for {@link DocxEditorCollaboration}.CaretLabels. @public */
export interface CollaborationCaretLabelsProps {
  /** The live session whose participants label the carets. `null` renders nothing. */
  readonly session: CollaborationSession | null;
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
}

/** Props for {@link DocxEditorCollaboration}.Avatars. @public */
export interface CollaborationAvatarsProps {
  /** The live session whose participants the stack shows. `null` renders nothing. */
  readonly session: CollaborationSession | null;
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
 * One collaborator's avatar: initials in a disc filled with their resolved accent — the
 * published colour, or the review roster's colour for their name, so the disc matches
 * their tracked changes and comments with no wiring.
 */
function CollaborationAvatar({ participant, className, children }: CollaborationAvatarProps) {
  const roster = useReviewAuthors();
  const stackAccents = useContext(AvatarAccentContext);
  const accent = stackAccents?.get(participant.actorId) ?? presenceAccentOf(roster, participant);
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
      {children ?? participantInitials(participant.name)}
    </span>
  );
}

/**
 * The avatar stack: everyone in the room, the local participant first, coloured by the same
 * review-roster derivation the painted presence and the review cards use.
 */
function CollaborationAvatars({ session, max, className, children }: CollaborationAvatarsProps) {
  const participants = useCollaborationParticipants(session);
  const roster = useReviewAuthors();
  const { t } = useTranslation();
  // Accents allocate in SESSION order (the engine's appearance order); only display sorts.
  const accents = useMemo(() => presenceAccentsOf(roster, participants), [roster, participants]);
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
  const participants = useCollaborationParticipants(session);
  const roster = useReviewAuthors();
  const [anchors, setAnchors] = useState<readonly RemoteCaretLabelAnchor[]>([]);
  useEffect(() => {
    // Registered only WITH a session: a host that never renders content would leave the
    // engine's labels empty, so without one the engine keeps its default name labels.
    if (!editor || !session) return undefined;
    editor.setRemoteCaretLabelHost({ publish: (next) => setAnchors([...next]) });
    return () => {
      editor.setRemoteCaretLabelHost(null);
      // Anchors from the unregistered host are dead elements; portals into them would leak.
      setAnchors([]);
    };
  }, [editor, session]);
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
          children ? children({ selection, participant, color }) : selection.name,
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
