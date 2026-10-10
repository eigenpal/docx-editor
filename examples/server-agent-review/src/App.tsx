import { useEffect, useMemo, useRef, useState } from 'react';
import { DocxEditor, useDocxSource } from '@docx-editor.dev/react';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { reviewModule } from '@docx-editor.dev/pro';
import {
  DocxEditorCollaboration,
  DocxEditorCollaborationRoot,
  useCollaborationParticipants,
  useCollaborationStatus,
  useReview,
} from '@docx-editor.dev/pro/react';
import { useHocuspocusCollaboration } from '@docx-editor.dev/pro/react/hocuspocus';
import { revisionPresentation } from './revision-presentation';
import { activeJob, api, newerJob, type Config, type Job, type Room } from './api';

const MODULES = [reviewModule()];
const FONTS = packagedFonts();
const STARTERS = [
  'Make the terms more balanced',
  'Improve clarity and remove ambiguity',
  'Review payment and termination terms',
];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function ThemeButton() {
  const [dark, setDark] = useState(() => localStorage.getItem('margin-theme') === 'dark');
  return (
    <button
      className="quiet icon-button"
      aria-label={dark ? 'Use light theme' : 'Use dark theme'}
      onClick={() => {
        const next = !dark;
        setDark(next);
        localStorage.setItem('margin-theme', next ? 'dark' : 'light');
        document.getElementById('root')!.classList.toggle('dark', next);
      }}
    >
      {dark ? '☀' : '◐'}
    </button>
  );
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [name, setName] = useState(() => sessionStorage.getItem('margin-name') ?? 'Alex');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    // A full navigation disposes the old replica and cancels in-flight room reads.
    const navigateHistory = () => location.reload();
    window.addEventListener('popstate', navigateHistory);
    void fetch('/api/config')
      .then(async (r) => {
        if (!r.ok) throw new Error('The review worker is unavailable');
        return r.json() as Promise<Config>;
      })
      .then(async (c) => {
        if (!live) return;
        setConfig(c);
        const roomId = new URL(location.href).searchParams.get('room');
        if (roomId) {
          const info = await api<Room>(c, `/rooms/${encodeURIComponent(roomId)}`);
          if (live) setRoom(info);
        }
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
      window.removeEventListener('popstate', navigateHistory);
    };
  }, []);
  async function create(file?: File) {
    if (!config) return;
    setBusy(true);
    setError('');
    try {
      const info = await api<Room>(config, '/rooms', {
        method: 'POST',
        ...(file
          ? {
              body: file,
              headers: {
                'Content-Type':
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'x-document-title': encodeURIComponent(file.name.replace(/\.docx$/i, '')),
              },
            }
          : {}),
      });
      history.pushState(null, '', `?room=${info.roomId}`);
      setRoom(info);
      sessionStorage.setItem('margin-name', name.trim() || 'Alex');
      setJoined(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const upload = (
    <input
      ref={input}
      className="file-input"
      type="file"
      accept=".docx"
      aria-label="Upload DOCX"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void create(file);
        e.target.value = '';
      }}
    />
  );
  if (joined && room && config)
    return (
      <>
        {upload}
        <ReviewRoom
          key={room.roomId}
          config={config}
          room={room}
          name={name.trim() || 'Alex'}
          upload={() => input.current?.click()}
        />
        {error && (
          <div role="alert" className="floating-error">
            {error}
          </div>
        )}
      </>
    );
  return (
    <main className="welcome">
      <header className="welcome-nav">
        <a className="brand" href="/">
          m<span>margin</span>
        </a>
        <div>
          <span className="eyebrow">A SHARED SPACE FOR BETTER WORDS</span>
          <ThemeButton />
        </div>
      </header>
      <div className="welcome-grid">
        <section className="welcome-copy">
          <span className="label">
            <span className="status-dot" /> COLLABORATIVE DOCUMENT REVIEW
          </span>
          <h1>
            Good agreements
            <br />
            start in the
            <br />
            <em>margins.</em>
          </h1>
          <p>
            Bring your document, your team, and a thoughtful AI reviewer. See every suggestion as it
            arrives. Keep the final say.
          </p>
          <label className="name-field">
            Your name
            <input
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
              autoComplete="given-name"
            />
          </label>
          {room ? (
            <button
              className="primary"
              disabled={!name.trim() || busy}
              onClick={() => {
                sessionStorage.setItem('margin-name', name.trim());
                setJoined(true);
              }}
            >
              Join {room.title} <span>↗</span>
            </button>
          ) : (
            <div className="welcome-actions">
              <button className="primary" disabled={!config || busy} onClick={() => void create()}>
                {busy ? 'Preparing your room…' : 'Explore the sample agreement'} <span>↗</span>
              </button>
              <button
                className="quiet"
                disabled={!config || busy}
                onClick={() => input.current?.click()}
              >
                Upload a DOCX
              </button>
            </div>
          )}
          {upload}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="fineprint">
            Live collaboration · Real Word tracked changes · Yours to accept or reject
          </p>
        </section>
        <section className="preview-scene" aria-label="Preview of a document suggestion">
          <div className="preview-paper">
            <span className="eyebrow">NORTHSTAR / STUDIO AGREEMENTS</span>
            <h2>
              A better working
              <br />
              agreement.
            </h2>
            <div className="paper-rule" />
            <h3>04 &nbsp; Ending the agreement</h3>
            <p>
              The Supplier may terminate <del>immediately</del>
              <ins>with 30 days’ written notice</ins>.
            </p>
            <div className="ghost-lines">
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="preview-note">
            <span className="agent-mark">✳</span>
            <div>
              <strong>Review agent</strong>
              <span className="small-label">A little more room to prepare.</span>
              <p>A clear notice period gives both parties time to plan the handover.</p>
              <span className="preview-note-footer">SUGGESTION, NOT A FINAL DECISION</span>
            </div>
          </div>
          <div className="live-caption">
            <span className="status-dot" /> Made together. Reviewed in real time.
          </div>
        </section>
      </div>
      <footer className="welcome-footer">
        An EigenPal example<span>Server-side AI. Human decisions.</span>
      </footer>
    </main>
  );
}

function ReviewRoom({
  config,
  room,
  name,
  upload,
}: {
  config: Config;
  room: Room;
  name: string;
  upload: () => void;
}) {
  const identity = useMemo(
    () => ({ actorId: crypto.randomUUID(), name, color: '#727ab1' }),
    [name]
  );
  const connection = useMemo(
    () => ({
      url: config.url,
      roomId: room.roomId,
      token: config.token,
      identity,
      bootstrap: { kind: 'join' as const },
      offlineEditing: false,
    }),
    [config, room.roomId, identity]
  );
  const collaboration = useHocuspocusCollaboration({ room: connection, modules: MODULES });
  const source = useDocxSource(collaboration.document, { fonts: FONTS });
  if (collaboration.error)
    return (
      <main className="connection-screen">
        <h1>We couldn’t join this room.</h1>
        <p role="alert">{collaboration.error.detail ?? collaboration.error.code}</p>
        <button className="primary" onClick={() => location.reload()}>
          Reconnect
        </button>
      </main>
    );
  return (
    <DocxEditorCollaborationRoot
      collaboration={collaboration}
      fonts={source.fonts ?? undefined}
      fallback={
        <main className="connection-screen">
          <span className="agent-mark">✳</span>
          <h2>Opening your shared document…</h2>
        </main>
      }
    >
      <DocxEditor.AuthorStyle author="Review agent" color="#49775f" />
      <main className="review-workspace">
        <Workspace config={config} room={room} upload={upload} />
      </main>
    </DocxEditorCollaborationRoot>
  );
}

function Workspace({ config, room, upload }: { config: Config; room: Room; upload: () => void }) {
  const people = useCollaborationParticipants();
  const connection = useCollaborationStatus();
  const review = useReview();
  const [tab, setTab] = useState<'agent' | 'changes'>('agent');
  const [panelOpen, setPanelOpen] = useState(false);
  const [instruction, setInstruction] = useState(STARTERS[0]!);
  const [mode, setMode] = useState<'scripted' | 'ai'>(config.ai ? 'ai' : 'scripted');
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [eventsLive, setEventsLive] = useState(true);
  const requestId = useRef<string | null>(null);
  const running = activeJob(job);
  const revisions = review.items.filter((item) => item.kind === 'revision');
  useEffect(() => {
    const events = new EventSource(
      `/api/rooms/${room.roomId}/events?token=${encodeURIComponent(config.token)}`
    );
    events.onmessage = (event) => {
      setJob((current) => newerJob(current, JSON.parse(event.data), 'stream'));
      setEventsLive(true);
    };
    events.onerror = () => setEventsLive(false);
    return () => events.close();
  }, [room.roomId, config.token]);
  async function start() {
    setError('');
    setSubmitting(true);
    requestId.current ??= crypto.randomUUID();
    try {
      const next = await api<Job>(config, `/rooms/${room.roomId}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current, mode, instruction }),
      });
      setJob((current) => newerJob(current, next));
      requestId.current = null;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSubmitting(false);
    }
  }
  async function cancel() {
    if (!job) return;
    try {
      await api(config, `/jobs/${job.id}/cancel`, { method: 'POST' });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      <header className="room-header">
        <a className="brand compact" href="/">
          m
        </a>
        <div className="document-heading">
          <h1>{room.title}</h1>
          <span>
            <span className={`status-dot ${connection.live ? '' : 'offline'}`} />
            {connection.live ? 'Live document' : 'Reconnecting document…'}
          </span>
        </div>
        <div className="room-actions">
          <div className="participants" aria-label="Collaborators">
            {people.map((p) => (
              <span
                key={p.actorId}
                className={`person ${p.role === 'agent' ? 'agent-person' : ''}`}
                title={`${p.name}${p.isLocal ? ' (you)' : ''}`}
                aria-label={p.name}
              >
                {p.role === 'agent' ? '✳' : p.name.slice(0, 2).toUpperCase()}
              </span>
            ))}
          </div>
          <button
            className="quiet"
            onClick={() => {
              void navigator.clipboard
                .writeText(location.href)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch((e) => setError(errorText(e)));
            }}
          >
            {copied ? 'Link copied' : 'Invite ↗'}
          </button>
          <button className="quiet upload-button" onClick={upload}>
            Upload
          </button>
          <a
            className="quiet download-button"
            href={`/api/rooms/${room.roomId}/download?token=${encodeURIComponent(config.token)}`}
          >
            Download ↓
          </a>
          <ThemeButton />
          <button
            className="quiet mobile-panel-button"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            Review
          </button>
        </div>
      </header>
      <div className="workspace-columns">
        <section className="document-pane" aria-label="Shared document">
          <DocxEditor.Toolbar />
          <DocxEditor.Viewport className="document-viewport">
            <DocxEditor.Content />
            <DocxEditor.HyperLink />
            <DocxEditorCollaboration.CaretLabels />
          </DocxEditor.Viewport>
        </section>
        <aside
          className={`agent-panel ${panelOpen ? 'panel-open' : ''}`}
          aria-label="Document review"
        >
          <div className="panel-tabs" role="tablist" aria-label="Review panel">
            <button role="tab" aria-selected={tab === 'agent'} onClick={() => setTab('agent')}>
              ✳ &nbsp; Agent
            </button>
            <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
              Changes <span className="count">{revisions.length}</span>
            </button>
            <button
              className="quiet mobile-panel-button"
              aria-label="Close review panel"
              onClick={() => setPanelOpen(false)}
            >
              ×
            </button>
          </div>
          {tab === 'agent' ? (
            <div className="agent-tab" role="tabpanel">
              <div className="agent-intro">
                <span className="agent-mark">✳</span>
                <span className="eyebrow">YOUR SECOND PAIR OF EYES</span>
                <h2>
                  A thoughtful review.
                  <br />
                  The final say is yours.
                </h2>
                <p>
                  Your agent works in this shared document. Suggestions arrive as tracked changes
                  for everyone to review.
                </p>
              </div>
              <label className="mode-control">
                Review mode
                <select
                  aria-label="Review mode"
                  value={mode}
                  disabled={running}
                  onChange={(e) => {
                    setMode(e.target.value as 'ai' | 'scripted');
                    requestId.current = null;
                  }}
                >
                  <option value="scripted">Scripted review · no API key</option>
                  <option value="ai" disabled={!config.ai}>
                    AI review{config.ai ? '' : ' · configure server key'}
                  </option>
                </select>
              </label>
              <label className="composer">
                What should we look for?
                <textarea
                  value={instruction}
                  maxLength={4000}
                  disabled={running || mode === 'scripted'}
                  onChange={(e) => {
                    setInstruction(e.target.value);
                    requestId.current = null;
                  }}
                  rows={4}
                />
              </label>
              {mode === 'scripted' ? (
                <p className="helper">
                  A guided demonstration of four sample-agreement edits. Uploaded documents may not
                  contain these clauses.
                </p>
              ) : (
                <div className="starter-list">
                  {STARTERS.map((prompt) => (
                    <button
                      key={prompt}
                      disabled={running}
                      onClick={() => {
                        setInstruction(prompt);
                        requestId.current = null;
                      }}
                    >
                      {prompt}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                className="primary start-review"
                disabled={!connection.live || running || submitting || !instruction.trim()}
                onClick={() => void start()}
              >
                {submitting ? 'Starting review…' : running ? 'Review in progress' : 'Start review'}
                <span>↗</span>
              </button>
              {job && (
                <div className={`job-card job-${job.state}`} aria-live="polite">
                  <div className="job-heading">
                    <span className={running ? 'working-dot' : 'status-dot'} />
                    <strong>
                      {job.state === 'completed'
                        ? 'Review complete'
                        : job.state === 'failed'
                          ? 'Review stopped'
                          : job.state[0]!.toUpperCase() + job.state.slice(1)}
                    </strong>
                    {running && (
                      <button className="quiet" onClick={() => void cancel()}>
                        Cancel
                      </button>
                    )}
                  </div>
                  <p>{job.message}</p>
                  <button className="job-count" onClick={() => setTab('changes')}>
                    {job.proposals} {job.proposals === 1 ? 'suggestion' : 'suggestions'} committed{' '}
                    <span>→</span>
                  </button>
                </div>
              )}
              {!eventsLive && (
                <p className="helper" role="status">
                  Reconnecting review progress. The agent can continue working.
                </p>
              )}
              <div className="panel-bottom">
                <span>◇</span>
                <p>
                  Your agent runs on the server.
                  <br />
                  You can close this tab and return later.
                </p>
              </div>
            </div>
          ) : (
            <div className="changes-tab" role="tabpanel">
              <div className="changes-heading">
                <span className="eyebrow">HUMAN DECISIONS</span>
                <h2>{revisions.length ? 'Make it your own.' : 'Room for improvement.'}</h2>
                <p>
                  {revisions.length
                    ? 'Keep what works. Reject what doesn’t.'
                    : 'Suggestions will appear here as the agent reviews your document.'}
                </p>
              </div>
              {revisions.map((item) => (
                <article className={`change-card ${item.isActive ? 'active' : ''}`} key={item.key}>
                  <div className="change-author">
                    <span className="agent-mark small">
                      {item.author === 'Review agent' ? '✳' : item.initials}
                    </span>
                    <strong>{item.author}</strong>
                    <span>{revisionPresentation(item.item).label}</span>
                  </div>
                  <button
                    className="change-text"
                    disabled={!item.activatable}
                    onClick={() => {
                      review.setActive(item.key);
                      setPanelOpen(false);
                    }}
                  >
                    {item.replacedText && item.revisionKind === 'replace' && (
                      <del>{item.replacedText}</del>
                    )}
                    {revisionPresentation(item.item).decoration === 'delete' ? (
                      <del>{item.text || revisionPresentation(item.item).description}</del>
                    ) : revisionPresentation(item.item).decoration === 'insert' ? (
                      <ins>{item.text || revisionPresentation(item.item).description}</ins>
                    ) : (
                      <span>
                        {revisionPresentation(item.item).description}
                        {item.text ? `: ${item.text}` : ''}
                      </span>
                    )}
                  </button>
                  <div className="change-actions">
                    <button
                      disabled={item.readOnly || !connection.live}
                      onClick={() => {
                        if (!review.reject(item))
                          setError(
                            'This change could not be rejected. It may have been resolved by a collaborator.'
                          );
                      }}
                    >
                      Reject
                    </button>
                    <button
                      className="accept"
                      disabled={item.readOnly || !connection.live}
                      onClick={() => {
                        if (!review.accept(item))
                          setError(
                            'This change could not be accepted. It may have been resolved by a collaborator.'
                          );
                      }}
                    >
                      Accept ✓
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {error && (
            <p className="error panel-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
