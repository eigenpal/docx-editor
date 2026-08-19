/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { defineComponent, h, type ComputedRef, type PropType, type VNode } from 'vue';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useEditorState } from '@docx-editor.dev/vue';
import { ACCEPT_ICON, REOPEN_ICON, icon } from './review-icons.tsx';
import type { ReviewRailValue } from './review-context.ts';
import type { ReviewItemView } from './useReview.ts';
import { ReviewActionSlot } from './review-action-slot.tsx';
import { guardMousedown, markPart, selectDocumentReadOnly } from './review-shared.ts';

interface ResolutionPartDeps {
  readonly useRail: () => ComputedRef<ReviewRailValue>;
  readonly useItem: () => ComputedRef<ReviewItemView | null>;
  readonly useLabel: () => (key: TranslationKey) => string;
}

/** Build the two comment-state parts against the rail's private contexts. */
export function createCommentResolutionParts(deps: ResolutionPartDeps) {
  const ReviewResolve = markPart(
    defineComponent({
      name: 'ReviewResolve',
      props: {
        className: String,
        asChild: Boolean,
        hidden: Boolean,
        icon: { type: [Object, String] as PropType<VNode | string>, default: undefined },
      },
      setup(props, { slots }) {
        const rail = deps.useRail();
        const entryRef = deps.useItem();
        const t = deps.useLabel();
        const readOnly = useEditorState(selectDocumentReadOnly);

        return () => {
          const entry = entryRef.value;
          if (props.hidden || !entry || entry.kind !== 'comment' || entry.resolved) return null;
          const review = rail.value.review;
          const label = t('comments.resolve');
          const engineDisabled = readOnly.value || review.commentResolutionDisabledReason !== null;
          const disabledReason = engineDisabled ? t('editingMode.viewingHint') : null;
          const shared = {
            type: 'button' as const,
            class: `docx-review__action${props.className ? ` ${props.className}` : ''}`,
            'data-testid': 'review-resolve',
            'aria-label': label,
            title: disabledReason ?? label,
            disabled: engineDisabled,
            onMousedown: guardMousedown,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              if (engineDisabled) return;
              review.resolve(entry);
            },
          };
          if (props.asChild) {
            return h(
              ReviewActionSlot,
              {
                engineDisabled,
                disabledReason,
                slotProps: shared,
              },
              slots.default
            );
          }
          return h('button', shared, props.icon ?? slots.default?.() ?? icon(ACCEPT_ICON));
        };
      },
    }),
    'Resolve'
  );

  const ReviewReopen = markPart(
    defineComponent({
      name: 'ReviewReopen',
      props: {
        className: String,
        asChild: Boolean,
        hidden: Boolean,
        icon: { type: [Object, String] as PropType<VNode | string>, default: undefined },
      },
      setup(props, { slots }) {
        const rail = deps.useRail();
        const entryRef = deps.useItem();
        const t = deps.useLabel();
        const readOnly = useEditorState(selectDocumentReadOnly);

        return () => {
          const entry = entryRef.value;
          if (props.hidden || !entry || entry.kind !== 'comment' || !entry.resolved) return null;
          const review = rail.value.review;
          const label = t('comments.reopen');
          const engineDisabled = readOnly.value || review.commentResolutionDisabledReason !== null;
          const disabledReason = engineDisabled ? t('editingMode.viewingHint') : null;
          const shared = {
            type: 'button' as const,
            class: `docx-review__action${props.className ? ` ${props.className}` : ''}`,
            'data-testid': 'review-reopen',
            'aria-label': label,
            title: disabledReason ?? label,
            disabled: engineDisabled,
            onMousedown: guardMousedown,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              if (engineDisabled) return;
              review.reopen(entry);
            },
          };
          if (props.asChild) {
            return h(
              ReviewActionSlot,
              {
                engineDisabled,
                disabledReason,
                slotProps: shared,
              },
              slots.default
            );
          }
          return h('button', shared, props.icon ?? slots.default?.() ?? icon(REOPEN_ICON));
        };
      },
    }),
    'Reopen'
  );

  return { ReviewResolve, ReviewReopen };
}
