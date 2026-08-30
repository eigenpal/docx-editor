// Server-backed collaboration: one Hocuspocus room, and one photo per person everywhere.
//
// Three things are on show here.
//
// 1. `useHocuspocusCollaboration` owns the room. It creates the `Y.Doc`, connects
//    `@hocuspocus/provider` to `server/server.ts`, seeds or joins the shared document, and
//    hands back the bytes to open plus the `collaborationModule` to register. Nothing else in
//    this file knows a CRDT exists.
// 2. `DocxEditorCollaboration.CaretLabels` replaces the engine's plain name labels with
//    `CollaboratorCaret`, which draws the collaborator's photo beside their name.
// 3. `DocxEditor.AuthorStyle` is the ONE declaration behind all of it. It names a display
//    name, a colour and a picture; the review card reads it, and so do the caret labels and
//    the avatar stack. There is no second wiring for presence, and no directory keyed on
//    `actorId` — the engine resolves the collaborator's declared style by the name they
//    published, which is the same string `w:author` carries in the saved file.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { DocxEditor, useDocxEditor, useDocxSource } from '@docx-editor.dev/react';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { reviewModule } from '@docx-editor.dev/pro';
import {
  DocxEditorCollaboration,
  DocxEditorCollaborationRoot,
  DocxEditorReview,
  useCollaborationParticipants,
  useCollaborationStatus,
} from '@docx-editor.dev/pro/react';
import type {
  CollaborationSession,
  UseCollaborationStatusReturn,
} from '@docx-editor.dev/pro/react';
import { useHocuspocusCollaboration } from '@docx-editor.dev/pro/react/hocuspocus';
import type { CollaborationFailure } from '@docx-editor.dev/core/collaboration';
import {
  createCollaborationRoomId,
  validateRoomId,
} from '@docx-editor.dev/pro/collaboration/hocuspocus';
import { CollaboratorCaret, PersonAvatar } from './CollaboratorCaret';
import { useColorMode, type ColorMode } from './useColorMode';
import { actorIdFor, PEOPLE, type Person } from './people';

/**
 * Comments and tracked changes. Read once, when the instance is built, so it must not be
 * rebuilt per render. The hook appends `collaborationModule` to it when a room is ready; a
 * host module that carried a collaboration contribution would be a configuration error.
 */
const MODULES = [reviewModule()];

/** Where `server/server.ts` listens. */
const SERVER_URL = import.meta.env.VITE_COLLAB_URL ?? 'ws://127.0.0.1:1234';

/**
 * The token the provider sends in its authentication handshake, which the server checks in
 * `onAuthenticate`. A real app sends a signed token for the signed-in user; pass a callback
 * instead of a string and the provider re-evaluates it on every reconnect, which is how an
 * expiring token renews.
 */
const TOKEN = import.meta.env.VITE_COLLAB_TOKEN ?? 'demo-token';

/**
 * Give up on the first sync after eight seconds rather than the default thirty.
 *
 * Forgetting to start the room server is the most likely thing to go wrong here, and thirty
 * seconds of a spinner reads as a hang. On a real deployment leave the default: a slow phone
 * on hotel wifi is not a failure.
 */
const SYNC_TIMEOUT_MS = 8_000;

const DOCUMENT_URL = '/sample.docx';

const SERVER_COMMAND = 'bun run dev:collaboration-hocuspocus:server';

/** The room named in the address bar, or null when this tab is starting a new one. */
function roomFromUrl(): string | null {
  const value = new URL(location.href).searchParams.get('room');
  if (!value) return null;
  try {
    return validateRoomId(value);
  } catch {
    return null;
  }
}

function inviteUrl(roomId: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', roomId);
  return url.toString();
}

/** A 48-character room id, shortened to something a person can compare across two windows. */
function shortRoomId(roomId: string): string {
  return `${roomId.slice(0, 8)}…${roomId.slice(-4)}`;
}

function accentVar(color: string): CSSProperties {
  return { '--collab-accent': color } as CSSProperties;
}

interface Joined {
  readonly person: Person;
  readonly roomId: string;
  /** Unique per attachment, so two tabs of one person are two carets. */
  readonly actorId: string;
}

/**
 * Sign-in: claim a seat, then create or join the room.
 *
 * The seats are numbered because the instruction for this demo is "open a second browser and
 * pick somebody else", and one keystroke is the shortest that gets.
 */
function SignIn({
  ready,
  onJoin,
}: {
  readonly ready: boolean;
  readonly onJoin: (person: Person) => void;
}) {
  const roomId = roomFromUrl();

  useEffect(() => {
    if (!ready) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const seat = Number(event.key);
      const person = Number.isInteger(seat) ? PEOPLE[seat - 1] : undefined;
      if (person) onJoin(person);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [onJoin, ready]);

  return (
    <div className="collab-stage">
      <div className="collab-stage__inner">
        <p className="collab-eyebrow">docx-editor.dev / collaboration</p>
        <h1>Take a seat.</h1>
        <p className="collab-stage__lede">
          {roomId
            ? 'Somebody is already in this room. Take a seat nobody else is using and you will see each other type.'
            : 'Take a seat, then open the invite link in a second browser as somebody else. Two people, one document, one server.'}
        </p>

        <ul className="collab-seats">
          {PEOPLE.map((person, index) => (
            <li key={person.id}>
              <button
                type="button"
                className="collab-seat"
                style={accentVar(person.color)}
                disabled={!ready}
                onClick={() => onJoin(person)}
              >
                <span className="collab-key" aria-hidden="true">
                  {index + 1}
                </span>
                <PersonAvatar
                  avatarUrl={person.avatarUrl}
                  name={person.name}
                  color={person.color}
                />
                <span className="collab-seat__who">
                  <span className="collab-seat__name">{person.name}</span>
                  <span className="collab-seat__role">{person.title}</span>
                </span>
                <span className="collab-seat__go" aria-hidden="true">
                  ↵
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="collab-stage__meta">
          <span className="collab-readout">
            Server <b>{SERVER_URL}</b>
          </span>
          {roomId ? (
            <span className="collab-readout">
              Room <b>{shortRoomId(roomId)}</b>
            </span>
          ) : null}
          {!ready ? <span className="collab-readout">Loading document and fonts…</span> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * What the transport is doing, as a glyph, a word and a class — never colour alone.
 *
 * `live`, `diverged` and `attached` are derived by the hook, so this is a lookup rather than
 * a state machine the demo maintains. `attached` is the one worth showing even though it is
 * almost always true: false with a live session means the editor was never remounted for the
 * session, so nothing replicates while everything else claims to be fine.
 */
function transportState(status: UseCollaborationStatusReturn): {
  readonly glyph: string;
  readonly label: string;
  readonly tone: string;
} {
  if (status.status === 'inactive') return { glyph: '◇', label: 'Local copy', tone: '' };
  if (status.diverged) return { glyph: '▲', label: 'Out of sync', tone: 'is-bad' };
  if (!status.live) return { glyph: '◇', label: 'Connecting', tone: 'is-warn' };
  if (!status.attached) return { glyph: '▲', label: 'Not attached', tone: 'is-bad' };
  return { glyph: '◆', label: 'Live', tone: 'is-ready' };
}

/**
 * Light and dark for the whole app, including the page.
 *
 * Two labelled halves rather than one button that flips meaning: a toggle whose label is the
 * mode you are in and whose action is the mode you are not is the classic reading error, and
 * `aria-pressed` on each half says which one is current without depending on the icon.
 */
function ThemeSwitch({ mode, toggle }: { readonly mode: ColorMode; readonly toggle: () => void }) {
  return (
    <span className="collab-theme" role="group" aria-label="Colour theme">
      {(['light', 'dark'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="collab-theme__option"
          aria-pressed={mode === option}
          aria-label={option === 'light' ? 'Light theme' : 'Dark theme'}
          onClick={() => {
            if (mode !== option) toggle();
          }}
        >
          <span aria-hidden="true">{option === 'light' ? '☀' : '☾'}</span>
        </button>
      ))}
    </span>
  );
}

/**
 * The room bar: transport state, the room id, who is here, and leaving.
 *
 * It sits inside `DocxEditor.Root` because Leave needs the document. The hook cannot read the
 * bytes itself, so `leave` requires them: pass `await editor.save()` and the edits made in the
 * room survive locally.
 */
function RoomBar({
  session,
  person,
  roomId,
  theme,
  onLeave,
}: {
  readonly session: CollaborationSession | null;
  readonly person: Person;
  readonly roomId: string;
  readonly theme: { readonly mode: ColorMode; readonly toggle: () => void };
  readonly onLeave: (bytes: Uint8Array) => void;
}) {
  const editor = useDocxEditor();
  // No `session` argument: both read the one the editor above holds.
  const status = useCollaborationStatus();
  const participants = useCollaborationParticipants();
  const [copied, setCopied] = useState(false);
  // The clipboard rejects without permission, and off a secure origin it is absent entirely.
  // Either way the failure has to land where the user can act on it, not in the console.
  const [copyFailed, setCopyFailed] = useState(false);
  const state = transportState(status);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyInvite = useCallback(() => {
    if (!navigator.clipboard) {
      setCopyFailed(true);
      return;
    }
    navigator.clipboard.writeText(inviteUrl(roomId)).then(
      () => setCopied(true),
      () => setCopyFailed(true)
    );
  }, [roomId]);

  return (
    <header
      className="collab-bar"
      style={{ '--collab-you': person.color } as CSSProperties}
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className={`collab-state ${state.tone}`} role="status">
        <span className="collab-state__glyph" aria-hidden="true">
          {state.glyph}
        </span>
        {state.label}
      </span>

      {session ? (
        <button
          type="button"
          className={`collab-room${copied ? ' is-copied' : ''}`}
          onClick={copyInvite}
          title={copyFailed ? inviteUrl(roomId) : 'Copy the invite link'}
        >
          <span className="collab-room__label">Room</span>
          <span className="collab-room__id">{shortRoomId(roomId)}</span>
          <span aria-hidden="true">
            {copied ? '✓ copied' : copyFailed ? '— copy it from the address bar' : '⧉'}
          </span>
        </button>
      ) : (
        <span className="collab-bar__note">This browser only. Nothing leaves it.</span>
      )}

      <span className="collab-bar__spacer" />

      {session ? (
        <span className="collab-here">
          {/*
            The packaged avatar stack. It needs no render prop to show the photos: the declared
            `avatarUrl` reaches it the same way it reaches a comment card. The override here is
            only for the overlap this bar wants, and `announced` keeps the name the packaged
            disc carries — this is chrome, not furniture, so unlike a caret label it IS
            announced.
          */}
          <DocxEditorCollaboration.Avatars max={5}>
            {({ participant, color, avatarUrl }) => (
              <span className="collab-bar__person" title={participant.name}>
                <PersonAvatar
                  avatarUrl={avatarUrl}
                  name={participant.name}
                  color={color}
                  announced
                />
              </span>
            )}
          </DocxEditorCollaboration.Avatars>
          <span className="collab-count">
            {participants.length < 2 ? 'only you — share the room' : `${participants.length} here`}
          </span>
        </span>
      ) : null}

      <ThemeSwitch mode={theme.mode} toggle={theme.toggle} />

      {session ? (
        <button
          type="button"
          className="collab-button"
          onClick={() => {
            void editor?.save().then((bytes) => onLeave(new Uint8Array(bytes)));
          }}
        >
          Leave room
        </button>
      ) : null}
    </header>
  );
}

/** A failure code turned into something a person can act on. */
function failureMessage(failure: CollaborationFailure): {
  readonly title: string;
  readonly body: string;
  readonly command?: string;
} {
  if (failure.code === 'initialization-timeout') {
    return {
      title: 'No answer from the room server.',
      body: `Nothing is listening on ${SERVER_URL}. Start it in a second terminal, then reload this page.`,
      command: SERVER_COMMAND,
    };
  }
  if (failure.code === 'initialization-aborted') {
    return {
      title: 'The room server refused the connection.',
      body:
        failure.detail ??
        'It rejected the token this demo sends. Check COLLAB_TOKEN on the server against VITE_COLLAB_TOKEN here.',
    };
  }
  return {
    title: 'Could not join the room.',
    body: failure.detail ?? `The room reported ${failure.code}. Reload to try again.`,
  };
}

export function App() {
  // ABOVE every screen, so a remembered choice applies on the sign-in stage too — not only
  // once the room bar, and with it the switch, has mounted.
  const theme = useColorMode();
  const [joined, setJoined] = useState<Joined | null>(null);
  // Set by Leave. It keeps the editor mounted on the saved bytes and stops the hook from
  // reconnecting to the room it was just asked to leave.
  const [left, setLeft] = useState(false);

  // Fetch the document and Word's substitute faces in one call. The hook holds `document`
  // back until fonts settle, because layout measures with them.
  const {
    document: bytes,
    fonts,
    error: loadError,
  } = useDocxSource(DOCUMENT_URL, { fonts: packagedFonts() });

  // Only the room's identity keys the connection, so this object does not need to be stable —
  // but building it in a memo keeps the branch that decides "no room yet" in one place.
  const room = useMemo(() => {
    if (!joined || !bytes || left) return null;
    return {
      url: SERVER_URL,
      roomId: joined.roomId,
      token: TOKEN,
      syncedTimeoutMs: SYNC_TIMEOUT_MS,
      identity: {
        actorId: joined.actorId,
        name: joined.person.name,
        color: joined.person.color,
      },
      // The first tab seeds the room from these bytes; every later tab ignores them and
      // takes the document the server already holds.
      bootstrap: { kind: 'create-or-join', document: bytes } as const,
    };
  }, [bytes, joined, left]);

  const collaboration = useHocuspocusCollaboration({ modules: MODULES, room });

  const join = useCallback((person: Person) => {
    const roomId = roomFromUrl() ?? createCollaborationRoomId();
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('room', roomId);
    history.replaceState(null, '', url);
    setJoined({ person, roomId, actorId: actorIdFor(person) });
  }, []);

  const leave = useCallback(
    (nextDocument: Uint8Array) => {
      setLeft(true);
      collaboration.leave(nextDocument);
    },
    [collaboration]
  );

  if (loadError) {
    return (
      <div className="collab-message" role="alert">
        <div className="collab-message__inner">
          <h2>Could not open the document.</h2>
          <p>{loadError.message}</p>
        </div>
      </div>
    );
  }

  if (!joined) return <SignIn ready={bytes !== undefined} onJoin={join} />;

  if (collaboration.error) {
    const message = failureMessage(collaboration.error);
    return (
      <div className="collab-message" role="alert">
        <div className="collab-message__inner">
          <h2>{message.title}</h2>
          <p>{message.body}</p>
          {message.command ? <code>{message.command}</code> : null}
        </div>
      </div>
    );
  }

  if (collaboration.pending || !collaboration.document) {
    return (
      <div className="collab-message">
        <div className="collab-message__inner">
          <h2>Opening the room…</h2>
          <p>{`Waiting for ${SERVER_URL}. If this sits here, the room server is not running.`}</p>
        </div>
      </div>
    );
  }

  return (
    // Sugar over `DocxEditor.Root` that writes the three props a room supplies — the `key`,
    // the document and the modules — and takes `author` from the room's identity, so comments
    // are signed with the name the room shows. The composed form still works; this is the
    // shorter way to say the same thing correctly.
    <DocxEditorCollaborationRoot
      collaboration={collaboration}
      mode="edit"
      {...(fonts ? { fonts } : {})}
    >
      {/*
        The one declaration. `AuthorStyle` renders nothing; it says how one `w:author` is
        presented, and every surface that draws that person reads it — the review card, the
        caret label, the avatar stack. Matching `color` to the identity colour keeps a person's
        ink, their card and their caret the same hue from the first frame, before they have
        written anything for the engine to allocate a colour from.
      */}
      {PEOPLE.map((person) => (
        <DocxEditor.AuthorStyle
          key={person.id}
          author={person.name}
          color={person.color}
          avatarUrl={person.avatarUrl}
        />
      ))}
      <RoomBar
        session={collaboration.session}
        person={joined.person}
        roomId={joined.roomId}
        theme={theme}
        onLeave={leave}
      />
      <DocxEditor.Toolbar />
      <DocxEditor.Viewport className="collab-viewport">
        <DocxEditor.Content />
        <DocxEditor.HyperLink />
        {/*
          The custom caret labels. The engine still creates, positions and colours one element
          per remote caret; this part portals `CollaboratorCaret` into each of them. Remove it
          and the engine's own name labels come back.
        */}
        <DocxEditorCollaboration.CaretLabels>
          {({ selection, color, avatarUrl }) => (
            <CollaboratorCaret selection={selection} color={color} avatarUrl={avatarUrl} />
          )}
        </DocxEditorCollaboration.CaretLabels>
        {/*
          The review rail: comments and tracked changes as cards beside the page. Its avatars
          are the packaged ones — they pick up the photos from `AuthorStyle` above with no
          render prop here. Select some text and add a comment to see it.
        */}
        <DocxEditorReview />
      </DocxEditor.Viewport>
    </DocxEditorCollaborationRoot>
  );
}
