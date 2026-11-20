import { defineComponent, onMounted, ref, watch, type PropType } from 'vue';
import {
  focusMenuItemForKey,
  hostWindowOf,
  isHTMLElementNode,
  placeContextMenu,
} from '@docx-editor.dev/core/editor';
import { Z_INDEX } from '../styles/zIndex';
import { formatPx } from '../lib/units';
import { useTranslation } from '../i18n';
import { guardToolbarMousedown } from './toolbar/ToolbarButton';
/** Note hover preview content and viewport coordinates. @public */
export interface DocxEditorNotePreviewProps {
  scopeId: string;
  text: string;
  x: number;
  y: number;
  className?: string;
}
/** Packaged note hover preview. @public */
export const DocxEditorNotePreview = defineComponent({
  name: 'DocxEditorNotePreview',
  props: {
    scopeId: { type: String, required: true },
    text: { type: String, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    className: String,
  },
  setup(props) {
    return () => (
      <div
        role="tooltip"
        class={props.className}
        data-testid="docx-notes-preview"
        style={{
          position: 'fixed',
          left: formatPx(props.x),
          top: formatPx(props.y),
          zIndex: Z_INDEX.popover,
          maxWidth: '280px',
          maxHeight: '40vh',
          overflowY: 'auto',
          padding: '8px 10px',
          background: 'var(--doc-popover-bg)',
          color: 'var(--doc-popover-fg)',
          border: '1px solid var(--doc-border)',
          boxShadow: '0 4px 16px var(--doc-shadow)',
          fontSize: '12px',
          lineHeight: 1.4,
          pointerEvents: 'none',
        }}
      >
        {props.text}
      </div>
    );
  },
});
/** Note context menu state and actions. @public */
export interface DocxEditorNotesContextMenuProps {
  scopeId: string;
  noteKind: 'footnote' | 'endnote';
  noteId: number;
  x: number;
  y: number;
  onDelete(): void;
  onConvert(): void;
  onConvertAll(): void;
  onOpenProperties(): void;
  onClose(): void;
  deleteEnabled: boolean;
  convertEnabled: boolean;
  convertAllEnabled: boolean;
  deleteDisabledReason?: string;
  convertDisabledReason?: string;
  convertAllDisabledReason?: string;
  className?: string;
}
const action = { type: Function as PropType<() => void>, required: true } as const;
/** Packaged note context menu. @public */
export const DocxEditorNotesContextMenu = defineComponent({
  name: 'DocxEditorNotesContextMenu',
  props: {
    scopeId: { type: String, required: true },
    noteKind: { type: String as PropType<'footnote' | 'endnote'>, required: true },
    noteId: { type: Number, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    onDelete: action,
    onConvert: action,
    onConvertAll: action,
    onOpenProperties: action,
    onClose: action,
    deleteEnabled: Boolean,
    convertEnabled: Boolean,
    convertAllEnabled: Boolean,
    deleteDisabledReason: String,
    convertDisabledReason: String,
    convertAllDisabledReason: String,
    className: String,
  },
  setup(props) {
    const { t } = useTranslation();
    const panelRef = ref<HTMLElement | null>(null);
    const placement = ref<ReturnType<typeof placeContextMenu> | null>(null);

    // Keep the menu inside the window: below the pointer, above it, or moved up.
    const place = () => {
      const panel = panelRef.value;
      if (!panel) return;
      const { width, height } = panel.getBoundingClientRect();
      const view = hostWindowOf(panel);
      const rtl = view.getComputedStyle(panel).direction === 'rtl';
      placement.value = placeContextMenu(
        { x: props.x, y: props.y },
        { width, height },
        { width: view.innerWidth, height: view.innerHeight },
        rtl
      );
    };
    onMounted(place);
    watch(() => [props.x, props.y], place, { flush: 'post' });
    // Focus the first row once the menu is placed, so the arrow keys and Escape work at once.
    watch(
      placement,
      (current) => {
        if (current) focusMenuItemForKey(panelRef.value, 'Home');
      },
      { flush: 'post' }
    );

    return () => (
      <div
        ref={(element: unknown) => {
          panelRef.value = isHTMLElementNode(element) ? element : null;
        }}
        role="menu"
        aria-label={t('notes.menuAriaLabel')}
        class={`docx-notes-menu${props.className ? ` ${props.className}` : ''}`}
        data-testid="docx-notes-menu"
        style={{
          left: formatPx(placement.value?.left ?? props.x),
          top: formatPx(placement.value?.top ?? props.y),
          maxHeight: placement.value ? formatPx(placement.value.maxHeight) : undefined,
          // Hidden until measured, so the menu is never seen at a position it then leaves.
          visibility: placement.value ? undefined : 'hidden',
          zIndex: Z_INDEX.popover,
        }}
        onMousedown={guardToolbarMousedown}
        onKeydown={(event) => {
          if (event.key === 'Escape') props.onClose();
          else if (focusMenuItemForKey(panelRef.value, event.key)) event.preventDefault();
        }}
      >
        <button
          type="button"
          role="menuitem"
          class="docx-hf-chrome__menu-item"
          data-testid="docx-notes-menu-delete"
          disabled={!props.deleteEnabled}
          title={props.deleteDisabledReason}
          onClick={props.onDelete}
        >
          {t('notes.delete')}
        </button>
        <button
          type="button"
          role="menuitem"
          class="docx-hf-chrome__menu-item"
          data-testid="docx-notes-menu-convert"
          disabled={!props.convertEnabled}
          title={props.convertDisabledReason}
          onClick={props.onConvert}
        >
          {props.noteKind === 'footnote'
            ? t('notes.convertToEndnote')
            : t('notes.convertToFootnote')}
        </button>
        <button
          type="button"
          role="menuitem"
          class="docx-hf-chrome__menu-item"
          data-testid="docx-notes-menu-convert-all"
          disabled={!props.convertAllEnabled}
          title={props.convertAllDisabledReason}
          onClick={props.onConvertAll}
        >
          {props.noteKind === 'footnote'
            ? t('notes.convertAllFootnotes')
            : t('notes.convertAllEndnotes')}
        </button>
        <div class="docx-hf-chrome__menu-separator" role="separator" />
        <button
          type="button"
          role="menuitem"
          class="docx-hf-chrome__menu-item"
          data-testid="docx-notes-menu-properties"
          onClick={props.onOpenProperties}
        >
          {t('dialogs.footnoteProperties.title')}
        </button>
      </div>
    );
  },
});
