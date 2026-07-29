/**
 * Coordinates asynchronous font installation with framework paint commits. A new display frame
 * invalidates interaction synchronously; only that frame's post-commit callback can re-enable it.
 */
export class PaintEpochGate {
  #epoch = 0;
  #interactionReady = false;

  get interactionReady(): boolean {
    return this.#interactionReady;
  }

  beginFrame(): number {
    this.#interactionReady = false;
    this.#epoch += 1;
    return this.#epoch;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.#epoch;
  }

  commitPaint(epoch: number): boolean {
    if (!this.isCurrent(epoch)) return false;
    this.#interactionReady = true;
    return true;
  }

  detach(): void {
    this.#interactionReady = false;
  }
}
