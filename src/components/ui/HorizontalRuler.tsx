/**
 * HorizontalRuler Component — Google Docs style
 *
 * 3 handles only:
 * - Left side: first-line indent (▼ down at top) + left indent (▲ up at bottom)
 * - Right side: right indent (▼ down at top)
 *
 * Margins shown as gray zones on the ruler edges.
 * Drag the boundary between gray/white to adjust page margins.
 * Drag tooltip shows value during any drag.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { SectionProperties, TabStop } from '../../types/document';
import { twipsToPixels, pixelsToTwips, formatPx } from '../../utils/units';

// ============================================================================
// TYPES
// ============================================================================

export interface HorizontalRulerProps {
  sectionProps?: SectionProperties | null;
  zoom?: number;
  editable?: boolean;
  onLeftMarginChange?: (marginTwips: number) => void;
  onRightMarginChange?: (marginTwips: number) => void;
  onFirstLineIndentChange?: (indentTwips: number) => void;
  showFirstLineIndent?: boolean;
  firstLineIndent?: number;
  hangingIndent?: boolean;
  indentLeft?: number;
  indentRight?: number;
  onIndentLeftChange?: (indentTwips: number) => void;
  onIndentRightChange?: (indentTwips: number) => void;
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
  tabStops?: TabStop[] | null;
  onTabStopRemove?: (positionTwips: number) => void;
}

type MarkerType = 'leftMargin' | 'rightMargin' | 'firstLineIndent' | 'leftIndent' | 'rightIndent';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PAGE_WIDTH_TWIPS = 12240;
const DEFAULT_MARGIN_TWIPS = 1440;
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;

const RULER_HEIGHT = 22;
const RULER_TEXT_COLOR = 'var(--doc-text-muted)';
const RULER_TICK_COLOR = 'var(--doc-text-subtle)';
const MARGIN_ZONE_COLOR = 'rgba(0, 0, 0, 0.06)';
const INDENT_COLOR = '#4285f4';
const INDENT_HOVER_COLOR = '#3367d6';
const INDENT_ACTIVE_COLOR = '#2a56c6';

const TRI_SIZE = 5; // triangle half-width in px

// ============================================================================
// HELPERS
// ============================================================================

function formatValueForTooltip(twips: number, unit: 'inch' | 'cm'): string {
  if (unit === 'inch') {
    return (twips / TWIPS_PER_INCH).toFixed(2) + '"';
  }
  return (twips / TWIPS_PER_CM).toFixed(1) + ' cm';
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function HorizontalRuler({
  sectionProps,
  zoom = 1,
  editable = false,
  onLeftMarginChange,
  onRightMarginChange,
  onFirstLineIndentChange,
  showFirstLineIndent = false,
  firstLineIndent = 0,
  hangingIndent = false,
  indentLeft = 0,
  indentRight = 0,
  onIndentLeftChange,
  onIndentRightChange,
  unit = 'inch',
  className = '',
  style,
  tabStops,
  onTabStopRemove,
}: HorizontalRulerProps): React.ReactElement {
  const [dragging, setDragging] = useState<MarkerType | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<MarkerType | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [dragPositionPx, setDragPositionPx] = useState<number | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  // Page dimensions
  const pageWidthTwips = sectionProps?.pageWidth ?? DEFAULT_PAGE_WIDTH_TWIPS;
  const leftMarginTwips = sectionProps?.marginLeft ?? DEFAULT_MARGIN_TWIPS;
  const rightMarginTwips = sectionProps?.marginRight ?? DEFAULT_MARGIN_TWIPS;
  const contentTwips = pageWidthTwips - leftMarginTwips - rightMarginTwips;

  // Pixel conversions
  const pageWidthPx = twipsToPixels(pageWidthTwips) * zoom;
  const leftMarginPx = twipsToPixels(leftMarginTwips) * zoom;
  const rightMarginPx = twipsToPixels(rightMarginTwips) * zoom;
  const indentLeftPx = twipsToPixels(indentLeft) * zoom;
  const indentRightPx = twipsToPixels(indentRight) * zoom;

  // First line indent: hanging goes left, normal goes right
  const effectiveFirstLineIndent = hangingIndent ? -firstLineIndent : firstLineIndent;
  const firstLineIndentPx = twipsToPixels(effectiveFirstLineIndent) * zoom;

  // Handle positions (in px from ruler left edge)
  const leftIndentPosPx = leftMarginPx + indentLeftPx;
  const rightIndentPosPx = pageWidthPx - rightMarginPx - indentRightPx;
  const firstLinePosPx = leftMarginPx + indentLeftPx + firstLineIndentPx;

  const handleDragStart = useCallback(
    (e: React.MouseEvent, marker: MarkerType) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(marker);
    },
    [editable]
  );

  const handleDrag = useCallback(
    (e: MouseEvent) => {
      if (!dragging || !rulerRef.current) return;

      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setDragPositionPx(x);
      const positionTwips = pixelsToTwips(x / zoom);

      if (dragging === 'leftMargin') {
        const maxMargin = pageWidthTwips - rightMarginTwips - 720;
        const rounded = Math.round(Math.max(0, Math.min(positionTwips, maxMargin)));
        setDragValue(rounded);
        onLeftMarginChange?.(rounded);
      } else if (dragging === 'rightMargin') {
        const fromRight = pageWidthTwips - positionTwips;
        const maxMargin = pageWidthTwips - leftMarginTwips - 720;
        const rounded = Math.round(Math.max(0, Math.min(fromRight, maxMargin)));
        setDragValue(rounded);
        onRightMarginChange?.(rounded);
      } else if (dragging === 'firstLineIndent') {
        const base = leftMarginTwips + indentLeft;
        const indentFromBase = positionTwips - base;
        const maxIndent = contentTwips - indentLeft - indentRight - 720;
        const rounded = Math.round(Math.max(-indentLeft, Math.min(indentFromBase, maxIndent)));
        setDragValue(rounded);
        onFirstLineIndentChange?.(rounded);
      } else if (dragging === 'leftIndent') {
        const indentFromMargin = positionTwips - leftMarginTwips;
        const maxIndent = contentTwips - indentRight - 720;
        const rounded = Math.round(Math.max(0, Math.min(indentFromMargin, maxIndent)));
        setDragValue(rounded);
        onIndentLeftChange?.(rounded);
      } else if (dragging === 'rightIndent') {
        const rightEdge = pageWidthTwips - rightMarginTwips;
        const indentFromRight = rightEdge - positionTwips;
        const maxIndent = contentTwips - indentLeft - 720;
        const rounded = Math.round(Math.max(0, Math.min(indentFromRight, maxIndent)));
        setDragValue(rounded);
        onIndentRightChange?.(rounded);
      }
    },
    [
      dragging,
      zoom,
      pageWidthTwips,
      leftMarginTwips,
      rightMarginTwips,
      contentTwips,
      indentLeft,
      indentRight,
      onLeftMarginChange,
      onRightMarginChange,
      onFirstLineIndentChange,
      onIndentLeftChange,
      onIndentRightChange,
    ]
  );

  const handleDragEnd = useCallback(() => {
    setDragging(null);
    setDragValue(null);
    setDragPositionPx(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      document.addEventListener('mousemove', handleDrag);
      document.addEventListener('mouseup', handleDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [dragging, handleDrag, handleDragEnd]);

  const ticks = generateTicks(pageWidthTwips, zoom, unit);

  return (
    <div
      ref={rulerRef}
      className={`docx-horizontal-ruler ${className}`}
      style={{
        position: 'relative',
        width: formatPx(pageWidthPx),
        height: RULER_HEIGHT,
        backgroundColor: 'transparent',
        overflow: 'visible',
        userSelect: 'none',
        cursor: dragging ? 'ew-resize' : 'default',
        ...style,
      }}
      role="slider"
      aria-label="Horizontal ruler"
      aria-valuemin={0}
      aria-valuemax={pageWidthTwips}
    >
      {/* Gray margin zones — click & drag anywhere in the gray area to adjust margin */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: formatPx(leftMarginPx),
          height: RULER_HEIGHT,
          backgroundColor: MARGIN_ZONE_COLOR,
          borderRight: '1px solid rgba(0,0,0,0.12)',
          cursor: editable ? 'ew-resize' : 'default',
          zIndex: 1,
        }}
        onMouseDown={
          editable && onLeftMarginChange ? (e) => handleDragStart(e, 'leftMargin') : undefined
        }
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: formatPx(rightMarginPx),
          height: RULER_HEIGHT,
          backgroundColor: MARGIN_ZONE_COLOR,
          borderLeft: '1px solid rgba(0,0,0,0.12)',
          cursor: editable ? 'ew-resize' : 'default',
          zIndex: 1,
        }}
        onMouseDown={
          editable && onRightMarginChange ? (e) => handleDragStart(e, 'rightMargin') : undefined
        }
      />

      {/* Tick marks */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {ticks.map((tick, i) => (
          <RulerTick key={i} tick={tick} />
        ))}
      </div>

      {/* === 3 INDENT HANDLES (Google Docs style) === */}

      {/* First-line indent — ▼ down triangle at top-left */}
      {showFirstLineIndent && (
        <IndentTriangle
          direction="down"
          positionPx={firstLinePosPx}
          editable={editable}
          isDragging={dragging === 'firstLineIndent'}
          isHovered={hoveredMarker === 'firstLineIndent'}
          onMouseEnter={() => setHoveredMarker('firstLineIndent')}
          onMouseLeave={() => setHoveredMarker(null)}
          onMouseDown={(e) => handleDragStart(e, 'firstLineIndent')}
          label="First line indent"
        />
      )}

      {/* Left indent — ▲ up triangle at bottom-left */}
      {editable && onIndentLeftChange && (
        <IndentTriangle
          direction="up"
          positionPx={leftIndentPosPx}
          editable={editable}
          isDragging={dragging === 'leftIndent'}
          isHovered={hoveredMarker === 'leftIndent'}
          onMouseEnter={() => setHoveredMarker('leftIndent')}
          onMouseLeave={() => setHoveredMarker(null)}
          onMouseDown={(e) => handleDragStart(e, 'leftIndent')}
          label="Left indent"
        />
      )}

      {/* Right indent — ▼ down triangle at top-right */}
      {editable && onIndentRightChange && (
        <IndentTriangle
          direction="down"
          positionPx={rightIndentPosPx}
          editable={editable}
          isDragging={dragging === 'rightIndent'}
          isHovered={hoveredMarker === 'rightIndent'}
          onMouseEnter={() => setHoveredMarker('rightIndent')}
          onMouseLeave={() => setHoveredMarker(null)}
          onMouseDown={(e) => handleDragStart(e, 'rightIndent')}
          label="Right indent"
        />
      )}

      {/* Tab stop markers (display only) */}
      {tabStops?.map((tab) => (
        <TabStopMarker
          key={tab.position}
          tabStop={tab}
          positionPx={twipsToPixels(tab.position) * zoom}
          onDoubleClick={() => onTabStopRemove?.(tab.position)}
        />
      ))}

      {/* Drag tooltip */}
      {dragging && dragValue !== null && dragPositionPx !== null && (
        <DragTooltip value={formatValueForTooltip(dragValue, unit)} positionPx={dragPositionPx} />
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface TickData {
  position: number;
  height: number;
  label?: string;
}

function RulerTick({ tick }: { tick: TickData }): React.ReactElement {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: formatPx(tick.position),
          bottom: 0,
          width: 1,
          height: tick.height,
          backgroundColor: RULER_TICK_COLOR,
        }}
      />
      {tick.label && (
        <div
          style={{
            position: 'absolute',
            left: formatPx(tick.position),
            top: 3,
            transform: 'translateX(-50%)',
            fontSize: '9px',
            color: RULER_TEXT_COLOR,
            fontFamily: 'sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {tick.label}
        </div>
      )}
    </>
  );
}

/**
 * Indent triangle handle — Google Docs style.
 * direction="down": ▼ anchored at top (first-line indent, right indent)
 * direction="up":   ▲ anchored at bottom (left indent)
 */
interface IndentTriangleProps {
  direction: 'up' | 'down';
  positionPx: number;
  editable: boolean;
  isDragging: boolean;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  label: string;
}

function IndentTriangle({
  direction,
  positionPx,
  editable,
  isDragging,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  label,
}: IndentTriangleProps): React.ReactElement {
  const color = isDragging ? INDENT_ACTIVE_COLOR : isHovered ? INDENT_HOVER_COLOR : INDENT_COLOR;
  const triHeight = Math.round(TRI_SIZE * 1.6);

  const containerStyle: CSSProperties = {
    position: 'absolute',
    left: formatPx(positionPx - TRI_SIZE),
    width: TRI_SIZE * 2,
    height: triHeight + 2,
    cursor: editable ? 'ew-resize' : 'default',
    zIndex: isDragging ? 10 : 4,
    ...(direction === 'down' ? { top: 0 } : { bottom: 0 }),
  };

  const triangleStyle: CSSProperties =
    direction === 'down'
      ? {
          position: 'absolute',
          top: 1,
          left: 0,
          width: 0,
          height: 0,
          borderLeft: `${TRI_SIZE}px solid transparent`,
          borderRight: `${TRI_SIZE}px solid transparent`,
          borderTop: `${triHeight}px solid ${color}`,
          transition: 'border-top-color 0.1s',
        }
      : {
          position: 'absolute',
          bottom: 1,
          left: 0,
          width: 0,
          height: 0,
          borderLeft: `${TRI_SIZE}px solid transparent`,
          borderRight: `${TRI_SIZE}px solid transparent`,
          borderBottom: `${triHeight}px solid ${color}`,
          transition: 'border-bottom-color 0.1s',
        };

  return (
    <div
      className="docx-ruler-indent"
      style={containerStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
      role="slider"
      aria-label={label}
      aria-orientation="horizontal"
      tabIndex={editable ? 0 : -1}
    >
      <div style={triangleStyle} />
    </div>
  );
}

function DragTooltip({
  value,
  positionPx,
}: {
  value: string;
  positionPx: number;
}): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: formatPx(positionPx),
        top: -22,
        transform: 'translateX(-50%)',
        backgroundColor: '#333',
        color: '#fff',
        fontSize: '10px',
        fontFamily: 'sans-serif',
        padding: '2px 6px',
        borderRadius: 3,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {value}
    </div>
  );
}

interface TabStopMarkerProps {
  tabStop: TabStop;
  positionPx: number;
  onDoubleClick: () => void;
}

const TAB_SYMBOLS: Record<string, string> = {
  left: 'L',
  center: 'C',
  right: 'R',
  decimal: 'D',
  bar: '|',
};

function TabStopMarker({
  tabStop,
  positionPx,
  onDoubleClick,
}: TabStopMarkerProps): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: formatPx(positionPx - 5),
        bottom: 0,
        width: 10,
        height: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 8,
        fontWeight: 700,
        color: '#555',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      title={`${tabStop.alignment} tab at ${(tabStop.position / 1440).toFixed(2)}"`}
    >
      {TAB_SYMBOLS[tabStop.alignment] || 'L'}
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateTicks(pageWidthTwips: number, zoom: number, unit: 'inch' | 'cm'): TickData[] {
  const ticks: TickData[] = [];

  if (unit === 'inch') {
    const eighthInchTwips = TWIPS_PER_INCH / 8;
    const totalEighths = Math.ceil(pageWidthTwips / eighthInchTwips);
    for (let i = 0; i <= totalEighths; i++) {
      const twipsPos = i * eighthInchTwips;
      if (twipsPos > pageWidthTwips) break;
      const pxPos = twipsToPixels(twipsPos) * zoom;
      if (i % 8 === 0) {
        ticks.push({ position: pxPos, height: 10, label: i / 8 > 0 ? String(i / 8) : undefined });
      } else if (i % 4 === 0) {
        ticks.push({ position: pxPos, height: 6 });
      } else if (i % 2 === 0) {
        ticks.push({ position: pxPos, height: 4 });
      } else {
        ticks.push({ position: pxPos, height: 2 });
      }
    }
  } else {
    const mmTwips = TWIPS_PER_CM / 10;
    const totalMm = Math.ceil(pageWidthTwips / mmTwips);
    for (let i = 0; i <= totalMm; i++) {
      const twipsPos = i * mmTwips;
      if (twipsPos > pageWidthTwips) break;
      const pxPos = twipsToPixels(twipsPos) * zoom;
      if (i % 10 === 0) {
        ticks.push({ position: pxPos, height: 10, label: i / 10 > 0 ? String(i / 10) : undefined });
      } else if (i % 5 === 0) {
        ticks.push({ position: pxPos, height: 6 });
      } else {
        ticks.push({ position: pxPos, height: 3 });
      }
    }
  }

  return ticks;
}

export function positionToMargin(
  positionPx: number,
  side: 'left' | 'right',
  pageWidthPx: number,
  zoom: number
): number {
  const positionTwips = pixelsToTwips(positionPx / zoom);
  if (side === 'left') return Math.max(0, positionTwips);
  return Math.max(0, pixelsToTwips(pageWidthPx / zoom) - positionTwips);
}

export function getRulerDimensions(
  sectionProps?: SectionProperties | null,
  zoom: number = 1
): { width: number; leftMargin: number; rightMargin: number; contentWidth: number } {
  const pw = sectionProps?.pageWidth ?? DEFAULT_PAGE_WIDTH_TWIPS;
  const lm = sectionProps?.marginLeft ?? DEFAULT_MARGIN_TWIPS;
  const rm = sectionProps?.marginRight ?? DEFAULT_MARGIN_TWIPS;
  const width = twipsToPixels(pw) * zoom;
  const leftMargin = twipsToPixels(lm) * zoom;
  const rightMargin = twipsToPixels(rm) * zoom;
  return { width, leftMargin, rightMargin, contentWidth: width - leftMargin - rightMargin };
}

export function getMarginInUnits(marginTwips: number, unit: 'inch' | 'cm'): string {
  return unit === 'inch'
    ? (marginTwips / TWIPS_PER_INCH).toFixed(2) + '"'
    : (marginTwips / TWIPS_PER_CM).toFixed(1) + ' cm';
}

export function parseMarginFromUnits(value: string, unit: 'inch' | 'cm'): number | null {
  const num = parseFloat(value.replace(/[^\d.]/g, ''));
  if (isNaN(num)) return null;
  return Math.round(num * (unit === 'inch' ? TWIPS_PER_INCH : TWIPS_PER_CM));
}

export default HorizontalRuler;
