import { useEffect, useMemo, useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorCollaboration, DocxEditorCollaborationRoot } from '@docx-editor.dev/pro/react';
import { useHocuspocusCollaboration } from '@docx-editor.dev/pro/react/hocuspocus';
import { EventLogPanel } from '../../telemetry-stack/client/event-log';
import { eventLog, telemetry } from './telemetry';

const SERVER = import.meta.env.VITE_COLLABORATION_URL ?? 'ws://127.0.0.1:1235';
const params = new URLSearchParams(location.search);
// A room id has 24 to 256 URL-safe characters. Make a random one with `createCollaborationRoomId`.
const ROOM = params.get('room') ?? 'docx-editor-telemetry-demo-room';
const NAME = params.get('name') ?? `Guest ${Math.floor(Math.random() * 900) + 100}`;
const ACTOR = `actor-${crypto.randomUUID()}`;

export function App() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  useEffect(() => {
    void fetch('/sample.docx')
      .then((response) => response.arrayBuffer())
      .then((buffer) => setBytes(new Uint8Array(buffer)));
  }, []);

  const room = useMemo(
    () =>
      bytes
        ? {
            url: SERVER,
            roomId: ROOM,
            identity: { actorId: ACTOR, name: NAME },
            bootstrap: { kind: 'create-or-join' as const, document: bytes },
          }
        : null,
    [bytes]
  );
  // Each event from this editor carries the room and the person, so a slow room or a failing
  // user can be found in your events. The hook adds the collaboration module when it is ready.
  const modules = useMemo(
    () => [reviewModule(), telemetry.moduleFor({ 'room.id': ROOM, 'user.id': ACTOR })],
    []
  );
  const collaboration = useHocuspocusCollaboration({ room, modules });

  const invite = `${location.origin}${location.pathname}?room=${encodeURIComponent(ROOM)}`;
  return (
    <div className="example-shell">
      <header className="example-bar">
        <h1>Editor telemetry, collaboration</h1>
        <span>
          Room <code>{ROOM}</code> as {NAME}
        </span>
        <a href={invite} target="_blank" rel="noreferrer">
          Open a second person
        </a>
        <a
          href="http://localhost:3300/d/docx-editor-collaboration"
          target="_blank"
          rel="noreferrer"
        >
          Dashboard
        </a>
      </header>
      <main className="example-main">
        <section className="example-editor">
          {collaboration.error ? (
            <p>
              Could not join the room (<code>{collaboration.error.code}</code>{' '}
              {collaboration.error.detail}). Start the server with <code>npm run server</code>, then
              reload.
            </p>
          ) : (
            <DocxEditorCollaborationRoot
              collaboration={collaboration}
              fallback={<p>Connecting…</p>}
            >
              <DocxEditor.Toolbar />
              <DocxEditor.Viewport>
                <DocxEditor.Content />
                <DocxEditorCollaboration.CaretLabels />
              </DocxEditor.Viewport>
            </DocxEditorCollaborationRoot>
          )}
        </section>
        <EventLogPanel log={eventLog} />
      </main>
    </div>
  );
}
