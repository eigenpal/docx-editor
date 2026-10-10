# Collaboration server benchmark and scenario fuzzer

This directory holds two tools for full-document collaboration:

- A **load benchmark** measures one [Hocuspocus](https://tiptap.dev/docs/hocuspocus) room under realistic editing load. Use it to check server health and to size a server for a number of concurrent participants.
- A **scenario fuzzer** runs seeded concurrent-editing scenarios in one process and checks that every replica ends correct. Use it to find collaboration defects, reduce one to a minimal case, and replay it. For more information, see [Find collaboration defects](#find-collaboration-defects).

Each load benchmark step starts a fresh server, fills one room with simulated participants, and has them type for a fixed time. The default steps use 5, 10, 15, 20, and 25 participants.

## What the benchmark simulates

Each participant is a real collaboration replica. It joins through `createHocuspocusCollaboration` from `@docx-editor.dev/pro/collaboration/hocuspocus`, and it attaches a canonical document store the same way the editor does. Edits are store transactions, so they travel the same path as keystrokes in the editor. Participants do not lay out or paint pages.

A participant types in bursts at about 60 words per minute, then pauses for 0.5 to 4 seconds. This averages near 3.5 keystrokes per second. The keystroke mix is:

- 88% insert one character
- 7% delete one character
- 3% start a new paragraph
- 2% apply bold to the last five characters

Each participant writes in its own paragraph. 10% of keystrokes go to one paragraph that all participants share, at random positions, so the room also carries concurrent edits at one place. After each keystroke, the participant publishes its caret, as the editor does.

The plan comes from a seeded generator. The same seed gives the same keystrokes.

The server in `server.ts` does the work of a production room server. It authenticates each connection, refuses incompatible collaboration formats, holds the room, and stores it as a Yjs update and as a DOCX file each time Hocuspocus persists the room.

## Run the benchmark

You need Node.js 22.18 or later for the server and Bun for the participants. Build the packages first, because the server runs on Node and imports the built `@docx-editor.dev/pro`:

```bash
bun install
bun run build:packages
```

Run all steps from the repository root:

```bash
bun run bench:collaboration
```

The run takes about 8 minutes with the default settings. To run it with Bun directly, use this command from `benchmarks/collaboration-server`:

```bash
bun test ./collaboration-load.bench.ts
```

## Change the settings

Set these environment variables to change a run:

| Variable | Default | Effect |
| --- | --- | --- |
| `BENCH_PARTICIPANTS` | `5,10,15,20,25` | Participant counts, one step each |
| `BENCH_ACTIVE_SHARES` | `1` | Shares of participants who type, for example `0.2,0.5,1`. Each share runs every participant count. The others stay connected and read. |
| `BENCH_DURATION_S` | `60` | Typing time in each step, in seconds |
| `BENCH_PER_WORKER` | `1` | Participants in each client process. One matches a browser tab. |
| `BENCH_TYPING_SCALE` | `1` | Multiplier for typing speed; `2` types twice as fast |
| `BENCH_SHARED_SHARE` | `0.1` | Share of keystrokes in the shared paragraph |
| `BENCH_DOCUMENT` | `examples/vite/public/sample.docx` | The DOCX file that seeds the room |
| `BENCH_SEED` | `1` | Seed for the keystroke plan |
| `BENCH_URL` | none | Connect to this server instead of starting one |
| `BENCH_TOKEN` | `benchmark-token` | Token for the server |
| `BENCH_MAX_P95_MS` | none | Fail a step when p95 latency is higher than this value |
| `BENCH_PROFILE_WORKER` | none | Write a CPU profile of this client worker id to the step directory |
| `BENCH_OUT` | `results/<timestamp>` | Output directory |

For example, this command runs a short check with 20 participants:

```bash
BENCH_PARTICIPANTS=20 BENCH_DURATION_S=30 bun run bench:collaboration
```

When you set `BENCH_URL`, the server runs somewhere else. The benchmark then cannot read its CPU and memory, and it cannot check the saved DOCX. Measure those on the server host. The server must accept the token envelope that `client-worker.ts` sends.

## Read the results

Each run writes these files to its output directory:

- `summary.md`: a table of all steps, for people
- `summary.json`: all steps with every measured value, for charts and tools
- `summary.csv`: one row per step, for spreadsheets
- `step-<P>pct-<N>/result.json`: the full result of one step, where `P` is the typing share and `N` the participant count
- `step-<P>pct-<N>/server-samples.jsonl`: server CPU, memory, event loop delay, and socket count every 500 ms
- `step-<P>pct-<N>/stores.jsonl`: the room size, DOCX size, and export time of each store
- `step-<P>pct-<N>/worker-<id>.json`: raw per-participant data, including every send and receive time
- `step-<P>pct-<N>/server.log`: the server output
- `step-<P>pct-<N>/rooms/`: the room the server stored, as `.ydoc` and `.ydoc.docx`

The main measurements are:

- **Latency**: the time from a keystroke at one participant to that edit in the document store of another participant. Every pair of sender and receiver counts. Latency includes the server relay and the remote replica's own work.
- **Client apply time**: the time one participant takes to integrate and materialize one remote transaction. This cost is on each person's device, and it grows with the edit rate of the whole room.
- **Client CPU per participant**: the CPU cores that one typing participant used while the room typed. Readers are not included.
- **Join time**: the time from connection to a synchronized, editable replica.
- **Server CPU**: the share of one core that the server process uses. One Node.js process runs JavaScript on one core, so values near 100% mean the room server is saturated.
- **Server RSS**: the resident memory of the server process.
- **Event loop delay**: how late the server's event loop runs timers. A high value means that the server delays every message in that period.
- **Server out**: the bytes that the server sends to all participants each second during typing.
- **Disk writes**: the bytes that the server stores each second, from the room state and the DOCX export.
- **Cost of one more participant**: the slope of a straight line through the steps for memory, CPU, and egress.

A step is healthy when all of these are true:

- The server did not exit.
- Every participant joined.
- No session reported an error or a disconnect.
- Every edit reached every other typing participant.
- All participants converged to the same Yjs state, including deletions. Typing participants also have the same document text.
- The DOCX that the server saved has the same text as the replicas.

The test fails on any unhealthy step. It still writes the results.

If `summary.md` reports that the client machine fell behind its keystroke plan, the participants did not get enough CPU. Latency then includes delay on the client machine. Use a separate client machine, or run fewer participants on this one.

## Limits

- The participants and the server run on the same machine unless you set `BENCH_URL`. Network latency is near zero. Add your network round trip to the measured latency.
- The benchmark uses one room. A server that holds many rooms needs the per-room cost multiplied by the number of active rooms.
- Readers do not measure latency. Latency comes from the participants who type, so a step with one typist has none.
- Participants do not run layout or paint. Those costs are on each person's device, not on the server.
- The seed document sets the room size. A larger document increases join time, join traffic, and server memory. Run the benchmark with your own documents through `BENCH_DOCUMENT`.

## Measure edit latency

The load benchmark measures a room. To measure what collaboration adds to one edit, run `edit-latency.ts`. It opens two replicas of one document in one process and applies each edit kind many times: typing at the end and in the middle of a paragraph, deleting a word, bolding a word, Enter, Backspace that joins two paragraphs, pasting 270 characters, and aligning a paragraph.

```bash
bun edit-latency.ts
bun edit-latency.ts --document ../../e2e/fixtures/synthetic-long-edit.docx --rounds 20
bun edit-latency.ts --only 'Enter,type a'
```

For each edit kind, the table reports these values in milliseconds:

- `solo`: the same edit on a store with no collaboration attached.
- `local`: the edit on the author's replica, from the operation gate through publishing its Yjs update.
- `remote`: the other replica applying that update, through installing it in its store.
- `lag`: `local` plus `remote`, which is the delay a participant sees without the network.

It also reports the size of the update in bytes. The first 5 rounds are a warm-up and are not counted; set the count with `--warmup`. Each round collects garbage first, alternates which of the solo store and the author's replica edits first, and takes back each paste without timing it, so every sample starts from the same paragraph. Each round repeats every selected edit kind on the same paragraph. Use `--only` to measure one kind alone. The run fails if the two replicas do not converge.

To find where the time goes, profile one edit kind:

```bash
bun --cpu-prof --cpu-prof-dir=profiles edit-latency.ts --only Enter
```

## Measure room migration memory

A room migration runs offline in a worker process. To size that worker, run `migration/memory.mjs` from the repository root after you build the packages:

```bash
bun run build:packages
bun run collaboration:migration-memory -- --fixtures
bun run collaboration:migration-memory -- --sizes 1000,50000
```

For each document, it runs `migrateCollaborationRoom` under Node.js in a process of its own, one process at a time. It reports these values:

- `Time`: how long the migration took.
- `Peak RSS`: the most memory the whole process held, including Node.js and the loaded modules. V8 grows its heap past what it needs when no limit is set, so this value is an upper bound.
- `Minimum heap`: the smallest `--max-old-space-size` with which the migration completes, found by bisection to within 8%. Size the worker by this value, with a margin.

The synthetic documents have paragraphs of about 250 characters with one bold run. `--fixtures` adds three repository fixtures. The run writes `migration/results/memory.json`.

## Find collaboration defects

The scenario fuzzer runs replicas in one process, joined by a simulated network. Each replica attaches a document store the way the editor does, and edits it with random operations: typing, deleting, splitting and joining paragraphs, run and paragraph formatting, tabs, breaks, block deletes, table rows and columns, cell fills, lists and list levels, hyperlinks, content controls, footnotes, and image resizing, moving, wrapping, and deletion. Some scenarios also add undo and redo, offline periods, and late joiners. The `textbox` shape edits a document with a floating text box.

Every random choice comes from the seed, including Yjs client ids and replica identities, so a seed replays the same scenario exactly. Time is fixed too: `scenario-clock.ts` replaces `Date.now` before Yjs loads, and each action moves it on by the same amount. Yjs groups an author's edits into undo steps by time, so with the real clock a seed would undo different steps on a busier machine.

### Choose a delivery mode

The network delivers updates in one of three ways:

| Mode | Behavior | Models |
| --- | --- | --- |
| `in-order` | Every update reaches every replica at once | One person at a time |
| `server` | One relay orders all updates, and each replica reads that order late | A Hocuspocus room |
| `peer` | Each pair of replicas has its own link, so an edit can arrive before the edit it depends on | A WebRTC mesh |

The `faults` shape also damages deliveries. An update can arrive twice, never arrive, or arrive cut short. A replica then catches up through a state-vector sync, which a provider runs on reconnect: it sends its state vector, and a peer answers with every update it is missing. Each fault is part of the recorded action, so a failing seed shrinks and replays like any other. At the end, every pair of replicas syncs this way before the checks run.

### Run scenarios

Run 12 seeds of the `concurrent` scenario with server delivery:

```bash
bun scenarios.ts run --config concurrent --delivery server --seeds 12
```

The `--config` values are `sequential`, `concurrent`, `offline`, `undo`, `join`, `everything`, `faults`, `textbox`, `denseTable`, `denseImages`, `denseControls`, and `denseLinks`. The command exits with a nonzero status when any seed fails. It groups failures by their first problem, because later problems in a seed are usually consequences of the first one.

To check every scenario shape, run the matrix. It runs each shape with both server and peer delivery, except `sequential`, which runs with `in-order` delivery only. It runs 6 seeds of each shape and delivery, one child process per seed, and prints a `shrink` command for each failure:

```bash
bun scenarios.ts matrix
```

The matrix runs at most half as many processes as the machine has cores, and at most one process for each 4 GB of memory, because one `everything` seed uses about 1.5 GB. To set the number of processes, pass `--jobs`. To run more seeds, pass `--seeds`.

At the end of each scenario, these checks run:

- Every replica holds the same package.
- No session reported an error, and no operation or remote update threw.
- A replica's package survives a DOCX round trip, and `readCollaborationDocument` on the shared state gives the same document body. A cold joiner and a server export read the room this way.
- With `in-order` delivery, the editing replica equals one plain document store after every edit. The first edit after which the two differ is the one reported.
- Each typing action also types one unique character. It shows exactly once in the final document, unless someone deleted it, undid an edit after it, or deleted its paragraph.
- Once every replica holds the same document, each replica publishes its caret, and every peer shows that caret in the same paragraph at the same offset.

During a scenario, these checks also run:

- An undo or redo never removes what another participant typed, unless it removes the paragraph that holds it.
- A participant always sees what they typed: the replica an action touches still shows every character it typed, unless someone removed it or its paragraph is gone. Typing that vanishes for a moment and comes back fails this check. The check waits while the replica holds back an update whose dependencies have not arrived: Yjs applies that update's deletions at once and its inserts later, so moved text is missing until then. Hocuspocus and y-webrtc deliver every update after the updates it depends on, so only a lost message leaves such a gap.
- After a replica types, its caret stays right after the typed character while remote updates arrive, as long as that character stays in the paragraph. The caret is carried across each update by the editor's own code.

### Check every step

To also check each replica after every action and every delivery, pass `--strict` to `one`, `run`, `matrix`, `shrink`, or `replay`. Strict mode builds a fresh registry and view from each replica's shared state and compares it with the replica's editor tree, so a failure names the action that caused it. It reports the cause it can tell apart: stale registry indexes, a stale editor tree, or replicas that hold the same shared state but show different documents. It also compares node IDs in every story, because serialized XML carries none, and a later local edit addresses nodes by ID. Strict mode is several times slower.

### Reduce a failure to a minimal case

The `run` output prints a `shrink` command for each failure group. For example:

```bash
bun scenarios.ts shrink --config concurrent --delivery server --seed 7
```

The command removes actions while the same problem persists, and writes the remaining actions to a JSON file. The file also names the scenario shape, seed, replica count, and delivery mode. Use `--match` to keep a specific problem text.

Before it starts to remove actions, the command writes the unshrunk case to a file that ends in `.start.json`. A long seed can take a long time to shrink, and you can replay the start file in the meantime. Each time the command finds a smaller case, it writes it to a file that ends in `.progress.json`, so a shrink that stops early keeps its progress. To shrink a saved case further without running its seed again, pass the file with `--start`:

```bash
bun scenarios.ts shrink --start shrunk-concurrent-server-7.start.json --match diverged
```

### Replay a minimal case

Replay a saved case to debug it:

```bash
bun scenarios.ts replay shrunk-concurrent-server-7.json
```

A replay and `shrink --start` run the case on the document of the scenario shape that the file names. To change the replica count, delivery mode, or seed of a replay, pass `--replicas`, `--delivery`, or `--seed`.

To see why replicas disagree about a paragraph, print its shared text on every replica: each Yjs item with its origin, and the identities, hidden positions, and follow anchors each replica reads from it:

```bash
bun inspect-paragraph.ts shrunk-concurrent-server-7.json /word/document.xml#0.0.1
```

The command uses the scenario shape that the file names. To use another shape, pass its name before the paragraph ID. These flags add views:

| Flag | View |
| --- | --- |
| `--unsettled` | Inspect after the last action, before the final delivery. |
| `--paragraphs` | The first paragraphs that each replica's editor shows. |
| `--ids` | The paragraphs with their IDs. |
| `--all` | Every paragraph, not only the first ones. |
| `--find <text>` | Every paragraph whose shared text contains the text. |
| `--find-replica <n>` | With `--find`, search replica `n` instead of replica 0. |
| `--holders <a,b>` | The paragraphs that hold these identities. |
| `--deletions` | The deletion records of every replica. |
| `--shows <text>` | The paragraphs whose shown text contains the text, on every replica. |
| `--stale` | Whether each editor shows what a fresh build of its shared state shows. |
| `--children` | The children that each editor shows for the paragraph, with their text. |
| `--listed <p,c>` | Whether parent `p` lists child `c` on every replica, with its listing items. |

### Keep a minimal case as a regression test

Copy the shrunk file into `replays/` with a name that says what it exercises. The `collaboration-replays-*.test.ts` files replay every file there in strict mode, spread over eight shares, and expect no problem. To run them all, run `bun test collaboration-replays`. To also cover the case in the pro package tests, write the same edits with the two-peer harness in `packages/pro/src/collaboration/__tests__/document-peer-support.ts`.

### Open cases

Each case in `replays/open/` still fails, and the replay test does not run it. Its seed is in the `OPEN` list in `scenario-regressions.ts`, where `bun test --todo` runs it. When a fix makes a case pass, move the file into `replays/` and the seed back into `CLEAN`.

## Unit tests

The analysis, the keystroke model, the seeded scenarios, and the replayed cases have tests:

```bash
bun run --filter docx-editor-benchmark-collaboration-server test
```
