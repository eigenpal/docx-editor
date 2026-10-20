import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api';
import { z } from 'zod';
import { inspectSchema } from './editing-schemas';
import { inspectDocument } from './inspect-document';
import { WriterError } from './document-access';

export const inspectBatchSchema = z.object({
  requests: z
    .array(inspectSchema)
    .min(1)
    .max(6)
    .refine(
      (requests) => requests.reduce((total, request) => total + request.limit, 0) <= 120,
      'Request at most 120 top-level items across all inspections.'
    ),
});

/** The caller validates one snapshot around the complete read-only batch. */
export async function inspectDocumentBatch(runtime: DocxEditorRuntime, input: unknown) {
  const { requests } = inspectBatchSchema.parse(input);
  const results = [];
  let bytes = 32;
  for (const [requestIndex, request] of requests.entries()) {
    // Keep public run() lifetimes separate. Each inspector registers its own targets.
    const data = await inspectDocument(runtime, request);
    bytes += new TextEncoder().encode(JSON.stringify({ requestIndex, data })).byteLength + 1;
    if (bytes > 120_000)
      throw new WriterError(
        'ResultTooLarge',
        'Inspection results exceed 120,000 UTF-8 bytes. Reduce limits or split the batch.'
      );
    results.push({ requestIndex, data });
  }
  return { results };
}
