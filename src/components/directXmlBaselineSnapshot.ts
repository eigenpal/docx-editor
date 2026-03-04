import { parseDocx } from '../docx/parser';
import type { Document } from '../types/document';
import { cloneArrayBuffer, cloneDocumentForBaseline } from './docSaveEquivalence';

export interface BuildDirectXmlBaselineSnapshotArgs {
  currentDocument: Document | null;
  savedBuffer: ArrayBuffer;
  parseSavedBuffer?: (buffer: ArrayBuffer) => Promise<Document>;
}

export interface DirectXmlBaselineSnapshot {
  baselineDocument: Document | null;
  baselineBuffer: ArrayBuffer;
  hydratedFromSavedBytes: boolean;
  hydrationError: Error | null;
}

export function shouldHydrateBaselineFromSavedBytes(document: Document | null): boolean {
  return !document?.package.relationships;
}

export async function buildDirectXmlBaselineSnapshot(
  args: BuildDirectXmlBaselineSnapshotArgs
): Promise<DirectXmlBaselineSnapshot> {
  const parser = args.parseSavedBuffer ?? parseDocx;
  const baselineBuffer = cloneArrayBuffer(args.savedBuffer);
  let baselineDocument = args.currentDocument
    ? cloneDocumentForBaseline(args.currentDocument)
    : null;
  let hydratedFromSavedBytes = false;
  let hydrationError: Error | null = null;

  if (shouldHydrateBaselineFromSavedBytes(baselineDocument)) {
    try {
      const reparsed = await parser(cloneArrayBuffer(args.savedBuffer));
      baselineDocument = cloneDocumentForBaseline(reparsed);
      hydratedFromSavedBytes = true;
    } catch (error) {
      hydrationError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (baselineDocument) {
    baselineDocument.originalBuffer = cloneArrayBuffer(args.savedBuffer);
  }

  return {
    baselineDocument,
    baselineBuffer,
    hydratedFromSavedBytes,
    hydrationError,
  };
}
