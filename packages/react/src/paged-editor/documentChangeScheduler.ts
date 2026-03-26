export type DebounceInputs = {
  docSize: number;
  blockCount: number;
  lastKeyInterval: number;
};

export function computeDebounceDelay({
  docSize,
  blockCount,
  lastKeyInterval,
}: DebounceInputs): number {
  const base = 120;
  const sizeDelay = Math.min(350, Math.max(0, docSize - 1000) * 0.04);
  const blockDelay = Math.min(200, Math.max(0, blockCount - 20) * 0.6);
  let delay = base + sizeDelay + blockDelay;

  if (lastKeyInterval > 250) {
    delay = Math.max(base, delay - Math.min(200, (lastKeyInterval - 250) * 0.5));
  }

  return Math.max(120, Math.min(650, Math.round(delay)));
}
