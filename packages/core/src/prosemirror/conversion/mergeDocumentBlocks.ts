import type { Document, Paragraph, Table } from '../../types/document';

type Block = Paragraph | Table;

export function mergeDocumentBlocks(
  base: Document,
  updates: Map<number, Block>,
  expectedCount: number
): Document {
  const content = base.package.document.content ?? [];
  if (content.length !== expectedCount) return base;

  const next = content.map((block, idx) => updates.get(idx) ?? block);
  return {
    ...base,
    package: {
      ...base.package,
      document: {
        ...base.package.document,
        content: next,
      },
    },
  };
}
