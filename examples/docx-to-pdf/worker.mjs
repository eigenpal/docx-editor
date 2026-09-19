import { parentPort, workerData } from 'node:worker_threads';
import { exportPdf } from '@docx-editor.dev/docx-to-pdf';
try {
  const result = await exportPdf(new Uint8Array(workerData.bytes), workerData.options);
  parentPort.postMessage(
    { ok: true, bytes: result.bytes, pageCount: result.pageCount, diagnostics: result.diagnostics },
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
