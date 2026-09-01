/** Monotonic gate for async work where only the newest document intent may publish. */
export interface LatestOperationGate {
  begin(): number;
  isCurrent(operation: number): boolean;
  invalidate(): void;
}

export function createLatestOperationGate(): LatestOperationGate {
  let latest = 0;
  return Object.freeze({
    begin() {
      latest += 1;
      return latest;
    },
    isCurrent(operation: number) {
      return operation === latest;
    },
    invalidate() {
      latest += 1;
    },
  });
}
