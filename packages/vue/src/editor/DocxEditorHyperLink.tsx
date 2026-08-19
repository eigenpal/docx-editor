import {
  defineComponent,
  Fragment,
  ref,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
  isVNode,
} from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';
import { flattenChildren } from '../lib/flattenChildren';
import { useStableDocxId } from '../lib/stable-id';
import { useTranslation } from '../i18n';
import { absolutePointInScroller } from './scroller-geometry.ts';
import { isFieldLink, useHyperlinkPopup } from './useHyperlinkPopup';
import { Slot } from './toolbar/Slot';

/** Keeps the caret: a mousedown that bubbles to the editor moves it. Inputs are exempt. */
function guardMousedown(event: MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** Shared props for every part. @public */
export interface HyperLinkPartProps {
  className?: string;
  asChild?: boolean;
  hidden?: boolean;
  children?: DocxEditorChildren;
}

/** Props for the action parts, which also take an icon. @public */
export interface HyperLinkActionProps extends HyperLinkPartProps {
  icon?: DocxEditorChildren;
}

/** Props for `DocxEditor.HyperLink`. @public */
export interface HyperLinkProps extends HyperLinkPartProps {
  preset?: boolean;
}

const icon = (path: string): VNode => (
  <svg viewBox="0 -960 960 960" width={16} height={16} aria-hidden="true" focusable="false">
    <path d={path} fill="currentColor" />
  </svg>
);

const COPY_ICON =
  'M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z';
const EDIT_ICON =
  'M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z';
const UNLINK_ICON =
  'M770-302 656-416l57-57 114 114-57 57ZM603-469 469-603l57-57 134 134-57 57ZM280-280h133v80H280q-83 0-141.5-58.5T80-400q0-83 58.5-141.5T280-600h133v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35Zm40-80v-80h101l80 80H320Zm493-15-57-57q23-11 33.5-32t10.5-36q0-50-35-85t-85-35H547v-80h133q83 0 141.5 58.5T880-400q0 32-11 61.5T813-375ZM792-56 56-792l56-56 736 736-56 56Z';
const OPEN_ICON =
  'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z';

function partOverrides(children: VNode[]): Record<string, VNode | VNode[]> {
  const found: Record<string, VNode | VNode[]> = {};
  const extra: VNode[] = [];
  const visit = (nodes: VNode[]): void => {
    for (const node of nodes) {
      if (!isVNode(node)) continue;
      if (node.type === Fragment) {
        visit(flattenChildren(node.children));
        continue;
      }
      const marker = (node.type as { docxHyperLinkPart?: string }).docxHyperLinkPart;
      if (marker) found[marker] = node;
      else extra.push(node);
    }
  };
  visit(children);
  if (extra.length > 0) found.__extra = extra;
  return found;
}

const HyperLinkUrl = defineComponent({
  name: 'HyperLinkUrl',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const popup = useHyperlinkPopup();
    const { t } = useTranslation();
    return () => {
      const state = popup.state.value;
      if (props.hidden || !state.link) return null;
      const inert = !state.link.href;
      const internal = state.link.kind === 'internal';
      const text = internal ? `#${state.link.anchor ?? ''}` : state.link.authored;
      const hint = inert
        ? t('hyperlinkPopup.inertTarget')
        : internal
          ? t('hyperlinkPopup.bookmarkTarget')
          : t('hyperlinkPopup.openLink');
      const shared = {
        class: `docx-hyperlink-popup__url${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'hyperlink-popup-url',
        ...(inert ? { 'data-inert': '' } : {}),
        title: hint,
        onMousedown: guardMousedown,
        ...(inert ? {} : { onClick: () => popup.openTarget(), type: 'button' as const }),
      };
      const content = slots.default?.() ?? text;
      if (props.asChild) return <Slot {...shared}>{content}</Slot>;
      if (inert) {
        return (
          <span {...shared}>
            {content}
            <span class="docx-editor-sr-only">{hint}</span>
          </span>
        );
      }
      return (
        <button {...shared}>
          {content}
          {icon(OPEN_ICON)}
        </button>
      );
    };
  },
});
(HyperLinkUrl as unknown as { docxHyperLinkPart: string }).docxHyperLinkPart = 'Url';

const HyperLinkCopy = defineComponent({
  name: 'HyperLinkCopy',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
  },
  setup(props, { slots }) {
    const popup = useHyperlinkPopup();
    const { t } = useTranslation();
    return () => {
      const state = popup.state.value;
      if (props.hidden || !state.link?.href) return null;
      const label = state.copied ? t('editor.linkCopied') : t('hyperlinkPopup.copyLink');
      const shared = {
        type: 'button' as const,
        class: `docx-hyperlink-popup__action${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'hyperlink-popup-copy',
        ...(state.copied ? { 'data-copied': '' } : {}),
        'aria-label': label,
        title: label,
        onMousedown: guardMousedown,
        onClick: () => void popup.copy(),
      };
      const content = props.icon ?? slots.default?.() ?? icon(COPY_ICON);
      if (props.asChild) return <Slot {...shared}>{content}</Slot>;
      return <button {...shared}>{content}</button>;
    };
  },
});
(HyperLinkCopy as unknown as { docxHyperLinkPart: string }).docxHyperLinkPart = 'Copy';

const HyperLinkEdit = defineComponent({
  name: 'HyperLinkEdit',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
  },
  setup(props, { slots }) {
    const popup = useHyperlinkPopup();
    const { t } = useTranslation();
    return () => {
      if (props.hidden) return null;
      const label = t('hyperlinkPopup.editLink');
      const shared = {
        type: 'button' as const,
        class: `docx-hyperlink-popup__action${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'hyperlink-popup-edit',
        'aria-label': label,
        title: label,
        onMousedown: guardMousedown,
        onClick: () => popup.beginEdit(),
      };
      const content = props.icon ?? slots.default?.() ?? icon(EDIT_ICON);
      if (props.asChild) return <Slot {...shared}>{content}</Slot>;
      return <button {...shared}>{content}</button>;
    };
  },
});
(HyperLinkEdit as unknown as { docxHyperLinkPart: string }).docxHyperLinkPart = 'Edit';

const HyperLinkUnlink = defineComponent({
  name: 'HyperLinkUnlink',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
  },
  setup(props, { slots }) {
    const popup = useHyperlinkPopup();
    const { t } = useTranslation();
    return () => {
      if (props.hidden) return null;
      const label = t('hyperlinkPopup.removeLink');
      const shared = {
        type: 'button' as const,
        class: `docx-hyperlink-popup__action${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'hyperlink-popup-unlink',
        'aria-label': label,
        title: label,
        onMousedown: guardMousedown,
        onClick: () => popup.unlink(),
      };
      const content = props.icon ?? slots.default?.() ?? icon(UNLINK_ICON);
      if (props.asChild) return <Slot {...shared}>{content}</Slot>;
      return <button {...shared}>{content}</button>;
    };
  },
});
(HyperLinkUnlink as unknown as { docxHyperLinkPart: string }).docxHyperLinkPart = 'Unlink';

const HyperLinkFields = defineComponent({
  name: 'HyperLinkFields',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const popup = useHyperlinkPopup();
    const { t } = useTranslation();
    const urlRef = ref<HTMLInputElement | null>(null);
    const textId = useStableDocxId('hyperlink-text');
    const urlId = useStableDocxId('hyperlink-url');

    watch(
      () => popup.state.value.mode,
      (mode) => {
        if (mode !== 'editing') return;
        urlRef.value?.focus({ preventScroll: true });
        urlRef.value?.select();
      },
      { flush: 'post' }
    );

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        popup.commitEdit();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        popup.close();
      }
    };

    return () => {
      if (props.hidden) return null;
      const state = popup.state.value;
      return (
        <div class={`docx-hyperlink-popup__fields${props.className ? ` ${props.className}` : ''}`}>
          <label class="docx-editor-sr-only" for={textId}>
            {t('hyperlinkPopup.displayTextPlaceholder')}
          </label>
          <input
            id={textId}
            data-testid="hyperlink-popup-text"
            class="docx-hyperlink-popup__input"
            value={state.text}
            placeholder={t('hyperlinkPopup.displayTextPlaceholder')}
            onInput={(event) => popup.setText((event.target as HTMLInputElement).value)}
            onKeydown={onKeyDown}
          />
          <label class="docx-editor-sr-only" for={urlId}>
            {t('hyperlinkPopup.urlPlaceholder')}
          </label>
          <input
            id={urlId}
            ref={urlRef}
            data-testid="hyperlink-popup-url-input"
            class="docx-hyperlink-popup__input"
            value={state.url}
            placeholder={t('hyperlinkPopup.urlPlaceholder')}
            onInput={(event) => popup.setUrl((event.target as HTMLInputElement).value)}
            onKeydown={onKeyDown}
          />
        </div>
      );
    };
  },
});
(HyperLinkFields as unknown as { docxHyperLinkPart: string }).docxHyperLinkPart = 'Fields';

const HyperLinkApply = defineComponent({
  name: 'HyperLinkApply',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const popup = useHyperlinkPopup();
    const { t } = useTranslation();
    return () => {
      if (props.hidden) return null;
      const state = popup.state.value;
      const label = t('hyperlinkPopup.apply');
      const shared = {
        type: 'button' as const,
        class: `docx-hyperlink-popup__apply${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'hyperlink-popup-apply',
        disabled: state.url.trim().length === 0,
        onMousedown: guardMousedown,
        onClick: () => popup.commitEdit(),
      };
      if (props.asChild) return <Slot {...shared}>{slots.default?.()}</Slot>;
      return <button {...shared}>{slots.default?.() ?? label}</button>;
    };
  },
});
(HyperLinkApply as unknown as { docxHyperLinkPart: string }).docxHyperLinkPart = 'Apply';

const HyperLinkError = defineComponent({
  name: 'HyperLinkError',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const popup = useHyperlinkPopup();
    const { t } = useTranslation();
    return () => {
      const state = popup.state.value;
      if (props.hidden || !state.error) return null;
      return (
        <div
          class={`docx-hyperlink-popup__error${props.className ? ` ${props.className}` : ''}`}
          data-testid="hyperlink-popup-error"
          role="alert"
        >
          {t('hyperlinkPopup.refused')}
        </div>
      );
    };
  },
});
(HyperLinkError as unknown as { docxHyperLinkPart: string }).docxHyperLinkPart = 'Error';

const HyperLinkCancel = defineComponent({
  name: 'HyperLinkCancel',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const popup = useHyperlinkPopup();
    const { t } = useTranslation();
    return () => {
      if (props.hidden) return null;
      const label = t('hyperlinkPopup.cancel');
      const shared = {
        type: 'button' as const,
        class: `docx-hyperlink-popup__cancel${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'hyperlink-popup-cancel',
        onMousedown: guardMousedown,
        onClick: () => popup.close(),
      };
      if (props.asChild) return <Slot {...shared}>{slots.default?.()}</Slot>;
      return <button {...shared}>{slots.default?.() ?? label}</button>;
    };
  },
});
(HyperLinkCancel as unknown as { docxHyperLinkPart: string }).docxHyperLinkPart = 'Cancel';

const HyperLinkPreset = defineComponent({
  name: 'HyperLinkPreset',
  setup(_, { slots }) {
    const popup = useHyperlinkPopup();
    return () => {
      const state = popup.state.value;
      const overrides = partOverrides(flattenChildren(slots.default?.() ?? []));
      const take = (key: string, fallback: VNode): VNode | VNode[] | null =>
        key in overrides ? (overrides[key] as VNode) : fallback;

      if (state.mode === 'editing') {
        return (
          <>
            {take('Fields', <HyperLinkFields />)}
            {take('Error', <HyperLinkError />)}
            <div class="docx-hyperlink-popup__actions">
              {take('Apply', <HyperLinkApply />)}
              {take('Cancel', <HyperLinkCancel />)}
            </div>
            {overrides.__extra}
          </>
        );
      }
      const editable = state.canEdit && !(state.link && isFieldLink(state.link));
      return (
        <>
          {take('Url', <HyperLinkUrl />)}
          <div class="docx-hyperlink-popup__actions">
            {take('Copy', <HyperLinkCopy />)}
            {editable ? take('Edit', <HyperLinkEdit />) : null}
            {editable ? take('Unlink', <HyperLinkUnlink />) : null}
          </div>
          {overrides.__extra}
        </>
      );
    };
  },
});

const HyperLinkRoot = defineComponent({
  name: 'DocxEditorHyperLink',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
    preset: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const popup = useHyperlinkPopup();
    const panelRef = ref<HTMLDivElement | null>(null);
    const placement = ref<CSSProperties | null>(null);
    const { t } = useTranslation();

    watch(
      () => popup.state.value.mode,
      (mode, _, onCleanup) => {
        if (mode === 'closed') return;
        const onKeyDown = (event: KeyboardEvent): void => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          popup.close();
        };
        const onMouseDown = (event: MouseEvent): void => {
          const panel = panelRef.value;
          if (panel && event.target instanceof Node && panel.contains(event.target)) return;
          popup.close();
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onMouseDown, true);
        onCleanup(() => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('mousedown', onMouseDown, true);
        });
      }
    );

    watch(
      () => popup.state.value.anchor,
      () => {
        const anchor = popup.state.value.anchor;
        const panel = panelRef.value;
        if (!anchor || !panel) {
          placement.value = null;
          return;
        }
        const container = panel.offsetParent as HTMLElement | null;
        if (!container) {
          placement.value = null;
          return;
        }
        const { left, top } = absolutePointInScroller(container, anchor.left, anchor.top);
        const maxLeft = Math.max(0, container.scrollWidth - panel.offsetWidth);
        placement.value = { left: Math.max(0, Math.min(left, maxLeft)), top };
      },
      { flush: 'post' }
    );

    return () => {
      const state = popup.state.value;
      const title =
        state.mode === 'editing'
          ? t(state.link ? 'hyperlinkPopup.editTitle' : 'hyperlinkPopup.insertTitle')
          : t('hyperlinkPopup.editLink');

      if (props.hidden) {
        return state.mode === 'closed' ? null : <>{slots.default?.()}</>;
      }
      if (state.mode === 'closed') return null;

      const body = props.preset ? (
        <HyperLinkPreset>{slots.default?.()}</HyperLinkPreset>
      ) : (
        slots.default?.()
      );
      const shared = {
        ref: panelRef,
        class: `docx-hyperlink-popup${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'hyperlink-popup',
        'data-mode': state.mode,
        role: 'dialog' as const,
        'aria-modal': false as const,
        onMousedown: guardMousedown,
        style: placement.value ?? undefined,
        'aria-label': title,
      };

      if (props.asChild) return <Slot {...shared}>{body}</Slot>;
      return <div {...shared}>{body}</div>;
    };
  },
});

/** @public */
export interface DocxEditorHyperLinkNamespace {
  (props: HyperLinkProps): VNode;
  readonly Url: typeof HyperLinkUrl;
  readonly Copy: typeof HyperLinkCopy;
  readonly Edit: typeof HyperLinkEdit;
  readonly Unlink: typeof HyperLinkUnlink;
  readonly Fields: typeof HyperLinkFields;
  readonly Error: typeof HyperLinkError;
  readonly Apply: typeof HyperLinkApply;
  readonly Cancel: typeof HyperLinkCancel;
}

/** @public */
export const DocxEditorHyperLink: DocxEditorHyperLinkNamespace = Object.assign(HyperLinkRoot, {
  Url: HyperLinkUrl,
  Copy: HyperLinkCopy,
  Edit: HyperLinkEdit,
  Unlink: HyperLinkUnlink,
  Fields: HyperLinkFields,
  Error: HyperLinkError,
  Apply: HyperLinkApply,
  Cancel: HyperLinkCancel,
}) as unknown as DocxEditorHyperLinkNamespace;
