/**
 * useAutoSave Hook
 *
 * Thin React wrapper around the framework-agnostic AutoSaveManager.
 * Bridges AutoSaveManager's subscribe/getSnapshot pattern with React state.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  AutoSaveManager,
  formatLastSaveTime,
  getAutoSaveStatusLabel,
  getAutoSaveStorageSize,
  formatStorageSize,
  isAutoSaveSupported,
} from '@eigenpal/docx-core';
import type { AutoSaveStatus, SavedDocumentData } from '@eigenpal/docx-core';
import type { Document } from '@eigenpal/docx-core/types/document';

// ============================================================================
// RE-EXPORT TYPES AND UTILITIES (backwards compat)
// ============================================================================

export type { AutoSaveStatus, SavedDocumentData };
export {
  formatLastSaveTime,
  getAutoSaveStatusLabel,
  getAutoSaveStorageSize,
  formatStorageSize,
  isAutoSaveSupported,
};

// ============================================================================
// TYPES
// ============================================================================

/** Options for useAutoSave hook */
export interface UseAutoSaveOptions {
  /** Storage key for localStorage (default: 'docx-editor-autosave') */
  storageKey?: string;
  /** Save interval in milliseconds (default: 30000 - 30 seconds) */
  interval?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
  /** Maximum age of auto-save in milliseconds before it's considered stale (default: 24 hours) */
  maxAge?: number;
  /** Callback when save succeeds */
  onSave?: (timestamp: Date) => void;
  /** Callback when save fails */
  onError?: (error: Error) => void;
  /** Callback when recovery data is found */
  onRecoveryAvailable?: (savedDocument: SavedDocumentData) => void;
  /** Whether to save immediately when document changes (debounced) */
  saveOnChange?: boolean;
  /** Debounce delay for saveOnChange in milliseconds (default: 2000) */
  debounceDelay?: number;
}

/** Return value of useAutoSave hook */
export interface UseAutoSaveReturn {
  status: AutoSaveStatus;
  lastSaveTime: Date | null;
  save: () => Promise<boolean>;
  clearAutoSave: () => void;
  hasRecoveryData: boolean;
  getRecoveryData: () => SavedDocumentData | null;
  acceptRecovery: () => Document | null;
  dismissRecovery: () => void;
  isEnabled: boolean;
  enable: () => void;
  disable: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useAutoSave(
  document: Document | null | undefined,
  options: UseAutoSaveOptions = {}
): UseAutoSaveReturn {
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

  // Create the manager once (stable across renders)
  const manager = useMemo(
    () =>
      new AutoSaveManager({
        storageKey,
        interval,
        maxAge,
        saveOnChange,
        debounceDelay,
        onSave,
        onError,
        onRecoveryAvailable,
      }),
    // Only recreate if storageKey changes — callbacks are captured in the manager
    [storageKey]
  );

  // Start/stop interval based on enabled prop
  useEffect(() => {
    if (initialEnabled) {
      manager.enable();
      manager.startInterval();
    } else {
      manager.disable();
    }
  }, [manager, initialEnabled]);

  // Feed document changes to the manager
  useEffect(() => {
    manager.onDocumentChanged(document ?? null);
  }, [manager, document]);

  // Destroy on unmount
  useEffect(() => {
    return () => {
      manager.destroy();
    };
  }, [manager]);

  // Subscribe to manager state via useSyncExternalStore
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);

  // Stable callback refs
  const save = useCallback(() => manager.save(), [manager]);
  const clearAutoSave = useCallback(() => manager.clear(), [manager]);
  const getRecoveryData = useCallback(() => manager.getRecoveryData(), [manager]);
  const acceptRecovery = useCallback(() => manager.acceptRecovery(), [manager]);
  const dismissRecovery = useCallback(() => manager.dismissRecovery(), [manager]);
  const enable = useCallback(() => manager.enable(), [manager]);
  const disable = useCallback(() => manager.disable(), [manager]);

  return {
    status: snapshot.status,
    lastSaveTime: snapshot.lastSaveTime,
    save,
    clearAutoSave,
    hasRecoveryData: snapshot.hasRecoveryData,
    getRecoveryData,
    acceptRecovery,
    dismissRecovery,
    isEnabled: snapshot.isEnabled,
    enable,
    disable,
  };
}

export default useAutoSave;
