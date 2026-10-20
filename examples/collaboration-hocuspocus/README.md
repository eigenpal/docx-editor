# Server-backed DOCX collaboration

This example connects a React editor to a [Hocuspocus collaboration server](https://tiptap.dev/docs/hocuspocus). Remote carets show each person's name and avatar.

The example has two parts:

- `server/server.ts` authenticates connections and stores rooms.
- `src/` joins a room with `useHocuspocusCollaboration`.

## Run the example

Use Node.js 22.18 or later for the server. Hocuspocus v4 targets Node, and Node runs the TypeScript server with type stripping.

Install and build from the repository root:

```bash
bun install
bun run build:packages
```

Start the server in the first terminal:

```bash
bun run dev:collaboration-hocuspocus:server
```

Start the app in the second terminal:

```bash
bun run dev:collaboration-hocuspocus
```

The server uses `ws://127.0.0.1:1234`. Open the app at `http://localhost:5176`.

1. Choose a seat in the first browser.
2. Select the room ID to copy the invite link.
3. Open the link in a private window or another browser profile.
4. Choose a different seat, and edit in both windows.

## Configure the connection

The default shared token is `demo-token`. Set matching server and client values when you change it.

- `PORT` sets the Hocuspocus server port.
- `COLLAB_TOKEN` sets the server token.
- `VITE_COLLAB_URL` sets the WebSocket URL for the app.
- `VITE_COLLAB_TOKEN` sets the token that the app sends.

The app wraps the token in this demo's JSON authentication envelope:

```ts
{ token, collaborationVersion: COLLABORATION_FORMAT_VERSION, createRoom?: true }
```

Only the tab that starts a room sends `createRoom`. A production server derives that permission from the signed token instead.

`shared/admission.ts` creates and validates that envelope. In `onAuthenticate`, the server checks the secret and calls `assertCollaborationFormatCompatibility(collaborationVersion)` before Hocuspocus allows synchronization. Import the version from the installed package; transmit it unchanged. Missing, malformed, and incompatible versions are refused. The example also accepts compatible clients that send its previous `versions` envelope. Those clients can join existing rooms, but they cannot start one, because that envelope has no `createRoom` field. Pass the encoded string as `token`, or return it from a callback to refresh credentials on reconnection.

These self-reported versions prevent accidental connections between incompatible builds. They do not prove which code a client runs. A production server should verify a signed token, derive identity and room permissions from it, and enforce its deployment policy separately.

## Store and export rooms

The server stores rooms in `server/.data/`. It reads each `.ydoc` file when a room opens, and keeps a `.room` record for each room it created. It also exports a `.docx` file beside each Yjs document. Before admitting a saved snapshot, `server/stored-room.ts` checks its version with `readCollaborationFormatVersion` and `assertCollaborationFormatCompatibility` in a temporary document. It then validates the compatible document with `readCollaborationDocument`. The server rejects incompatible or invalid snapshots before loading them into the live room. Compatible clients cannot upgrade saved room data.

The server creates a room only for the tab that starts it. That tab asks for a new room in its authentication envelope; an invite link only joins, and the server refuses a room it does not know. To create the room, the server seeds it from `examples/vite/public/sample.docx` with `createCollaborationState`. It stores the room state with a create-only write before anyone syncs, and then writes a `.room` record. When it loads a stored room that has no record, it writes one, so a crash between the two writes leaves no room unprotected. Participants join the seeded room, so no participant uploads the document or receives it back. For more information, see [Seed new rooms on a server](https://www.docx-editor.dev/docs/2.x/pro/collaboration#seed-new-rooms-on-a-server).

If a room has a record but no state, the server refuses it with `saved-room-unavailable` and does not seed it again. A second seed would replace every edit with the original document. Participants keep their copies while you restore the `.ydoc` file. A document that cannot seed a room, such as one over the seed size limit, is refused with its failure code, such as `baseline-too-large`.

Replace `onLoadDocument` and `onStoreDocument` when you need database or object storage. Keep the `prepareCollaborationServerDocument` call at the start of `onLoadDocument`, before the room's state loads. Keep the `document.flush()` call in `afterLoadDocument`, so the first participant receives the loaded room once.

When a saved room is at least twice the size of a fresh build of its content, `onLoadDocument` compacts it with `compactCollaborationState` and stores the new generation in place of the old state. The server replaces each file atomically, so an interrupted write leaves either its previous state or its complete replacement. If compaction throws `CollaborationSchemaError`, the server keeps the stored state unchanged. `beforeHandleMessage` calls `checkCollaborationRoomGeneration`, which refuses a client that still holds the room from before a compaction. That client reports `room-generation-changed` and can rejoin. Keep both calls when you replace the storage hooks. For more information, see [Compact rooms on a server](https://www.docx-editor.dev/docs/2.x/pro/collaboration#compact-rooms-on-a-server).

### Recover after a version mismatch

Preserve local and offline edits before reloading browser tabs. Upgrade the app, room server, and export workers together. The server rejects incompatible clients before synchronization.

For saved rooms and offline work, follow the [collaboration upgrade guide](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions). Pause editing and preserve pending work before exporting with the compatible previous build. Verify the DOCX, then create a replacement room. Collaboration undo history starts afresh.

### Migrate saved rooms

The server does not migrate rooms by itself. Two scripts move every saved room to the current collaboration format with the public migration API, `collaborationMigrationNeed` and `migrateCollaborationRoom`. `server/room-migration.ts` holds what depends on storage: where rooms and exports are, the backup, the atomic write, and one result for each room. Replace it with your own storage. For the procedure on any storage, see [Migrate rooms on a server](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#migrate-rooms-on-a-server).

To migrate the rooms, follow these steps:

1. Ask users to synchronize pending edits or save a local DOCX for reconciliation. Stop the server and every background writer.
1. Back up the complete data directory and retain the build that can open it.
1. Copy `server/export-rooms.ts` and `server/room-files.ts` into a directory where the build that created the rooms is installed. The scripts need Node.js 22.18 or later. Replace `2.27.0` with that release:

   ```bash
   mkdir room-export && cd room-export
   npm init -y && npm pkg set type=module
   npm install @docx-editor.dev/pro@2.27.0 @docx-editor.dev/core@2.27.0 yjs@^13.6.32
   ```

1. In that directory, run `node export-rooms.ts --data-dir "/absolute/path/to/server/.data"`. Replace the quoted path with your stopped server's data directory. It writes `<room>.migration.docx` beside each room, with `<room>.migration.sha256`, the SHA-256 of the state it exported. If a room fails with `not-initialized`, it holds no document: move both `<room>.ydoc` and its `<room>.room` record out of the data directory together, keep them with your backups, and run the export again. The room ID is then retired: an invite to it reports that the room does not exist. Moving only the `.ydoc` file makes the server refuse the room as a saved room it cannot open.
1. Return to `examples/collaboration-hocuspocus` in the checkout with the target build. Install dependencies and build packages with the repository-root commands in [Run the example](#run-the-example). Run `node server/migrate-rooms.ts --dry-run --report report.json` from the example directory. For each room, it seeds a new room from the export and checks the new room against the export: every XML part, every media file, and every link target. It prints one line for each room and a summary, writes the results to `report.json`, and leaves room files unchanged. The report file is still written.
1. If any room is not `would-migrate` or `current`, stop and resolve it as the following table describes. Otherwise, run `node server/migrate-rooms.ts`. It keeps each earlier state as `<room>.ydoc.previous` and writes the new state in its place. Rooms already in the current format stay as they are, so a second run after an interruption migrates only the rest.
1. Check that the write run exits with status 0. Start the server with the new build. Open migrated rooms with two clients, edit, and verify DOCX export.

Both scripts accept `--data-dir <dir>` and `--help`. They refuse unknown options with exit status 2.

Each room ends in one of these outcomes:

| Outcome | Meaning |
| --- | --- |
| `current` | The room uses the current format, and its document passes validation. |
| `migrated`, `would-migrate` | The new room passed the check. A dry run reports `would-migrate`. |
| `failed-check` | The new room differs from the export. The room is not changed. |
| `no-export` | The room has no export. Run `export-rooms.ts` with the earlier build. |
| `stale-export` | The room changed after its export. Export it again, so no edit is lost. |
| `later-format` | A later build wrote the room. This build does not open or replace it. |
| `error` | The room or its export could not be read. For `not-initialized`, the state holds no document that a build can open: move `<room>.ydoc` and `<room>.room` out of the data directory together, and keep them with your backups. The room ID stays retired. |

A write run can migrate some rooms before another room fails. Keep all servers stopped if it exits with status 1. Resolve the failure and run it again. To cancel instead, restore all migrated rooms before starting the earlier build. Never serve mixed formats with one deployment.

`migrate-rooms.ts` exits with status 1 unless every room is `current`, `migrated`, or `would-migrate`. Its output names each differing paragraph by its part and position, without document text. `report.json` holds the text of differing paragraphs, so keep it with the room data. A line that counts paragraphs as not editable names text that the new room keeps but the editor cannot show; check those rooms before you resume editing.

Keep the backups until you accept the migration. The `.previous` file holds one earlier generation; keep separate backups across later migrations.

To roll back, stop all writers and preserve pending client work. Export post-migration edits with the target build before restoring anything. Copy each migrated room's `<room>.ydoc.previous` over `<room>.ydoc`, then start the earlier build. Use a fresh browser persistence key and reconcile the saved DOCX files separately. Migrated updates cannot replay into the restored generation. Collaboration undo history starts afresh in a migrated room.

### Check admission and recovery

Run the example tests from the repository root:

```bash
bun run --filter docx-editor-example-collaboration-hocuspocus test
```

The tests exercise admission, saved-room refusal, and room migration without starting a server. They cover matching, missing, older, future, and malformed version claims; incorrect secrets; preservation of live state when a saved room is refused; and a migration that keeps every paragraph of the export.

Hocuspocus stores room snapshots. `readCollaborationDocument` exports a room to DOCX.

## Customize people and carets

`src/people.ts` defines each person's ID, name, color, and local avatar URL. The app uses this record for carets, the room bar, and comment cards under the EigenPal Pro License.

Presence sends an actor ID, display name, and color. Each replica resolves the avatar locally through `DocxEditor.AuthorStyle`. The demo serves its avatar files from `public/avatars/`.

An `actorId` identifies one editor attachment, not one person. The same person in two tabs has two actor IDs. The DOCX stores comment authors as `w:author`, not as actor IDs.

`DocxEditorCollaboration.CaretLabels` renders custom labels inside the React tree. Removing it restores the standard name labels. Caret labels use `aria-hidden` and do not accept pointer events.

Close carets can produce overlapping labels. The editor does not apply collision avoidance.
