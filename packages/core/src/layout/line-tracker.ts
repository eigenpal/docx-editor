import type { VisualLineIdentity } from './display-item.ts';

/** Stable semantic line / fragment identity for one paragraph (task 5.5). */
export class LineTracker {
  private lineIndex = 0;
  private fragmentIndex = 0;
  private lastPageIndex = -1;

  constructor(private readonly paragraphId: string) {}

  identity(pageIndex: number): VisualLineIdentity {
    if (this.lastPageIndex >= 0 && pageIndex !== this.lastPageIndex) {
      this.fragmentIndex += 1;
    }
    this.lastPageIndex = pageIndex;
    return {
      lineId: `${this.paragraphId}:L${this.lineIndex}`,
      fragmentId: `${this.paragraphId}:L${this.lineIndex}:F${this.fragmentIndex}`,
      lineIndex: this.lineIndex,
      fragmentIndex: this.fragmentIndex,
    };
  }

  wrap(pageIndex: number): void {
    this.lineIndex += 1;
    if (this.lastPageIndex >= 0 && pageIndex !== this.lastPageIndex) this.fragmentIndex += 1;
    this.lastPageIndex = pageIndex;
  }
}
