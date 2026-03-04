/**
 * AutoSaveManager
 *
 * Framework-agnostic class for auto-saving documents to localStorage.
 * Extracted from the React `useAutoSave` hook.
 *
 * Usage with React:
 * ```ts
 * const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
 * ```
 */

import { Subscribable } from './Subscribable';
import type {
  AutoSaveSnapshot,
  AutoSaveStatus,
  AutoSaveManagerOptions,
  SavedDocumentData,
} from './types';
import type { Document } from '../types/document';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_STORAGE_KEY = 'docx-editor-autosave';
const DEFAULT_INTERVAL = 30000; // 30 seconds
const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_DEBOUNCE_DELAY = 2000; // 2 seconds
const SAVE_VERSION = 1;

// ============================================================================
// HELPERS
// ============================================================================

function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__docx_editor_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function serializeForStorage(document: Document): string {
  return JSON.stringify({ ...document, originalBuffer: null });
}

function parseSavedData(json: string): SavedDocumentData | null {
  try {
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object') return null;
    if (!data.document || !data.savedAt) return null;
    if (data.version !== SAVE_VERSION) {
      console.warn('Auto-save data version mismatch, may need migration');
    }
    return data as SavedDocumentData;
  } catch {
    return null;
  }
}

function isStale(savedAt: string, maxAge: number): boolean {
  const savedTime = new Date(savedAt).getTime();
  return Date.now() - savedTime > maxAge;
}

// ============================================================================
// MANAGER
// ============================================================================

export class AutoSaveManager extends Subscribable<AutoSaveSnapshot> {
  private storageKey: string;
  private interval: number;
  private maxAge: number;
  private saveOnChange: boolean;
  private debounceDelay: number;
  private onSaveCallback?: (timestamp: Date) => void;
  private onErrorCallback?: (error: Error) => void;
  private onRecoveryAvailableCallback?: (saved: SavedDocumentData) => void;

  private storageAvailable: boolean;
  private currentDocument: Document | null = null;
  private lastSavedJson: string | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private status: AutoSaveStatus = 'idle';
  private lastSaveTime: Date | null = null;
  private _hasRecoveryData = false;
  private _isEnabled: boolean;

  constructor(options: AutoSaveManagerOptions = {}) {
    super({
      status: 'idle',
      lastSaveTime: null,
      hasRecoveryData: false,
      isEnabled: true,
    });

    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.interval = options.interval ?? DEFAULT_INTERVAL;
    this.maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
    this.saveOnChange = options.saveOnChange ?? true;
    this.debounceDelay = options.debounceDelay ?? DEFAULT_DEBOUNCE_DELAY;
    this.onSaveCallback = options.onSave;
    this.onErrorCallback = options.onError;
    this.onRecoveryAvailableCallback = options.onRecoveryAvailable;
    this._isEnabled = true;
    this.storageAvailable = isLocalStorageAvailable();

    // Check for recovery data
    this.checkRecoveryData();
  }

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  /** Update the current document. Triggers debounced save if enabled. */
  onDocumentChanged(document: Document | null): void {
    this.currentDocument = document;

    if (this._isEnabled && this.saveOnChange && document && this.storageAvailable) {
      this.debounceSave();
    }
  }

  /** Manually trigger a save. */
  async save(): Promise<boolean> {
    if (!this.storageAvailable) {
      this.onErrorCallback?.(new Error('localStorage is not available'));
      return false;
    }

    const doc = this.currentDocument;
    if (!doc) return false;

    this.updateStatus('saving');

    try {
      const serialized = serializeForStorage(doc);

      // Skip if unchanged
      if (serialized === this.lastSavedJson) {
        this.updateStatus('saved');
        return true;
      }

      this.persistToStorage(serialized);
      this.lastSavedJson = serialized;

      const saveTime = new Date();
      this.lastSaveTime = saveTime;
      this.updateStatus('saved');
      this.onSaveCallback?.(saveTime);
      return true;
    } catch (error) {
      console.error('Auto-save failed:', error);
      this.updateStatus('error');
      this.onErrorCallback?.(error as Error);
      return false;
    }
  }

  /** Clear auto-saved data from storage. */
  clear(): void {
    if (!this.storageAvailable) return;
    try {
      localStorage.removeItem(this.storageKey);
      this._hasRecoveryData = false;
      this.lastSavedJson = null;
      this.emitSnapshot();
    } catch (error) {
      console.error('Failed to clear auto-save:', error);
    }
  }

  /** Get recovery data from storage. */
  getRecoveryData(): SavedDocumentData | null {
    if (!this.storageAvailable) return null;
    try {
      const savedJson = localStorage.getItem(this.storageKey);
      if (!savedJson) return null;

      const savedData = parseSavedData(savedJson);
      if (!savedData) return null;

      if (isStale(savedData.savedAt, this.maxAge)) {
        this.clear();
        return null;
      }
      return savedData;
    } catch {
      return null;
    }
  }

  /** Accept recovery and return the document. */
  acceptRecovery(): Document | null {
    const data = this.getRecoveryData();
    if (!data) return null;
    this._hasRecoveryData = false;
    this.emitSnapshot();
    return data.document;
  }

  /** Dismiss recovery and clear saved data. */
  dismissRecovery(): void {
    this.clear();
    this._hasRecoveryData = false;
    this.emitSnapshot();
  }

  /** Enable auto-save and start the interval timer. */
  enable(): void {
    this._isEnabled = true;
    this.startInterval();
    this.emitSnapshot();
  }

  /** Disable auto-save and stop all timers. */
  disable(): void {
    this._isEnabled = false;
    this.stopTimers();
    this.emitSnapshot();
  }

  /** Start the interval timer. Call after enabling or on init. */
  startInterval(): void {
    this.stopTimers();
    if (!this._isEnabled || !this.storageAvailable) return;

    this.intervalTimer = setInterval(() => {
      this.save();
    }, this.interval);
  }

  /** Save synchronously on destroy (best-effort). */
  destroy(): void {
    this.stopTimers();

    if (this._isEnabled && this.currentDocument && this.storageAvailable) {
      try {
        this.persistToStorage(serializeForStorage(this.currentDocument));
      } catch (error) {
        console.error('Failed to save on destroy:', error);
      }
    }
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private checkRecoveryData(): void {
    if (!this.storageAvailable) return;
    const data = this.getRecoveryData();
    if (data) {
      this._hasRecoveryData = true;
      this.emitSnapshot();
      this.onRecoveryAvailableCallback?.(data);
    }
  }

  private persistToStorage(serialized: string): void {
    const dataToSave: SavedDocumentData = {
      document: JSON.parse(serialized),
      savedAt: new Date().toISOString(),
      version: SAVE_VERSION,
    };
    localStorage.setItem(this.storageKey, JSON.stringify(dataToSave));
  }

  private debounceSave(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.save();
    }, this.debounceDelay);
  }

  private stopTimers(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private updateStatus(status: AutoSaveStatus): void {
    this.status = status;
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.setSnapshot({
      status: this.status,
      lastSaveTime: this.lastSaveTime,
      hasRecoveryData: this._hasRecoveryData,
      isEnabled: this._isEnabled,
    });
  }
}

// ============================================================================
// UTILITY FUNCTIONS (re-exported as-is from the old hook)
// ============================================================================

/** Format last save time for display */
export function formatLastSaveTime(date: Date | null): string {
  if (!date) return 'Never';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec} seconds ago`;
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;

  return date.toLocaleDateString();
}

/** Get auto-save status label */
export function getAutoSaveStatusLabel(status: AutoSaveStatus): string {
  const labels: Record<AutoSaveStatus, string> = {
    idle: 'Ready',
    saving: 'Saving...',
    saved: 'Saved',
    error: 'Save failed',
  };
  return labels[status];
}

/** Get storage size used by auto-save */
export function getAutoSaveStorageSize(storageKey: string = DEFAULT_STORAGE_KEY): number {
  try {
    const data = localStorage.getItem(storageKey);
    if (!data) return 0;
    return new Blob([data]).size;
  } catch {
    return 0;
  }
}

/** Format storage size for display */
export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Check if auto-save is supported */
export function isAutoSaveSupported(): boolean {
  return isLocalStorageAvailable();
}
