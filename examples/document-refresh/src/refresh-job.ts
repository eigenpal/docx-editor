import type {
  DocumentRefresh,
  RefreshChangeInput,
  RefreshResult,
  RefreshSubmission,
} from '@docx-editor.dev/react';

export interface ServerUpdate {
  documentId: string;
  submissionId: string;
  sequence: number;
  bytes: string;
  changes: RefreshChangeInput[];
  failures: string[];
}

/** Transport identity belongs to the application; submission tokens stay in the browser. */
export async function runRefreshJob(
  refresh: DocumentRefresh,
  signal: AbortSignal,
  receive: (submission: RefreshSubmission) => AsyncIterable<ServerUpdate>,
  report: (result: RefreshResult) => void
): Promise<void> {
  const submission = await refresh.capture();
  try {
    if (signal.aborted) return;
    for await (const update of receive(submission)) {
      if (signal.aborted) break;
      if (update.documentId !== 'schedule' || update.submissionId !== submission.id)
        throw new Error('identity-mismatch');
      const result = await refresh.applyUpdate({
        submission,
        sequence: update.sequence,
        bytes: Uint8Array.from(atob(update.bytes), (c) => c.charCodeAt(0)),
        changes: update.changes,
        failures: update.failures,
      });
      if (signal.aborted) break;
      report(result);
      // A late result cannot replace newer output. Keep receiving the job's remaining results.
      if (!result.ok && result.code !== 'out-of-order') break;
    }
  } finally {
    refresh.finish(submission);
  }
}

/** Two complete cumulative files; production transport can use polling or a result stream. */
export async function* receiveSampleUpdates(
  submission: RefreshSubmission,
  signal: AbortSignal,
  round: number,
  includeLateResult: boolean
): AsyncGenerator<ServerUpdate> {
  let first: ServerUpdate | undefined;
  for (const sequence of [1, 2]) {
    const response = await fetch(`/api/update?round=${round}&sequence=${sequence}`, {
      method: 'POST',
      headers: { 'X-Submission-Id': submission.id },
      signal,
      body: submission.bytes,
    });
    if (!response.ok) throw new Error('request-failed');
    const update: ServerUpdate = await response.json();
    first ??= update;
    yield update;
  }
  if (includeLateResult && first) yield first;
}
