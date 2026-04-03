/**
 * useAutoSave — Vue composable wrapping AutoSaveManager from core.
 *
 * Persists document to localStorage with configurable interval.
 * Supports recovery detection for crash recovery.
 */

import { ref, onBeforeUnmount } from 'vue';
import {
  AutoSaveManager,
  isAutoSaveSupported,
} from '@eigenpal/docx-core/managers/AutoSaveManager';
import type { AutoSaveStatus } from '@eigenpal/docx-core/managers/types';

export interface UseAutoSaveOptions {
  /** localStorage key (default: 'docx-editor-autosave') */
  storageKey?: string;
  /** Auto-save interval in ms (default: 30000) */
  interval?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
}

export function useAutoSave(options: UseAutoSaveOptions = {}) {
  const {
    storageKey = 'docx-editor-autosave',
    interval = 30000,
    enabled = true,
  } = options;

  const status = ref<AutoSaveStatus>('idle');
  const lastSaveTime = ref<number | null>(null);
  const hasRecoveryData = ref(false);
  const isEnabled = ref(enabled);

  if (!isAutoSaveSupported()) {
    return {
      status,
      lastSaveTime,
      hasRecoveryData,
      isEnabled,
      save: () => {},
      clearAutoSave: () => {},
      acceptRecovery: () => null as string | null,
      dismissRecovery: () => {},
    };
  }

  const manager = new AutoSaveManager({
    storageKey,
    intervalMs: interval,
    enabled,
  });

  // Subscribe to state changes
  const unsubscribe = manager.subscribe((snapshot) => {
    status.value = snapshot.status;
    lastSaveTime.value = snapshot.lastSaveTime;
    hasRecoveryData.value = snapshot.hasRecoveryData;
  });

  // Sync initial state
  const initial = manager.getSnapshot();
  status.value = initial.status;
  lastSaveTime.value = initial.lastSaveTime;
  hasRecoveryData.value = initial.hasRecoveryData;

  function save(data?: string) {
    if (data !== undefined) {
      manager.saveNow(data);
    }
  }

  function clearAutoSave() {
    manager.clear();
  }

  function acceptRecovery(): string | null {
    return manager.getRecoveryData();
  }

  function dismissRecovery() {
    manager.dismissRecovery();
  }

  onBeforeUnmount(() => {
    unsubscribe();
    manager.destroy();
  });

  return {
    status,
    lastSaveTime,
    hasRecoveryData,
    isEnabled,
    save,
    clearAutoSave,
    acceptRecovery,
    dismissRecovery,
  };
}
