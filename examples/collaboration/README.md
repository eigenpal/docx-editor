# Peer-to-peer collaboration

This example uses `y-webrtc` to replicate a document between browsers. It has no application
server or durable shared storage.

For server-backed rooms, see the
[Hocuspocus collaboration example](../collaboration-hocuspocus/README.md).

## Set up the example

Run these commands from the repository root on each machine:

```bash
bun install
bun run build:packages
bun run dev:collaboration
```

The example uses `http://localhost:5173`. The React Vite example also uses port `5173`.
Stop `bun run dev` or `bun run dev:react` before you start this example.

## Test from two machines

1. Open `http://localhost:5173` on the first machine.
2. Enter a display name, and select **Create room**.
3. Copy the join link that the page shows.
4. Send the link to the second person.
5. Open the link after the second machine starts its local example.
6. Edit the document in both browsers.

The link uses `localhost:5173`. Each person must run the example on their own machine.

Share only the join link that the page shows. Do not initialize one room from two creator pages.
Use the participant count to confirm peer discovery.

The link has the form `?room=<id>#collab=<key>`. The query value identifies the public signaling
topic. The fragment contains the `y-webrtc` encryption key. Browsers do not send fragments to
servers, but anyone with the full link can join the room.

## Limits

- Public signaling makes this example unsuitable for production.
- The full join link grants access to the room.
- Some networks require a Traversal Using Relays around NAT (TURN) server.
- Every browser stores a full document replica.
- Two creators with different starting documents cause a schema error.

## Run the headless proof

Run this command from the repository root:

```bash
bun run --filter './examples/collaboration' headless
```

The script connects two stores through in-process Yjs updates. It does not use React, WebRTC, or
a browser.
