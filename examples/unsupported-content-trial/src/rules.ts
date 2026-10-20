import type { UnsupportedElement, UnsupportedElementLayout } from '@docx-editor.dev/react';
export const approvalMatch = (element: UnsupportedElement) =>
  element.namespaceUri === 'urn:consumer-review' && element.localName === 'approval';
export const referenceMatch = (element: UnsupportedElement) =>
  element.namespaceUri === 'urn:consumer-review' && element.localName === 'reference';
export const approvalLayout: UnsupportedElementLayout = { width: 420, height: 118 };
export const referenceLayout: UnsupportedElementLayout = { width: 112, height: 22 };

/** Read source values as text. Never insert untrusted XML as HTML. */
export function sourceField(element: UnsupportedElement, localName: string): string {
  const child = element.source?.children.find(
    (node) => node.kind !== 'textValue' && node.localName === localName
  );
  const read = (node: NonNullable<UnsupportedElement['source']>['children'][number]): string =>
    node.kind === 'textValue' ? node.value : node.children.map(read).join('');
  return child ? read(child) : '';
}

export const drawingMatch = (element: UnsupportedElement) => Boolean(element.drawing);
