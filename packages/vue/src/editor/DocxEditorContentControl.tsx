import { defineComponent, ref, watch, type CSSProperties, type PropType, type VNode } from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useStableDocxId } from '../lib/stable-id';
import { useTranslation } from '../i18n';
import { useContentControl, type ContentControlInspectorState } from './useContentControl';
import { Slot } from './toolbar/Slot';

/** Keeps the caret: a mousedown that bubbles to the editor moves it. Inputs are exempt. */
function guardMousedown(event: MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** Shared props for every part. @public */
export interface ContentControlPartProps {
  className?: string;
  asChild?: boolean;
  hidden?: boolean;
  children?: DocxEditorChildren;
}

/** Props for action parts that also take an icon. @public */
export interface ContentControlActionProps extends ContentControlPartProps {
  icon?: DocxEditorChildren;
}

/** Props for `DocxEditor.ContentControl`. @public */
export interface ContentControlProps extends ContentControlPartProps {
  /** Render the packaged arrangement. `false` mounts only the shell and host children. */
  preset?: boolean;
}

const icon = (path: string): VNode => (
  <svg viewBox="0 -960 960 960" width={16} height={16} aria-hidden="true" focusable="false">
    <path d={path} fill="currentColor" />
  </svg>
);

const CLOSE_ICON =
  'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z';
const REMOVE_ICON =
  'M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z';

const panelStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 20,
  minWidth: 240,
  maxWidth: 320,
  top: 12,
  right: 12,
  padding: 12,
  borderRadius: 8,
  border: '1px solid var(--doc-border)',
  backgroundColor: 'var(--doc-surface)',
  boxShadow: '0 4px 16px var(--doc-shadow)',
  color: 'var(--doc-text)',
  fontSize: 13,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'baseline',
};

const labelStyle: CSSProperties = {
  color: 'var(--doc-text-muted)',
  flexShrink: 0,
};

const valueStyle: CSSProperties = {
  textAlign: 'right',
  wordBreak: 'break-word',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontWeight: 600,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 4,
};

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 4,
  border: '1px solid var(--doc-border)',
  backgroundColor: 'var(--doc-bg)',
  color: 'var(--doc-text)',
  font: 'inherit',
  cursor: 'pointer',
};

function typeLabelKey(type: ContentControlInspectorState['controlType']): string {
  switch (type) {
    case 'plainText':
      return 'contentControl.types.plainText';
    case 'checkbox':
      return 'contentControl.types.checkbox';
    case 'dropdown':
      return 'contentControl.types.dropdown';
    case 'comboBox':
      return 'contentControl.types.comboBox';
    case 'date':
      return 'contentControl.types.date';
    case 'picture':
      return 'contentControl.types.picture';
    case 'repeatingSection':
      return 'contentControl.types.repeatingSection';
    case 'richText':
    default:
      return 'contentControl.types.richText';
  }
}

function lockLabelKey(control: ContentControlInspectorState): string {
  if (control.effectiveLock === 'sdtContentLocked') {
    return 'contentControl.lock.sdtContentLocked';
  }
  if (control.effectiveLock === 'contentLocked' || control.locked) {
    return 'contentControl.lock.contentLocked';
  }
  if (control.effectiveLock === 'sdtLocked' || control.removalLocked) {
    return 'contentControl.lock.sdtLocked';
  }
  return 'contentControl.lock.unlocked';
}

const Field = defineComponent({
  name: 'ContentControlField',
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
    testId: { type: String, required: true },
  },
  setup(props) {
    return () => (
      <div style={rowStyle} data-testid={props.testId}>
        <span style={labelStyle}>{props.label}</span>
        <span style={valueStyle}>{props.value}</span>
      </div>
    );
  },
});

const ContentControlHeader = defineComponent({
  name: 'ContentControlHeader',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const { closeInspector } = useContentControl();
    const { t } = useTranslation();
    return () => {
      if (props.hidden) return null;
      const shared = {
        style: headerStyle,
        class: props.className ?? undefined,
        'data-testid': 'content-control-inspector-header',
      };
      const content = (
        <>
          <span>{slots.default?.() ?? t('contentControl.inspectorPanel.title')}</span>
          <button
            type="button"
            data-testid="content-control-inspector-close"
            aria-label={t('common.close')}
            title={t('common.close')}
            style={{
              ...buttonStyle,
              padding: 4,
              border: 'none',
              background: 'transparent',
            }}
            onMousedown={guardMousedown}
            onClick={() => closeInspector()}
          >
            {icon(CLOSE_ICON)}
          </button>
        </>
      );
      if (props.asChild) return <Slot {...shared}>{content}</Slot>;
      return <div {...shared}>{content}</div>;
    };
  },
});

const ContentControlFields = defineComponent({
  name: 'ContentControlFields',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const { control } = useContentControl();
    const { t } = useTranslation();
    return () => {
      const current = control.value;
      if (props.hidden || !current) return null;
      const empty = t('contentControl.inspectorPanel.empty');
      const yes = t('contentControl.inspectorPanel.yes');
      const no = t('contentControl.inspectorPanel.no');
      const fields = slots.default?.() ?? [
        <Field
          label={t('contentControl.inspectorPanel.alias')}
          value={current.alias ?? empty}
          testId="content-control-inspector-alias"
        />,
        <Field
          label={t('contentControl.inspectorPanel.tag')}
          value={current.tag ?? empty}
          testId="content-control-inspector-tag"
        />,
        <Field
          label={t('contentControl.inspectorPanel.type')}
          value={t(typeLabelKey(current.controlType) as 'contentControl.types.richText')}
          testId="content-control-inspector-type"
        />,
        <Field
          label={t('contentControl.inspectorPanel.lock')}
          value={t(lockLabelKey(current) as 'contentControl.lock.unlocked')}
          testId="content-control-inspector-lock"
        />,
        <Field
          label={t('contentControl.inspectorPanel.placeholder')}
          value={current.placeholder ? yes : no}
          testId="content-control-inspector-placeholder"
        />,
        <Field
          label={t('contentControl.inspectorPanel.bound')}
          value={current.bound ? yes : no}
          testId="content-control-inspector-bound"
        />,
        current.bound ? (
          <p
            data-testid="content-control-inspector-bound-note"
            style={{ margin: 0, color: 'var(--doc-text-muted)', fontSize: 12 }}
          >
            {t('contentControl.inspectorPanel.boundNote')}
          </p>
        ) : null,
        current.locked ? (
          <p
            data-testid="content-control-inspector-locked-note"
            style={{ margin: 0, color: 'var(--doc-text-muted)', fontSize: 12 }}
            aria-live="polite"
          >
            {t('contentControl.inspectorPanel.lockedNote')}
          </p>
        ) : null,
      ];
      const shared = {
        class: props.className ?? undefined,
        'data-testid': 'content-control-inspector-fields',
        style: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
      };
      if (props.asChild) return <Slot {...shared}>{fields}</Slot>;
      return <div {...shared}>{fields}</div>;
    };
  },
});

const ContentControlRemove = defineComponent({
  name: 'ContentControlRemove',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
  },
  setup(props, { slots }) {
    const { canRemove, removeDisabledReason, remove, closeInspector } = useContentControl();
    const { t } = useTranslation();
    return () => {
      if (props.hidden) return null;
      const label = t('contentControl.remove');
      const shared = {
        type: 'button' as const,
        class: `docx-content-control-inspector__remove${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'content-control-inspector-remove',
        'data-slot': 'contentControl.remove',
        disabled: !canRemove.value,
        ...(!canRemove.value ? { 'data-disabled': '' } : {}),
        'aria-label': label,
        title: removeDisabledReason.value ?? label,
        style: buttonStyle,
        onMousedown: guardMousedown,
        onClick: () => {
          const result = remove();
          if (result.ok) closeInspector();
        },
      };
      const content = (
        <>
          {props.icon ?? slots.default?.() ?? icon(REMOVE_ICON)}
          <span>{label}</span>
        </>
      );
      if (props.asChild) return <Slot {...shared}>{content}</Slot>;
      return <button {...shared}>{content}</button>;
    };
  },
});

const ContentControlRoot = defineComponent({
  name: 'DocxEditorContentControl',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    hidden: { type: Boolean, default: undefined },
    preset: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const chrome = useContentControl();
    const panelRef = ref<HTMLDivElement | null>(null);
    const titleId = useStableDocxId('content-control-title');
    const { t } = useTranslation();

    watch(
      () => chrome.inspectorOpen.value,
      (open, _, onCleanup) => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent): void => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          chrome.closeInspector();
        };
        const onMouseDown = (event: MouseEvent): void => {
          const panel = panelRef.value;
          if (panel && event.target instanceof Node && panel.contains(event.target)) return;
          chrome.closeInspector();
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onMouseDown, true);
        onCleanup(() => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('mousedown', onMouseDown, true);
        });
      }
    );

    watch([() => chrome.inspectorOpen.value, () => chrome.control.value], ([open, control]) => {
      if (open && !control) chrome.closeInspector();
    });

    return () => {
      const control = chrome.control.value;
      if (props.hidden || !chrome.inspectorOpen.value || !control) return null;

      const body = props.preset ? (
        <>
          <ContentControlHeader />
          <ContentControlFields />
          <div style={actionsStyle}>
            <ContentControlRemove />
          </div>
          {slots.default?.()}
        </>
      ) : (
        slots.default?.()
      );

      const shared = {
        ref: panelRef,
        role: 'dialog' as const,
        'aria-modal': false as const,
        'aria-labelledby': titleId,
        'data-testid': 'content-control-inspector',
        'data-control-id': control.id,
        'data-control-type': control.controlType,
        ...(control.locked ? { 'data-locked': '' } : {}),
        ...(control.bound ? { 'data-bound': '' } : {}),
        ...(control.placeholder ? { 'data-placeholder': '' } : {}),
        class: `docx-content-control-inspector${props.className ? ` ${props.className}` : ''}`,
        style: panelStyle,
        onMousedown: (event: MouseEvent) => {
          guardMousedown(event);
          event.stopPropagation();
        },
      };

      const titled = (
        <>
          <span id={titleId} class="docx-editor-sr-only">
            {t('contentControl.inspectorPanel.title')}
          </span>
          {body}
        </>
      );

      if (props.asChild) return <Slot {...shared}>{titled}</Slot>;
      return <div {...shared}>{titled}</div>;
    };
  },
});

/** @public */
export interface DocxEditorContentControlNamespace {
  (props: ContentControlProps): VNode;
  readonly Header: typeof ContentControlHeader;
  readonly Fields: typeof ContentControlFields;
  readonly Remove: typeof ContentControlRemove;
}

/** @public */
export const DocxEditorContentControl: DocxEditorContentControlNamespace = Object.assign(
  ContentControlRoot,
  {
    Header: ContentControlHeader,
    Fields: ContentControlFields,
    Remove: ContentControlRemove,
  }
) as unknown as DocxEditorContentControlNamespace;
