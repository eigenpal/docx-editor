// Hidden ProseMirror input-host controller (interactive-paginated-editing 4.1 / 4.3).
// Visual hiding uses opacity:0 on the clip shell (attached, focusable, non-display:none).
// pointer-events:none on root/shell/mount prevents intercepting painted-page clicks.
// Styles are applied with setProperty only — no file-derived HTML/CSS interpolation.

import type { InteractionFrameId } from '@docx-editor.dev/core-contract/interaction';
import type { Rect } from '@docx-editor.dev/core-contract/types';
import { applyAccessibleNamePolicy, resolveAccessibilityNamePolicy } from './accessibility-projection.ts';

export const INPUT_HOST_MIN_WIDTH_PX = 2;
export const INPUT_HOST_MIN_HEIGHT_PX = 16;
export const INPUT_HOST_DEFAULT_WIDTH_PX = 200;
export const INPUT_HOST_DEFAULT_HEIGHT_PX = 24;

export type InputHostPlacementReason =
  | 'applied'
  | 'staleFrame'
  | 'pendingLayout'
  | 'noCaret'
  | 'readOnly'
  | 'fallback';

export interface InputHostPlacement {
  readonly clientRect: Rect;
  readonly reason: InputHostPlacementReason;
  readonly frameId?: InteractionFrameId;
}

export interface InputHostViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface InputHostPlacementRequest {
  readonly frameId: InteractionFrameId;
  readonly activeFrameId: InteractionFrameId;
  readonly caretClientRect: Rect | null;
  readonly pendingLayout?: boolean;
  readonly readOnly?: boolean;
  readonly viewport?: InputHostViewport;
}

export interface InputHostAssistiveState {
  readonly policy: 'sole-semantic-projection';
  readonly paintedPagesAssistiveRole: 'presentation';
  readonly hostAttached: boolean;
  readonly placement: InputHostPlacement;
}

export interface InputHostControllerOptions {
  readonly viewport?: InputHostViewport;
  readonly accessibleName?: string;
}

export interface InputHostController {
  readonly root: HTMLElement;
  readonly clipShell: HTMLElement;
  readonly pmMount: HTMLElement;
  readonly assistiveState: InputHostAssistiveState;
  updatePlacement(request: InputHostPlacementRequest): InputHostPlacement;
  focus(): void;
  blur(): void;
  destroy(): void;
}

const DEFAULT_VIEWPORT: InputHostViewport = { x: 0, y: 0, width: 1920, height: 1080 };

const FALLBACK_CLIENT_RECT: Rect = {
  x: 8,
  y: 8,
  width: INPUT_HOST_DEFAULT_WIDTH_PX,
  height: INPUT_HOST_DEFAULT_HEIGHT_PX,
};

function boundedRect(rect: Rect): Rect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(INPUT_HOST_MIN_WIDTH_PX, rect.width),
    height: Math.max(INPUT_HOST_MIN_HEIGHT_PX, rect.height),
  };
}

/** Clamp a client rect into the supplied viewport, preserving minimum bounds. */
export function clampRectToViewport(rect: Rect, viewport: InputHostViewport): Rect {
  const width = Math.max(INPUT_HOST_MIN_WIDTH_PX, Math.min(rect.width, viewport.width));
  const height = Math.max(INPUT_HOST_MIN_HEIGHT_PX, Math.min(rect.height, viewport.height));
  const maxX = viewport.x + viewport.width - width;
  const maxY = viewport.y + viewport.height - height;
  return {
    x: Math.min(Math.max(rect.x, viewport.x), maxX),
    y: Math.min(Math.max(rect.y, viewport.y), maxY),
    width,
    height,
  };
}

function applyClipShellStyles(shell: HTMLElement, rect: Rect): void {
  shell.style.setProperty('position', 'fixed');
  shell.style.setProperty('overflow', 'hidden');
  shell.style.setProperty('left', `${rect.x}px`);
  shell.style.setProperty('top', `${rect.y}px`);
  shell.style.setProperty('width', `${rect.width}px`);
  shell.style.setProperty('height', `${rect.height}px`);
  shell.style.setProperty('clip-path', 'inset(0)');
  shell.style.setProperty('opacity', '0');
  shell.style.setProperty('pointer-events', 'none');
  shell.style.setProperty('z-index', '2147483646');
  shell.style.removeProperty('display');
}

function applyRootShellStyles(root: HTMLElement): void {
  root.style.setProperty('position', 'fixed');
  root.style.setProperty('left', '0');
  root.style.setProperty('top', '0');
  root.style.setProperty('width', '0');
  root.style.setProperty('height', '0');
  root.style.setProperty('overflow', 'visible');
  root.style.setProperty('pointer-events', 'none');
  root.style.removeProperty('display');
}

function applyPmMountStyles(mount: HTMLElement): void {
  mount.style.setProperty('position', 'absolute');
  mount.style.setProperty('left', '0');
  mount.style.setProperty('top', '0');
  mount.style.setProperty('width', '100%');
  mount.style.setProperty('min-height', `${INPUT_HOST_MIN_HEIGHT_PX}px`);
  mount.style.setProperty('outline', 'none');
  mount.style.setProperty('pointer-events', 'none');
  mount.style.removeProperty('display');
}

export function createInputHostController(doc: Document, options: InputHostControllerOptions = {}): InputHostController {
  const defaultViewport = options.viewport ?? DEFAULT_VIEWPORT;
  const root = doc.createElement('div');
  root.setAttribute('data-docx-input-host', 'true');
  root.setAttribute('data-assistive-policy', 'sole-semantic-projection');
  root.setAttribute('data-painted-pages-assistive-role', 'presentation');

  const clipShell = doc.createElement('div');
  clipShell.setAttribute('data-docx-input-host-clip', 'true');

  const pmMount = doc.createElement('div');
  pmMount.setAttribute('data-docx-input-host-mount', 'true');
  pmMount.setAttribute('tabindex', '-1');
  applyAccessibleNamePolicy(pmMount, resolveAccessibilityNamePolicy(options.accessibleName));

  clipShell.append(pmMount);
  root.append(clipShell);

  applyRootShellStyles(root);
  applyPmMountStyles(pmMount);

  let destroyed = false;
  let lastPlacement: InputHostPlacement = {
    clientRect: clampRectToViewport(boundedRect(FALLBACK_CLIENT_RECT), defaultViewport),
    reason: 'fallback',
  };
  applyClipShellStyles(clipShell, lastPlacement.clientRect);

  const controller: InputHostController = {
    root,
    clipShell,
    pmMount,
    get assistiveState(): InputHostAssistiveState {
      return {
        policy: 'sole-semantic-projection',
        paintedPagesAssistiveRole: 'presentation',
        hostAttached: !destroyed && root.isConnected,
        placement: lastPlacement,
      };
    },
    updatePlacement(request: InputHostPlacementRequest): InputHostPlacement {
      if (destroyed) return lastPlacement;
      const viewport = request.viewport ?? defaultViewport;
      let reason: InputHostPlacementReason = 'applied';
      let rect = request.caretClientRect ? boundedRect(request.caretClientRect) : null;

      if (request.frameId.value !== request.activeFrameId.value) {
        reason = 'staleFrame';
        rect = null;
      } else if (request.pendingLayout) {
        reason = 'pendingLayout';
        rect = null;
      } else if (request.readOnly) {
        reason = 'readOnly';
        rect = null;
      } else if (!rect) {
        reason = 'noCaret';
      }

      if (!rect) {
        const fallbackSource = lastPlacement.reason === 'applied' ? lastPlacement.clientRect : FALLBACK_CLIENT_RECT;
        rect = clampRectToViewport(boundedRect(fallbackSource), viewport);
      } else {
        rect = clampRectToViewport(rect, viewport);
      }

      applyClipShellStyles(clipShell, rect);
      lastPlacement = { clientRect: rect, reason, frameId: request.frameId };
      return lastPlacement;
    },
    focus() {
      if (!destroyed) pmMount.focus({ preventScroll: true });
    },
    blur() {
      if (!destroyed) pmMount.blur();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.remove();
    },
  };

  return controller;
}

export interface InputHostComputedStyles {
  readonly display: string;
  readonly opacity: string;
  readonly pointerEvents: string;
  readonly width: string;
  readonly height: string;
}

/** Test helper: read computed styles relevant to visibility and hit testing. */
export function readInputHostComputedStyles(el: HTMLElement, win: Window = el.ownerDocument?.defaultView ?? window): InputHostComputedStyles {
  const computed = win.getComputedStyle(el);
  return {
    display: computed.display,
    opacity: computed.opacity,
    pointerEvents: computed.pointerEvents,
    width: computed.width,
    height: computed.height,
  };
}
