// Immutable navigation sidecar store (task 5.5).

import type { InteractionFrameId } from '@docx-editor.dev/core-contract/interaction';
import type { NavigationGeometry } from './navigation-geometry.ts';
import { emptyNavigationGeometry, freezeNavigationGeometry } from './navigation-geometry.ts';

const MAX_RETAINED = 2;

/** Bounded, immutable navigation geometry keyed by frame identity. */
export class NavigationSidecarStore {
  private byFrameId: Readonly<Record<number, NavigationGeometry>> = Object.freeze({});

  get(frameId: InteractionFrameId): NavigationGeometry {
    return this.byFrameId[frameId.value] ?? emptyNavigationGeometry();
  }

  publish(frameId: InteractionFrameId, geometry: NavigationGeometry): void {
    const frozen = freezeNavigationGeometry(geometry);
    const next: Record<number, NavigationGeometry> = { ...this.byFrameId, [frameId.value]: frozen };
    this.prune(next, frameId.value);
    this.byFrameId = Object.freeze(next);
  }

  rebase(fromId: InteractionFrameId, toId: InteractionFrameId): void {
    const prior = this.byFrameId[fromId.value] ?? emptyNavigationGeometry();
    const next: Record<number, NavigationGeometry> = { ...this.byFrameId, [toId.value]: prior };
    this.prune(next, toId.value);
    this.byFrameId = Object.freeze(next);
  }

  clear(): void {
    this.byFrameId = Object.freeze({});
  }

  private prune(table: Record<number, NavigationGeometry>, keepId: number): void {
    const ids = Object.keys(table)
      .map(Number)
      .sort((a, b) => b - a);
    let kept = 0;
    for (const id of ids) {
      if (id === keepId) {
        kept += 1;
        continue;
      }
      if (kept >= MAX_RETAINED) delete table[id];
      else kept += 1;
    }
  }
}
