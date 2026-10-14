// The refused-open dialog: what a person sees when the editor cannot open a file.
//
// A refused open leaves the pages blank, so without this part the person sees nothing. It
// reads `snapshot().openFailure`, the same pull state every other consumer reads, so it also
// covers a document passed at construction, before any listener could subscribe.
//
// The default text is generic on purpose. It explains the refusal and shows the stable code,
// and names no contact: the host adds its own support action through the `actions` slot.

import {
  Comment,
  Fragment,
  computed,
  defineComponent,
  getCurrentInstance,
  inject,
  provide,
  shallowRef,
  type ComputedRef,
  type CSSProperties,
  type InjectionKey,
  type PropType,
  type ShallowRef,
  type SlotsType,
  type VNode,
} from 'vue';
import type {
  DocumentOpenFailure,
  DocumentOpenFailureReason,
  EditorSnapshot,
} from '@docx-editor.dev/core/contracts/editor';
import type { TFunction } from '@docx-editor.dev/i18n';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import { isDevelopment } from '../lib/is-development';
import { NativeDialog } from './dialog-parts';
import { Slot } from './toolbar/Slot';
import { useEditorState } from './useEditorState';

const MESSAGE_KEYS = {
  damaged: 'openFailure.reasons.damaged',
  'not-docx': 'openFailure.reasons.notDocx',
  'too-large': 'openFailure.reasons.tooLarge',
  blocked: 'openFailure.reasons.blocked',
  unknown: 'openFailure.reasons.unknown',
} as const satisfies Record<DocumentOpenFailureReason, string>;

/**
 * Whether a `dismiss` argument names an older refusal. Anything that is not a failure, such as
 * the click event of `onClick={dismiss}`, means "the one on screen".
 */
function isStaleFailure(shown: unknown, current: DocumentOpenFailure | null): boolean {
  return typeof shown === 'object' && shown !== null && 'reason' in shown && shown !== current;
}

const selectOpenFailure = (snapshot: EditorSnapshot): DocumentOpenFailure | null =>
  snapshot.openFailure ?? null;

/** The current refused open, with the packaged message and a way to dismiss it. @public */
export interface UseOpenFailureReturn {
  /** The refused open, or `null` when there is none or the person dismissed it. */
  readonly failure: ComputedRef<DocumentOpenFailure | null>;
  /** The packaged, translated message for {@link UseOpenFailureReturn.failure}. */
  readonly message: ComputedRef<string | null>;
  /**
   * Hide this refusal. A later refusal shows again, even for the same file. Pass the failure
   * your UI showed, such as from a toast's close callback, so a late call cannot hide a newer
   * refusal.
   */
  dismiss(failure?: DocumentOpenFailure): void;
}

/** Options for {@link useOpenFailure}. @public */
export interface UseOpenFailureOptions {
  /** Translator override; defaults to the ambient locale context. */
  t?: TFunction;
}

/**
 * Reads the document the editor refused to open, for a host that shows it in its own UI,
 * such as a toast. Pair it with `:open-failure="false"` on `<DocxEditor>`, so the packaged
 * dialog does not show as well. Call it inside a `DocxEditor.Root`.
 *
 * ```ts
 * const { failure, message, dismiss } = useOpenFailure();
 * watch(failure, (next) => {
 *   if (next) toast(message.value, { detail: next.code, onClose: () => dismiss(next) });
 * });
 * ```
 *
 * @public
 */
export function useOpenFailure(options: UseOpenFailureOptions = {}): UseOpenFailureReturn {
  const current = useEditorState(selectOpenFailure);
  const ambient = useTranslation();
  // Each refusal is a new object, so remembering the dismissed one by reference lets the
  // next refusal of the same file show again.
  const dismissed: ShallowRef<DocumentOpenFailure | null> = shallowRef(null);
  const failure = computed(() =>
    current.value !== null && current.value !== dismissed.value ? current.value : null
  );
  const message = computed(() => {
    const value = failure.value;
    return value ? (options.t ?? ambient.t)(MESSAGE_KEYS[value.reason]) : null;
  });
  return {
    failure,
    message,
    dismiss: (shown?: DocumentOpenFailure) => {
      if (!isStaleFailure(shown, current.value)) dismissed.value = current.value;
    },
  };
}

/** What the `actions` and `default` slots receive. @public */
export interface DocxEditorOpenFailureContext {
  /** The refused open: its stable `code` and its `reason`. */
  readonly failure: DocumentOpenFailure;
  /** The packaged, translated message for the failure. */
  readonly message: string;
  /** Close the dialog. It emits `dismiss`, as **Close** does. */
  dismiss(): void;
}

const openFailureKey: InjectionKey<DocxEditorOpenFailureContext> = Symbol('docx-open-failure');

/** Props for `DocxEditor.OpenFailure.Action`. @public */
export interface DocxEditorOpenFailureActionProps {
  /** `primary` is filled, `secondary` is outlined. Defaults to `secondary`. */
  variant?: 'primary' | 'secondary';
  /** Close the dialog after the click handler runs, unless it called `preventDefault()`. */
  dismiss?: boolean;
  /** Render your own element, such as a link, with the button's classes and handler. */
  asChild?: boolean;
  /** The `default` slot: the button label, or with `asChild` your own element. */
  children?: DocxEditorChildren;
}

/**
 * A button in the open-failure dialog, styled as the packaged **Close**. Use it in the
 * `actions` slot, or in your own `default` slot. With `as-child`, it styles your own element
 * instead, such as a link to your support page:
 *
 * ```vue
 * <DocxEditor.OpenFailure>
 *   <template #actions="{ failure }">
 *     <DocxEditor.OpenFailure.Action as-child>
 *       <a :href="`/support?code=${failure.code}`">Get help</a>
 *     </DocxEditor.OpenFailure.Action>
 *   </template>
 * </DocxEditor.OpenFailure>
 * ```
 *
 * @public
 */
export const DocxEditorOpenFailureAction = defineComponent({
  name: 'DocxEditorOpenFailureAction',
  inheritAttrs: false,
  props: {
    variant: { type: String as PropType<'primary' | 'secondary'>, default: 'secondary' },
    dismiss: { type: Boolean, default: false },
    asChild: { type: Boolean, default: false },
  },
  slots: Object as SlotsType<{ default?: () => VNode[] }>,
  setup(props, { attrs, slots }) {
    const context = inject(openFailureKey, null);
    return () => {
      const classes = [
        'docx-dialog__button',
        props.variant === 'primary' ? 'docx-dialog__button--primary' : undefined,
        attrs.class as string | undefined,
      ];
      const hostClick = attrs.onClick as ((event: MouseEvent) => void) | undefined;
      const onClick = (event: MouseEvent) => {
        hostClick?.(event);
        if (props.dismiss && !event.defaultPrevented) context?.dismiss();
      };
      const shared = { ...attrs, class: classes, onClick };
      if (props.asChild) return <Slot {...shared}>{{ default: () => slots.default?.() }}</Slot>;
      return (
        <button type="button" {...shared}>
          {slots.default?.()}
        </button>
      );
    };
  },
});

/**
 * A message for the open-failure dialog: text, content, or a function of the failure. It
 * renders in a `div`, so block content is valid.
 *
 * @public
 */
export type DocxEditorOpenFailureMessage =
  | string
  | DocxEditorChildren
  | ((failure: DocumentOpenFailure) => string | DocxEditorChildren);

/** Props for `DocxEditor.OpenFailure`. @public */
export interface DocxEditorOpenFailureProps {
  /**
   * The dialog title. Defaults to the translated `openFailure.title`. It also names the dialog
   * for screen readers, including when your own content replaces the packaged one.
   */
  title?: string;
  /** Your own message in place of the packaged one, as content or per failure. */
  message?: DocxEditorOpenFailureMessage;
  /** Show the stable error code under the message. Defaults to `true`. */
  showCode?: boolean;
  /** The label of the **Close** button. Defaults to the translated `common.close`. */
  closeLabel?: string;
  /**
   * Show the packaged **Close** button. Defaults to `true`. Turn it off only when the
   * `actions` slot gives a way out. Escape still closes the dialog.
   */
  showClose?: boolean;
  /** The `actions` slot: your own buttons, before **Close**. */
  actions?: (context: DocxEditorOpenFailureContext) => DocxEditorChildren;
  /** Listener for the `dismiss` event: the person closed the dialog, by any route. */
  onDismiss?: (failure: DocumentOpenFailure) => void;
  /** The `default` slot: your own dialog content, in place of the header, body and footer. */
  children?: (context: DocxEditorOpenFailureContext) => DocxEditorChildren;
  /** Appended after the load-bearing `docx-dialog` class. */
  className?: string;
  /** Inline styles for the dialog element. */
  style?: CSSProperties;
  /** Translator override; defaults to the ambient locale context. */
  t?: TFunction;
}

const warnedActions = new Set<'both' | 'disabled'>();

/**
 * Warn once, in development, when the `openFailureActions` slot cannot do what it says: it
 * replaces `openFailure.actions`, and `:open-failure="false"` renders no dialog for it.
 */
export function warnOpenFailureActions(
  openFailure: boolean | DocxEditorOpenFailureProps,
  hasSlot: boolean
): void {
  if (!hasSlot || !isDevelopment()) return;
  const kind =
    openFailure === false
      ? 'disabled'
      : typeof openFailure === 'object' && openFailure.actions
        ? 'both'
        : null;
  if (kind === null || warnedActions.has(kind)) return;
  warnedActions.add(kind);
  console.warn(
    kind === 'both'
      ? '[docx-editor] The #openFailureActions slot replaces openFailure.actions. Pass only one.'
      : '[docx-editor] The #openFailureActions slot is ignored with :open-failure="false", ' +
          'which renders no dialog.'
  );
}

/** Whether slot output holds anything: comments from a false `v-if` and empty fragments do not. */
function hasContent(nodes: readonly VNode[] | undefined): boolean {
  return (nodes ?? []).some((node) =>
    node.type === Comment
      ? false
      : node.type === Fragment
        ? hasContent(Array.isArray(node.children) ? (node.children as VNode[]) : [])
        : true
  );
}

const DocxEditorOpenFailureImpl = defineComponent({
  name: 'DocxEditorOpenFailure',
  props: {
    title: { type: String, default: undefined },
    message: {
      type: [String, Object, Function] as PropType<DocxEditorOpenFailureMessage>,
      default: undefined,
    },
    showCode: { type: Boolean, default: true },
    closeLabel: { type: String, default: undefined },
    showClose: { type: Boolean, default: true },
    // Function forms of the `actions` and `default` slots, for the `openFailure` object on
    // `<DocxEditor>`. A slot wins over its prop.
    actions: {
      type: Function as PropType<DocxEditorOpenFailureProps['actions']>,
      default: undefined,
    },
    children: {
      type: Function as PropType<DocxEditorOpenFailureProps['children']>,
      default: undefined,
    },
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
    t: { type: Function as PropType<TFunction>, default: undefined },
  },
  emits: { dismiss: (failure: DocumentOpenFailure) => failure !== null },
  slots: Object as SlotsType<{
    /** Your own dialog content, in place of the packaged header, body and footer. */
    default?: (context: DocxEditorOpenFailureContext) => VNode[];
    /** Your own buttons, before **Close**. */
    actions?: (context: DocxEditorOpenFailureContext) => VNode[];
  }>,
  setup(props, { emit, slots }) {
    const ambient = useTranslation();
    const translate = (): TFunction => props.t ?? ambient.t;
    // Vue 3.3 has no `useId`; the instance uid is unique per mounted dialog.
    const messageId = `docx-open-failure-${getCurrentInstance()?.uid ?? 0}-message`;
    const state = useOpenFailure({
      get t() {
        return translate();
      },
    });
    const context = computed<DocxEditorOpenFailureContext | null>(() => {
      const failure = state.failure.value;
      const message = state.message.value;
      if (!failure || message === null) return null;
      return {
        failure,
        message,
        dismiss: () => {
          state.dismiss(failure);
          emit('dismiss', failure);
        },
      };
    });
    // A stable object whose members follow the current refusal, for `Action` to inject.
    provide(openFailureKey, {
      get failure() {
        return context.value!.failure;
      },
      get message() {
        return context.value!.message;
      },
      dismiss: () => context.value?.dismiss(),
    });

    return () => {
      const ctx = context.value;
      if (!ctx) return null;
      const t = translate();
      const { failure } = ctx;
      const heading = props.title ?? t('openFailure.title');
      const body =
        typeof props.message === 'function'
          ? props.message(failure)
          : (props.message ?? ctx.message);
      const extra = slots.actions?.(ctx) ?? props.actions?.(ctx);
      const hasExtra = hasContent(extra === undefined ? undefined : ([] as VNode[]).concat(extra));
      return (
        <NativeDialog
          kind="openFailure"
          role="alertdialog"
          label={heading}
          class={props.className}
          style={props.style}
          onClose={ctx.dismiss}
          // An alert asks for a decision: a stray click on the backdrop does not dismiss it.
          dismissOutside={false}
          describedBy={slots.default || props.children ? undefined : messageId}
          content={() =>
            slots.default?.(ctx) ??
            props.children?.(ctx) ?? (
              <>
                <header class="docx-dialog__header">
                  <h2 class="docx-dialog__title">{heading}</h2>
                </header>
                <div class="docx-dialog__body">
                  <div id={messageId} class="docx-dialog__message">
                    {body}
                  </div>
                  {props.showCode ? (
                    <p class="docx-dialog__code">
                      {/* Interpolated locally too: a host bridging a bare `(key) => string`
                          into `t` must not show a literal placeholder. */}
                      {t('openFailure.code', { code: failure.code }).replace(
                        '{code}',
                        failure.code
                      )}
                    </p>
                  ) : null}
                </div>
                {hasExtra || props.showClose ? (
                  <footer class="docx-dialog__footer">
                    {extra}
                    {props.showClose ? (
                      // Filled while it is the only button; outlined beside the host's own,
                      // so the host's action reads as the main one.
                      <DocxEditorOpenFailureAction
                        variant={hasExtra ? 'secondary' : 'primary'}
                        dismiss
                      >
                        {{ default: () => props.closeLabel ?? t('common.close') }}
                      </DocxEditorOpenFailureAction>
                    ) : null}
                  </footer>
                ) : null}
              </>
            )
          }
        />
      );
    };
  },
});

/**
 * The open-failure part with its button attached as a static.
 *
 * @public
 */
export interface DocxEditorOpenFailureComponent {
  /**
   * Renders the dialog while a refused open is waiting, and nothing otherwise. The second
   * parameter types the `default` and `actions` slots for templates.
   */
  (
    props: DocxEditorOpenFailureProps,
    context?: {
      slots: {
        default?: (context: DocxEditorOpenFailureContext) => VNode[];
        actions?: (context: DocxEditorOpenFailureContext) => VNode[];
      };
    }
  ): VNode;
  /** A button styled for the dialog, for the `actions` and `default` slots. */
  readonly Action: typeof DocxEditorOpenFailureAction;
}

/**
 * A dialog that explains why a file did not open. It shows nothing until the editor refuses a
 * document, and shows again for each later refusal. `<DocxEditor>` renders it by default;
 * compose it yourself inside a `DocxEditor.Root`. The `actions` slot adds your own buttons
 * before **Close**, and the `default` slot replaces the whole content. Both receive
 * `{ failure, message, dismiss }`.
 *
 * ```vue
 * <DocxEditor.OpenFailure @dismiss="onClosed">
 *   <template #actions="{ failure, dismiss }">
 *     <DocxEditor.OpenFailure.Action variant="primary" @click="report(failure.code); dismiss()">
 *       Report
 *     </DocxEditor.OpenFailure.Action>
 *   </template>
 * </DocxEditor.OpenFailure>
 * ```
 *
 * The packaged message is generic and names no contact. For a toast or banner instead of a
 * dialog, use `useOpenFailure`.
 *
 * @public
 */
export const DocxEditorOpenFailure = Object.assign(DocxEditorOpenFailureImpl, {
  Action: DocxEditorOpenFailureAction,
}) as unknown as DocxEditorOpenFailureComponent;
