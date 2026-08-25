import * as Y from 'yjs';

export function clientRange(update: Uint8Array): {
  from: Record<string, number>;
  to: Record<string, number>;
} {
  const meta = Y.parseUpdateMeta(update);
  return {
    from: Object.fromEntries(meta.from),
    to: Object.fromEntries(meta.to),
  };
}

export function clientIdsIn(update: Uint8Array): number[] {
  return [...Y.parseUpdateMeta(update).from.keys()].sort((a, b) => a - b);
}

export function captureUpdates(doc: Y.Doc): Uint8Array[] {
  const frames: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    frames.push(update);
  });
  return frames;
}

export function captureTransactions(doc: Y.Doc): Array<{
  origin: unknown;
  local: boolean;
  metaKeys: unknown[];
  after: Record<string, number>;
}> {
  const rows: Array<{
    origin: unknown;
    local: boolean;
    metaKeys: unknown[];
    after: Record<string, number>;
  }> = [];
  doc.on('afterTransaction', (transaction: Y.Transaction) => {
    rows.push({
      origin: transaction.origin,
      local: transaction.local,
      metaKeys: [...transaction.meta.keys()],
      after: Object.fromEntries(transaction.afterState),
    });
  });
  return rows;
}

export function applyAll(target: Y.Doc, updates: readonly Uint8Array[], origin?: unknown): void {
  for (const update of updates) {
    Y.applyUpdate(target, update, origin);
  }
}
