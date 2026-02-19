/**
 * ImageSelectionOverlay Component
 *
 * Renders a selection overlay with resize handles over a selected image
 * in the visible pages. Handles:
 * - Blue selection border
 * - 4 corner resize handles
 * - Drag-to-resize with aspect ratio lock
 * - Dimension tooltip during resize
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

export interface ImageSelectionInfo {
  /** The DOM element of the selected image in the pages container */
  element: HTMLElement;
  /** ProseMirror position of the image node */
  pmPos: number;
  /** Current width in pixels */
  width: number;
  /** Current height in pixels */
  height: number;
}

export interface ImageSelectionOverlayProps {
  /** Info about the currently selected image, or null if no image selected */
  imageInfo: ImageSelectionInfo | null;
  /** Zoom level */
  zoom: number;
  /** Whether the editor is focused */
  isFocused: boolean;
  /** Callback when image is resized */
  onResize?: (pmPos: number, newWidth: number, newHeight: number) => void;
  /** Callback when resize starts (to prevent other interactions) */
  onResizeStart?: () => void;
  /** Callback when resize ends */
  onResizeEnd?: () => void;
  /** Callback when image drag-move completes. Receives drop clientX/clientY. */
  onDragMove?: (pmPos: number, clientX: number, clientY: number) => void;
  /** Callback when drag starts */
  onDragStart?: () => void;
  /** Callback when drag ends (cancelled or completed) */
  onDragEnd?: () => void;
}

// =============================================================================
// STYLES
// =============================================================================

const HANDLE_SIZE = 10;
const HANDLE_HALF = HANDLE_SIZE / 2;
const BORDER_WIDTH = 2;
const ACCENT_COLOR = '#2563eb'; // Blue-600

const overlayStyles: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: 'none',
  zIndex: 15,
  overflow: 'visible',
};

const borderStyles: CSSProperties = {
  position: 'absolute',
  border: `${BORDER_WIDTH}px solid ${ACCENT_COLOR}`,
  pointerEvents: 'none',
  boxSizing: 'border-box',
};

const handleBaseStyles: CSSProperties = {
  position: 'absolute',
  width: `${HANDLE_SIZE}px`,
  height: `${HANDLE_SIZE}px`,
  backgroundColor: ACCENT_COLOR,
  border: '1px solid white',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  zIndex: 16,
};

const dimensionStyles: CSSProperties = {
  position: 'absolute',
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  color: 'white',
  fontSize: '11px',
  fontFamily: 'system-ui, sans-serif',
  padding: '2px 8px',
  borderRadius: '3px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  zIndex: 20,
  transform: 'translateX(-50%)',
};

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nw-resize',
  ne: 'ne-resize',
  se: 'se-resize',
  sw: 'sw-resize',
};

// =============================================================================
// RESIZE CALCULATION
// =============================================================================

function calculateNewDimensions(
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  startWidth: number,
  startHeight: number,
  lockAspect: boolean
): { width: number; height: number } {
  const signX = handle.includes('w') ? -1 : 1;
  const signY = handle.includes('n') ? -1 : 1;

  let newWidth = startWidth + deltaX * signX;
  let newHeight = startHeight + deltaY * signY;

  if (lockAspect) {
    const scale = Math.max(newWidth / startWidth, newHeight / startHeight);
    newWidth = startWidth * scale;
    newHeight = startHeight * scale;
  }

  return {
    width: Math.max(20, Math.min(2000, newWidth)),
    height: Math.max(20, Math.min(2000, newHeight)),
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ImageSelectionOverlay({
  imageInfo,
  zoom,
  isFocused,
  onResize,
  onResizeStart,
  onResizeEnd,
  onDragMove,
  onDragStart,
  onDragEnd,
}: ImageSelectionOverlayProps): React.ReactElement | null {
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeWidth, setResizeWidth] = useState(0);
  const [resizeHeight, setResizeHeight] = useState(0);
  const [overlayRect, setOverlayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const rafRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Store callbacks in refs so imperative handlers always have latest values
  const onResizeRef = useRef(onResize);
  const onResizeStartRef = useRef(onResizeStart);
  const onResizeEndRef = useRef(onResizeEnd);
  const onDragMoveRef = useRef(onDragMove);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  onResizeRef.current = onResize;
  onResizeStartRef.current = onResizeStart;
  onResizeEndRef.current = onResizeEnd;
  onDragMoveRef.current = onDragMove;
  onDragStartRef.current = onDragStart;
  onDragEndRef.current = onDragEnd;

  // Store imageInfo and zoom in refs for the imperative mousemove/mouseup handlers
  const imageInfoRef = useRef(imageInfo);
  const zoomRef = useRef(zoom);
  imageInfoRef.current = imageInfo;
  zoomRef.current = zoom;

  // Update overlay position when imageInfo or layout changes
  const updatePosition = useCallback(() => {
    if (!imageInfo || !overlayRef.current) {
      setOverlayRect(null);
      return;
    }

    // Use the overlay's own offsetParent (the viewport div) for correct coordinates
    const parent = overlayRef.current.offsetParent as HTMLElement | null;
    if (!parent) {
      setOverlayRect(null);
      return;
    }

    const parentRect = parent.getBoundingClientRect();
    const imageRect = imageInfo.element.getBoundingClientRect();

    // Calculate position relative to the overlay's positioning parent
    setOverlayRect({
      left: (imageRect.left - parentRect.left) / zoom,
      top: (imageRect.top - parentRect.top) / zoom,
      width: imageRect.width / zoom,
      height: imageRect.height / zoom,
    });
  }, [imageInfo, zoom]);

  // Update position on mount and when dependencies change
  useEffect(() => {
    updatePosition();
  }, [updatePosition]);

  // Also update on scroll/resize
  useEffect(() => {
    if (!imageInfo) return;

    const container =
      overlayRef.current?.closest('[style*="overflow"]') ??
      overlayRef.current?.closest('.paged-editor__container');
    if (!container) return;

    const handleScrollOrResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };

    container.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [imageInfo, updatePosition]);

  // Handle resize start - registers window listeners IMMEDIATELY (not via useEffect)
  // This is critical because browser automation and fast interactions fire
  // mousedown/mousemove/mouseup synchronously before React can re-render.
  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.MouseEvent) => {
      if (!imageInfo || !overlayRect) return;

      e.preventDefault();
      e.stopPropagation();

      const startWidth = overlayRect.width;
      const startHeight = overlayRect.height;
      const startX = e.clientX;
      const startY = e.clientY;

      // Track final dimensions in local variables (no stale closure issues)
      let finalWidth = Math.round(startWidth);
      let finalHeight = Math.round(startHeight);

      setIsResizing(true);
      setResizeWidth(finalWidth);
      setResizeHeight(finalHeight);
      onResizeStartRef.current?.();

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentZoom = zoomRef.current;
        const deltaX = (moveEvent.clientX - startX) / currentZoom;
        const deltaY = (moveEvent.clientY - startY) / currentZoom;
        const lockAspect = !moveEvent.shiftKey;

        const dims = calculateNewDimensions(
          handle,
          deltaX,
          deltaY,
          startWidth,
          startHeight,
          lockAspect
        );

        finalWidth = Math.round(dims.width);
        finalHeight = Math.round(dims.height);
        setResizeWidth(finalWidth);
        setResizeHeight(finalHeight);

        // Update overlay rect for live preview
        setOverlayRect((prev) => {
          if (!prev) return prev;
          const newRect = { ...prev };
          if (handle.includes('w')) {
            newRect.left = prev.left + (prev.width - dims.width);
          }
          if (handle.includes('n')) {
            newRect.top = prev.top + (prev.height - dims.height);
          }
          newRect.width = dims.width;
          newRect.height = dims.height;
          return newRect;
        });
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        setIsResizing(false);

        // Use the locally tracked final dimensions (always up to date)
        const info = imageInfoRef.current;
        if (info) {
          onResizeRef.current?.(info.pmPos, finalWidth, finalHeight);
        }
        onResizeEndRef.current?.();
      };

      // Register listeners IMMEDIATELY - not in a useEffect
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [imageInfo, overlayRect]
  );

  // Handle drag-to-move: mousedown on image body (not a handle) starts a move drag
  const handleBodyMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!imageInfo || !overlayRect) return;

      e.preventDefault();
      e.stopPropagation();

      const DRAG_THRESHOLD = 4; // px before considering it a drag
      const startX = e.clientX;
      const startY = e.clientY;
      let dragStarted = false;
      let ghostEl: HTMLElement | null = null;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        if (!dragStarted && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) {
          return; // Haven't moved enough to start dragging
        }

        if (!dragStarted) {
          dragStarted = true;
          setIsDragging(true);
          onDragStartRef.current?.();

          // Create ghost element
          ghostEl = document.createElement('div');
          ghostEl.style.cssText =
            'position: fixed; pointer-events: none; z-index: 10000; ' +
            'opacity: 0.5; border: 2px dashed #2563eb; border-radius: 4px; ' +
            'background: rgba(37, 99, 235, 0.1);';
          ghostEl.style.width = `${overlayRect.width}px`;
          ghostEl.style.height = `${overlayRect.height}px`;
          document.body.appendChild(ghostEl);
        }

        if (ghostEl) {
          ghostEl.style.left = `${moveEvent.clientX - overlayRect.width / 2}px`;
          ghostEl.style.top = `${moveEvent.clientY - overlayRect.height / 2}px`;
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        if (ghostEl) {
          ghostEl.remove();
          ghostEl = null;
        }

        setIsDragging(false);

        if (dragStarted) {
          const info = imageInfoRef.current;
          if (info) {
            onDragMoveRef.current?.(info.pmPos, upEvent.clientX, upEvent.clientY);
          }
          onDragEndRef.current?.();
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [imageInfo, overlayRect]
  );

  // Always render the container div so the ref is available for position calculation.
  // Use visibility:hidden when not active (keeps offsetParent accessible).
  const showOverlay = !!(imageInfo && overlayRect && isFocused);

  if (!showOverlay) {
    return (
      <div
        ref={overlayRef}
        style={{ ...overlayStyles, visibility: 'hidden' }}
        className="image-selection-overlay"
      />
    );
  }

  const { left, top, width, height } = overlayRect;

  return (
    <div ref={overlayRef} style={overlayStyles} className="image-selection-overlay">
      {/* Selection border */}
      <div
        style={{
          ...borderStyles,
          left: left - BORDER_WIDTH,
          top: top - BORDER_WIDTH,
          width: width + BORDER_WIDTH * 2,
          height: height + BORDER_WIDTH * 2,
        }}
      />

      {/* Draggable body area - click and drag to move */}
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height,
          cursor: isDragging ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
          zIndex: 15,
        }}
        onMouseDown={handleBodyMouseDown}
      />

      {/* Corner resize handles */}
      <Handle
        handle="nw"
        style={{ left: left - HANDLE_HALF, top: top - HANDLE_HALF }}
        onMouseDown={handleResizeStart}
      />
      <Handle
        handle="ne"
        style={{ left: left + width - HANDLE_HALF, top: top - HANDLE_HALF }}
        onMouseDown={handleResizeStart}
      />
      <Handle
        handle="se"
        style={{ left: left + width - HANDLE_HALF, top: top + height - HANDLE_HALF }}
        onMouseDown={handleResizeStart}
      />
      <Handle
        handle="sw"
        style={{ left: left - HANDLE_HALF, top: top + height - HANDLE_HALF }}
        onMouseDown={handleResizeStart}
      />

      {/* Dimension indicator during resize */}
      {isResizing && (
        <div
          style={{
            ...dimensionStyles,
            left: left + width / 2,
            top: top + height + 12,
          }}
        >
          {resizeWidth} × {resizeHeight}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// HANDLE SUB-COMPONENT
// =============================================================================

interface HandleProps {
  handle: ResizeHandle;
  style: CSSProperties;
  onMouseDown: (handle: ResizeHandle, e: React.MouseEvent) => void;
}

function Handle({ handle, style, onMouseDown }: HandleProps): React.ReactElement {
  return (
    <div
      style={{
        ...handleBaseStyles,
        ...style,
        cursor: HANDLE_CURSORS[handle],
      }}
      onMouseDown={(e) => onMouseDown(handle, e)}
      data-handle={handle}
    />
  );
}

export default ImageSelectionOverlay;
