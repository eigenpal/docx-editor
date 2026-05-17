/**
 * Vue port of packages/react/src/components/ui/useFixedDropdown.ts.
 *
 * Provides refs + computed style for a dropdown that escapes
 * overflow:hidden ancestors by positioning itself with `position:
 * fixed` directly under its trigger button. Same close-on-outside-
 * click / escape / scroll behaviour as the React hook.
 */
import { ref, watch, type Ref, type CSSProperties, onBeforeUnmount } from 'vue';

export interface UseFixedDropdownOptions {
  isOpen: Ref<boolean>;
  onClose: () => void;
  /** 'left' aligns dropdown left edge to trigger, 'right' aligns right edge. */
  align?: 'left' | 'right';
}

export interface UseFixedDropdownReturn {
  containerRef: Ref<HTMLElement | null>;
  dropdownRef: Ref<HTMLElement | null>;
  dropdownStyle: Ref<CSSProperties>;
  handleMouseDown: (e: MouseEvent) => void;
}

export function useFixedDropdown({
  isOpen,
  onClose,
  align = 'left',
}: UseFixedDropdownOptions): UseFixedDropdownReturn {
  const containerRef = ref<HTMLElement | null>(null);
  const dropdownRef = ref<HTMLElement | null>(null);
  const dropdownStyle = ref<CSSProperties>({
    position: 'fixed',
    top: '0px',
    left: '0px',
    zIndex: 10000,
  });

  function setPos(top: number, left: number) {
    dropdownStyle.value = {
      position: 'fixed',
      top: top + 'px',
      left: left + 'px',
      zIndex: 10000,
    };
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (
      containerRef.value &&
      !containerRef.value.contains(target) &&
      dropdownRef.value &&
      !dropdownRef.value.contains(target)
    ) {
      onClose();
    }
  }
  function handleEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
  function handleScroll() {
    onClose();
  }

  function attach() {
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);
  }
  function detach() {
    document.removeEventListener('mousedown', handleClickOutside);
    document.removeEventListener('keydown', handleEscape);
    window.removeEventListener('scroll', handleScroll, true);
  }

  watch(isOpen, (open) => {
    if (!open) {
      detach();
      return;
    }
    const c = containerRef.value;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    if (align === 'right') {
      requestAnimationFrame(() => {
        const d = dropdownRef.value;
        if (d) {
          const dr = d.getBoundingClientRect();
          setPos(rect.bottom + 4, rect.right - dr.width);
        } else {
          setPos(rect.bottom + 4, rect.left);
        }
      });
    } else {
      setPos(rect.bottom + 4, rect.left);
    }
    attach();
  });

  onBeforeUnmount(detach);

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  return { containerRef, dropdownRef, dropdownStyle, handleMouseDown };
}
