// The demo's user directory: one record per person, and nothing that reads it at render time.
//
// This roster is DECLARED once, as `DocxEditor.AuthorStyle` per person in `App.tsx`. After
// that the engine owns the lookup: a caret label, an avatar and a comment card each resolve
// the declared colour and picture themselves. So there is no directory call in any component,
// and no second index keyed on `actorId` — the display name is the only key, because it is
// the one the saved file carries in `w:author`.
//
// A real app builds this from its user service and declares the people it knows about.

/** One person the demo can sign in as. */
export interface Person {
  /** The user id. It is the stable half of the collaboration `actorId`. */
  readonly id: string;
  /** The display name. It is also the `w:author` a comment or tracked change is saved with. */
  readonly name: string;
  readonly title: string;
  /** Published as the collaboration identity colour. Hex, because the engine paints it. */
  readonly color: string;
  /**
   * Any image URL, resolved on each replica rather than published over presence.
   *
   * These are illustrative portraits drawn for the demo and served from `public/avatars/`,
   * so the example ships no third-party imagery and needs no network. Point this at your own
   * CDN. `DocxEditor.AuthorStyle` accepts `http`, `https`, `data:` (non-SVG), `blob:` and
   * same-origin relative URLs; it drops anything else.
   */
  readonly avatarUrl: string;
}

/** The first letter of up to two name words, uppercased. */
export function participantInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('');
}

/** Who the demo lets you sign in as. Pick a different one in each browser. */
export const PEOPLE: readonly Person[] = [
  {
    id: 'frodo',
    name: 'Frodo Baggins',
    title: 'Ring-bearer',
    color: '#1f7a4d',
    avatarUrl: '/avatars/frodo.jpg',
  },
  {
    id: 'aragorn',
    name: 'Aragorn',
    title: 'Ranger of the North',
    color: '#2d5b8e',
    avatarUrl: '/avatars/aragorn.jpg',
  },
  {
    id: 'galadriel',
    name: 'Galadriel',
    title: 'Lady of Lórien',
    color: '#7c5cd6',
    avatarUrl: '/avatars/galadriel.jpg',
  },
  {
    id: 'gandalf',
    name: 'Gandalf the Grey',
    title: 'Wandering wizard',
    color: '#a16207',
    avatarUrl: '/avatars/gandalf.jpg',
  },
];

/**
 * Build the `actorId` for one attachment of `person`.
 *
 * An `actorId` identifies one ATTACHMENT, not one person: the same person in two tabs is two
 * carets, so it has to be unique per tab and a user id is not. Nothing decodes it — the
 * `<userId>#<random>` shape is here only so a room roster is readable in devtools.
 */
export function actorIdFor(person: Person): string {
  // `getRandomValues`, not `randomUUID`: the latter needs a secure context, so it throws on
  // the `http://<lan-ip>` origin you reach for when showing the demo on a second device.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${person.id}#${suffix}`;
}
