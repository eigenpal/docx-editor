// Shared async flush for composition end handlers in integration tests.

export async function flushCompositionFrames(): Promise<void> {
  await new Promise<void>((resolve) => {
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') raf(() => raf(() => resolve()));
    else resolve();
  });
}
