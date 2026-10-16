// The token a tab sends on each connect.
//
// The provider reads a token callback again on every reconnect. A tab that starts a room asks
// the server to create it only until its first successful sync; after that it only joins. A
// room the server lost or retired is then refused on reconnect, instead of being seeded
// again from the demo document while other tabs still hold the earlier room.

export interface RoomToken {
  /** Pass this as the provider's `token`. */
  readonly token: () => string;
  /** Call once the room is synced: later connects only join. */
  readonly markJoined: () => void;
}

export function roomToken(tokens: {
  /** The token that asks the server to create the room. */
  readonly create: string;
  /** The token that only joins. */
  readonly join: string;
  /** This tab started the room. */
  readonly creating: boolean;
}): RoomToken {
  let joined = !tokens.creating;
  return {
    token: () => (joined ? tokens.join : tokens.create),
    markJoined: () => {
      joined = true;
    },
  };
}
