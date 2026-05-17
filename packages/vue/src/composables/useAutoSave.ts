/**
 * useAutoSave — Vue composable wrapping AutoSaveManager from core.
 *
 * Persists document to localStorage with configurable interval. Tracks the
 * manager's snapshot (status, lastSaveTime, hasRecoveryData) as Vue refs so
 * UI components can react to it. Recovery detection is exposed for crash-
 * recovery UX.
 */

import { ref, onBeforeUnmount, unref, watch, type MaybeRef, type Ref } from 'vue';
import {
  AutoSaveManager,
  formatLastSaveTime,
  getAutoSaveStatusLabel,
  getAutoSaveStorageSize,
  formatStorageSize,
  isAutoSaveSupported,
} from '@eigenpal/docx-editor-core';
import type { AutoSaveStatus, SavedDocumentData } from '@eigenpal/docx-editor-core/managers/types';
import type { Document } from '@eigenpal/docx-editor-core/types/document';

export type { AutoSaveStatus, SavedDocumentData };
export {
  formatLastSaveTime,
  getAutoSaveStatusLabel,
  getAutoSaveStorageSize,
  formatStorageSize,
  isAutoSaveSupported,
};

export interface UseAutoSaveOptions {
  /** localStorage key (default: 'docx-editor-autosave') */
  storageKey?: string;
  /** Auto-save interval in ms (default: 30000) */
  interval?: number;
  /** Whether auto-save starts enabled (default: true). */
  enabled?: boolean;
  /** Maximum age of auto-save before it is considered stale. */
  maxAge?: number;
  /** Callback when save succeeds. */
  onSave?: (timestamp: Date) => void;
  /** Callback when save fails. */
  onError?: (error: Error) => void;
  /** Callback when recovery data is found. */
  onRecoveryAvailable?: (savedDocument: SavedDocumentData) => void;
  /** Whether document changes trigger a debounced save. */
  saveOnChange?: boolean;
  /** Debounce delay for saveOnChange in milliseconds. */
  debounceDelay?: number;
}

export interface UseAutoSaveReturn {
  status: Ref<AutoSaveStatus>;
  lastSaveTime: Ref<Date | null>;
  save: () => Promise<boolean>;
  clearAutoSave: () => void;
  hasRecoveryData: Ref<boolean>;
  getRecoveryData: () => SavedDocumentData | null;
  acceptRecovery: () => Document | null;
  dismissRecovery: () => void;
  isEnabled: Ref<boolean>;
  enable: () => void;
  disable: () => void;
}

export function useAutoSave(
  document: MaybeRef<Document | null | undefined>,
  options: UseAutoSaveOptions = {}
): UseAutoSaveReturn {
  const status = ref<AutoSaveStatus>('idle');
  const lastSaveTime = ref<Date | null>(null);
  const hasRecoveryData = ref(false);
  const isEnabled = ref(true);
  const {
    storageKey,
    interval,
    enabled: initialEnabled = true,
    maxAge,
    onSave,
    onError,
    onRecoveryAvailable,
    saveOnChange,
    debounceDelay,
  } = options;

  if (!isAutoSaveSupported()) {
    return {
      status,
      lastSaveTime,
      hasRecoveryData,
      isEnabled,
      save: async () => false,
      clearAutoSave: () => {},
      getRecoveryData: () => null,
      acceptRecovery: () => null,
      dismissRecovery: () => {},
      enable: () => {},
      disable: () => {},
    };
  }

  const manager = new AutoSaveManager({
    storageKey,
    interval,
    maxAge,
    saveOnChange,
    debounceDelay,
    onSave,
    onError,
    onRecoveryAvailable,
  });

  const sync = () => {
    const snapshot = manager.getSnapshot();
    status.value = snapshot.status;
    lastSaveTime.value = snapshot.lastSaveTime;
    hasRecoveryData.value = snapshot.hasRecoveryData;
    isEnabled.value = snapshot.isEnabled;
  };

  const unsubscribe = manager.subscribe(sync);
  if (initialEnabled) manager.enable();
  else manager.disable();
  sync();

  watch(
    () => unref(document),
    (doc) => manager.onDocumentChanged(doc ?? null),
    { immediate: true }
  );

  function save(): Promise<boolean> {
    return manager.save();
  }

  function clearAutoSave() {
    manager.clear();
  }

  function getRecoveryData(): SavedDocumentData | null {
    return manager.getRecoveryData();
  }

  function acceptRecovery(): Document | null {
    return manager.acceptRecovery();
  }

  function dismissRecovery() {
    manager.dismissRecovery();
  }

  function enable() {
    manager.enable();
  }

  function disable() {
    manager.disable();
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
    getRecoveryData,
    acceptRecovery,
    dismissRecovery,
    enable,
    disable,
  };
}
