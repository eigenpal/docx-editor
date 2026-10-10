import { shallowRef, toValue, watch, type ShallowRef } from 'vue';
import type { HighlightHit, HighlightRange } from '@docx-editor.dev/core/contracts/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';
import { scopeDispose } from './scope-dispose';
import { useDocxEditor } from './context';

function sameHit(a: HighlightHit | null, b: HighlightHit | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    a.index === b.index &&
    a.range === b.range &&
    a.active === b.active &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}

/**
 * The topmost text highlight under the pointer, or `null`. Pass a set name to watch one set.
 * `R` is your range type, so fields you added to your ranges come back typed on `range`.
 *
 * @example
 * ```ts
 * const hit = useHighlightAt<GlossaryRange>('glossary');
 * // hit.value?.range.definition, positioned at hit.value.rect
 * ```
 * @public
 */
export function useHighlightAt<R extends HighlightRange = HighlightRange>(
  name?: MaybeRefOrGetter<string>
): Readonly<ShallowRef<HighlightHit<R> | null>> {
  const editorRef = useDocxEditor();
  const hit = shallowRef<HighlightHit<R> | null>(null);

  scopeDispose(
    watch(
      [() => editorRef.value, () => (name === undefined ? undefined : toValue(name))],
      ([editor, setName], _previous, onCleanup) => {
        if (!editor) {
          hit.value = null;
          return;
        }
        const doc = globalThis.document;
        let frame = 0;
        let point: { readonly x: number; readonly y: number } | null = null;
        const read = () => {
          frame = 0;
          const found = point
            ? (editor
                .getHighlightsAt<R>(point.x, point.y)
                .find((candidate) => setName === undefined || candidate.name === setName) ?? null)
            : null;
          if (!sameHit(hit.value, found)) hit.value = found;
        };
        const schedule = () => {
          if (frame === 0) frame = requestAnimationFrame(read);
        };
        const onMove = (event: PointerEvent) => {
          // Only a pointer on a page: a menu, dialog, or tooltip over the text hides the mark.
          const target = event.target;
          const onPage = target instanceof Element && target.closest('[data-page-index]') !== null;
          point = onPage ? { x: event.clientX, y: event.clientY } : null;
          schedule();
        };
        const onLeave = (event: PointerEvent) => {
          if (event.relatedTarget) return;
          point = null;
          schedule();
        };
        doc.addEventListener('pointermove', onMove, { passive: true });
        doc.addEventListener('pointerout', onLeave, { passive: true });
        doc.addEventListener('scroll', schedule, { passive: true, capture: true });
        const off = editor.on('change', schedule);
        onCleanup(() => {
          doc.removeEventListener('pointermove', onMove);
          doc.removeEventListener('pointerout', onLeave);
          doc.removeEventListener('scroll', schedule, { capture: true });
          off();
          if (frame !== 0) cancelAnimationFrame(frame);
        });
      },
      { immediate: true }
    )
  );

  return hit;
}
