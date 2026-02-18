/**
 * Hook for toolbar dropdowns that need position:fixed to escape overflow:auto/hidden ancestors.
 *
 * Returns refs and styles for a dropdown that positions itself below its trigger
 * using fixed coordinates (like MenuDropdown), so it isn't clipped by the toolbar's
 * overflow-x-auto container.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties, RefObject } from 'react';

interface UseFixedDropdownOptions {
  isOpen: boolean;
  onClose: () => void;
  /** 'left' aligns dropdown left edge to trigger, 'right' aligns right edge */
  align?: 'left' | 'right';
}

interface UseFixedDropdownReturn {
  containerRef: RefObject<HTMLDivElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  dropdownStyle: CSSProperties;
  handleMouseDown: (e: React.MouseEvent) => void;
}

export function useFixedDropdown({
  isOpen,
  onClose,
  align = 'left',
}: UseFixedDropdownOptions): UseFixedDropdownReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Calculate position when opening
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (align === 'right') {
      // We need the dropdown width to right-align, but it's not rendered yet.
      // Use a rAF to measure after first paint.
      requestAnimationFrame(() => {
        if (dropdownRef.current) {
          const dropRect = dropdownRef.current.getBoundingClientRect();
          setPos({ top: rect.bottom + 4, left: rect.right - dropRect.width });
        } else {
          setPos({ top: rect.bottom + 4, left: rect.left });
        }
      });
    } else {
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [isOpen, align]);

  // Close on outside click, escape, scroll
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, onClose]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const dropdownStyle: CSSProperties = {
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    zIndex: 10000,
  };

  return { containerRef, dropdownRef, dropdownStyle, handleMouseDown };
}
