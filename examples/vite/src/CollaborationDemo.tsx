import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useDocxEditor } from '@docx-editor.dev/react';
import type {
  CollaborationParticipant,
  CollaborationStatus,
} from '@docx-editor.dev/core/collaboration';
import { createT, en } from '@docx-editor.dev/i18n';
import {
  createCollaborationRoomId,
  validateRoomId,
} from '@docx-editor.dev/pro/collaboration/webrtc';
import type {
  CollaborationSession,
  UseWebrtcCollaborationConnectOptions,
} from '@docx-editor.dev/pro/react/webrtc';
import { DemoHeaderButton } from './DemoHeaderButton';

const NAME_KEY = 'docx-editor-collaboration-name';
const t = createT(en);
const strings = {
  name: t('collaborationDemo.name'),
  room: t('collaborationDemo.room'),
  join: t('collaborationDemo.join'),
  copy: t('collaborationDemo.copy'),
  copied: t('collaborationDemo.copied'),
  scope: t('collaborationDemo.scope'),
  warning: t('collaborationDemo.warning'),
  connect: t('collaborationDemo.connect'),
  online: t('collaborationDemo.online'),
  dialogTitle: t('collaborationDemo.dialogTitle'),
  dialogSubtitle: t('collaborationDemo.dialogSubtitle'),
  roomTitle: t('collaborationDemo.roomTitle'),
  roomSubtitle: t('collaborationDemo.roomSubtitle'),
  shareDocument: t('collaborationDemo.shareDocument'),
  shareDescription: t('collaborationDemo.shareDescription'),
  joinExisting: t('collaborationDemo.joinExisting'),
  joinDescription: t('collaborationDemo.joinDescription'),
  inviteLink: t('collaborationDemo.inviteLink'),
  connected: t('collaborationDemo.connected'),
  reconnecting: t('collaborationDemo.reconnecting'),
  outOfSync: t('collaborationDemo.outOfSync'),
  outOfSyncShort: t('collaborationDemo.outOfSyncShort'),
  person: t('collaborationDemo.person'),
  people: t('collaborationDemo.people'),
  you: t('collaborationDemo.you'),
  leave: t('collaborationDemo.leave'),
  done: t('collaborationDemo.done'),
  close: t('collaborationDemo.close'),
  back: t('collaborationDemo.back'),
  creating: t('collaborationDemo.creating'),
  connecting: t('collaborationDemo.connecting'),
  enterRoom: t('collaborationDemo.enterRoom'),
  connectFailed: t('collaborationDemo.connectFailed'),
  leaveFailed: t('collaborationDemo.leaveFailed'),
  guest: t('collaborationDemo.guest'),
};

function CollaborationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.29 19.7l-1.41-1.41L9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3 1.42 1.42Z"
      />
    </svg>
  );
}

function identityColor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `var(--doc-review-author-${Math.abs(hash) % 8})`;
}

function roomIdFrom(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(strings.enterRoom);
  try {
    const url = new URL(trimmed);
    return validateRoomId(url.searchParams.get('room') ?? '');
  } catch (error) {
    if (error instanceof TypeError) return validateRoomId(trimmed);
    throw error;
  }
}

/**
 * The room's encryption key, carried in the URL fragment.
 *
 * The room id is the signaling topic, so it cannot double as the key — the signaling host sees
 * it. A fragment is never sent to that host, so two peers who opened the same invite share a
 * secret it never learns. Anyone holding the whole link can still decrypt, which is what
 * joining the room means anyway.
 */
function createRoomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

const COLLAB_FRAGMENT = '#collab=';

/** Read the key out of a pasted invite, or out of the address bar for a link opened directly. */
function roomSecretFrom(value: string): string | undefined {
  for (const candidate of [value.trim(), location.href]) {
    if (!candidate) continue;
    let hash = '';
    try {
      hash = new URL(candidate).hash;
    } catch {
      continue;
    }
    if (hash.startsWith(COLLAB_FRAGMENT)) return hash.slice(COLLAB_FRAGMENT.length);
  }
  return undefined;
}

function shareUrl(roomId: string): string {
  const url = new URL(location.href);
  // Keep `fixture` so the joiner opens the same small file the creator did. Dropping it
  // forced every peer to load `sample.docx` first, then throw it away for the room bytes.
  const fixture = url.searchParams.get('fixture');
  url.search = '';
  url.searchParams.set('room', roomId);
  if (fixture) url.searchParams.set('fixture', fixture);
  return url.toString();
}

function ParticipantStack({ participants }: { participants: readonly CollaborationParticipant[] }) {
  return (
    <span className="demo-collaboration-avatars" aria-hidden="true">
      {participants.slice(0, 3).map((participant) => (
        <span
          className="demo-collaboration-avatar"
          key={participant.actorId}
          title={participant.name}
          style={{ '--demo-participant-color': participant.color } as CSSProperties}
        >
          {participant.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

export interface CollaborationControlProps {
  readonly session: CollaborationSession | null;
  readonly pending: boolean;
  readonly connect: (options: UseWebrtcCollaborationConnectOptions) => Promise<void>;
  readonly leave: (nextDocument?: Uint8Array) => void;
}

export function CollaborationControl({
  session,
  pending,
  connect,
  leave,
}: CollaborationControlProps) {
  const editor = useDocxEditor();
  const initialRoom = new URL(location.href).searchParams.get('room') ?? '';
  const [open, setOpen] = useState(session !== null || initialRoom.length > 0);
  const [mode, setMode] = useState<'choice' | 'join' | 'connected'>(
    session ? 'connected' : initialRoom ? 'join' : 'choice'
  );
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? strings.guest);
  const [roomInput, setRoomInput] = useState(initialRoom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [participants, setParticipants] = useState<readonly CollaborationParticipant[]>([]);
  const [status, setStatus] = useState<CollaborationStatus>('initializing');
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!session) {
      setParticipants([]);
      return;
    }
    const update = () => setParticipants(session.participants());
    update();
    return session.subscribeParticipants(update);
  }, [session]);

  // The session reports transport health. Reading it keeps the dialog from claiming
  // "Connected" over a session that refuses every write.
  useEffect(() => {
    if (!session) {
      setStatus('initializing');
      return;
    }
    setStatus(session.status());
    return session.subscribeStatus((next) => setStatus(next));
  }, [session]);

  // `error` and `destroyed` are NOT "reconnecting". A replica reaches them by refusing an update
  // and keeping the copy it already had, so this peer is now editing a document the others do not
  // have, and waiting will never fix it. Shown as one label with the other statuses collapsed into
  // it read "Reconnecting", which tells the reader to sit and wait for a state that never arrives.
  const diverged = status === 'error' || status === 'destroyed';
  const statusLabel = diverged
    ? strings.outOfSync
    : status === 'ready'
      ? strings.connected
      : strings.reconnecting;

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [busy, open]);

  const activeShareUrl = useMemo(() => (session ? shareUrl(session.documentId) : ''), [session]);

  const rememberName = (): string => {
    const value = name.trim() || strings.guest;
    localStorage.setItem(NAME_KEY, value);
    return value;
  };

  const start = async (kind: 'create' | 'join') => {
    if (!editor || busy || pending) return;
    setBusy(true);
    setError(null);
    try {
      const displayName = rememberName();
      const roomId = kind === 'create' ? createCollaborationRoomId() : roomIdFrom(roomInput);
      // Passed explicitly rather than left for the engine to read off the address bar, so the
      // URL only changes once a room actually exists.
      const secret = kind === 'create' ? createRoomSecret() : roomSecretFrom(roomInput);
      await connect({
        roomId,
        identity: {
          actorId: `${displayName}:${crypto.randomUUID()}`,
          name: displayName,
          color: identityColor(displayName),
        },
        bootstrap:
          kind === 'create'
            ? { kind: 'create', document: new Uint8Array(await editor.save()) }
            : { kind: 'join' },
        ...(secret ? { password: secret } : {}),
      });
      const url = new URL(location.href);
      url.search = '';
      url.searchParams.set('room', roomId);
      // The invite carries the key, so `shareUrl` below hands the joiner both halves.
      url.hash = secret ? `${COLLAB_FRAGMENT.slice(1)}${secret}` : '';
      history.replaceState(null, '', url);
      setMode('connected');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.connectFailed);
    } finally {
      setBusy(false);
    }
  };

  const leaveRoom = async () => {
    if (!editor || busy || pending) return;
    setBusy(true);
    setError(null);
    try {
      // `leave()` keeps the last room document. Pass saved bytes so live edits survive the remount.
      leave(new Uint8Array(await editor.save()));
      const url = new URL(location.href);
      url.searchParams.delete('room');
      // Drop the key too. Leaving it in the address bar would hand the next room's invite a
      // secret from a room this peer is no longer in.
      url.hash = '';
      history.replaceState(null, '', url);
      setMode('choice');
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.leaveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DemoHeaderButton
        className={`demo-collaboration-trigger${session ? ' is-connected' : ''}${
          session && diverged ? ' is-diverged' : ''
        }`}
        onClick={() => {
          setError(null);
          setMode(session ? 'connected' : initialRoom ? 'join' : 'choice');
          setOpen(true);
        }}
        disabled={!editor || busy || pending}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={busy || pending}
      >
        {session ? <ParticipantStack participants={participants} /> : <CollaborationIcon />}
        {/* A diverged replica still has peers in its participant list, so a headcount here
            reads as healthy while this copy's edits reach nobody. The trigger is the only
            collaboration state on screen once the dialog closes, so it has to carry the
            warning in WORDS: the class alone would leave the meaning in the colour. */}
        <span>
          {!session
            ? strings.connect
            : diverged
              ? strings.outOfSyncShort
              : `${participants.length} ${strings.online}`}
        </span>
      </DemoHeaderButton>

      {open
        ? createPortal(
            <div
              className="demo-collaboration-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) setOpen(false);
              }}
            >
              <section
                className="demo-collaboration-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="collaboration-dialog-title"
              >
                <header className="demo-collaboration-dialog__header">
                  <div className="demo-collaboration-dialog__heading">
                    <span className="demo-collaboration-dialog__icon">
                      <CollaborationIcon />
                    </span>
                    <div>
                      <h2 id="collaboration-dialog-title">
                        {session ? strings.roomTitle : strings.dialogTitle}
                      </h2>
                      <p>{session ? strings.roomSubtitle : strings.dialogSubtitle}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="demo-collaboration-close"
                    onClick={() => setOpen(false)}
                    disabled={busy || pending}
                    aria-label={strings.close}
                  >
                    <CloseIcon />
                  </button>
                </header>

                {session && mode === 'connected' ? (
                  <div className="demo-collaboration-body">
                    <div
                      className={`demo-collaboration-status${
                        status === 'ready' ? '' : ' is-degraded'
                      }${diverged ? ' is-diverged' : ''}`}
                    >
                      <span className="demo-collaboration-status__dot" />
                      <span>{statusLabel}</span>
                      <span className="demo-collaboration-status__count">
                        {participants.length}{' '}
                        {participants.length === 1 ? strings.person : strings.people}
                      </span>
                    </div>
                    <div className="demo-collaboration-people">
                      {participants.map((participant) => (
                        <div className="demo-collaboration-person" key={participant.actorId}>
                          <span
                            className="demo-collaboration-person__avatar"
                            style={
                              {
                                '--demo-participant-color': participant.color,
                              } as CSSProperties
                            }
                          >
                            {participant.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span>{participant.name}</span>
                          {participant.isLocal ? <small>{strings.you}</small> : null}
                        </div>
                      ))}
                    </div>
                    <label className="demo-collaboration-field">
                      {strings.inviteLink}
                      <span className="demo-collaboration-copy-row">
                        <input readOnly value={activeShareUrl} aria-label={strings.inviteLink} />
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(activeShareUrl).then(() => {
                              setCopied(true);
                              window.setTimeout(() => setCopied(false), 1500);
                            });
                          }}
                        >
                          {copied ? strings.copied : strings.copy}
                        </button>
                      </span>
                    </label>
                    <p className="demo-collaboration-note">{strings.scope}</p>
                    <footer className="demo-collaboration-actions">
                      <button type="button" className="is-danger" onClick={() => void leaveRoom()}>
                        {strings.leave}
                      </button>
                      <button type="button" className="is-primary" onClick={() => setOpen(false)}>
                        {strings.done}
                      </button>
                    </footer>
                  </div>
                ) : (
                  <div className="demo-collaboration-body">
                    <label className="demo-collaboration-field">
                      {strings.name}
                      <input
                        ref={nameRef}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={80}
                        autoComplete="name"
                      />
                    </label>

                    {mode === 'choice' ? (
                      <div className="demo-collaboration-choices">
                        <button
                          type="button"
                          className="demo-collaboration-choice"
                          onClick={() => void start('create')}
                          disabled={busy || pending}
                        >
                          <span className="demo-collaboration-choice__icon">
                            <CollaborationIcon />
                          </span>
                          <span>
                            <strong>{strings.shareDocument}</strong>
                            <small>{strings.shareDescription}</small>
                          </span>
                          <span aria-hidden="true">→</span>
                        </button>
                        <button
                          type="button"
                          className="demo-collaboration-choice"
                          onClick={() => setMode('join')}
                          disabled={busy || pending}
                        >
                          <span className="demo-collaboration-choice__icon">↗</span>
                          <span>
                            <strong>{strings.joinExisting}</strong>
                            <small>{strings.joinDescription}</small>
                          </span>
                          <span aria-hidden="true">→</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        <label className="demo-collaboration-field">
                          {strings.room}
                          <input
                            value={roomInput}
                            onChange={(event) => setRoomInput(event.target.value)}
                            placeholder={strings.room}
                          />
                        </label>
                        <button
                          type="button"
                          className="demo-collaboration-back"
                          onClick={() => setMode('choice')}
                          disabled={busy || pending}
                        >
                          ← {strings.back}
                        </button>
                        <footer className="demo-collaboration-actions">
                          <button
                            type="button"
                            className="is-primary"
                            onClick={() => void start('join')}
                            disabled={busy || pending || !roomInput.trim()}
                          >
                            {busy ? strings.connecting : strings.join}
                          </button>
                        </footer>
                      </>
                    )}
                    {busy && mode === 'choice' ? (
                      <div className="demo-collaboration-progress">{strings.creating}</div>
                    ) : null}
                    {error ? (
                      <div className="demo-collaboration-error" role="alert">
                        {error}
                      </div>
                    ) : null}
                    <p className="demo-collaboration-note">{strings.warning}</p>
                  </div>
                )}
              </section>
            </div>,
            document.querySelector<HTMLElement>('.demo-app') ?? document.body
          )
        : null}
    </>
  );
}
