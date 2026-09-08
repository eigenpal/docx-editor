interface ActiveCommit {
  depth: number;
  settled?: Promise<void>;
  resolve?: () => void;
}
const commits = new WeakMap<HTMLElement, ActiveCommit>();

/** Reentrant saves wait until the active edit installs its final selection. */
export function pendingSurfaceCommit(container: HTMLElement): Promise<void> | undefined {
  const active = commits.get(container);
  if (!active) return undefined;
  active.settled ??= new Promise((resolve) => {
    active.resolve = resolve;
  });
  return active.settled;
}

/** Balance in finally, including nested edits and exceptions from host callbacks. */
export function beginSurfaceCommit(container: HTMLElement): () => void {
  const active = commits.get(container) ?? { depth: 0 };
  active.depth++;
  commits.set(container, active);
  return () => {
    if (--active.depth !== 0) return;
    commits.delete(container);
    active.resolve?.();
  };
}
