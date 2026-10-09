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
{ token, collaborationVersion: COLLABORATION_FORMAT_VERSION }
```

`shared/admission.ts` creates and validates that envelope. In `onAuthenticate`, the server checks the secret and calls `assertCollaborationFormatCompatibility(collaborationVersion)` before Hocuspocus allows synchronization. Import the version from the installed package; transmit it unchanged. Missing, malformed, and incompatible versions are refused. The example also accepts compatible clients using its previous `versions` envelope. Pass the encoded string as `token`, or return it from a callback to refresh credentials on reconnection.

These self-reported versions prevent accidental connections between incompatible builds. They do not prove which code a client runs. A production server should verify a signed token, derive identity and room permissions from it, and enforce its deployment policy separately.

## Store and export rooms

The server stores rooms in `server/.data/`. It reads each `.ydoc` file when a room opens. It also exports a `.docx` file beside each Yjs document. Before admitting a saved snapshot, `server/stored-room.ts` checks its version with `readCollaborationFormatVersion` and `assertCollaborationFormatCompatibility` in a temporary document. It then validates the compatible document with `readCollaborationDocument`. The server rejects incompatible or invalid snapshots before loading them into the live room. Compatible clients cannot upgrade saved room data.

Replace `onLoadDocument` and `onStoreDocument` when you need database or object storage. Keep the `prepareCollaborationServerDocument` call at the start of `onLoadDocument`, before the room's state loads.

When a saved room is at least twice the size of a fresh build of its content, `onLoadDocument` compacts it with `compactCollaborationState` and stores the new generation in place of the old state. The server writes each file through a temporary file, so a crash during a write keeps the previous state. If compaction throws `CollaborationSchemaError`, the server keeps the stored state unchanged. `beforeHandleMessage` calls `checkCollaborationRoomGeneration`, which refuses a client that still holds the room from before a compaction. That client reports `room-generation-changed` and can rejoin. Keep both calls when you replace the storage hooks. For more information, see [Compact rooms on a server](https://www.docx-editor.dev/docs/2.x/pro/collaboration#compact-rooms-on-a-server).

### Recover after a version mismatch

Preserve local and offline edits before reloading browser tabs. Upgrade the app, room server, and export workers together. The server rejects incompatible clients before synchronization.

For saved rooms and offline work, follow the [collaboration upgrade guide](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions). Pause editing and preserve pending work before exporting with the compatible previous build. Verify the DOCX, then create a replacement room. Collaboration undo history starts afresh.

### Migrate saved rooms

The server does not migrate rooms by itself. Two scripts move every saved room to the current collaboration format with the public migration API, `collaborationMigrationNeed` and `migrateCollaborationRoom`. `server/room-migration.ts` holds what depends on storage: where rooms and exports are, the backup, the atomic write, and one result for each room. Replace it with your own storage.

1. Stop the server, so no participant edits a room during the migration.
1. With the build that created the rooms, run `node server/export-rooms.ts`. It writes `<room>.migration.docx` beside each room, with `<room>.migration.sha256`, the digest of the state it exported. It uses only `readCollaborationDocument`, so it runs with an earlier build unchanged.
1. With the new build, run `node server/migrate-rooms.ts --dry-run --report report.json`. For each room, it seeds a new room from the export and checks that the new room holds the same paragraphs with the same text, the same media, and the same link targets. It prints one line for each room, writes the results to `report.json`, and changes nothing.
1. If every room passes, run `node server/migrate-rooms.ts`. It keeps each earlier state as `<room>.ydoc.previous` and writes the new state in its place. Rooms already in the current format stay as they are, so a second run after an interruption migrates only the rest.
1. Start the server with the new build.

Each room ends in one of these outcomes:

| Outcome | Meaning |
| --- | --- |
| `current` | The room is already in the current format. |
| `migrated`, `would-migrate` | The new room passed the check. A dry run reports `would-migrate`. |
| `failed-check` | The new room differs from the export. The room is not changed. |
| `no-export` | The room has no export. Run `export-rooms.ts` with the earlier build. |
| `stale-export` | The room changed after its export. Export it again, so no edit is lost. |
| `later-format` | A later build wrote the room. This build does not open or replace it. |
| `error` | The room or its export could not be read. |

The script exits with status 1 unless every room is `current`, `migrated`, or `would-migrate`. A report that counts paragraphs as not editable names text that the new room keeps but the editor cannot show; check those rooms before you resume editing. Keep the backups until you accept the migration. Collaboration undo history starts afresh in a migrated room.

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
