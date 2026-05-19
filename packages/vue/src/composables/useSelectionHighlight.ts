/**
 * Vue port of packages/react/src/hooks/useSelectionHighlight.ts.
 * Wraps the framework-agnostic selection helpers in core. Same
 * debounce semantics (16ms default), same overlay rect calculation,
 * same selection-within-container detection.
 */
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  type Ref,
  type ComputedRef,
  type CSSProperties,
} from 'vue';
import {
  type HighlightRect,
  type SelectionHighlightConfig,
  DEFAULT_SELECTION_STYLE,
  getMergedSelectionGeometry,
  hasActiveSelection,
  getSelectedText,
  isSelectionWithin,
  injectSelectionStyles,
  areSelectionStylesInjected,
} from '@eigenpal/docx-editor-core/utils';

export interface UseSelectionHighlightOptions {
  containerRef: Ref<HTMLElement | null>;
  enabled?: boolean;
  config?: SelectionHighlightConfig;
  useOverlay?: boolean;
  debounceMs?: number;
  onSelectionChange?: (hasSelection: boolean, text: string) => void;
}

export interface UseSelectionHighlightReturn {
  hasSelection: ComputedRef<boolean>;
  selectedText: ComputedRef<string>;
  highlightRects: ComputedRef<HighlightRect[]>;
  isSelectionInContainer: ComputedRef<boolean>;
  refresh: () => void;
  getOverlayStyle: (rect: HighlightRect) => CSSProperties;
}

export function useSelectionHighlight(
  options: UseSelectionHighlightOptions
): UseSelectionHighlightReturn {
  const {
    containerRef,
    enabled = true,
    config = DEFAULT_SELECTION_STYLE,
    useOverlay = false,
    debounceMs = 16,
    onSelectionChange,
  } = options;

  const hasSelectionState = ref(false);
  const selectedText = ref('');
  const highlightRects = ref<HighlightRect[]>([]);
  const isSelectionInContainer = ref(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastUpdate = 0;

  function update() {
    const container = containerRef.value;
    const active = hasActiveSelection();
    const text = getSelectedText();
    const inContainer = container ? isSelectionWithin(container) : false;
    hasSelectionState.value = active;
    selectedText.value = text;
    isSelectionInContainer.value = inContainer;
    highlightRects.value =
      useOverlay && inContainer && container ? getMergedSelectionGeometry(container) : [];
    onSelectionChange?.(active && inContainer, text);
  }

  function refresh() {
    update();
  }

  function debouncedUpdate() {
    const now = performance.now();
    if (now - lastUpdate < debounceMs) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        lastUpdate = performance.now();
        update();
        debounceTimer = null;
      }, debounceMs);
      return;
    }
    lastUpdate = now;
    update();
  }

  function getOverlayStyle(rect: HighlightRect): CSSProperties {
    return {
      position: 'absolute',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      backgroundColor: config.backgroundColor,
      borderRadius: config.borderRadius ? config.borderRadius + 'px' : undefined,
      border: config.borderColor ? `1px solid ${config.borderColor}` : undefined,
      zIndex: config.zIndex ?? 0,
      pointerEvents: 'none',
    };
  }

  onMounted(() => {
    if (!enabled) return;
    if (!areSelectionStylesInjected()) injectSelectionStyles(config);
    document.addEventListener('selectionchange', debouncedUpdate);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('selectionchange', debouncedUpdate);
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  watch(containerRef, () => update());

  return {
    hasSelection: computed(() => hasSelectionState.value),
    selectedText: computed(() => selectedText.value),
    highlightRects: computed(() => highlightRects.value),
    isSelectionInContainer: computed(() => isSelectionInContainer.value),
    refresh,
    getOverlayStyle,
  };
}
