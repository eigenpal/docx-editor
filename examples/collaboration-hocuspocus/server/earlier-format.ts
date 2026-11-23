// A demonstration aid: make a saved room look like one that an earlier release wrote.
//
// A real format change comes with a release, so you cannot watch an upgrade without two
// releases. This file lowers the format that a saved room names, which is what the server
// reads to decide that the room needs an upgrade. The room's document does not change.
//
// Never use it on rooms you need. It exists for `simulate-format-change.ts` and its test.

import * as Y from 'yjs';
import { collaborationMigrationNeed } from '@docx-editor.dev/pro/collaboration';

// Where a room names its format. These are internals of the collaboration format, used here
// only to build a demonstration room. The check below fails when they change.
const FORMAT_MAP = 'docx-package-meta-v1';
const FORMAT_FIELD = 'sharedSchemaVersion';

/** `state` with an earlier format in place of the one it names. */
export function asEarlierFormat(state: Uint8Array): Uint8Array {
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, state);
    const format = room.getMap(FORMAT_MAP);
    const version = format.get(FORMAT_FIELD);
    if (typeof version !== 'number') throw new Error('The room names no format.');
    format.set(FORMAT_FIELD, version - 1);
    const earlier = Y.encodeStateAsUpdate(room);
    if (collaborationMigrationNeed(earlier) !== 'earlier-format') {
      throw new Error('The room does not read as an earlier format.');
    }
    return earlier;
  } finally {
    room.destroy();
  }
}
