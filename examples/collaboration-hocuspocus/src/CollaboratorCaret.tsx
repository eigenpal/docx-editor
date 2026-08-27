// The custom remote-caret label: a photo and a name, in a pill above the collaborator's caret.
//
// The engine owns the caret itself, the label's position and the label's colour. It hands the
// host an empty, positioned element per caret; `DocxEditorCollaboration.CaretLabels` portals
// this component into it. So the content below renders in the NORMAL React tree — every
// provider above it, including the editor's, is in reach.
//
// The photo is not looked up here. `avatarUrl` arrives already resolved from the
// `DocxEditor.AuthorStyle` declared for this collaborator's display name, which is the same
// declaration their comment cards read. One source, one key, three surfaces.
//
// The label layer is furniture: `aria-hidden`, no pointer events. Nothing here is clickable
// or announced, which is why a label's avatar is hidden from assistive technology and the
// interactive presence chrome lives in the room bar instead.

import type { CSSProperties } from 'react';
import type { CollaborationRemoteSelection } from '@docx-editor.dev/core/collaboration';
import { participantInitials } from './people';

/** The accent colour, handed to CSS as a custom property rather than a colour literal. */
function accent(color: string): CSSProperties {
  return { '--collab-accent': color } as CSSProperties;
}

/**
 * One person's photo, or their initials when nothing is declared for them.
 *
 * An undeclared collaborator is normal — someone joined from a build whose directory does not
 * carry them. Falling back to initials keeps their caret labelled instead of leaving a broken
 * image on the page.
 *
 * `announced` is the difference between the two places this renders. Inside a caret label the
 * whole layer is `aria-hidden`, so naming the image would be noise; in the room bar the stack
 * is the only presence signal assistive technology gets, so the name has to be on it.
 */
export function PersonAvatar({
  avatarUrl,
  name,
  color,
  className,
  announced = false,
}: {
  readonly avatarUrl: string | undefined;
  readonly name: string;
  readonly color: string;
  readonly className?: string;
  readonly announced?: boolean;
}) {
  const classes = `collab-avatar${className ? ` ${className}` : ''}`;
  if (avatarUrl === undefined) {
    return (
      <span
        className={classes}
        style={accent(color)}
        {...(announced ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
      >
        {participantInitials(name)}
      </span>
    );
  }
  return (
    <img className={classes} style={accent(color)} src={avatarUrl} alt={announced ? name : ''} />
  );
}

/**
 * The label content for one remote caret.
 *
 * The NAME shown is the one the peer published, not a directory's: a peer picks its own actor
 * id, so preferring a local name would let anyone wear someone else's name as well as their
 * face. The picture follows that same published name, so it is exactly as trustworthy as your
 * display names are — derive them server-side and it is exact.
 */
export function CollaboratorCaret({
  selection,
  color,
  avatarUrl,
}: {
  readonly selection: CollaborationRemoteSelection;
  readonly color: string;
  readonly avatarUrl?: string;
}) {
  return (
    <span className="collab-caret" style={accent(color)}>
      <PersonAvatar
        avatarUrl={avatarUrl}
        name={selection.name}
        color={color}
        className="collab-caret__avatar"
      />
      <span className="collab-caret__name">{selection.name}</span>
    </span>
  );
}
