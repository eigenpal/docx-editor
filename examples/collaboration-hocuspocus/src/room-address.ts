// When the address bar names the room.
//
// An invite link names its room from the start. A tab that starts a new room names it only
// once the first connect succeeded, because a reload reads `?room=` as an invite: named any
// earlier, a reload after a failed first connect would ask the server for a room it never
// created, and the tab would show "This room does not exist" instead of starting again.

export interface RoomAddressInput {
  /** The page address now. */
  readonly href: string;
  readonly roomId: string;
  /** This tab started the room. */
  readonly creating: boolean;
  /** The room is connected and its document is open. */
  readonly connected: boolean;
}

/** The address to show for the room, or null when the address bar should stay as it is. */
export function roomAddress(input: RoomAddressInput): string | null {
  if (input.creating && !input.connected) return null;
  const url = new URL(input.href);
  if (url.searchParams.get('room') === input.roomId && [...url.searchParams].length === 1) {
    return null;
  }
  url.search = '';
  url.searchParams.set('room', input.roomId);
  return url.toString();
}
