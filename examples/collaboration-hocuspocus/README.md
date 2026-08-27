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

The server checks the token before it opens a document. A production server should verify a
signed token and derive the user identity from that token.

## Store and export rooms

The server stores rooms in `server/.data/`. It reads each `.ydoc` file when a room opens.
It also exports a `.docx` file beside each Yjs document.

Delete `server/.data/` to remove all local rooms. Replace `onLoadDocument` and
`onStoreDocument` when you need database or object storage.

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
