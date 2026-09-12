# Server agent review

Run a Node.js worker that joins a Hocuspocus room as **Review agent** and proposes
Word tracked changes. Open the room in two browsers, then accept or reject
suggestions from either browser.

The browser renders the editor and requests jobs. All model calls and proposal execution happen on the worker. The job continues if its initiating browser closes.

## Run

Use Node.js 22.18 or later and Bun for workspace installation and builds. The worker uses native WebSocket support and TypeScript stripping in Node.js; the client uses the Hocuspocus provider.

```sh
bun install
cp examples/server-agent-review/.env.example examples/server-agent-review/.env
bun run dev:server-agent-review
```

Open [localhost:5180](http://localhost:5180). This command builds the workspace packages and starts Vite, Hocuspocus, and the worker. Stop all three with Ctrl+C.

1. Enter your display name and open the sample agreement, or upload a DOCX (up to 10 MiB) to create a new room.
2. Copy the invite link into another browser or browser profile and join under a different name.
3. Choose **Scripted review** to demonstrate four edits without a model key. This mode only targets clauses from the sample; missing clauses in uploads are skipped.
4. To use AI, set `OPENAI_API_KEY` in `.env`, restart, and select **AI review**. `OPENAI_MODEL` defaults to `gpt-5.4-mini`. Give the agent a review instruction.
5. Open **Changes** to accept or reject suggestions. **Download** exports the current shared document, including pending revisions.

## Architecture

```text
Browser A ─┐
           ├─ Hocuspocus (Yjs room + persistence) ─ Node worker peer
Browser B ─┘                                      │
                                                  ├─ headless editor-api
Browser instruction panel ─ HTTP start/cancel ────┤
Browser progress panel ← SSE job snapshots ───────┘
```

- `server/collaboration.ts` authenticates peers and stores `.ydoc` room state plus `.docx` exports. The Yjs state is the source for rejoining; exported DOCX bytes never replace an active room.
- `server/room.ts` joins a worker peer and attaches `DocxEditor.createCollaborative` to its session. Each attachment receives its own actor ID.
- `server/tools.ts` implements bounded document reads, snapshot tokens, unique-quote targeting, serialized tool execution, and explicit proposals. It exposes no ordinary text-write or revision-decision tools to the model.
- `server/agent.ts` runs the AI SDK tool loop or the deterministic scripted review through the same adapter.
- `server/jobs.ts` owns job lifetime independently of requests. `server/index.ts` exposes room creation, job submission, cancellation, progress, and export.
- The React app uses `useHocuspocusCollaboration`, `DocxEditorCollaborationRoot`, and `useReview` for the shared editor and compact decision cards.

Job state and room files live in ignored `.data/`. Override the directory with `REVIEW_DATA_DIR`.

## Copyable server integration

Join an existing room, generate one replacement, and commit it as a tracked change.
Provide `roomId`, `instruction`, and your `generateReplacement` function. The complete
example adds snapshot validation, cancellation, bounded retries, and tool-call deduplication.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createHocuspocusCollaboration } from '@docx-editor.dev/pro/collaboration/hocuspocus';
import { waitForOutboundSync } from './server/room.ts'; // example helper

const room = await createHocuspocusCollaboration({
  url: process.env.COLLAB_URL!,
  roomId,
  token: process.env.AGENT_COLLAB_TOKEN!,
  identity: {
    actorId: crypto.randomUUID(),
    name: 'Review agent',
    role: 'agent',
  },
  bootstrap: { kind: 'join' },
  offlineEditing: false,
});
let runtime;
try {
  runtime = await DocxEditor.createCollaborative(room.document, room.session, {
    author: 'Review agent',
    revisionTextView: 'original',
  });
  await runtime.run(async (context) => {
    const matches = context.document.body.search('may terminate immediately', {
      matchCase: true,
    });
    matches.load('items');
    await context.sync();
    if (matches.items.length !== 1) throw new Error('Choose a unique target');

    const range = matches.items[0]!;
    range.load('text');
    await context.sync();
    const replacement = await generateReplacement(range.text, instruction);
    if (typeof replacement !== 'string' || replacement.length === 0) {
      throw new Error('The model returned no replacement. No edit was queued.');
    }

    context.document.changeTrackingMode = 'TrackMineOnly';
    range.insertText(replacement, 'Replace');
    await context.sync(); // StaleDocument if the local replica changed since the read
  });
  await waitForOutboundSync(room.provider);
} finally {
  runtime?.dispose();
  room.destroy();
}
```

For insertions use `range.insertText(text, 'Before' | 'After')`. For deletions use `range.delete()`.
These methods follow the supported Office.js subset. Supply an `author` and enable `TrackMineOnly` before editing.
The mode persists for the runtime session. `Off` makes ordinary edits. `TrackAll` is explicitly unsupported,
as are structural or formatting mutations while tracking. Other peers keep their own editing mode.
The saved redlines are Word revisions; the local tracking setting is not a document-wide saved policy.

## Office.js developer patterns

Follow the [Office.js guide](../../packages/editor-api/OFFICE_JS_GUIDE.md) for explicit property loads,
batched reads, proxy lifetimes, error handling, and the supported tracking subset.

Each model tool has a focused schema: insertion requires text and an explicit position, replacement requires text,
and deletion accepts only its snapshot and quote. Refusals include the public error target and recovery guidance.
They never tell the model to disable tracking or blindly repeat a refused edit.

The worker batches paragraph reads, serializes tool calls, and commits one suggestion
at a time. Each commit becomes available for review while the job continues.

## Client integration

```tsx
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditor } from '@docx-editor.dev/react';
import { DocxEditorCollaborationRoot, DocxEditorReview } from '@docx-editor.dev/pro/react';
import { useHocuspocusCollaboration } from '@docx-editor.dev/pro/react/hocuspocus';

const modules = [reviewModule()];

function SharedDocument({ room }) {
  const collaboration = useHocuspocusCollaboration({ room, modules });
  if (collaboration.error) return <p>{collaboration.error.code}</p>;
  return (
    <DocxEditorCollaborationRoot collaboration={collaboration}>
      <DocxEditor.Toolbar />
      <DocxEditor.Viewport>
        <DocxEditor.Content />
        <DocxEditorReview />
      </DocxEditor.Viewport>
    </DocxEditorCollaborationRoot>
  );
}
```

Pass a stable `room` configuration with the same room ID and server URL, `bootstrap: { kind: 'join' }`, and a unique actor ID for each browser attachment. Add font configuration as in the runnable app.

## Behavior and limits

- Each proposal is one atomic document transaction. Replacement creates deletion and insertion revisions together; the review engine derives their decision cards.
- The worker’s proposal tools support only single-paragraph text ranges, including table-cell paragraphs. Cross-paragraph ranges, paragraph-break text, missing authors, empty replacement/insertion text, and touching or overlapping pending revisions refuse. A paragraph may receive only one proposal/edit per batch; use separate syncs for sequential edits.
- Ranges are snapshots, not moving CRDT anchors. The example checks a saved-document digest and the target paragraph before committing. Any document change invalidates the read token, even an unrelated edit; the model must reread and reconsider. The final write also uses the runtime's local revision guard. This cannot detect a human update that has not reached the worker yet; concurrent delivered updates still merge through the CRDT.
- Agent edits are disabled while disconnected. Loss of collaboration readiness stops the job; already committed suggestions remain. Cancellation prevents future writes and drains already committed updates when the transport permits it.
- A successful `sync()` commits and publishes to the local replica. `waitForOutboundSync()` waits for Hocuspocus acknowledgement, **not** other browsers' rendering or durable disk persistence. Hocuspocus persists through its debounced store hook. A transport failure can leave delivery unconfirmed; the job is not automatically replayed.
- Only one active job per room. Request IDs deduplicate submissions; tool-call IDs deduplicate within a running job. Reads are paginated; jobs stop after 20 model steps or three consecutive stale attempts.
- Browser disconnects do not cancel jobs. A worker restart marks unfinished jobs interrupted. There is no durable queue, cross-worker coordination, or automatic resumption.
- The example binds services locally and uses shared demo tokens. Display names are illustrative, not verified identity. Replace token handling, room authorization, rate limits, and local persistence before deploying a shared production service. The configuration endpoint intentionally returns the browser demo token; model and agent credentials stay on the worker.

## Checks

```sh
bun run --filter './examples/server-agent-review' typecheck
bun run --filter './examples/server-agent-review' build
bun run --filter './examples/server-agent-review' test
bun test packages/editor-api/src/runtime/__tests__/runtime-proposals.test.ts
bun run test:server-agent-review
```

Build the workspace packages before running Node or the browser suite. The deterministic Playwright suite starts isolated ports (5280/3280/1380) and checks two-peer streaming, human edits, review decisions, export, cancellation, browser disconnects, upload, and narrow/dark layouts. No model API key is needed.

CI runs the Node lifecycle integration in its build job, after workspace packages exist; the source-only Bun suite runs the unit tests. To run the integration alone after building, use `bun run --filter './examples/server-agent-review' test:lifecycle`.

The Node lifecycle test also kills the collaboration transport and restarts the worker, checking failure, persisted-room recovery, and interrupted-job handling without replay.

## Next steps

- [Server agent API patterns](../../packages/editor-api/OFFICE_JS_GUIDE.md)
- [Collaboration reference](https://www.docx-editor.dev/docs/2.x/pro/collaboration)
