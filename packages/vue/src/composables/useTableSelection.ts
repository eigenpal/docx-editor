/**
 * useTableSelection — Vue composable wrapping TableSelectionManager from core.
 *
 * Tracks selected table cell and provides table operations.
 */

import { ref, onBeforeUnmount } from 'vue';
import {
  TableSelectionManager,
  findTableFromClick,
} from '@eigenpal/docx-core/managers/TableSelectionManager';
import type { CellCoordinates } from '@eigenpal/docx-core/managers/types';

export function useTableSelection() {
  const manager = new TableSelectionManager();
  const selectedCell = ref<CellCoordinates | null>(null);

  // Subscribe to manager changes
  const unsubscribe = manager.subscribe((snapshot) => {
    selectedCell.value = snapshot.selectedCell;
  });

  onBeforeUnmount(() => {
    unsubscribe();
  });

  function handleCellClick(tableIndex: number, rowIndex: number, columnIndex: number) {
    manager.selectCell({ tableIndex, rowIndex, columnIndex });
  }

  function handleClickTarget(target: EventTarget | null, container?: HTMLElement | null) {
    const coords = findTableFromClick(target, container);
    if (coords) {
      manager.selectCell(coords);
    } else {
      manager.clearSelection();
    }
  }

  function clearSelection() {
    manager.clearSelection();
  }

  function isCellSelected(tableIndex: number, rowIndex: number, columnIndex: number): boolean {
    return manager.isCellSelected(tableIndex, rowIndex, columnIndex);
  }

  return {
    selectedCell,
    handleCellClick,
    handleClickTarget,
    clearSelection,
    isCellSelected,
    manager,
  };
}
