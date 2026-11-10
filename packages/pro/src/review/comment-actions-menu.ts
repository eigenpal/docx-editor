/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { hostDocumentOf, hostWindowOf, isDomNode } from '@docx-editor.dev/core/editor';

export function commentMenuItems(panel: HTMLElement): HTMLButtonElement[] {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
}

/** Bind dismissal to the menu's host document, including pop-out windows. */
export function observeCommentMenu(root: HTMLElement, close: () => void): () => void {
  const doc = hostDocumentOf(root);
  const outside = (event: Event) => {
    if (!isDomNode(event.target) || !root.contains(event.target)) close();
  };
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('focusin', outside, true);
  return () => {
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('focusin', outside, true);
  };
}

/** Arrow navigation, dismissal, and type-ahead share one behavior across adapters. */
export function commentMenuKey(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>,
  panel: HTMLElement,
  trigger: HTMLButtonElement,
  close: () => void
): void {
  event.stopPropagation();
  if (event.key === 'Escape' || event.key === 'Tab') {
    if (event.key === 'Escape') event.preventDefault();
    trigger.focus({ preventScroll: true });
    close();
    return;
  }
  const items = commentMenuItems(panel);
  if (items.length === 0) return;
  const active = hostDocumentOf(panel).activeElement;
  const current = items.findIndex((item) => item === active);
  let index: number | undefined;
  if (event.key === 'ArrowDown') index = (current + 1) % items.length;
  if (event.key === 'ArrowUp') index = (current - 1 + items.length) % items.length;
  if (event.key === 'Home') index = 0;
  if (event.key === 'End') index = items.length - 1;
  if (event.key.length === 1 && event.key.trim()) {
    for (let offset = 1; offset <= items.length; offset++) {
      const next = (current + offset) % items.length;
      if (
        items[next]!.textContent?.trim()
          .toLocaleLowerCase()
          .startsWith(event.key.toLocaleLowerCase())
      ) {
        index = next;
        break;
      }
    }
  }
  if (index === undefined) return;
  event.preventDefault();
  items[index]?.focus({ preventScroll: true });
}

/** Reuse an open draft without discarding its text or moving the document caret. */
export function focusCommentDraft(root: HTMLElement | null): void {
  if (!root) return;
  const card = root.closest('[data-testid="review-reply"], [data-testid="review-card"]');
  hostWindowOf(root).requestAnimationFrame(() => {
    card
      ?.querySelector<HTMLTextAreaElement>('[data-testid="review-edit-input"]')
      ?.focus({ preventScroll: true });
  });
}

/** Capture neighboring controls before deletion removes the current card. */
export function afterCommentDelete(
  trigger: HTMLButtonElement | null,
  fallback: () => void
): () => void {
  if (!trigger) return fallback;
  const rail = trigger.closest('[data-testid="review-rail"]');
  const controls = Array.from(
    rail?.querySelectorAll<HTMLButtonElement>(
      '[data-testid="review-comment-actions"]:not(:disabled)'
    ) ?? []
  );
  const index = controls.indexOf(trigger);
  const keys = [trigger, ...controls.slice(index + 1), ...controls.slice(0, index).reverse()].map(
    (button) => button.dataset.commentKey
  );
  const win = hostWindowOf(trigger);
  return () =>
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        const current = Array.from(
          rail?.querySelectorAll<HTMLButtonElement>(
            '[data-testid="review-comment-actions"]:not(:disabled)'
          ) ?? []
        );
        const target = keys
          .map((key) =>
            current.find((button) => button.isConnected && button.dataset.commentKey === key)
          )
          .find((button) => button !== undefined);
        if (target) target.focus({ preventScroll: true });
        else fallback();
      })
    );
}

/** Keep the menu inside its visible host viewport without an opening animation. */
export function positionCommentMenu(root: HTMLElement, panel: HTMLElement): void {
  const win = hostWindowOf(root);
  const bounds = panel.getBoundingClientRect();
  const anchor = root.getBoundingClientRect();
  const roomBelow = win.innerHeight - anchor.bottom - 8;
  const roomAbove = anchor.top - 8;
  const above = bounds.height > roomBelow && roomAbove > roomBelow;
  panel.style.top = above ? 'auto' : 'calc(100% + 4px)';
  panel.style.bottom = above ? 'calc(100% + 4px)' : 'auto';
  panel.style.maxHeight = `${Math.max(0, above ? roomAbove : roomBelow)}px`;
  panel.style.overflowY = 'auto';
  const shift =
    bounds.left < 4
      ? 4 - bounds.left
      : bounds.right > win.innerWidth - 4
        ? win.innerWidth - 4 - bounds.right
        : 0;
  if (shift) panel.style.transform = `translateX(${shift}px)`;
}

/** Resolve a fresh trigger after adapter rendering replaces a comment card. */
export function restoreCommentActions(
  trigger: HTMLButtonElement | null,
  key: string,
  consume: () => boolean
): void {
  if (!trigger) return;
  const rail = trigger.closest('[data-testid="review-rail"]');
  if (!rail) return;
  const win = hostWindowOf(trigger);
  win.requestAnimationFrame(() =>
    win.requestAnimationFrame(() => {
      const target = Array.from(
        rail.querySelectorAll<HTMLButtonElement>('[data-testid="review-comment-actions"]')
      ).find((button) => button.isConnected && button.dataset.commentKey === key);
      if (target && consume()) target.focus({ preventScroll: true });
    })
  );
}
