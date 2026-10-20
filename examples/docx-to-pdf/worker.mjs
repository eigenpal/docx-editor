import { parentPort, workerData } from 'node:worker_threads';
import { exportPdf } from '@docx-editor.dev/docx-to-pdf';
// Static imports have finished: startup ends exactly where export begins.
parentPort.postMessage({ type: 'ready' });
const generationStarted = performance.now();
try {
  const result = await exportPdf(new Uint8Array(workerData.bytes), workerData.options);
  parentPort.postMessage(
    {
      ok: true,
      bytes: result.bytes,
      pageCount: result.pageCount,
      diagnostics: result.diagnostics,
      generationMs: performance.now() - generationStarted,
    },
    [result.bytes.buffer]
  );
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error.name,
    message: error.message,
    diagnostics: error.diagnostics ?? [],
  });
}
