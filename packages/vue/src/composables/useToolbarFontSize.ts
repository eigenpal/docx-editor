/**
 * Font-size control logic for the Vue toolbar — the editable size box + the
 * −/+ steppers + the preset dropdown. Extracted from Toolbar.vue to keep that
 * file under its line budget and to isolate the (subtle) editing/commit flow.
 *
 * The `sizeTyped` guard mirrors React's FontSizePicker: only a value the user
 * actually TYPED commits on blur/Enter. Stepper/arrow actions apply directly via
 * execCommand, which re-focuses the editor and thus blurs the input — without
 * the guard that induced blur would re-read the stale DOM value and revert the
 * step (or re-commit a half-typed value over a clicked preset).
 */
import { ref, type Ref, type ComputedRef } from 'vue';
import { fontSizePresets } from '../components/Toolbar/presets';

export interface UseToolbarFontSizeReturn {
  onSizeFocus: () => void;
  onSizeInput: () => void;
  commitFontSize: (e: Event) => void;
  pickFontSize: (size: number) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
}

export function useToolbarFontSize(opts: {
  currentFontSize: ComputedRef<number>;
  openDropdown: Ref<string | null>;
  recomputeDropdownPos: (name: string) => void;
  execCommand: (name: string, ...args: unknown[]) => void;
}): UseToolbarFontSizeReturn {
  const sizeTyped = ref(false);

  // Commands expect half-points.
  const setFontSize = (sizePt: number) => opts.execCommand('setFontSize', sizePt * 2);

  // Open + position the preset list on focus (every toolbar dropdown is
  // position:fixed because the scrolling pill clips absolute children).
  function onSizeFocus() {
    sizeTyped.value = false;
    opts.openDropdown.value = 'size';
    opts.recomputeDropdownPos('size');
  }
  function onSizeInput() {
    sizeTyped.value = true;
  }

  function commitFontSize(e: Event) {
    if (sizeTyped.value) {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (!isNaN(v)) setFontSize(Math.round(Math.min(Math.max(v, 1), 1638) * 2) / 2);
    }
    sizeTyped.value = false;
    opts.openDropdown.value = null;
  }

  // Clear the guard first so the induced blur doesn't re-commit over the preset.
  function pickFontSize(size: number) {
    sizeTyped.value = false;
    setFontSize(size);
    opts.openDropdown.value = null;
  }

  // Step to the next/prev preset; ±1 beyond the list (matches React's stepper).
  function increaseFontSize() {
    const c = opts.currentFontSize.value;
    setFontSize(fontSizePresets.find((s) => s > c) || c + 1);
  }
  function decreaseFontSize() {
    const c = opts.currentFontSize.value;
    setFontSize([...fontSizePresets].reverse().find((s) => s < c) || Math.max(1, c - 1));
  }

  return {
    onSizeFocus,
    onSizeInput,
    commitFontSize,
    pickFontSize,
    increaseFontSize,
    decreaseFontSize,
  };
}
