# Peer-to-peer collaboration proof

This example replicates the whole document between two browsers, with no server between them.

It uses `y-webrtc` and public signaling. For a server-backed room, see
[`examples/collaboration-hocuspocus`](../collaboration-hocuspocus/README.md).

## Test from two machines

1. Check out the same branch on both machines.
2. Run `bun install` on both machines.
3. Run `bun run dev:collaboration` on both machines.
4. Open `http://localhost:5173` on the first machine.
5. Enter a display name, and select **Create room**.
6. Copy the join link from the page.
7. Send the join link to the second person.
8. Open the link on the second machine after its local demo starts.
9. Type in both browsers.
10. Test selection, undo, redo, disconnect, reconnect, and DOCX save.

Each join link uses `localhost:5173`. Therefore, it opens the demo that runs on the recipient's
machine.

The demo removes the creator role from the address after initialization. Share only the join link
shown on the page. Do not initialize the same room from two creator pages. The room status reports
schema readiness. Confirm peer discovery with the connected-participant count.

A join link has the shape `?room=<id>#collab=<key>`. The query string carries the public room id,
which is the signaling topic. The fragment carries a generated encryption key that the demo passes
to `y-webrtc` as the room password. Browsers don't send the fragment to servers, so the signaling
host never sees the key. Anyone who has the full link can join and decrypt the room.

## Limits

- Public signaling supports this proof only.
- A room identifier is not access control. The `#collab=` fragment key encrypts signaling, but
  the full link still grants join access.
- WebRTC can require a TURN relay on restrictive networks.
- The room has no durable shared storage.
- Concurrent creators with different baselines enter an error state after their updates meet.
- Peer-to-peer only. Every browser holds a full replica, so a room costs each peer the whole
  document.

## Run the headless proof

Run `bun run --filter './examples/collaboration' headless`.

The script creates two independent canonical stores and two Yjs documents. An in-process provider
forwards Yjs updates. The agent edits through `createDocumentCollaboration` without layout, paint,
ProseMirror, React, WebRTC, or a browser DOM.
