// Migrate every room the demo server stores, with the public migration API.
//
// `@docx-editor.dev/pro/collaboration` decides whether a room needs a migration
// (`collaborationMigrationNeed`) and seeds and checks the new room (`migrateCollaborationRoom`).
// This file adds what depends on storage: where rooms and their exports are, the backup, the
// atomic write, and one result for each room. Replace it with your own storage.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  collaborationMigrationNeed,
  migrateCollaborationRoom,
  type CollaborationMigrationReport,
} from '@docx-editor.dev/pro/collaboration';
import { ROOM_ID, stateDigest, writeAtomically } from './room-files.ts';

/** What happened to one room. */
export type RoomMigrationResult =
  | { readonly room: string; readonly outcome: 'current' }
  | {
      readonly room: string;
      readonly outcome: 'migrated' | 'would-migrate' | 'failed-check';
      readonly report: CollaborationMigrationReport;
    }
  | {
      readonly room: string;
      readonly outcome: 'no-export' | 'stale-export' | 'later-format' | 'error';
      readonly detail: string;
    };

/** The export the earlier build wrote for a room, beside its state. */
export function exportFileOf(directory: string, room: string): string {
  return path.join(directory, `${room}.migration.docx`);
}

/** The digest of the state an export was written from. */
export function exportDigestFileOf(directory: string, room: string): string {
  return path.join(directory, `${room}.migration.sha256`);
}

/**
 * Migrate every room in `directory`. A room already in the current format is left as it is,
 * so running again after an interruption migrates only the rest. A room is replaced only after
 * its new state passed the check, and its earlier state is kept as `<room>.ydoc.previous`.
 */
export async function migrateStoredRooms(
  directory: string,
  options: { readonly dryRun?: boolean } = {}
): Promise<RoomMigrationResult[]> {
  const results: RoomMigrationResult[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const room = name.endsWith('.ydoc') ? name.slice(0, -'.ydoc'.length) : null;
    if (!room || !ROOM_ID.test(room)) continue;
    const stateFile = path.join(directory, name);
    try {
      const state = new Uint8Array(await readFile(stateFile));
      const need = collaborationMigrationNeed(state);
      if (need === 'current') {
        results.push({ room, outcome: 'current' });
        continue;
      }
      if (need === 'later-format') {
        results.push({ room, outcome: 'later-format', detail: 'a later build wrote this room' });
        continue;
      }
      const exported = await readFile(exportFileOf(directory, room)).catch(() => null);
      const digest = await readFile(exportDigestFileOf(directory, room), 'utf8').catch(() => null);
      if (!exported || digest === null) {
        results.push({
          room,
          outcome: 'no-export',
          detail: 'export the room with the build that created it',
        });
        continue;
      }
      // The export must be of this exact state: one written before later edits would lose them.
      if (digest.trim() !== stateDigest(state)) {
        results.push({
          room,
          outcome: 'stale-export',
          detail: 'the room changed after its export; export it again',
        });
        continue;
      }
      const migrated = await migrateCollaborationRoom(new Uint8Array(exported), {
        documentId: room,
      });
      if (!migrated.ok) {
        results.push({ room, outcome: 'failed-check', report: migrated.report });
        continue;
      }
      if (options.dryRun) {
        results.push({ room, outcome: 'would-migrate', report: migrated.report });
        continue;
      }
      // The backup is the exact state the digest checked, on disk before the replacement.
      await writeAtomically(`${stateFile}.previous`, state);
      await writeAtomically(stateFile, migrated.state);
      results.push({ room, outcome: 'migrated', report: migrated.report });
    } catch (error) {
      results.push({ room, outcome: 'error', detail: (error as Error).message });
    }
  }
  return results;
}

/** Whether every room ended in a state the server can serve. */
export function allRoomsServable(results: readonly RoomMigrationResult[]): boolean {
  return results.every(
    (result) =>
      result.outcome === 'current' ||
      result.outcome === 'migrated' ||
      result.outcome === 'would-migrate'
  );
}
