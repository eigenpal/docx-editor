import type { Document, DocumentSnapshot } from '../../types/document';

export function clonePackageSnapshot(pkg: Document['package']): Document['package'] {
  if (typeof structuredClone === 'function') {
    return structuredClone(pkg);
  }
  return JSON.parse(JSON.stringify(pkg));
}

export function createBaselineSnapshot(document: Document): DocumentSnapshot {
  return {
    package: clonePackageSnapshot(document.package),
    originalBuffer: document.originalBuffer,
    templateVariables: document.templateVariables ? [...document.templateVariables] : undefined,
    warnings: document.warnings ? [...document.warnings] : undefined,
  };
}

export function withBaselineDocument(
  document: Document,
  fallbackBaseline?: DocumentSnapshot
): Document {
  if (document.baselineDocument) {
    return document;
  }
  return {
    ...document,
    baselineDocument: fallbackBaseline ?? createBaselineSnapshot(document),
  };
}
