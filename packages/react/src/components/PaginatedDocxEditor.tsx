// A React host for the engine-owned paginated surface (task 11.1).
//
// THIN, deliberately. The host owns three things and nothing else: a container element, the
// surface's lifetime, and the translation of engine state into React state. Every editing
// decision — what a key does, where the caret goes, what a selection means — belongs to the
// engine, so that React and Vue cannot drift into two behaviours.
//
// The measurer is injected rather than chosen here: which font bytes a document is measured
// and painted with is a packaging decision, and baking one in would make the adapter the
// place fidelity is decided.
//
// The engine is reached through its COMPOSITION ROOT only. An adapter that imported the
// layout lane for a parameter type would be reaching past the boundary for a name, which is
// how a boundary starts leaking. The import path becomes `@docx-editor.dev/core/editor` when
// task 10.5 migrates the namespace.

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceState,
  type NavigationCommand,
  type SurfaceFormatting,
  type TextMeasurer,
} from '@docx-editor.dev/engine-editor';

export interface PaginatedDocxEditorProps {
  /** The document to open. Replacing it remounts the surface. */
  readonly source: Uint8Array;
  /** Points to CSS pixels. */
  readonly scale?: number;
  /** Host-supplied font metrics; layout stays DOM-free without it. */
  readonly measurer?: TextMeasurer;
  /** Called on every committed revision and every selection change. */
  readonly onStateChange?: (state: PaginatedSurfaceState) => void;
  /** Called once if the document cannot be opened, with the engine's typed reason. */
  readonly onError?: (reason: string, detail?: string) => void;
  readonly className?: string;
  readonly ref?: Ref<PaginatedDocxEditorHandle>;
}

/**
 * What a host can drive from outside.
 *
 * Commands only. There is no accessor for the document or the layout, because a caller
 * holding either could act on a revision the model has already left behind.
 */
export interface PaginatedDocxEditorHandle {
  focus(): void;
  type(text: string): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  navigate(command: NavigationCommand, extend?: boolean): void;
  toggleRunProperty(localName: string, attributes?: Record<string, string>): void;
  setRunProperty(localName: string, attributes?: Record<string, string>): void;
  setParagraphProperty(localName: string, attributes?: Record<string, string>): void;
  /** Formatting at the selection, for a toolbar to reflect. */
  formatting(): SurfaceFormatting | null;
  /** Serialize the current document. */
  save(): Uint8Array | null;
}

export function PaginatedDocxEditor({
  source,
  scale,
  measurer,
  onStateChange,
  onError,
  className,
  ref,
}: PaginatedDocxEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<PaginatedSurface | null>(null);
  const [state, setState] = useState<PaginatedSurfaceState | null>(null);

  // Held in refs so the effect does not re-run — and therefore does not tear the surface
  // down and lose the caret — every time a parent re-renders with a new callback identity.
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const result = mountPaginatedSurface(container, source, {
      ...(scale === undefined ? {} : { scale }),
      ...(measurer ? { measurer } : {}),
      onChange: (next) => {
        setState(next);
        onStateChangeRef.current?.(next);
      },
    });

    if (!result.ok) {
      // A rejection is a property of the FILE, so it is reported rather than thrown: a
      // corrupt upload should not take the surrounding application down.
      onErrorRef.current?.(result.reason, result.detail);
      return;
    }

    surfaceRef.current = result.surface;
    setState(result.surface.state());
    return () => {
      result.surface.destroy();
      surfaceRef.current = null;
    };
  }, [source, scale, measurer]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => surfaceRef.current?.focus(),
      type: (text: string) => surfaceRef.current?.type(text),
      undo: () => surfaceRef.current?.undo(),
      redo: () => surfaceRef.current?.redo(),
      selectAll: () => surfaceRef.current?.selectAll(),
      navigate: (command: NavigationCommand, extend?: boolean) =>
        surfaceRef.current?.navigate(command, extend),
      toggleRunProperty: (localName: string, attributes?: Record<string, string>) =>
        surfaceRef.current?.toggleRunProperty(localName, attributes),
      setRunProperty: (localName: string, attributes?: Record<string, string>) =>
        surfaceRef.current?.setRunProperty(localName, attributes),
      setParagraphProperty: (localName: string, attributes?: Record<string, string>) =>
        surfaceRef.current?.setParagraphProperty(localName, attributes),
      formatting: () => surfaceRef.current?.formatting() ?? null,
      save: () => surfaceRef.current?.session.save() ?? null,
    }),
    []
  );

  return (
    <div
      ref={containerRef}
      // Centred by margin rather than by a flex parent: the pages are absolutely positioned,
      // so the container's own width is what has to be centred.
      style={{ margin: '24px auto' }}
      className={className ?? 'docx-paginated-surface'}
      data-revision={state?.revision ?? 0}
      data-page-count={state?.pageCount ?? 0}
    />
  );
}
