# Server-backed collaboration with avatar carets

Two people editing one DOCX through a [Hocuspocus](https://tiptap.dev/docs/hocuspocus) room,
with each remote caret labelled by the collaborator's photo and name.

The example has two halves:

- `server/server.ts` — the room server. It authenticates connections, holds the shared
  document, and writes it to disk so a room survives a restart.
- `src/` — a React host that joins the room with `useHocuspocusCollaboration` and replaces the
  engine's caret labels with `DocxEditorCollaboration.CaretLabels`.

## Run it

The server needs Node 22.18 or later: it strips the types in `server/server.ts` as it runs
them, and Hocuspocus v4 targets Node rather than Bun.

Run the server and the app in two terminals, from the repository root:

```bash
bun install

# terminal 1
bun run dev:collaboration-hocuspocus:server   # ws://127.0.0.1:1234

# terminal 2
bun run dev:collaboration-hocuspocus          # http://localhost:5176
```

Then:

1. Open `http://localhost:5176` and take a seat. Keys `1` to `4` pick one.
2. Select the room id in the bar to copy the invite link.
3. Open the link in a second browser profile or a private window, and take a different seat.
4. Type in both windows. Each caret carries the other person's avatar and name.

Rooms are stored in `server/.data/`, as a `.ydoc` the server reads back and a `.docx` it
exports beside it. Delete that directory to start over.

Two carets a few characters apart overlap, because the engine positions every label above its
own caret and does no collision avoidance. With four seats in the demo you will see it.

## One photo per person, in three places

The demo's four people live in `src/people.ts`: an id, a display name, a color, and an image
URL. That one record reaches the remote carets, the room bar, and the comment cards.

The photos are illustrative portraits drawn for this demo and served from `public/avatars/`,
so the example ships no third-party imagery and needs no network. Point `avatarUrl` at your own
images.

### The caret label

Presence carries an actor id, a display name, and a color. It never carries a photo, and it
must not: a peer publishes its own presence, so an avatar URL on the wire is a URL that any
room member can point at any host.

So the photo is resolved locally, on each replica, and arrives already resolved:

```tsx
<DocxEditorCollaboration.CaretLabels session={session}>
  {({ selection, color, avatarUrl }) => (
    <CollaboratorCaret selection={selection} color={color} avatarUrl={avatarUrl} />
  )}
</DocxEditorCollaboration.CaretLabels>
```

`CollaboratorCaret` renders `avatarUrl` straight from the render prop — the engine has already
resolved it from the `AuthorStyle` declared for that collaborator. There is no directory call
in the component, and no lookup keyed on `actorId`.

The NAME is the one the peer published, not a local one. A peer picks its own actor id and its
own display name, so the picture follows a value the peer controls: someone who joins calling
themselves "Galadriel" gets Galadriel's declared photo. That is the right trade for a demo with
no identity provider, and the wrong one for production — derive the display name from the token
your server verified, the way `onAuthenticate` in `server/server.ts` describes.

The engine keeps creating, positioning, and coloring one label element per remote caret. The
part portals your content into each one, inside the normal React tree, so every provider above
it still works. Removing the part restores the engine's own name labels.

An `actorId` identifies one attachment, not one person: the same person in two tabs is two
carets, so it cannot be a user id. Nothing here decodes it.

The label layer is furniture — `aria-hidden`, no pointer events. Nothing inside a label is
announced or clickable. Interactive presence chrome belongs elsewhere, which is why the room
bar holds the avatar stack and the invite link.

### Comments and tracked changes

The review side keys on a different value. A comment card resolves `w:author`, the display name
the document was saved with, because the actor id is not in the file at all. Declare the photo
against that name:

```tsx
<DocxEditor.AuthorStyle author={person.name} color={person.color} avatarUrl={person.avatarUrl} />
```

`AuthorStyle` renders nothing. The packaged review card reads `avatarUrl` off it, so
`<DocxEditorReview />` shows the same face with no render prop. `avatarUrl` accepts `http`,
`https`, non-SVG `data:`, `blob:`, and same-origin relative URLs; anything else is dropped.

Select some text and add a comment to see it.

### What you do not have to wire

Anything else. Colour and picture both resolve from the same declaration, on every surface that
draws that person. `src/people.ts` is a plain list with no lookups in it, and no component in
`src/` reads it at render time — `App.tsx` declares it once and the engine does the rest.

The one thing the declaration cannot answer for is somebody it does not name. An undeclared
collaborator falls back to initials on a colour from the author ramp, which is what you get for
anyone outside your directory.

## Authentication

The provider sends a token in its handshake, and the server checks it in `onAuthenticate`
before any message reaches a document:

```ts
async onAuthenticate({ token, documentName }) {
  if (token !== TOKEN) throw new Error('invalid token');
  return { room: documentName };
}
```

The demo checks one shared secret. A real deployment verifies a signed token, returns the user
it names as the connection context, and stops trusting the client's own display name. If your
tokens expire, pass a callback instead of a string: the provider re-evaluates it on every
reconnect.

Set `VITE_COLLAB_URL`, `VITE_COLLAB_TOKEN`, `PORT`, and `COLLAB_TOKEN` to point the two halves
somewhere else.

## What the server does not do

It never parses OOXML. What travels the socket is the Yjs replica of the canonical package, and
Hocuspocus treats it as an opaque `Y.Doc`. Persistence is therefore one Yjs update per room in
`server/.data/`. Swap `onLoadDocument` and `onStoreDocument` for your database and the shape of
the call stays the same.
