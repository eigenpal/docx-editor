/**
 * Incremental Block Cache
 *
 * Tracks ProseMirror document state between edits to enable incremental
 * re-conversion of only the dirty (changed) top-level nodes, avoiding
 * full toFlowBlocks() on every keystroke.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type {
  FlowBlock,
  Measure,
  PaginatorSnapshot,
  PaginatorStateAtBlock,
} from '../layout-engine/types';
import type { FloatingImageZone } from './measuring/measureParagraph';
import type { ToFlowBlocksOptions } from './toFlowBlocks';
import { convertTopLevelNode } from './toFlowBlocks';

// =============================================================================
// TYPES
// =============================================================================

export interface IncrementalBlockCache {
  /** Current block array (mirrors toFlowBlocks output). */
  blocks: FlowBlock[];
  /** Current measure array (parallel to blocks). */
  measures: Measure[];
  /** Previous ProseMirror doc for identity comparison. */
  prevDoc: PMNode | null;
  /** Snapshot of list counters after converting each top-level node index. */
  listCounterSnapshots: Map<number, Map<number, number[]>>;
  /** Cumulative Y position at each block index (for layout resume). */
  cumulativeYAtBlock: number[];
  /** Floating image zones active at each block index. */
  activeZonesAtBlock: (FloatingImageZone[] | undefined)[];
  /** Block indices that are section breaks (for dirty propagation). */
  sectionBreakIndices: number[];
  /** Block indices that anchor floating images. */
  floatingAnchorIndices: Set<number>;
  /** Maps top-level node index → [startBlockIdx, endBlockIdx) in blocks array. */
  nodeToBlockRange: Map<number, [number, number]>;
  /** Paginator snapshot at each block boundary (for layout resume). */
  paginatorSnapshotAtBlock: Map<number, PaginatorSnapshot>;
  /** Per-block paginator state from the last layout run (for convergence detection). */
  statesAtBlock: PaginatorStateAtBlock[];
}

export interface DirtyRange {
  /** First dirty block index (inclusive). */
  dirtyFrom: number;
  /** Last dirty block index (exclusive). */
  dirtyTo: number;
}

// =============================================================================
// FACTORY
// =============================================================================

export function createIncrementalBlockCache(): IncrementalBlockCache {
  return {
    blocks: [],
    measures: [],
    prevDoc: null,
    listCounterSnapshots: new Map(),
    cumulativeYAtBlock: [],
    activeZonesAtBlock: [],
    sectionBreakIndices: [],
    floatingAnchorIndices: new Set(),
    nodeToBlockRange: new Map(),
    paginatorSnapshotAtBlock: new Map(),
    statesAtBlock: [],
  };
}

// =============================================================================
// DIRTY RANGE DETECTION
// =============================================================================

/**
 * Compare previous and new document to find which top-level nodes changed.
 * Returns the block index range that needs re-conversion, or null to force
 * a full pipeline run.
 *
 * Returns null (force full) when:
 * - No previous doc cached
 * - More than 50% of nodes changed
 * - A section break falls within the dirty range
 */
export function computeDirtyRange(
  cache: IncrementalBlockCache,
  newDoc: PMNode,
  _transaction?: Transaction
): DirtyRange | null {
  const { prevDoc, nodeToBlockRange, sectionBreakIndices } = cache;

  // No previous state — must do full run
  if (!prevDoc) return null;

  const oldCount = prevDoc.childCount;
  const newCount = newDoc.childCount;

  // Find first dirty node from front (identity comparison)
  let dirtyNodeFrom = -1;
  const minCount = Math.min(oldCount, newCount);
  for (let i = 0; i < minCount; i++) {
    if (newDoc.child(i) !== prevDoc.child(i)) {
      dirtyNodeFrom = i;
      break;
    }
  }

  // If counts differ and no dirty node found from content comparison,
  // the change is at the boundary
  if (dirtyNodeFrom === -1 && oldCount !== newCount) {
    dirtyNodeFrom = minCount;
  }

  // No changes detected
  if (dirtyNodeFrom === -1) return null;

  // Find last dirty node from back
  let dirtyNodeTo = Math.max(oldCount, newCount); // exclusive
  const backLimit = Math.min(oldCount - dirtyNodeFrom, newCount - dirtyNodeFrom);
  for (let i = 1; i <= backLimit; i++) {
    if (newDoc.child(newCount - i) !== prevDoc.child(oldCount - i)) {
      break;
    }
    dirtyNodeTo = newCount - i;
  }

  // Ensure dirtyNodeTo > dirtyNodeFrom
  if (dirtyNodeTo <= dirtyNodeFrom) {
    dirtyNodeTo = dirtyNodeFrom + 1;
  }

  const dirtyNodeCount = dirtyNodeTo - dirtyNodeFrom;
  const totalNodes = Math.max(oldCount, newCount);

  // >50% changed — full run is cheaper than incremental bookkeeping
  if (dirtyNodeCount > totalNodes * 0.5) return null;

  // Map node indices to block indices
  const blockRange = nodeToBlockRange.get(dirtyNodeFrom);
  const dirtyBlockFrom = blockRange ? blockRange[0] : 0;

  // For dirtyTo, use the end of the last dirty node's block range,
  // or fall back to total blocks if node range is unknown
  let dirtyBlockTo = cache.blocks.length;
  if (dirtyNodeTo <= oldCount) {
    const endRange = nodeToBlockRange.get(dirtyNodeTo - 1);
    if (endRange) {
      dirtyBlockTo = endRange[1];
    }
  }

  // Propagate: if any section break falls in dirty range, extend to end
  for (const sbIdx of sectionBreakIndices) {
    if (sbIdx >= dirtyBlockFrom && sbIdx < dirtyBlockTo) {
      return null; // Section break in range — force full pipeline
    }
  }

  // Propagate: check if list numbering could be affected
  // If the dirty range includes list items, we may need to extend forward
  // until list counters stabilize. For now, we handle this in updateBlocks.

  return { dirtyFrom: dirtyBlockFrom, dirtyTo: dirtyBlockTo };
}

// =============================================================================
// INCREMENTAL UPDATE
// =============================================================================

/**
 * Result of an incremental block update.
 * Returned by updateBlocks — the caller must apply these to the cache
 * only after the full pipeline succeeds (to avoid split-state on stale abort).
 */
export interface IncrementalUpdateResult {
  /** The full updated blocks array (splice of old + new). */
  blocks: FlowBlock[];
  /** Updated node-to-block-range mapping. */
  nodeToBlockRange: Map<number, [number, number]>;
  /** List counter snapshots captured during conversion. */
  listCounterSnapshots: Map<number, Map<number, number[]>>;
}

/**
 * Re-convert only the dirty node range and splice results into the cached
 * blocks array. Returns an IncrementalUpdateResult — does NOT mutate the cache.
 * The caller must apply the result to the cache after the pipeline commits.
 */
export function updateBlocks(
  cache: IncrementalBlockCache,
  newDoc: PMNode,
  dirtyFrom: number,
  dirtyTo: number,
  opts: ToFlowBlocksOptions
): IncrementalUpdateResult {
  const { prevDoc, blocks: oldBlocks, nodeToBlockRange } = cache;
  if (!prevDoc) return { blocks: oldBlocks, nodeToBlockRange, listCounterSnapshots: new Map() };

  // Find which top-level node indices map to the dirty block range
  let dirtyNodeFrom = -1;
  let dirtyNodeTo = -1;
  for (const [nodeIdx, [blockStart, blockEnd]] of nodeToBlockRange) {
    if (blockStart <= dirtyFrom && blockEnd > dirtyFrom && dirtyNodeFrom === -1) {
      dirtyNodeFrom = nodeIdx;
    }
    if (blockEnd >= dirtyTo && dirtyNodeTo === -1) {
      dirtyNodeTo = nodeIdx + 1;
    }
  }

  if (dirtyNodeFrom === -1) dirtyNodeFrom = 0;
  if (dirtyNodeTo === -1) dirtyNodeTo = newDoc.childCount;

  // Restore list counters from snapshot before dirty range
  const listCounters = restoreListCounters(cache, dirtyNodeFrom);

  // Capture list counter snapshots during conversion
  const newListCounterSnapshots = new Map(cache.listCounterSnapshots);

  // Convert dirty nodes
  const newBlocks: FlowBlock[] = [];
  let pos = 0;
  for (let i = 0; i < dirtyNodeFrom && i < newDoc.childCount; i++) {
    pos += newDoc.child(i).nodeSize;
  }

  const newNodeToBlockRange = new Map(nodeToBlockRange);
  const newNodeCount = Math.min(dirtyNodeTo, newDoc.childCount);

  for (let i = dirtyNodeFrom; i < newNodeCount; i++) {
    const node = newDoc.child(i);
    const blockStartIdx = dirtyFrom + newBlocks.length;
    const converted = convertTopLevelNode(node, pos, opts, listCounters);
    newNodeToBlockRange.set(i, [blockStartIdx, blockStartIdx + converted.length]);
    for (const b of converted) {
      newBlocks.push(b);
    }
    pos += node.nodeSize;

    // Snapshot list counters after each node (Bug fix #4: populate listCounterSnapshots)
    newListCounterSnapshots.set(i, snapshotListCounters(listCounters));
  }

  // Bug fix #5: Propagate list counter changes past the dirty range.
  // If counters differ from what was cached after dirtyNodeTo-1, we need to
  // re-convert subsequent list items until counters stabilize.
  let extendedNodeTo = newNodeCount;
  const cachedPostDirtySnapshot = cache.listCounterSnapshots.get(newNodeCount - 1);
  const currentSnapshot = snapshotListCounters(listCounters);
  if (cachedPostDirtySnapshot && !listCountersEqual(currentSnapshot, cachedPostDirtySnapshot)) {
    // Counters differ — extend forward through subsequent nodes
    for (let i = extendedNodeTo; i < newDoc.childCount; i++) {
      const node = newDoc.child(i);
      const blockStartIdx = dirtyFrom + newBlocks.length;
      const converted = convertTopLevelNode(node, pos, opts, listCounters);
      newNodeToBlockRange.set(i, [blockStartIdx, blockStartIdx + converted.length]);
      for (const b of converted) {
        newBlocks.push(b);
      }
      pos += node.nodeSize;
      extendedNodeTo = i + 1;

      // Snapshot and check for convergence
      const snap = snapshotListCounters(listCounters);
      newListCounterSnapshots.set(i, snap);
      const cachedSnap = cache.listCounterSnapshots.get(i);
      if (cachedSnap && listCountersEqual(snap, cachedSnap)) {
        break; // Counters stabilized
      }
    }
  }

  // Calculate actual dirtyTo in block space accounting for extension
  const effectiveDirtyTo =
    extendedNodeTo > newNodeCount
      ? ((): number => {
          // Find the block end of the last extended node from the OLD mapping
          const lastExtRange = nodeToBlockRange.get(extendedNodeTo - 1);
          return lastExtRange ? lastExtRange[1] : dirtyTo;
        })()
      : dirtyTo;

  // Splice: replace old blocks in [dirtyFrom, effectiveDirtyTo) with newBlocks
  const result = [
    ...oldBlocks.slice(0, dirtyFrom),
    ...newBlocks,
    ...oldBlocks.slice(effectiveDirtyTo),
  ];

  // Adjust nodeToBlockRange for nodes after dirty range
  const blockDelta = newBlocks.length - (effectiveDirtyTo - dirtyFrom);
  if (blockDelta !== 0) {
    for (const [nodeIdx, [start, end]] of newNodeToBlockRange) {
      if (start >= effectiveDirtyTo) {
        newNodeToBlockRange.set(nodeIdx, [start + blockDelta, end + blockDelta]);
      }
    }
    // Reindex pmStart/pmEnd on blocks after the splice point
    if (result.length > dirtyFrom + newBlocks.length) {
      reindexPositions(result, dirtyFrom + newBlocks.length, blockDelta === 0 ? 0 : 0);
    }
  }

  // Return result WITHOUT mutating cache (Bug fix #7)
  return {
    blocks: result,
    nodeToBlockRange: newNodeToBlockRange,
    listCounterSnapshots: newListCounterSnapshots,
  };
}

// =============================================================================
// APPLY INCREMENTAL RESULT
// =============================================================================

/**
 * Apply the result of updateBlocks() to the cache.
 * Call this ONLY after the full pipeline succeeds (paint completed).
 * This prevents split-state corruption on stale aborts.
 */
export function applyIncrementalResult(
  cache: IncrementalBlockCache,
  result: IncrementalUpdateResult
): void {
  cache.blocks = result.blocks;
  cache.nodeToBlockRange = result.nodeToBlockRange;
  cache.listCounterSnapshots = result.listCounterSnapshots;
}

// =============================================================================
// STATE SAVE
// =============================================================================

/**
 * Save full pipeline state after a complete or incremental run.
 * Call this after toFlowBlocks() or updateBlocks() completes AND the
 * pipeline has successfully painted.
 */
export function saveBlockState(
  cache: IncrementalBlockCache,
  doc: PMNode,
  blocks: FlowBlock[],
  measures: Measure[]
): void {
  cache.prevDoc = doc;
  cache.blocks = blocks;
  cache.measures = measures;

  // Rebuild nodeToBlockRange, sectionBreakIndices, and list counter snapshots
  rebuildIndices(cache, doc);
  rebuildListCounterSnapshots(cache, doc, blocks);
}

/**
 * Build nodeToBlockRange and sectionBreakIndices from a doc + blocks array.
 * Also captures list counter snapshots for each node.
 */
export function rebuildIndices(cache: IncrementalBlockCache, doc: PMNode): void {
  const { blocks } = cache;
  cache.nodeToBlockRange = new Map();
  cache.sectionBreakIndices = [];
  cache.floatingAnchorIndices = new Set();

  let blockIdx = 0;

  for (let nodeIdx = 0; nodeIdx < doc.childCount; nodeIdx++) {
    const node = doc.child(nodeIdx);
    const nodeStart = getNodeStartPos(doc, nodeIdx);
    const nodeEnd = nodeStart + node.nodeSize;
    const rangeStart = blockIdx;

    // Walk blocks that belong to this node
    while (blockIdx < blocks.length) {
      const block = blocks[blockIdx];

      // SectionBreak has no pmStart — it's always emitted right after its paragraph
      if (block.kind === 'sectionBreak') {
        cache.sectionBreakIndices.push(blockIdx);
        blockIdx++;
        continue;
      }

      const bStart = 'pmStart' in block ? (block as { pmStart: number }).pmStart : -1;
      if (bStart < nodeStart) break;
      if (bStart >= nodeEnd) break;
      blockIdx++;
    }

    cache.nodeToBlockRange.set(nodeIdx, [rangeStart, blockIdx]);
  }
}

// =============================================================================
// POSITION REINDEXING
// =============================================================================

/**
 * Adjust pmStart/pmEnd on a single block and its nested content by `delta`.
 */
function shiftBlockPositions(block: FlowBlock, delta: number): void {
  if ('pmStart' in block && typeof block.pmStart === 'number') {
    (block as { pmStart: number }).pmStart += delta;
  }
  if ('pmEnd' in block && typeof block.pmEnd === 'number') {
    (block as { pmEnd: number }).pmEnd += delta;
  }

  // Shift run positions for paragraph blocks
  if (block.kind === 'paragraph' && 'runs' in block) {
    for (const run of (block as { runs: Array<{ pmStart?: number; pmEnd?: number }> }).runs) {
      if (typeof run.pmStart === 'number') run.pmStart += delta;
      if (typeof run.pmEnd === 'number') run.pmEnd += delta;
    }
  }

  // Recurse into table rows → cells → blocks → runs (Bug fix #6)
  if (block.kind === 'table' && 'rows' in block) {
    const table = block as {
      rows: Array<{
        cells: Array<{
          blocks: FlowBlock[];
          pmStart?: number;
          pmEnd?: number;
        }>;
        pmStart?: number;
        pmEnd?: number;
      }>;
    };
    for (const row of table.rows) {
      if (typeof row.pmStart === 'number') row.pmStart += delta;
      if (typeof row.pmEnd === 'number') row.pmEnd += delta;
      for (const cell of row.cells) {
        if (typeof cell.pmStart === 'number') cell.pmStart += delta;
        if (typeof cell.pmEnd === 'number') cell.pmEnd += delta;
        for (const innerBlock of cell.blocks) {
          shiftBlockPositions(innerBlock, delta);
        }
      }
    }
  }

  // Recurse into textBox content paragraphs (Bug fix #6)
  if (block.kind === 'textBox' && 'content' in block) {
    const tb = block as { content: FlowBlock[] };
    for (const innerBlock of tb.content) {
      shiftBlockPositions(innerBlock, delta);
    }
  }
}

/**
 * Adjust pmStart/pmEnd on blocks after an insertion or deletion.
 * Shifts all blocks from `fromIndex` onwards by `delta` positions.
 * Recurses into tables (rows → cells → blocks) and textBoxes (content).
 */
export function reindexPositions(blocks: FlowBlock[], fromIndex: number, delta: number): void {
  for (let i = fromIndex; i < blocks.length; i++) {
    shiftBlockPositions(blocks[i], delta);
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Restore list counters from the snapshot taken before a given node index.
 * Returns a fresh Map that can be mutated during conversion.
 */
function restoreListCounters(
  cache: IncrementalBlockCache,
  beforeNodeIndex: number
): Map<number, number[]> {
  // Find the closest snapshot before beforeNodeIndex
  const result = new Map<number, number[]>();
  if (beforeNodeIndex <= 0) return result;

  const snapshot = cache.listCounterSnapshots.get(beforeNodeIndex - 1);
  if (!snapshot) return result;

  // Deep-clone the counter arrays
  for (const [numId, counters] of snapshot) {
    result.set(numId, [...counters]);
  }
  return result;
}

/**
 * Get the document-relative start position of a top-level node by index.
 */
function getNodeStartPos(doc: PMNode, nodeIndex: number): number {
  let pos = 0;
  for (let i = 0; i < nodeIndex; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}

/**
 * Capture a deep-clone snapshot of list counters at a given point.
 */
export function snapshotListCounters(counters: Map<number, number[]>): Map<number, number[]> {
  const snapshot = new Map<number, number[]>();
  for (const [numId, arr] of counters) {
    snapshot.set(numId, [...arr]);
  }
  return snapshot;
}

/**
 * Compare two list counter snapshots for equality.
 */
function listCountersEqual(a: Map<number, number[]>, b: Map<number, number[]>): boolean {
  if (a.size !== b.size) return false;
  for (const [numId, countersA] of a) {
    const countersB = b.get(numId);
    if (!countersB) return false;
    if (countersA.length !== countersB.length) return false;
    for (let i = 0; i < countersA.length; i++) {
      if (countersA[i] !== countersB[i]) return false;
    }
  }
  return true;
}

/**
 * Rebuild list counter snapshots by replaying conversion through the doc.
 * Called during saveBlockState to populate snapshots for future incremental runs.
 * (Bug fix #4: ensures listCounterSnapshots is always populated after full runs.)
 */
function rebuildListCounterSnapshots(
  cache: IncrementalBlockCache,
  doc: PMNode,
  _blocks: FlowBlock[]
): void {
  cache.listCounterSnapshots = new Map();
  const listCounters = new Map<number, number[]>();

  for (let nodeIdx = 0; nodeIdx < doc.childCount; nodeIdx++) {
    const node = doc.child(nodeIdx);
    const pmAttrs = node.type.name === 'paragraph' ? node.attrs : null;

    if (pmAttrs && pmAttrs.numPr && !pmAttrs.listMarker) {
      const numId = pmAttrs.numPr.numId;
      if (numId != null && numId !== 0) {
        const level = pmAttrs.numPr.ilvl ?? 0;
        const counters = listCounters.get(numId) ?? new Array(9).fill(0);
        counters[level] = (counters[level] ?? 0) + 1;
        for (let i = level + 1; i < counters.length; i++) {
          counters[i] = 0;
        }
        listCounters.set(numId, counters);
      }
    }

    // Snapshot after each node
    cache.listCounterSnapshots.set(nodeIdx, snapshotListCounters(listCounters));
  }
}
