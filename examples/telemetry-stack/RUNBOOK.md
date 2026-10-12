# Editor telemetry runbook

What to do when an alert in `rules.yml` fires or a dashboard panel turns red. Each section starts with what the signal means, then the checks in order.

The objectives in this example are starting points. Measure your own traffic for a few weeks, then set targets that match what your users accept.

| Objective | Target | Error budget |
| --- | --- | --- |
| Key presses and clicks reach the screen within 100 ms | 99% | 1% |
| Opens succeed, excluding broken files | 99.9% | 0.1% |
| Successful opens finish within 2.5 seconds | 99% | 1% |

## Interaction slow

**Alert:** `DocxEditorInteractionSlowBurnRatePage` or `...Ticket`. More than 1% of presses take over 100 ms to reach the screen, fast enough to use the error budget early.

1. On **Editor experience**, open **Input delay by document size**. If only the `100-999` or `1000+` buckets are slow, the delay follows document size.
2. Compare **Layout and paint within 16 ms** with input delay. If layout and paint stay fast while input delay grows, the time goes to your app, such as React renders, other scripts, or the main thread, not to the editor engine.
3. Compare **Input delay by version**. A new version that is slower points to the release.
4. In your events backend, search `performance` events with the code `performance.slow-interaction` and group them by your `room.id` or `document.id` attributes to find the documents involved.

## Open failed

**Alert:** `DocxEditorOpenFailedBurnRate...`. Opens fail for reasons the app causes: `open.failed`, `open.unsupported-source`, or `open.invalid-limits`. Broken files sent by users are not counted here; they appear in **Refused files**.

1. Open **Refused files by reason** and follow the code link to its hint in the diagnostics guide.
2. `open.unsupported-source`: the app passes something that is not DOCX bytes, often an HTML error page from a failed download. Check the request that fetches the document.
3. `open.invalid-limits`: the app passes invalid open limits. Check the editor options in the last release.
4. `open.failed`: the engine could not say why. Search Sentry issues grouped by this code, and report them with the engine version.

## Open slow

**Alert:** `DocxEditorOpenSlowBurnRate...`. More than 1% of successful opens take over 2.5 seconds.

1. Check **Open time** by document size. Large documents open slower.
2. Check whether fonts fail (**Font substitutions**): the editor waits for fonts before the first layout.
3. Compare versions, and check the network time to fetch the document in your own traces.

## Collaboration server down

**Alert:** `DocxCollaborationServerDown`. Prometheus cannot scrape the collaboration server. Editors keep working offline when offline editing is on, and their **Client status changes** show `disconnected`.

1. Check that the server process runs and that its port answers `/metrics`.
2. Check the server logs for load or store errors.
3. After a restart, rooms reload from storage. Watch **Room load and store time**.

## Room store failing

**Alert:** `DocxCollaborationStoreFailing`. Rooms fail to store. Edits made since the last good store can be lost if the server restarts.

1. Check the storage the `onStoreDocument` hook writes to: disk space, permissions, database health.
2. Do not restart the server until stores succeed again, or the rooms reload from the last good state.

## Telemetry dropping events

**Alert:** `DocxTelemetryDroppingEvents`. The privacy check drops events whose kind, code, or fields it does not know.

1. The usual cause is different versions of `@docx-editor.dev/core` and `@docx-editor.dev/telemetry`. Install the same version of both.
2. The **Dropped events** panel shows the reason: `unknown-kind`, `unknown-code`, or `invalid-field`.

## Unexpected refusals

**Panel:** **Unexpected refusals per 1,000 presses**. A proxy for edit reliability, until the package counts edit attempts. Expected refusals, such as typing in a read-only document, are not counted.

1. Open **Refused edits by reason** and follow the code link to its hint.
2. Check **Refused edits by source**: `automation` refusals come from an editing API batch, so check the agent or job that sent it.
