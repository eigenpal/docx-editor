import { Node as PMNode } from 'prosemirror-model';
import { schema } from '@eigenpal/docx-core/prosemirror/schema';
import type { Document, Paragraph, Table } from '@eigenpal/docx-core/types/document';
import {
  fromProseDoc,
  convertTopLevelNode,
  buildTrackedChangeCounts,
} from '@eigenpal/docx-core/prosemirror/conversion/fromProseDoc';
import { mergeDocumentBlocks } from '@eigenpal/docx-core/prosemirror/conversion/mergeDocumentBlocks';

type ConversionMode = 'full' | 'incremental';

type WorkerRequest = {
  id: number;
  mode: ConversionMode;
  pmDocJson: unknown;
  baseDocument: Document | null;
  dirtyIndices?: number[];
  expectedBlockCount?: number;
};

type WorkerResponse = {
  id: number;
  mode: ConversionMode;
  document: Document | null;
  error?: string;
};

function buildIncrementalDocument(
  pmDoc: PMNode,
  baseDocument: Document,
  dirtyIndices: number[],
  expectedBlockCount: number
): Document {
  const counts = buildTrackedChangeCounts(pmDoc);
  const updates = new Map<number, Paragraph | Table>();

  for (const index of dirtyIndices) {
    const node = pmDoc.child(index);
    updates.set(index, convertTopLevelNode(node, counts));
  }

  return mergeDocumentBlocks(baseDocument, updates, expectedBlockCount);
}

function handleRequest(payload: WorkerRequest): WorkerResponse {
  try {
    const pmDoc = PMNode.fromJSON(schema, payload.pmDocJson);
    const baseDocument = payload.baseDocument ?? null;

    if (
      payload.mode === 'incremental' &&
      baseDocument &&
      Array.isArray(payload.dirtyIndices) &&
      typeof payload.expectedBlockCount === 'number'
    ) {
      const document = buildIncrementalDocument(
        pmDoc,
        baseDocument,
        payload.dirtyIndices,
        payload.expectedBlockCount
      );
      return { id: payload.id, mode: payload.mode, document };
    }

    const document = fromProseDoc(pmDoc, baseDocument ?? undefined);
    return { id: payload.id, mode: payload.mode, document };
  } catch (error) {
    return {
      id: payload.id,
      mode: payload.mode,
      document: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const response = handleRequest(event.data);
  self.postMessage(response);
};
