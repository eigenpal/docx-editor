import type { PdfDiagnostic } from './pdf-export-state';

export interface ConversionTimings {
  readonly workerStartupMs?: number;
  readonly generationMs?: number;
}

export interface ConversionProgress {
  readonly phase: 'starting' | 'generating';
  readonly workerStartupMs?: number;
}

interface ConversionPayload {
  readonly pdf?: string;
  readonly pageCount?: number;
  readonly diagnostics?: readonly PdfDiagnostic[];
  readonly message?: string;
  readonly timings?: ConversionTimings;
}

/** Accept streaming phase updates and the older, single-JSON conversion service. */
export async function readConversionResponse(
  response: Response,
  onProgress: (progress: ConversionProgress) => void
): Promise<ConversionPayload> {
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    return response.json();
  }
  if (!response.body) throw new Error('The conversion service returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'result') return event as ConversionPayload;
        if (event.type === 'progress' && ['starting', 'generating'].includes(event.phase)) {
          onProgress(event as ConversionProgress);
        }
      }
      if (done) throw new Error('The conversion service disconnected before returning a PDF.');
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
