# Peer-to-peer collaboration proof

This example synchronizes text insertion and deletion in existing body paragraphs.

It uses `y-webrtc` and public signaling. It does not use a docx-editor document backend.

## Test from two machines

1. Check out the same branch on both machines.
2. Run `bun install` on both machines.
3. Run `bun run dev:collaboration` on both machines.
4. Open `http://localhost:5173` on the first machine.
5. Enter a display name, and select **Create room**.
6. Copy the join link from the page.
7. Send the join link to the second person.
8. Open the link on the second machine after its local demo starts.
9. Type in the existing paragraph from both browsers.
10. Test selection, undo, redo, disconnect, reconnect, and DOCX save.

Each join link uses `localhost:5173`. Therefore, it opens the demo that runs on the recipient's
machine.

The demo removes the creator role from the address after initialization. Share only the join link
shown on the page. Do not initialize the same room from two creator pages. The room status reports
schema readiness. Confirm peer discovery with the connected-participant count.

## Limits

- Public signaling supports this proof only.
- A room identifier is not access control.
- WebRTC can require a TURN relay on restrictive networks.
- The room has no durable shared storage.
- Concurrent creators with different baselines enter an error state after their updates meet.
- The proof supports existing body-paragraph text only.
- It refuses structural edits, formatting, tables, headers, footers, notes, drawings, comments,
  and tracked changes.

## Run the headless proof

Run `bun run --filter './examples/collaboration' headless`.

The script creates two independent canonical stores and two Yjs documents. An in-process provider
forwards Yjs updates. The agent edits through `DocxEditor.createCollaborative` without layout,
paint, ProseMirror, React, WebRTC, or a browser DOM.
