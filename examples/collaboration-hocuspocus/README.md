# Server-backed collaboration

This example connects a React editor to a
[Hocuspocus collaboration server](https://tiptap.dev/docs/hocuspocus). Remote carets show each
person's name and avatar.

The example has two parts:

- `server/server.ts` authenticates connections and stores rooms.
- `src/` joins a room with `useHocuspocusCollaboration`.

## Run the example

Use Node 22.18 or later for the server. Hocuspocus v4 targets Node, and Node runs the TypeScript
server with type stripping.

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

The default shared token is `demo-token`. Set matching server and client values when you change
it.

- `PORT` sets the Hocuspocus server port.
- `COLLAB_TOKEN` sets the server token.
- `VITE_COLLAB_URL` sets the WebSocket URL for the app.
- `VITE_COLLAB_TOKEN` sets the token that the app sends.

The app wraps the token in this demo's JSON authentication envelope:

```ts
{ token, versions: DOCUMENT_COLLABORATION_VERSIONS }
```

`shared/admission.ts` creates and validates that envelope. In `onAuthenticate`, the server
checks the secret and calls `assertDocumentCollaborationCompatibility(versions)` before
Hocuspocus allows document synchronization. All four advertised versions must match. Older
raw-token clients, missing versions, and older or future version tuples are refused.
The provider's public `token` option remains a string; this envelope is an example policy.

These self-reported versions prevent accidental connections between incompatible builds.
They do not prove which code a client runs. A production server should verify a signed token,
derive identity and room permissions from it, and enforce its deployment policy separately.

## Store and export rooms

The server stores rooms in `server/.data/`. It reads each `.ydoc` file when a room opens.
It also exports a `.docx` file beside each Yjs document. Before admitting a saved snapshot,
`server/stored-room.ts` validates it in a temporary document with `readCollaborationDocument`.
An incompatible or invalid snapshot is refused before its state reaches the live room;
client version compatibility does not upgrade persisted data.

Replace `onLoadDocument` and `onStoreDocument` when you need database or object storage.

### Recover after a version mismatch

Upgrade the app, room server, and export workers together, then reload every open browser tab.
Clients that still advertise a different tuple will be refused before sync.

A saved room from an incompatible version needs a separate recovery step:

1. Keep a backup of its `.ydoc` and any exported `.docx` file.
2. Use the matching older build to export the room to DOCX, or use its last successful DOCX export.
3. Create a new room on the updated deployment and use that DOCX as the bootstrap document.
4. Check the new document before retiring the old room.

The exported DOCX preserves document content; creating a new room does not carry over Yjs undo
history or live presence. This demo does not automatically migrate or delete incompatible rooms.
Its sample app seeds new rooms from `DOCUMENT_URL`; change that source to the recovered DOCX
when opening the replacement room.

### Check admission and recovery

```bash
bun run --filter docx-editor-example-collaboration-hocuspocus test
```

The tests exercise admission and saved-room refusal without starting a server. They cover
matching, missing, older, future, and malformed version claims; incorrect secrets; and
preservation of live state when a saved room is refused.

The server never parses Office Open XML (OOXML). Hocuspocus stores the canonical package as an
opaque `Y.Doc`. `readCollaborationDocument` creates the DOCX export from that replica.

## Customize people and carets

`src/people.ts` defines each person's ID, name, color, and local avatar URL. The
app uses this record for carets, the room bar, and comment cards under the
EigenPal Pro License.

Presence sends an actor ID, display name, and color. Each replica resolves the avatar locally
through `DocxEditor.AuthorStyle`. The demo serves its avatar files from `public/avatars/`.

An `actorId` identifies one editor attachment, not one person. The same person in two tabs has
two actor IDs. The DOCX stores comment authors as `w:author`, not as actor IDs.

`DocxEditorCollaboration.CaretLabels` renders custom labels inside the React tree. Removing it
restores the standard name labels. Caret labels use `aria-hidden` and do not accept pointer
events.

Close carets can produce overlapping labels. The editor does not apply collision avoidance.
